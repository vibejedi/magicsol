// @ts-nocheck
/**
 * Serves the real phase.rs Magic client (phase-rs/phase) and a results ladder.
 * The engine wasm and card data stay on phase's CDN; this origin proxies the
 * matching web client and records VICTORY / DEFEAT / DRAW.
 */
import { LOGO_DATA_URL } from "./logo-data.mjs";
import { FX_DATA_URL } from "./fx-data.mjs";
import { INTRO_DATA_URL } from "./intro-data.mjs";
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

function cleanWallet(value) {
  const wallet = String(value ?? "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return "";
  return wallet;
}

function publicPlayer(p) {
  return {
    name: p.name,
    wallet: p.wallet || "",
    rating: p.rating,
    w: p.w,
    l: p.l,
    d: p.d,
    streak: p.streak || 0,
    cards: p.cards || 0,
    played: p.w + p.l + p.d,
    joined: p.joined || null,
  };
}

function expected(a, b) {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

const CARD_PAY = { ai: 5, draft: 15, online: 40 };

export function ladderStandings() {
  const board = loadBoard();
  const players = Object.values(board.players)
    .map((p) => publicPlayer(p))
    .sort((a, b) => b.cards - a.cards || b.streak - a.streak || b.rating - a.rating || a.name.localeCompare(b.name));
  return { players, recent: board.recent.slice(0, 12) };
}

export function loginPlayer({ username, wallet }) {
  const address = cleanWallet(wallet);
  if (!address) return { ok: false, error: "Enter a Solana wallet address." };
  const playerName = cleanName(username);
  if (!String(username ?? "").trim() || playerName === "You") return { ok: false, error: "Choose a username." };
  const board = loadBoard();
  const taken = Object.values(board.players).find(
    (p) => p.wallet !== address && String(p.name || "").toLowerCase() === playerName.toLowerCase(),
  );
  if (taken) return { ok: false, error: "That username is already taken." };
  const row = board.players[address] ?? {
    name: playerName,
    wallet: address,
    rating: 1200,
    w: 0,
    l: 0,
    d: 0,
    streak: 0,
    cards: 0,
    joined: Date.now(),
  };
  row.name = playerName;
  row.wallet = address;
  row.lastSeen = Date.now();
  board.players[address] = row;
  board.signins = Array.isArray(board.signins) ? board.signins : [];
  board.signins.unshift({ name: playerName, wallet: address, at: Date.now() });
  board.signins = board.signins.slice(0, 200);
  saveBoard(board);
  return { ok: true, you: publicPlayer(row), ...ladderStandings() };
}

export function recordLadderResult({ name, result, gamePath, mode, wallet }) {
  const outcome = result === "win" || result === "loss" || result === "draw" ? result : null;
  if (!outcome) return { ok: false, error: "bad result" };
  const address = cleanWallet(wallet);
  if (!address) return { ok: false, error: "Sign in with your wallet first." };
  const table = mode === "online" || mode === "draft" || mode === "ai" ? mode : "ai";
  const path = String(gamePath ?? "").slice(0, 180);
  const board = loadBoard();
  const row = board.players[address];
  if (!row) return { ok: false, error: "Sign in on the leaderboard first." };
  if (path && board.recent.some((entry) => entry.gamePath === path && entry.wallet === address)) {
    return { ok: true, duplicate: true, ...ladderStandings(), you: publicPlayer(row) };
  }
  row.streak = row.streak || 0;
  row.cards = row.cards || 0;
  const before = row.rating;
  const score = outcome === "win" ? 1 : outcome === "draw" ? 0.5 : 0;
  const delta = Math.round(K * (score - expected(before, AI_RATING)));
  row.rating = Math.max(100, before + delta);
  row[outcome === "win" ? "w" : outcome === "loss" ? "l" : "d"] += 1;
  let awarded = 0;
  if (outcome === "win") {
    row.streak += 1;
    awarded = CARD_PAY[table] * row.streak;
    row.cards += awarded;
  } else {
    row.streak = 0;
  }
  row.lastSeen = Date.now();
  board.players[address] = row;
  board.recent.unshift({
    name: row.name,
    wallet: address,
    result: outcome,
    delta,
    rating: row.rating,
    cards: awarded,
    streak: row.streak,
    mode: table,
    gamePath: path,
    at: Date.now(),
  });
  board.recent = board.recent.slice(0, 40);
  saveBoard(board);
  return { ok: true, duplicate: false, delta, awarded, mode: table, you: publicPlayer(row), ...ladderStandings() };
}

export const LADDER_SCRIPT = String.raw`
(() => {
  if (window.__phaseLadder) return;
  window.__phaseLadder = true;
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister().catch(() => {}));
    }).catch(() => {});
  }
  if (location.pathname === "/" || location.pathname === "") {
  const intro = document.createElement("div");
  intro.setAttribute("role", "presentation");
  intro.style.cssText = "position:fixed;inset:0;z-index:400;background:#000;display:grid;place-items:center;cursor:pointer;transition:opacity .7s ease;";
  const introVideo = document.createElement("video");
  introVideo.src = "__MC_INTRO__";
  introVideo.muted = true;
  introVideo.defaultMuted = true;
  introVideo.autoplay = true;
  introVideo.playsInline = true;
  introVideo.setAttribute("muted", "");
  introVideo.setAttribute("playsinline", "");
  introVideo.style.cssText = "width:min(520px,88vw);height:auto;max-height:86vh;object-fit:contain;";
  intro.appendChild(introVideo);
  document.body.appendChild(intro);
  let introClosed = false;
  const closeIntro = () => {
    if (introClosed) return;
    introClosed = true;
    intro.style.opacity = "0";
    setTimeout(() => intro.remove(), 700);
  };
  intro.addEventListener("click", closeIntro);
  setTimeout(closeIntro, 5000);
  introVideo.play().catch(() => {});
  }
  const SEAT = "mc-seat";
  const seen = new Set();
  const root = document.createElement("div");
  root.id = "phase-ladder";
  root.style.cssText = "position:fixed;z-index:30;right:16px;top:60px;font:13px/1.35 ui-sans-serif,system-ui,sans-serif;color:#e7e5e4;";
  document.body.appendChild(root);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.textContent = "Leaderboard";
  chip.style.cssText = "cursor:pointer;border:1px solid rgba(45,226,255,.7);background:#070814;color:#e8fbff;border-radius:999px;padding:8px 16px;letter-spacing:.12em;text-transform:uppercase;font-size:11px;font-weight:700;box-shadow:0 0 18px rgba(45,226,255,.35);";
  const panel = document.createElement("div");
  panel.hidden = true;
  panel.style.cssText = "position:absolute;right:0;top:44px;width:min(420px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:auto;background:#070814;border:1px solid rgba(255,43,214,.55);border-radius:14px;padding:14px 14px 12px;box-shadow:0 18px 50px rgba(0,0,0,.5),0 0 24px rgba(45,226,255,.12);";
  const toast = document.createElement("div");
  toast.hidden = true;
  toast.style.cssText = "position:absolute;right:0;top:46px;background:#111827;border:1px solid rgba(62,207,154,.5);color:#d1fae5;border-radius:12px;padding:10px 12px;width:min(280px,calc(100vw - 28px));";
  root.append(panel, toast, chip);
  function placeChip() {
    const mute = document.querySelector('button[aria-label="Mute"]');
    if (!mute) return;
    const box = mute.getBoundingClientRect();
    const gap = 12;
    const width = root.offsetWidth || 148;
    let right = window.innerWidth - box.left + gap;
    if (right + width > window.innerWidth - 12) right = 12;
    root.style.top = Math.max(8, Math.round(box.top)) + "px";
    root.style.right = Math.round(right) + "px";
  }
  placeChip();
  window.addEventListener("resize", placeChip);

  let open = false;
  chip.onclick = () => { open = !open; panel.hidden = !open; if (open) toast.hidden = true; };
  function seat() {
    try {
      const raw = JSON.parse(localStorage.getItem(SEAT) || "null");
      if (!raw || !raw.wallet || !raw.name) return null;
      return raw;
    } catch {
      return null;
    }
  }
  function setSeat(value) {
    if (value) localStorage.setItem(SEAT, JSON.stringify({ name: value.name, wallet: value.wallet }));
    else localStorage.removeItem(SEAT);
  }
  function shortWallet(wallet) {
    const value = String(wallet || "");
    return value.length < 10 ? value : value.slice(0, 4) + "…" + value.slice(-4);
  }
  function esc(value) {
    return String(value).replace(/[&<>"]/g, (ch) => {
      if (ch === "&") return "&" + "amp;";
      if (ch === "<") return "&" + "lt;";
      if (ch === ">") return "&" + "gt;";
      return "&" + "quot;";
    });
  }
  function rememberMode(text) {
    const t = String(text || "").toLowerCase();
    const mode = t.includes("play online") ? "online" : t.includes("draft") ? "draft" : (t.includes("play vs ai") || t.includes("vs ai") || t.includes("solo")) ? "ai" : "";
    if (mode) sessionStorage.setItem("mc-mode", mode);
  }
  document.addEventListener("click", (event) => {
    const el = event.target && event.target.closest ? event.target.closest("a,button") : null;
    if (el) rememberMode(el.innerText);
  }, true);
  function currentMode() {
    const path = location.pathname;
    if (path.startsWith("/draft")) return "draft";
    if (/online|lobby|multiplayer/.test(path)) return "online";
    return sessionStorage.getItem("mc-mode") || "ai";
  }

  function render(data) {
    const who = seat();
    const rows = (data.players || []).map((p, i) =>
      '<tr><td style="padding:4px 6px 4px 0;color:#a8a29e">' + (i + 1) + '</td><td style="padding:4px 8px 4px 0">' + esc(p.name) + (who && p.wallet === who.wallet ? ' <span style="color:#2de2ff">you</span>' : '') + '<div style="color:#78716c;font-size:11px">' + esc(shortWallet(p.wallet)) + '</div></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + (p.streak || 0) + '</td><td style="text-align:right;color:#3dff9a;font-variant-numeric:tabular-nums">' + (p.cards || 0) + '</td><td style="text-align:right;color:#a8a29e;font-variant-numeric:tabular-nums">' + p.w + '-' + p.l + '-' + p.d + '</td></tr>'
    ).join("") || '<tr><td colspan="5" style="color:#a8a29e;padding:8px 0">No players yet. Sign in to take a seat.</td></tr>';
    const field = 'display:block;width:100%;margin-top:4px;box-sizing:border-box;background:#07080c;color:#efe8dc;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px';
    const account = who
      ? '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:10px"><div><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">Signed in</div><strong>' + esc(who.name) + '</strong><div style="color:#78716c;font-size:11px">' + esc(shortWallet(who.wallet)) + '</div></div><button id="mc-logout" type="button" style="cursor:pointer;background:transparent;color:#a8a29e;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:6px 8px">Log out</button></div>'
      : '<form id="mc-login" style="margin-top:10px"><label style="display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">Username<input id="mc-user" maxlength="24" required style="' + field + '"></label><label style="display:block;margin-top:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a29e">Wallet<input id="mc-wallet" required spellcheck="false" autocapitalize="off" placeholder="Solana address" style="' + field + '"></label><button type="submit" style="margin-top:10px;cursor:pointer;width:100%;border:0;border-radius:8px;padding:9px 10px;background:#2de2ff;color:#070814;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Sign in</button></form>';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><strong style="letter-spacing:.14em;font-size:11px;text-transform:uppercase;color:#2de2ff">Leaderboard</strong><span style="color:#3dff9a;font-size:11px">$CARDS</span></div>' +
      '<p style="margin:8px 0 6px;color:#a8a29e">Sign in with a username and wallet. Consecutive wins pay $CARDS. A loss or a draw resets the streak.</p>' +
      '<p style="margin:0 0 4px;color:#d6d3d1;font-size:12px">Play vs AI <b style="color:#efe8dc">5</b> · Draft <b style="color:#efe8dc">15</b> · Play Online <b style="color:#ff2bd6">40</b> per win, times the streak.</p>' +
      account +
      '<table style="width:100%;border-collapse:collapse;margin-top:12px"><thead><tr style="color:#78716c;font-size:11px;letter-spacing:.08em;text-transform:uppercase"><th></th><th style="text-align:left">Seat</th><th style="text-align:right">Streak</th><th style="text-align:right">$CARDS</th><th style="text-align:right">W-L-D</th></tr></thead><tbody>' + rows + '</tbody></table>';
    const form = panel.querySelector("#mc-login");
    if (form) form.addEventListener("submit", (event) => {
      event.preventDefault();
      signIn(form.querySelector("#mc-user").value, form.querySelector("#mc-wallet").value);
    });
    const logout = panel.querySelector("#mc-logout");
    if (logout) logout.addEventListener("click", () => { setSeat(null); render(data); });
    chip.textContent = "Leaderboard";
  }

  async function signIn(username, wallet) {
    const res = await fetch("/__ladder/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, wallet }),
    });
    const data = await res.json();
    if (!data.ok) {
      flash(data.error || "Could not sign in.");
      return;
    }
    setSeat(data.you);
    render(data);
    flash("Signed in as " + data.you.name + ".");
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
    const who = seat();
    if (!who) {
      open = true;
      panel.hidden = false;
      flash("Sign in on the leaderboard first.");
      return;
    }
    const res = await fetch("/__ladder/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: who.wallet, result, gamePath: location.pathname, mode: currentMode() }),
    });
    const data = await res.json();
    if (!data.ok) {
      flash(data.error || "Could not post the result.");
      return;
    }
    render(data);
    if (!data.duplicate && typeof data.delta === "number") {
      const sign = data.delta > 0 ? "+" + data.delta : String(data.delta);
      const word = result === "win" ? "Victory" : result === "loss" ? "Defeat" : "Draw";
      const purse = data.awarded ? " +" + data.awarded + " $CARDS. Streak " + data.you.streak + "." : " Streak reset.";
      flash(word + " posted. Rating " + data.you.rating + " (" + sign + ")." + purse);
    }
  }

  const LOGO = "__MC_LOGO__";

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
      ? "position:relative;z-index:1;display:block;width:46%;height:auto;object-fit:contain;filter:drop-shadow(0 0 16px rgba(45,226,255,.45)) drop-shadow(0 0 26px rgba(255,43,214,.35));"
      : "width:42px;height:42px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(45,226,255,.55));";
    return img;
  }

  function centerHero(node) {
    let n = node && node.parentElement;
    for (let i = 0; i < 4 && n && !(n.classList && n.classList.contains("menu-scene")); i++) {
      n.style.alignItems = "center";
      n.style.textAlign = "center";
      n = n.parentElement;
    }
  }

  function heroLockup() {
    const lockup = document.createElement("span");
    lockup.dataset.mc = "lockup";
    lockup.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100%;gap:8px;text-align:center;";
    const stage = document.createElement("span");
    stage.style.cssText = "position:relative;display:grid;place-items:center;width:min(320px,78vw);height:min(300px,72vw);overflow:hidden;";
    const video = document.createElement("video");
    video.src = "__MC_FX__";
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;";
    const canvas = document.createElement("canvas");
    canvas.width = 560;
    canvas.height = 560;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;";
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const paintFrame = () => {
      if (video.readyState >= 2 && ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = frame.data;
        for (let i = 0; i < d.length; i += 4) {
          const m = d[i] > d[i + 1] ? (d[i] > d[i + 2] ? d[i] : d[i + 2]) : (d[i + 1] > d[i + 2] ? d[i + 1] : d[i + 2]);
          if (m < 8) {
            d[i + 3] = 0;
            continue;
          }
          d[i] = Math.min(255, (d[i] * 5) >> 1);
          d[i + 1] = Math.min(255, (d[i + 1] * 5) >> 1);
          d[i + 2] = Math.min(255, (d[i + 2] * 5) >> 1);
          d[i + 3] = Math.min(255, (m - 8) * 8);
        }
        ctx.putImageData(frame, 0, 0);
      }
      requestAnimationFrame(paintFrame);
    };
    video.addEventListener("playing", () => requestAnimationFrame(paintFrame), { once: true });
    video.play().catch(() => {});
    const name = document.createElement("span");
    name.textContent = "Magic Cards";
    name.style.cssText = "position:relative;z-index:1;font-weight:900;letter-spacing:.16em;font-size:28px;line-height:1;text-transform:uppercase;font-family:Cinzel,Palatino,'Palatino Linotype',serif;background:linear-gradient(90deg,#3dff9a,#2de2ff 38%,#7a3dff 70%,#ff2bd6);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(45,226,255,.28));";
    stage.append(video, canvas, logoImg(true));
    lockup.append(stage, name);
    return lockup;
  }

  function socials() {
    const xIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 fill-current"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
    const pumpIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 fill-current"><path d="M7 3.5h6.2a4.3 4.3 0 0 1 0 8.6H7V3.5Zm2 2v4.6h4.2a2.3 2.3 0 0 0 0-4.6H9Zm-1.2 9h10.4v2H7.8Zm.7 3.4h8.8v2H8.5Z"/></svg>';
    const point = (a, href, label, icon) => {
      if (a.dataset.mcLink === label && a.getAttribute("href") === href) return;
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.title = label;
      a.setAttribute("aria-label", label);
      a.innerHTML = icon;
      a.dataset.mcLink = label;
    };
    document.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href.includes("ko-fi.com") || href.includes("github.com/sponsors")) {
        a.remove();
        return;
      }
      if (href.includes("github.com/phase-rs")) point(a, "https://x.com/lordkahl", "X", xIcon);
      else if (href.includes("discord.gg")) point(a, "https://pump.fun/coin/BWwZ6YWfhFKdfTvDHPX3gQck6WqFqDZesU3x41GAiutn", "Pump.fun", pumpIcon);
    });
  }

  function brand() {
    paint();
    placeChip();
    socials();
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
      const lockup = heroLockup();
      img.replaceWith(lockup);
      centerHero(lockup);
    });
    document.querySelectorAll("span[data-mc='1']").forEach((span) => {
      if ((span.textContent || "").trim() !== "Magic Cards") return;
      const lockup = heroLockup();
      span.replaceWith(lockup);
      centerHero(lockup);
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
`.replace("__MC_LOGO__", LOGO_DATA_URL).replace("__MC_FX__", FX_DATA_URL).replace("__MC_INTRO__", INTRO_DATA_URL);

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
  const tag = '<script src="/__ladder/ui.js?v=10"></script>';
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
  if (pathOnly === "/sw.js") {
    return {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-cache",
      },
      body: `self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));await self.registration.unregister();const all=await self.clients.matchAll({type:"window"});for(const client of all) client.navigate(client.url);})());});
`,
    };
  }
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
  if (pathname === "/__ladder/fx.mp4" && (method === "GET" || method === "HEAD")) {
    try {
      const body = readFileSync(join(process.cwd(), "public/brand/fx.mp4"));
      return {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "cache-control": "public, max-age=86400",
        },
        body,
      };
    } catch {
      return { status: 404, headers: { "content-type": "text/plain" }, body: "fx missing" };
    }
  }
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
  if (pathname === "/__ladder/login" && method === "POST") {
    let payload = {};
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      payload = {};
    }
    const result = loginPlayer(payload);
    return {
      status: result.ok ? 200 : 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(result),
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
