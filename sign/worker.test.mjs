/*
 * End-to-end tests for the pledge registry Worker.
 *
 * Runs against any base URL via the PLEDGE_BASE_URL env var; defaults to the
 * local wrangler dev port. ADMIN_TOKEN is required for the admin write paths.
 *
 * Local vs deployed split:
 *   - Local wrangler dev (default): every test runs, including writes.
 *   - Deployed Worker: only reads and rejected requests run. No signature row
 *     is ever written to production D1, so the 201 sign, 200 ban, 403 re-sign,
 *     and 200 unban paths are skipped. The two live-unverified write paths stay
 *     with issue #11's launch walk.
 *
 * Test 8's fail-closed half (no ADMIN_TOKEN bound -> 401) cannot be probed by
 * curling the deployed Worker because the secret is already bound. It is
 * asserted in-process by importing the Worker module and calling its fetch
 * handler with an env that omits ADMIN_TOKEN and stubs the D1 binding.
 *
 *   PLEDGE_BASE_URL=http://127.0.0.1:8788 ADMIN_TOKEN=... node --test sign/worker.test.mjs
 *   PLEDGE_BASE_URL=https://pledge-registry.actualintelligence.workers.dev node --test sign/worker.test.mjs
 *
 * Rate limit (issue #5): POST /api/sign consumes one per-IP token per minute
 * once the body parses. Locally each request sends a unique fake
 * CF-Connecting-IP so tests do not trip each other; Cloudflare overwrites that
 * header in production, so the deployed run keeps the caller's real bucket and
 * the dedicated 429 test tolerates an already-tripped one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const BASE = (process.env.PLEDGE_BASE_URL || "http://127.0.0.1:8788").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const IS_DEPLOYED = new URL(BASE).hostname.endsWith("workers.dev");

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `test-${RUN}@example.invalid`;
const EMAIL_UPPER = `TEST-${RUN}@EXAMPLE.INVALID`;
const OTHER_EMAIL = `other-${RUN}@example.invalid`;

const baseline = { count: 0, banned: 0 };
let signedNumber = null;

/* TEST-NET-3 addresses; the suite stays far below 254 requests. */
let ipCounter = 0;
function fakeIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function json(method, path, body, extraHeaders = {}) {
  return fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": fakeIp(),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path) {
  return fetch(BASE + path);
}

function noEmailLeak(text) {
  assert.ok(
    !text.toLowerCase().includes(EMAIL.toLowerCase()),
    "response leaked the test email",
  );
}

function signedTest(desc, fn) {
  if (IS_DEPLOYED) {
    return test.skip(`SKIP (deployed): ${desc}`, fn);
  }
  return test(desc, fn);
}

test("health endpoint is reachable and reports service ok", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "pledge-registry");
  assert.match(body.db, /row\(s\)|ok/);
});

test("list is readable and never leaks emails", async () => {
  const res = await get("/api/signatures");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.count, "number");
  assert.ok(Array.isArray(body.signatures));
  baseline.count = body.count;
  baseline.banned = body.banned;
  noEmailLeak(JSON.stringify(body));
});

signedTest("sign returns 201 with signatory number and hides email", async () => {
  const res = await json("POST", "/api/sign", {
    name: "Ada Lovelace",
    email: EMAIL,
    url: "https://ada.example",
    agreed: true,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "signed");
  assert.ok(Number.isInteger(body.signature.number));
  assert.equal(body.signature.name, "Ada Lovelace");
  assert.equal(body.signature.url, "https://ada.example");
  assert.equal(body.signature.status, "signed");
  assert.equal(body.count, baseline.count + 1);
  assert.equal(body.signature.email, undefined);
  signedNumber = body.signature.number;
  noEmailLeak(JSON.stringify(body));
});

signedTest("duplicate email is 200 already_signed, case-insensitive", async () => {
  const res = await json("POST", "/api/sign", {
    name: "Different Name",
    email: EMAIL_UPPER,
    agreed: true,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "already_signed");
  assert.equal(body.signature.name, "Ada Lovelace");
  assert.equal(body.signature.number, signedNumber);
  assert.equal(body.count, baseline.count + 1);
  noEmailLeak(JSON.stringify(body));
});

/* Local-only: each of these parses cleanly, so each consumes a rate-limit
   token. Deployed, they would drain the caller's single per-IP bucket and
   collide with the dedicated 429 test below. */
signedTest("validation errors return 400 without writing a row", async () => {
  const cases = [
    { name: "", email: "x@example.invalid", agreed: true },
    { name: "z".repeat(121), email: "x@example.invalid", agreed: true },
    { name: "Nobody", email: "not-an-email", agreed: true },
    { name: "Nobody", email: "x@example.invalid", agreed: false },
    { name: "Nobody", email: "x@example.invalid", agreed: "yes" },
  ];
  for (const body of cases) {
    const res = await json("POST", "/api/sign", body);
    assert.equal(res.status, 400, JSON.stringify(body));
    const jsonBody = await res.json();
    assert.equal(jsonBody.ok, false);
    noEmailLeak(JSON.stringify(jsonBody));
  }
  const list = await (await get("/api/signatures")).json();
  assert.equal(list.count, IS_DEPLOYED ? baseline.count : baseline.count + 1);
});

test("malformed request bodies return 400", async () => {
  if (!IS_DEPLOYED) {
    /* An empty body parses to {} and consumes a token, so deployed runs skip
       it to keep the caller's bucket for the dedicated 429 test. */
    const empty = await fetch(BASE + "/api/sign", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": fakeIp() },
    });
    assert.equal(empty.status, 400);
  }

  const broken = await fetch(BASE + "/api/sign", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": fakeIp() },
    body: "{not json",
  });
  assert.equal(broken.status, 400);
});

