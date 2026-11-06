// @ts-nocheck
/**
 * Serves the real phase.rs Magic client (phase-rs/phase) and a results ladder.
 * The engine wasm and card data stay on phase's CDN; this origin proxies the
 * matching web client and records VICTORY / DEFEAT / DRAW.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { injectGrokPwaHead } from "./grok-pwa-shared.mjs";

export const PHASE_UPSTREAM = "https://preview.phase-rs.dev";
/** Where the table opens 1v1. Override with PHASE_LOBBY_URL. Must be a wss:// URL the browser can reach. */
export const PHASE_LOBBY_URL = process.env.PHASE_LOBBY_URL || "wss://play.magiccards.io/ws";
const LADDER_PATH = join(process.cwd(), "data", "phase-ladder.json");
const AI_RATING = 1200;
const K = 32;

const SKIP_PREFIXES = [
  "/__ladder",
  "/api/",
  "/__grok",
  "/_server",
  "/@",
  "/src/",
  "/node_modules/",
  "/auth/",
];

export function shouldProxyPhase(pathname) {
  if (!pathname || pathname === "") return false;
  return !SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function emptyBoard() {
  return { players: {}, recent: [] };
}

let memoryBoard = null;

function loadBoard() {
  if (memoryBoard) return memoryBoard;
  try {
    const raw = JSON.parse(readFileSync(LADDER_PATH, "utf8"));
    if (!raw || typeof raw !== "object" || typeof raw.players !== "object") return emptyBoard();
    if (!Array.isArray(raw.recent)) raw.recent = [];
    memoryBoard = raw;
    return raw;
  } catch {
    memoryBoard = emptyBoard();
    return memoryBoard;
  }
}

function saveBoard(board) {
  memoryBoard = board;
  try {
    mkdirSync(dirname(LADDER_PATH), { recursive: true });
    writeFileSync(LADDER_PATH, JSON.stringify(board));
  } catch {
    // Preview disk can be read-only after deploy; the in-memory board still stands.
  }
}

function cleanName(value) {
  const name = String(value ?? "")
    .replace(/[<>&]/g, "")
    .trim()
    .slice(0, 24);
  return name || "You";
}

function expected(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export function ladderStandings() {
  const board = loadBoard();
  const players = Object.values(board.players)
    .map((p) => ({
      name: p.name,
      rating: p.rating,
      w: p.w,
      l: p.l,
      d: p.d,
      played: p.w + p.l + p.d,
    }))
    .sort((a, b) => b.rating - a.rating || b.w - a.w || a.name.localeCompare(b.name));
  return { players, recent: board.recent.slice(0, 12) };
}

export function recordLadderResult({ name, result, gamePath }) {
  const outcome = result === "win" || result === "loss" || result === "draw" ? result : null;
  if (!outcome) return { ok: false, error: "bad result" };
  const playerName = cleanName(name);
  const path = String(gamePath ?? "").slice(0, 180);
  const board = loadBoard();
  if (path && board.recent.some((row) => row.gamePath === path)) {
    return { ok: true, duplicate: true, ...ladderStandings(), you: board.players[playerName.toLowerCase()] };
  }
  const key = playerName.toLowerCase();
  const row = board.players[key] ?? { name: playerName, rating: 1200, w: 0, l: 0, d: 0 };
  row.name = playerName;
  const before = row.rating;
  const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const delta = Math.round(K * (score - expected(before, AI_RATING)));
  row.rating = Math.max(100, before + delta);
  row[outcome === "win" ? "w" : outcome === "loss" ? "l" : "d"] += 1;
  board.players[key] = row;
  board.recent.unshift({
    name: playerName,
    result: outcome,
    delta,
    rating: row.rating,
    gamePath: path,
    at: Date.now(),
  });
  board.recent = board.recent.slice(0, 40);
  saveBoard(board);
  return { ok: true, duplicate: false, delta, you: row, ...ladderStandings() };
}

export const LADDER_SCRIPT = String.raw`
(() => {
  if (window.__phaseLadder) return;
  window.__phaseLadder = true;
  const KEY = "phase-ladder-name";
  const seen = new Set();
  const root = document.createElement("div");
  root.id = "phase-ladder";
  root.style.cssText = "position:fixed;z-index:80;right:14px;top:12px;font:13px/1.35 ui-sans-serif,system-ui,sans-serif;color:#e7e5e4;";
  document.body.appendChild(root);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.textContent = "Ladder";
  chip.style.cssText = "cursor:pointer;border:1px solid rgba(45,226,255,.55);background:#070814;color:#e8fbff;border-radius:999px;padding:8px 14px;letter-spacing:.08em;text-transform:uppercase;font-size:11px;box-shadow:0 0 18px rgba(45,226,255,.25);";
  const panel = document.createElement("div");
  panel.hidden = true;
  panel.style.cssText = "position:absolute;right:0;top:46px;width:min(340px,calc(100vw - 28px));max-height:min(70vh,520px);overflow:auto;background:#070814;border:1px solid rgba(255,43,214,.55);border-radius:14px;padding:14px 14px 12px;box-shadow:0 18px 50px rgba(0,0,0,.5),0 0 24px rgba(45,226,255,.12);";
  const toast = document.createElement("div");
  toast.hidden = true;
  toast.style.cssText = "position:absolute;right:0;top:46px;background:#111827;border:1px solid rgba(62,207,154,.5);color:#d1fae5;border-radius:12px;padding:10px 12px;width:min(280px,calc(100vw - 28px));";
  root.append(panel, toast, chip);

  let open = false;
  chip.onclick = () => { open = !open; panel.hidden = !open; if (open) toast.hidden = true; };
  function name() { return (localStorage.getItem(KEY) || "You").slice(0, 24); }
  function setName(v) { localStorage.setItem(KEY, v.slice(0, 24)); }

  function render(data) {
    const you = name();
    const rows = (data.players || []).map((p, i) =>
      '<tr><td style="padding:4px 6px 4px 0;color:#a8a29e">' + (i + 1) + '</td><td style="padding:4px 8px">' + p.name + (p.name.toLowerCase() === you.toLowerCase() ? ' <span style="color:#e39a45">you</span>' : '') + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' + p.rating + '</td><td style="text-align:right;color:#a8a29e;font-variant-numeric:tabular-nums">' + p.w + '-' + p.l + '-' + p.d + '</td></tr>'
    ).join("") || '<tr><td colspan="4" style="color:#a8a29e;padding:8px 0">No finished games yet. Finish a match and it posts here.</td></tr>';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><strong style="letter-spacing:.14em;font-size:11px;text-transform:uppercase;color:#2de2ff">Magic Cards</strong><span style="color:#a8a29e;font-size:11px">vs the table AI</span></div>' +
      '<p style="margin:8px 0 10px;color:#a8a29e">Finish a game on the Magic Cards table and the result moves your rating.</p>' +
      '<label style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">Name<input id="phase-ladder-name" maxlength="24" style="display:block;width:100%;margin-top:4px;box-sizing:border-box;background:#07080c;color:#efe8dc;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px"></label>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px"><thead><tr style="color:#78716c;font-size:11px;letter-spacing:.08em;text-transform:uppercase"><th></th><th style="text-align:left">Seat</th><th style="text-align:right">Rating</th><th style="text-align:right">W-L-D</th></tr></thead><tbody>' + rows + '</tbody></table>';
    const input = panel.querySelector("#phase-ladder-name");
    input.value = you;
    input.addEventListener("change", () => { setName(input.value.trim() || "You"); render(data); });
    const mine = (data.players || []).find((p) => p.name.toLowerCase() === you.toLowerCase());
    chip.textContent = mine ? "Ladder " + mine.rating : "Ladder";
  }

  async function refresh() {
    const res = await fetch("/__ladder/board");
    const data = await res.json();
    render(data);
  }

  function flash(text) {
    toast.hidden = false;
    toast.textContent = text;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  async function post(result) {
    const res = await fetch("/__ladder/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name(), result, gamePath: location.pathname }),
    });
    const data = await res.json();
    render(data);
    if (!data.duplicate && typeof data.delta === "number") {
      const sign = data.delta > 0 ? "+" + data.delta : String(data.delta);
      const word = result === "win" ? "Victory" : result === "loss" ? "Defeat" : "Draw";
      flash(word + " posted. Rating " + data.you.rating + " (" + sign + ").");
    }
  }

  const LOGO = "/__ladder/logo.png";

  function paint() {
    if (!document.getElementById("mc-font")) {
      const link = document.createElement("link");
      link.id = "mc-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&display=swap";
      document.head.appendChild(link);
    }
    if (document.getElementById("mc-theme")) return;
    const style = document.createElement("style");
    style.id = "mc-theme";
    style.textContent = [
      ":root{",
      "--color-ember:#ff2bd6;--color-ember-bright:#c84bff;--color-ember-text:#ffd0f6;--color-ember-soft:#ff7ae8;",
      "--color-arcane:#2de2ff;--color-arcane-text:#c9fbff;--color-arcane-soft:#7af0ff;",
      "--color-jade:#3dff9a;--color-jade-text:#c8ffe4;--color-jade-soft:#7dffc0;",
      "--color-rose:#ff4ad8;",
      "--color-hairline:rgba(45,226,255,.22);--color-hairline-hover:rgba(255,43,214,.5);--color-hairline-strong:rgba(61,255,154,.18);",
      "}",
      ".mc-wordmark{font-family:Cinzel,Palatino,'Palatino Linotype',serif !important;font-weight:900;letter-spacing:.14em;text-transform:uppercase;}",
      "nav[aria-label='Primary navigation']{",
      "background:linear-gradient(180deg,rgba(8,10,22,.96),rgba(8,4,18,.94)) padding-box,linear-gradient(180deg,#3dff9a,#2de2ff 42%,#7a3dff 72%,#ff2bd6) border-box !important;",
      "border-right:1px solid transparent !important;",
      "box-shadow:10px 0 36px rgba(45,226,255,.14) !important;",
      "}",
      "nav[aria-label='Primary navigation'] a[aria-current='page']{",
      "background:linear-gradient(180deg,rgba(45,226,255,.2),rgba(255,43,214,.16)) !important;",
      "border-color:rgba(45,226,255,.72) !important;",
      "box-shadow:0 0 16px rgba(45,226,255,.28) !important;",
      "color:#f4feff !important;",
      "}",
      "nav[aria-label='Primary navigation'] a:hover,nav[aria-label='Primary navigation'] button:hover{",
      "border-color:rgba(255,43,214,.45) !important;",
      "}",
    ].join("");
    document.head.appendChild(style);
  }

  function logoImg(big) {
    const img = document.createElement("img");
    img.src = LOGO;
    img.alt = "Magic Cards";
    img.dataset.mc = "logo";
    img.style.cssText = big
      ? "display:block;width:min(168px,42vw);height:auto;object-fit:contain;filter:drop-shadow(0 0 16px rgba(45,226,255,.45)) drop-shadow(0 0 26px rgba(255,43,214,.35));"
      : "width:42px;height:42px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(45,226,255,.55));";
    return img;
  }

  function brand() {
    paint();
    if (document.title === "phase.rs") document.title = "Magic Cards";
    document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href.indexOf("favicon") === -1) return;
      if (link.href.indexOf(LOGO) === -1) link.href = LOGO;
    });
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const text of nodes) {
      const value = text.nodeValue || "";
      if (value.includes("matt evans")) text.nodeValue = "Created by Grok through Pump.Fun";
      else if (value.includes("phase.rs") && /fan project|Fanprojekt/i.test(value)) {
        text.nodeValue = value.replaceAll("phase.rs", "magiccards.io");
      } else if (value.includes("An open-source Magic: The Gathering rules engine and game client")) {
        text.nodeValue = value.replace(
          "An open-source Magic: The Gathering rules engine and game client",
          "An open-source play-to-earn Magic: The Gathering rules engine and game client",
        );
      } else if (value.trim() === "phase.rs") text.nodeValue = "Magic Cards";
    }
    document.querySelectorAll("img").forEach((img) => {
      if (img.dataset.mc === "logo") return;
      const src = img.getAttribute("src") || "";
      const brandMark = src.indexOf("wordmark") !== -1 || src.indexOf("logo.webp") !== -1 || src.indexOf("logo_only") !== -1 || src.indexOf("data:image/svg+xml") !== -1;
      if (!brandMark) return;
      const big = src.indexOf("logo_only") === -1 && src.indexOf("data:image/svg+xml") === -1;
      if (!big) {
        img.replaceWith(logoImg(false));
        return;
      }
      const lockup = document.createElement("span");
      lockup.dataset.mc = "lockup";
      lockup.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:10px;";
      const name = document.createElement("span");
      name.textContent = "Magic Cards";
      name.style.cssText = "font-weight:900;letter-spacing:.16em;font-size:28px;line-height:1;text-transform:uppercase;font-family:Cinzel,Palatino,'Palatino Linotype',serif;background:linear-gradient(90deg,#3dff9a,#2de2ff 38%,#7a3dff 70%,#ff2bd6);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(45,226,255,.28));";
      lockup.append(logoImg(true), name);
      img.replaceWith(lockup);
    });
    document.querySelectorAll("span[data-mc='1']").forEach((span) => {
      if ((span.textContent || "").trim() !== "Magic Cards") return;
      const lockup = document.createElement("span");
      lockup.dataset.mc = "lockup";
      lockup.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:10px;";
      const name = document.createElement("span");
      name.textContent = "Magic Cards";
      name.style.cssText = "font-weight:900;letter-spacing:.16em;font-size:28px;line-height:1;text-transform:uppercase;font-family:Cinzel,Palatino,'Palatino Linotype',serif;background:linear-gradient(90deg,#3dff9a,#2de2ff 38%,#7a3dff 70%,#ff2bd6);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(45,226,255,.28));";
      lockup.append(logoImg(true), name);
      span.replaceWith(lockup);
    });
  }

  const obs = new MutationObserver(() => {
    brand();
    if (!location.pathname.startsWith("/game/")) return;
    if (seen.has(location.pathname)) return;
    const headings = document.querySelectorAll("h2");
    for (const h of headings) {
      const text = (h.textContent || "").trim();
      const result = text === "VICTORY" ? "win" : text === "DEFEAT" ? "loss" : text === "DRAW" ? "draw" : null;
      if (!result) continue;
      seen.add(location.pathname);
      post(result);
      break;
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  brand();
  refresh().catch(() => render({ players: [] }));
})();
`;

function stripChallenges(html) {
  return html
    .replace(/<script>\(function\(\)\{function c\(\)\{var b=a\.contentDocument[\s\S]*?<\/script>/g, "")
    .replace(/<script[^>]+src="\/cdn-cgi\/[^"]*"[^>]*><\/script>/g, "");
}

function brandHtml(html) {
  return html
    .replaceAll("<title>phase.rs</title>", "<title>Magic Cards</title>")
    .replaceAll("Loading phase.rs", "Loading Magic Cards")
    .replaceAll(">phase.rs</span>", ">Magic Cards</span>");
}

function injectLadder(html, host) {
  let next = stripChallenges(html);
  next = brandHtml(next);
  next = injectGrokPwaHead(next, { host, cwd: process.cwd() });
  const tag = '<script src="/__ladder/ui.js"></script>';
  if (!next.includes("/__ladder/ui.js")) {
    if (next.includes("</body>")) next = next.replace("</body>", tag + "</body>");
    else next += tag;
  }
  return next;
}

function headerObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-encoding" || k === "content-length" || k === "transfer-encoding") return;
    if (k === "strict-transport-security" || k === "content-security-policy") return;
    if (k === "set-cookie") return;
    out[key] = value;
  });
  return out;
}

export async function proxyPhase(url, host) {
  const pathOnly = url.split("?")[0];
  if (pathOnly === "/config.js") {
    return {
      status: 200,
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: `window.__PHASE_CONFIG__ = ${JSON.stringify({ multiplayerServerUrl: PHASE_LOBBY_URL })};\n`,
    };
  }
  const upstream = new URL(url, PHASE_UPSTREAM);
  const response = await fetch(upstream, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "*/*",
    },
  });
  const type = response.headers.get("content-type") || "application/octet-stream";
  const headers = headerObject(response.headers);
  headers["cache-control"] = "no-cache";
  if (type.includes("text/html")) {
    const html = injectLadder(await response.text(), host || "localhost");
    headers["content-type"] = "text/html; charset=utf-8";
    return { status: response.status, headers, body: html };
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers, body: buf };
}

export function ladderResponse(method, pathname, rawBody) {
  if (pathname === "/__ladder/logo.png" && (method === "GET" || method === "HEAD")) {
    try {
      const body = readFileSync(join(process.cwd(), "public/brand/logo.png"));
      return {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=3600",
        },
        body,
      };
    } catch {
      return { status: 404, headers: { "content-type": "text/plain" }, body: "logo missing" };
    }
  }
  if (pathname === "/__ladder/ui.js") {
    return {
      status: 200,
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: LADDER_SCRIPT,
    };
  }
  if (pathname === "/__ladder/board" && method === "GET") {
    return {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(ladderStandings()),
    };
  }
  if (pathname === "/__ladder/result" && method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      payload = {};
    }
    const result = recordLadderResult(payload);
    return {
      status: result.ok ? 200 : 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result),
    };
  }
  return null;
}
