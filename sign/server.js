#!/usr/bin/env node
/*
 * The pledge registry.
 *
 * Records who signed the No-AI Pledge, and who got caught and banned.
 * SQLite, zero dependencies, one file. Node 22+ (node:sqlite).
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

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

function publicRow(row) {
  return {
    number: row.id,
    name: row.name,
    url: row.url || null,
    signed_at: row.signed_at,
    status: row.status,
    ban_reason: row.status === "banned" ? row.ban_reason : null,
    banned_at: row.status === "banned" ? row.banned_at : null,
  };
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

/* ---------- handlers ---------- */

function sign(body) {
  const name = String(body.name || "").trim();
  const email = normaliseEmail(body.email);
  const url = String(body.url || "").trim() || null;

  if (!name) return { code: 400, body: { ok: false, error: "A name is required. Yours, ideally." } };
  if (name.length > 120) return { code: 400, body: { ok: false, error: "That name is too long." } };
  if (!validEmail(email)) return { code: 400, body: { ok: false, error: "That email does not look like an email." } };
  if (body.agreed !== true) {
    return { code: 400, body: { ok: false, error: "You have to actually agree to the pledge. That is the whole thing." } };
  }

  const existing = db.prepare("SELECT * FROM signatures WHERE email = ?").get(email);

  if (existing && existing.status === "banned") {
    return {
      code: 403,
      body: {
        ok: false,
        status: "banned",
        error: "This email is banned from the hub.",
        ban_reason: existing.ban_reason,
        banned_at: existing.banned_at,
      },
    };
  }

  if (existing) {
    return {
      code: 200,
      body: { ok: true, status: "already_signed", signature: publicRow(existing), count: countSignatures() },
    };
  }

  const signed_at = new Date().toISOString();
  db.prepare("INSERT INTO signatures (name, email, url, signed_at) VALUES (?, ?, ?, ?)").run(name, email, url, signed_at);
  const row = db.prepare("SELECT * FROM signatures WHERE email = ?").get(email);
  return { code: 201, body: { ok: true, status: "signed", signature: publicRow(row), count: countSignatures() } };
}

function countSignatures() {
  return db.prepare("SELECT COUNT(*) AS n FROM signatures WHERE status != 'banned'").get().n;
}

function listSignatures() {
  const rows = db.prepare("SELECT * FROM signatures ORDER BY id ASC").all();
  return {
    ok: true,
    count: rows.filter((r) => r.status !== "banned").length,
    banned: rows.filter((r) => r.status === "banned").length,
    signatures: rows.map(publicRow),
  };
}

function status(email) {
  const clean = normaliseEmail(email);
  if (!validEmail(clean)) return { code: 400, body: { ok: false, error: "Pass a real email." } };
  const row = db.prepare("SELECT * FROM signatures WHERE email = ?").get(clean);
  if (!row) return { code: 200, body: { ok: true, status: "unknown" } };
  return { code: 200, body: { ok: true, status: row.status, signature: publicRow(row) } };
}

function setBan(body, banned) {
  const email = normaliseEmail(body.email);
  if (!validEmail(email)) return { code: 400, body: { ok: false, error: "Pass a real email." } };
  const row = db.prepare("SELECT * FROM signatures WHERE email = ?").get(email);
  if (!row) return { code: 404, body: { ok: false, error: "Nobody by that email has signed." } };

  if (banned) {
    const reason = String(body.reason || "").trim() || "Broke the pledge.";
    db.prepare("UPDATE signatures SET status = 'banned', ban_reason = ?, banned_at = ? WHERE email = ?")
      .run(reason, new Date().toISOString(), email);
  } else {
    db.prepare("UPDATE signatures SET status = 'signed', ban_reason = NULL, banned_at = NULL WHERE email = ?").run(email);
  }

  const updated = db.prepare("SELECT * FROM signatures WHERE email = ?").get(email);
  return { code: 200, body: { ok: true, signature: publicRow(updated) } };
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
    if (req.method === "GET" && pathname === "/api/signatures") return json(res, 200, listSignatures());

    if (req.method === "GET" && pathname === "/api/status") {
      const out = status(searchParams.get("email"));
      return json(res, out.code, out.body);
    }

    if (req.method === "POST" && pathname === "/api/sign") {
      const out = sign(await readBody(req));
      return json(res, out.code, out.body);
    }

    if (req.method === "POST" && (pathname === "/api/ban" || pathname === "/api/unban")) {
      if (!authorised(req)) return json(res, 401, { ok: false, error: "Admin token required." });
      const out = setBan(await readBody(req), pathname === "/api/ban");
      return json(res, out.code, out.body);
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
