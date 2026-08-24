/**
 * Loopback access relay. Default off. Not FastAPI. Never decrypts the vault.
 * Pairing token required. Browser Origin on POST /v1/access/request is rejected.
 * Policy and plaintext stay in the unlocked PWA.
 */
import { createServer, request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_PWA_ORIGINS = [
  "http://127.0.0.1:8788",
  "http://localhost:8788",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];

export function originsFromEnv(raw = process.env.FOURALLPASS_BROKER_PWA_ORIGINS) {
  if (!raw || !String(raw).trim()) return DEFAULT_PWA_ORIGINS;
  const extra = String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_PWA_ORIGINS, ...extra])];
}

const MAX_BODY = 64 * 1024;
const POLL_MS = 25_000;
const ACCESS_WAIT_MS = 60_000;

export function newBrokerToken() {
  return randomBytes(32).toString("hex");
}

export function pwaOriginAllowed(origin, allowlist = DEFAULT_PWA_ORIGINS) {
  if (!origin) return false;
  return allowlist.includes(origin);
}

/** Browser pages must not call the grant path. Node/n8n typically send no Origin. */
export function browserGrantOrigin(origin) {
  return (
    typeof origin === "string" &&
    (origin.toLowerCase() === "null" || /^https?:\/\//i.test(origin))
  );
}

function readBearer(req) {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match ? match[1] : "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, obj, corsOrigin) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (corsOrigin) {
    headers["access-control-allow-origin"] = corsOrigin;
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers.vary = "origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

/**
 * @param {{ host?: string, port?: number, token: string, pwaOrigins?: string[], log?: { info: Function, warn: Function } }} opts
 */
export function createBroker(opts) {
  const host = opts.host ?? DEFAULT_HOST;
  const token = opts.token;
  if (!token) throw new Error("broker token required");
  const pwaOrigins = opts.pwaOrigins ?? DEFAULT_PWA_ORIGINS;
  const log = opts.log ?? { info() {}, warn() {} };

  /** @type {null | { res: import('node:http').ServerResponse, origin: string, timer: NodeJS.Timeout }} */
  let poller = null;
  /** @type {Array<{ id: string, body: unknown }>} */
  const queue = [];
  /** @type {Map<string, { res: import('node:http').ServerResponse, timer: NodeJS.Timeout }>} */
  const waiting = new Map();

  function flushPoller() {
    if (!poller || queue.length === 0) return;
    const job = queue.shift();
    const { res, origin, timer } = poller;
    poller = null;
    clearTimeout(timer);
    send(res, 200, { v: 1, id: job.id, method: "POST /v1/access/request", body: job.body }, origin);
  }

  function denyWaiting(id, reason) {
    const row = waiting.get(id);
    if (!row) return;
    waiting.delete(id);
    clearTimeout(row.timer);
    send(row.res, 200, { status: "denied", reason });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const cors = pwaOriginAllowed(origin, pwaOrigins) ? origin : "";

    if (req.method === "OPTIONS" && url.pathname.startsWith("/v1/broker/")) {
      if (!cors) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": cors,
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        vary: "origin",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, vault: Boolean(poller) || queue.length > 0 || waiting.size > 0 });
      return;
    }

    const bearer = readBearer(req);
    if (bearer !== token) {
      const allowCors = url.pathname.startsWith("/v1/broker/") ? cors : "";
      send(res, 401, { status: "denied", reason: "malformed_request" }, allowCors);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/broker/poll") {
      if (!cors) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (poller) {
        clearTimeout(poller.timer);
        send(poller.res, 204, {}, poller.origin);
        poller = null;
      }
      const timer = setTimeout(() => {
        if (poller && poller.res === res) {
          poller = null;
          send(res, 204, {}, cors);
        }
      }, POLL_MS);
      poller = { res, origin: cors, timer };
      flushPoller();
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/broker/decide") {
      if (!cors) {
        res.writeHead(403);
        res.end();
        return;
      }
      void readBody(req)
        .then((raw) => {
          let parsed;
          try {
            parsed = JSON.parse(raw || "{}");
          } catch {
            send(res, 400, { status: "denied", reason: "malformed_request" }, cors);
            return;
          }
          const id = parsed.id;
          const body = parsed.body;
          const row = typeof id === "string" ? waiting.get(id) : undefined;
          if (!row) {
            send(res, 404, { status: "denied", reason: "malformed_request" }, cors);
            return;
          }
          waiting.delete(id);
          clearTimeout(row.timer);
          send(row.res, 200, body && typeof body === "object" ? body : { status: "denied", reason: "malformed_request" });
          send(res, 200, { ok: true }, cors);
          log.info("decide", typeof body?.status === "string" ? body.status : "unknown");
        })
        .catch(() => send(res, 400, { status: "denied", reason: "malformed_request" }, cors));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/access/request") {
      if (browserGrantOrigin(origin)) {
        send(res, 403, { status: "denied", reason: "malformed_request" });
        log.warn("rejected browser Origin on grant path");
        return;
      }
      void readBody(req)
        .then((raw) => {
          let body;
          try {
            body = JSON.parse(raw || "{}");
          } catch {
            send(res, 200, { status: "denied", reason: "malformed_request" });
            return;
          }
          if (!poller && queue.length === 0 && waiting.size === 0) {
            send(res, 200, { status: "denied", reason: "vault_locked" });
            return;
          }
          const id = `req_${randomBytes(8).toString("hex")}`;
          const timer = setTimeout(() => denyWaiting(id, "broker_timeout"), ACCESS_WAIT_MS);
          waiting.set(id, { res, timer });
          queue.push({ id, body });
          flushPoller();
        })
        .catch(() => send(res, 200, { status: "denied", reason: "malformed_request" }));
      return;
    }

    send(res, 404, { status: "denied", reason: "malformed_request" });
  });

  function listen(port = opts.port ?? DEFAULT_PORT) {
    return new Promise((resolve) => {
      server.listen(port, host, () => resolve(server.address()));
    });
  }

  function close() {
    if (poller) {
      clearTimeout(poller.timer);
      try {
        poller.res.end();
      } catch {
        /* ignore */
      }
      poller = null;
    }
    for (const [id] of waiting) denyWaiting(id, "vault_locked");
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, listen, close, token, host };
}

export async function postJson(url, { token, body, origin, method = "POST" }) {
  const target = new URL(url);
  const payload = body === undefined ? "" : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(origin ? { origin } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const token = process.env.FOURALLPASS_BROKER_TOKEN || newBrokerToken();
  const port = Number(process.env.FOURALLPASS_BROKER_PORT || DEFAULT_PORT);
  const broker = createBroker({
    token,
    port,
    pwaOrigins: originsFromEnv(),
    log: {
      info: (...args) => console.info("[broker]", ...args),
      warn: (...args) => console.warn("[broker]", ...args),
    },
  });
  const addr = await broker.listen(port);
  const bound = typeof addr === "object" && addr ? addr.port : port;
  console.info(`4AllPass local access broker on http://${DEFAULT_HOST}:${bound}`);
  console.info("Not FastAPI. Default off. Pairing token (paste in the Access tab):");
  console.info(token);
  console.info("n8n: POST /v1/access/request with Authorization: Bearer <token>");
  console.info("Application identity is still a string. Unknown app = DENY in the PWA.");
}
