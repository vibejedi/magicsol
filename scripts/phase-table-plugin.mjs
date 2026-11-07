import { ladderResponse, proxyPhase, shouldProxyPhase } from "./phase-table.mjs";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Dev-server front door: the phase.rs client, plus the ladder endpoints. */
export function phaseTablePlugin() {
  return {
    name: "phase-table",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const raw = req.url || "/";
          const pathname = raw.split("?", 1)[0] || "/";
          if (raw.includes("install=1")) {
            next();
            return;
          }
          const method = (req.method || "GET").toUpperCase();
          if (pathname.startsWith("/__ladder")) {
            const body = method === "POST" ? await readBody(req) : "";
            const out = await ladderResponse(method, pathname, body);
            if (!out) {
              next();
              return;
            }
            res.statusCode = out.status;
            for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
            res.end(out.body);
            return;
          }
          if (!shouldProxyPhase(pathname) || method !== "GET" && method !== "HEAD") {
            next();
            return;
          }
          const host = req.headers.host || "localhost";
          const out = await proxyPhase(raw, host);
          res.statusCode = out.status;
          for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
          if (method === "HEAD") res.end();
          else res.end(out.body);
        } catch (err) {
          console.error("[phase-table]", err);
          next();
        }
      });
    },
  };
}