test("oversized body returns 413 without consuming a rate-limit token", async () => {
  const res = await json("POST", "/api/sign", {
    name: "Nobody",
    email: "x@example.invalid",
    agreed: true,
    padding: "z".repeat(65 * 1024),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).ok, false);
});

test("second rapid sign attempt from one IP is rate limited with 429", async () => {
  const rejected = { name: "Nobody", email: "x@example.invalid", agreed: false };
  const ip = { "cf-connecting-ip": fakeIp() };
  const first = await json("POST", "/api/sign", rejected, ip);
  const second = await json("POST", "/api/sign", rejected, ip);
  /* Consent-false never writes a row, so this is production-safe. On a rerun
     inside the 60s window the caller's real bucket may already be empty, so
     the first response is allowed to be a 429 too. */
  assert.ok([400, 429].includes(first.status), `first was ${first.status}`);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "60");
  const body = await second.json();
  assert.equal(body.ok, false);
  noEmailLeak(JSON.stringify(body));
});

signedTest("admin ban returns 200 and status reports banned", async () => {
  const res = await json(
    "POST",
    "/api/ban",
    { email: EMAIL, reason: "GPT wrote paragraph four" },
    { "x-admin-token": ADMIN_TOKEN },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.signature.status, "banned");
  assert.equal(body.signature.ban_reason, "GPT wrote paragraph four");
  assert.ok(body.signature.banned_at);
  noEmailLeak(JSON.stringify(body));

  const statusRes = await get(`/api/status?email=${encodeURIComponent(EMAIL)}`);
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.equal(statusBody.ok, true);
  assert.equal(statusBody.status, "banned");
  assert.equal(statusBody.signature.ban_reason, "GPT wrote paragraph four");
  noEmailLeak(JSON.stringify(statusBody));

  const list = await (await get("/api/signatures")).json();
  assert.equal(list.count, baseline.count);
  assert.equal(list.banned, baseline.banned + 1);
});

signedTest("banned email cannot sign again and is told why", async () => {
  const res = await json("POST", "/api/sign", {
    name: "Ada",
    email: EMAIL,
    agreed: true,
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "banned");
  assert.equal(body.ban_reason, "GPT wrote paragraph four");
  assert.ok(body.banned_at);
  noEmailLeak(JSON.stringify(body));
});

signedTest("unban restores standing and clears reason", async () => {
  const res = await json(
    "POST",
    "/api/unban",
    { email: EMAIL },
    { "x-admin-token": ADMIN_TOKEN },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.signature.status, "signed");
  assert.equal(body.signature.ban_reason, null);
  assert.equal(body.signature.banned_at, null);
  noEmailLeak(JSON.stringify(body));

  const list = await (await get("/api/signatures")).json();
  assert.equal(list.count, baseline.count + 1);
  assert.equal(list.banned, baseline.banned);
});

test("admin routes reject missing or wrong token with 401", async () => {
  const missing = await json("POST", "/api/ban", { email: EMAIL });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).ok, false);

  const wrong = await json("POST", "/api/ban", { email: EMAIL }, { "x-admin-token": "wrong" });
  assert.equal(wrong.status, 401);

  const sameLengthWrong = await json(
    "POST",
    "/api/ban",
    { email: EMAIL },
    { "x-admin-token": "x".repeat(ADMIN_TOKEN.length || 64) },
  );
  assert.equal(sameLengthWrong.status, 401);

  const unbanMissing = await json("POST", "/api/unban", { email: EMAIL });
  assert.equal(unbanMissing.status, 401);
});

test("Worker fails closed when ADMIN_TOKEN is not bound", async () => {
  const fakeDb = {
    prepare() {
      return {
        bind() {
          return { all: async () => ({ results: [] }) };
        },
        first: async () => ({ n: 0 }),
      };
    },
  };
  const req = new Request("http://localhost/api/ban", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": "anything" },
    body: JSON.stringify({ email: "test@example.invalid" }),
  });
  const res = await worker.fetch(req, { DB: fakeDb });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "Admin token required.");
});
