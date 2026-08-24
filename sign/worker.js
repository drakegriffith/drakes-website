/*
 * The pledge registry, as a Cloudflare Worker.
 *
 * The second adapter over sign/registry.mjs — the same rules sign/server.js
 * runs locally. This file owns HTTP, CORS, the admin token, and a D1-backed
 * store; the rules live next door and are shared byte for byte.
 *
 *   npx wrangler deploy --config sign/wrangler.toml
 *   npx wrangler dev    --config sign/wrangler.toml   # local D1, port 8787
 *
 * Unlike server.js this serves no static files. GitHub Pages already does that
 * job; the Worker is API-only. It also never creates the table — the schema is
 * applied to D1 by hand from sign/schema.sql.
 *
 * ---------------------------------------------------------------------------
 * CORS
 * ---------------------------------------------------------------------------
 *
 * server.js allows `*` because it is a local preview that also serves the page
 * asking. Deployed, `*` on a write endpoint invites exactly the drive-by
 * traffic the rate limiter exists for, so this narrows to the site's own
 * origin plus localhost (any port, so `wrangler dev` and `node sign/server.js`
 * both keep working against the deployed API).
 *
 * A request with no Origin header — curl, the ban script — is not a browser
 * request and is untouched: CORS is a browser rule, and nothing here treats it
 * as authentication. A disallowed origin gets a normal response with no CORS
 * headers, which is what makes the browser refuse to hand it over.
 *
 * A page opened with a file:// URL sends `Origin: null` and is therefore
 * denied. Open the site through `node sign/server.js` instead, which serves
 * page and API from one origin.
 */

import * as registry from "./registry.mjs";

const PAGES_ORIGIN = "https://drakegriffith.github.io";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  if (origin !== PAGES_ORIGIN && !LOCAL_ORIGIN.test(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-admin-token",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  };
}

function json(request, code, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { ...JSON_HEADERS, ...corsHeaders(request), ...extraHeaders },
  });
}

/* The store port, backed by D1. Same SQL, same rows, already async. */
function d1Store(db) {
  return {
    async query(sql, params) {
      const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
      const { results } = await stmt.all();
      return results || [];
    },
  };
}

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bodyTooLarge() {
  return new RequestError(413, "Request body is too large. The limit is 64 KB.");
}

async function readBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) throw bodyTooLarge();

  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The 413 still wins if the client has already aborted the stream.
      }
      throw bodyTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new RequestError(400, "body is not valid JSON");
  }
}

/*
 * Admin auth. `crypto.subtle.timingSafeEqual` is the Workers runtime's answer
 * to node:crypto's, and it throws on a length mismatch, so length is checked
 * first — leaking the token's length is not worth a compat flag to avoid.
 *
 * With no ADMIN_TOKEN bound, every admin call is unauthorised. A Worker with
 * no secret should refuse bans, not accept a default one.
 */
function authorised(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const given = request.headers.get("x-admin-token");
  if (!given) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(env.ADMIN_TOKEN);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

/*
 * The whole API.
 *
 * request  a normal Fetch API Request. The routes: POST /api/sign,
 *          GET /api/signatures, GET /api/status?email=, POST /api/ban,
 *          POST /api/unban, GET /api/health. Anything else is a 404.
 * env      the Worker bindings — `DB`, a D1 database carrying the schema in
 *          sign/schema.sql; `SIGN_RATE_LIMITER`, the per-IP sign limiter; and
 *          `ADMIN_TOKEN`, a secret. `DB` and the limiter are required; without
 *          `ADMIN_TOKEN` the two admin routes answer 401 forever, which is the
 *          intended failure.
 * returns  a Response, always JSON except the 204 preflight, always
 *          no-store, carrying whatever `{ code, body }` the core resolved to.
 * effects  none of its own. The core writes a row on a successful sign, and
 *          updates one on a successful ban or unban.
 * throws   nothing. Known request errors keep their 4xx status; any other throw
 *          from the body reader or driver becomes a 400 carrying its message.
 */
export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    const method = request.method;
    const send = (out) => json(request, out.code, out.body);

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (!pathname.startsWith("/api/")) {
      return json(request, 404, {
        ok: false,
        error: "This is the pledge registry API. The site is at https://drakegriffith.github.io/drakes-website/",
      });
    }

    const store = d1Store(env.DB);

    try {
      /* Not part of the frozen contract: a deploy check, and the one place the
       * D1 binding proves itself without touching a signature. */
      if (method === "GET" && pathname === "/api/health") {
        let db = "unreachable";
        try {
          const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM signatures").first();
          db = `ok, ${row.n} row(s)`;
        } catch (e) {
          db = `error: ${e.message}`;
        }
        return json(request, 200, { ok: true, service: "pledge-registry", db });
      }

      if (method === "GET" && pathname === "/api/signatures") {
        return send(await registry.listSignatures(store));
      }

      if (method === "GET" && pathname === "/api/status") {
        return send(await registry.status(store, searchParams.get("email")));
      }

      if (method === "POST" && pathname === "/api/sign") {
        const body = await readBody(request);
        const ip = request.headers.get("cf-connecting-ip") || "unknown";
        const { success } = await env.SIGN_RATE_LIMITER.limit({ key: ip });
        if (!success) {
          return json(
            request,
            429,
            { ok: false, error: "Too many signing attempts from this connection. Try again in a minute." },
            { "retry-after": String(RATE_LIMIT_WINDOW_SECONDS) },
          );
        }
        return send(await registry.sign(store, body));
      }

      if (method === "POST" && (pathname === "/api/ban" || pathname === "/api/unban")) {
        if (!authorised(request, env)) {
          return json(request, 401, { ok: false, error: "Admin token required." });
        }
        return send(await registry.setBan(store, await readBody(request), pathname === "/api/ban"));
      }

      return json(request, 404, { ok: false, error: `No such endpoint: ${pathname}` });
    } catch (e) {
      const code = e instanceof RequestError ? e.status : 400;
      return json(request, code, { ok: false, error: e.message || String(e) });
    }
  },
};
