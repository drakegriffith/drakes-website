#!/usr/bin/env node
/*
 * The pledge registry, locally.
 *
 * A thin Node adapter over sign/registry.mjs — the same rules the deployed
 * Cloudflare Worker runs. This file owns HTTP, static files, the admin token,
 * and a node:sqlite store; the rules live next door. Zero dependencies,
 * Node 22+ (node:sqlite, and require() of an ESM module).
 *
 *   node sign/server.js            # http://localhost:8787, also serves the site
 *   PORT=9000 node sign/server.js
 *
 * Admin calls need the token:
 *   ADMIN_TOKEN=hunter2 node sign/server.js
 *   curl -X POST localhost:8787/api/ban -H 'x-admin-token: hunter2' \
 *        -H 'content-type: application/json' \
 *        -d '{"email":"someone@example.com","reason":"GPT wrote paragraph four"}'
 *
 * Storage lives in sign/signatures.db, which is gitignored. The signatures are
 * the only state; everything else in this repo is a flat file, on purpose.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const registry = require("./registry.mjs");

const PORT = Number(process.env.PORT || 8787);
const ROOT = path.join(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "signatures.db");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-token-change-me";

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS signatures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,
    url        TEXT,
    signed_at  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'signed',
    ban_reason TEXT,
    banned_at  TEXT
  );
`);

/* The store port, backed by node:sqlite. Synchronous underneath, async out. */
const store = {
  async query(sql, params) {
    return db.prepare(sql).all(...params);
  },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-admin-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store", ...CORS });
  res.end(payload);
}

function send(res, out) {
  json(res, out.code, out.body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function authorised(req) {
  const given = req.headers["x-admin-token"];
  if (!given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- static files ---------- */

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return json(res, 403, { ok: false, error: "no" });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": MIME[".html"] });
    return res.end("<h1>404</h1><p>Not here. Try <a href='/index.html'>the front page</a>.</p>");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

/* ---------- router ---------- */

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  try {
    if (req.method === "GET" && pathname === "/api/signatures") {
      return send(res, await registry.listSignatures(store));
    }

    if (req.method === "GET" && pathname === "/api/status") {
      return send(res, await registry.status(store, searchParams.get("email")));
    }

    if (req.method === "POST" && pathname === "/api/sign") {
      return send(res, await registry.sign(store, await readBody(req)));
    }

    if (req.method === "POST" && (pathname === "/api/ban" || pathname === "/api/unban")) {
      if (!authorised(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      return send(res, await registry.setBan(store, await readBody(req), pathname === "/api/ban"));
    }

    return json(res, 404, { ok: false, error: `No such endpoint: ${pathname}` });
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`pledge registry on http://localhost:${PORT}`);
  console.log(`  site:       http://localhost:${PORT}/index.html`);
  console.log(`  sign page:  http://localhost:${PORT}/sign.html`);
  console.log(`  database:   ${DB_PATH}`);
  if (ADMIN_TOKEN === "dev-token-change-me") console.log("  admin token: dev-token-change-me (set ADMIN_TOKEN in production)");
});
