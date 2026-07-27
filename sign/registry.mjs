/*
 * The pledge registry's rules.
 *
 * Everything that decides *what* the registry does — validation, what counts as
 * already signed, what a ban does, which status code each outcome earns. Knows
 * nothing about HTTP servers, Node, or Cloudflare. Two adapters wrap it:
 * sign/server.js (node:sqlite, local) and sign/worker.js (D1, production).
 *
 * ESM (.mjs) on purpose: the repo root has no package.json, so a .js file is
 * CommonJS. The Worker needs ESM; server.js reaches it with require(), which
 * Node has supported for ESM since 22.12.
 *
 *   node --test 'sign/*.test.mjs'   # the unit tests, no server, no network
 *
 * ---------------------------------------------------------------------------
 * The store port
 * ---------------------------------------------------------------------------
 *
 * Every function below takes a `store` as its first argument: an object with
 * one method.
 *
 *   store.query(sql, params) -> Promise<row[]>
 *
 *   sql     a SQLite statement, `?` placeholders
 *   params  an array of bound values
 *   returns the result rows as plain objects; [] for a statement that returns
 *           none. Always a promise, even where the driver underneath is
 *           synchronous — D1 cannot be made to look sync, and node:sqlite is
 *           trivially made to look async.
 *   throws  whatever the driver throws. Callers surface it as a 400; a UNIQUE
 *           violation from two simultaneous signatures of the same email is
 *           the one realistic case, and it predates this split.
 *
 * One method rather than five (findByEmail, insert, listAll, ...) because both
 * backends *are* SQLite: five methods would mean writing the same six
 * statements twice, in two adapters, to hide a dialect difference that does
 * not exist.
 *
 * ---------------------------------------------------------------------------
 * The return shape
 * ---------------------------------------------------------------------------
 *
 * Every entry point resolves to `{ code, body }` — an HTTP status and the JSON
 * to send. Both consumers are HTTP APIs serving one frozen contract, so the
 * status codes *are* the rules, not a transport detail; keeping them here is
 * what lets each adapter stay four lines instead of carrying a copy of the
 * outcome-to-code table.
 */

const SELECT_BY_EMAIL = "SELECT * FROM signatures WHERE email = ?";

export function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value);
}

/*
 * The public view of a row. Emails are stored but never leave the server; the
 * ban reason and date only appear once someone is actually banned.
 */
export function publicRow(row) {
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

async function one(store, sql, params) {
  const rows = await store.query(sql, params);
  return rows[0];
}

async function countSignatures(store) {
  const row = await one(store, "SELECT COUNT(*) AS n FROM signatures WHERE status != 'banned'", []);
  return row.n;
}

/*
 * Record a signature.
 *
 * body     { name, email, url?, agreed } from the sign form
 * returns  201 + the new signature on success
 *          200 + status "already_signed" if that email is already on the list
 *          403 if that email is banned, with the reason and date
 *          400 with a human-readable error if name, email, or agreement is bad
 * effects  inserts one row on the 201 path only
 */
export async function sign(store, body) {
  const name = String(body.name || "").trim();
  const email = normaliseEmail(body.email);
  const url = String(body.url || "").trim() || null;

  if (!name) return { code: 400, body: { ok: false, error: "A name is required. Yours, ideally." } };
  if (name.length > 120) return { code: 400, body: { ok: false, error: "That name is too long." } };
  if (!validEmail(email)) return { code: 400, body: { ok: false, error: "That email does not look like an email." } };
  if (body.agreed !== true) {
    return { code: 400, body: { ok: false, error: "You have to actually agree to the pledge. That is the whole thing." } };
  }

  const existing = await one(store, SELECT_BY_EMAIL, [email]);

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
      body: { ok: true, status: "already_signed", signature: publicRow(existing), count: await countSignatures(store) },
    };
  }

  const row = await one(
    store,
    "INSERT INTO signatures (name, email, url, signed_at) VALUES (?, ?, ?, ?) RETURNING *",
    [name, email, url, new Date().toISOString()],
  );
  return { code: 201, body: { ok: true, status: "signed", signature: publicRow(row), count: await countSignatures(store) } };
}

/*
 * The whole list, oldest first — what sign.html renders.
 *
 * returns  200, always: { ok, count, banned, signatures } where count excludes
 *          the banned and `banned` counts them
 */
export async function listSignatures(store) {
  const rows = await store.query("SELECT * FROM signatures ORDER BY id ASC", []);
  return {
    code: 200,
    body: {
      ok: true,
      count: rows.filter((r) => r.status !== "banned").length,
      banned: rows.filter((r) => r.status === "banned").length,
      signatures: rows.map(publicRow),
    },
  };
}

/*
 * Where one email stands. What banned.html asks on load.
 *
 * returns  200 + status "signed" | "banned" + the signature, if known
 *          200 + status "unknown" if that email never signed
 *          400 if the email is not an email
 */
export async function status(store, email) {
  const clean = normaliseEmail(email);
  if (!validEmail(clean)) return { code: 400, body: { ok: false, error: "Pass a real email." } };
  const row = await one(store, SELECT_BY_EMAIL, [clean]);
  if (!row) return { code: 200, body: { ok: true, status: "unknown" } };
  return { code: 200, body: { ok: true, status: row.status, signature: publicRow(row) } };
}

/*
 * Ban or unban. Admin only — the adapter checks the token before calling.
 *
 * body     { email, reason? }; reason is ignored when unbanning and defaults
 *          to "Broke the pledge." when banning
 * banned   true to ban, false to restore
 * returns  200 + the updated signature
 *          404 if nobody by that email has signed
 *          400 if the email is not an email
 * effects  updates one row on the 200 path only
 */
export async function setBan(store, body, banned) {
  const email = normaliseEmail(body.email);
  if (!validEmail(email)) return { code: 400, body: { ok: false, error: "Pass a real email." } };
  const existing = await one(store, SELECT_BY_EMAIL, [email]);
  if (!existing) return { code: 404, body: { ok: false, error: "Nobody by that email has signed." } };

  const updated = banned
    ? await one(
        store,
        "UPDATE signatures SET status = 'banned', ban_reason = ?, banned_at = ? WHERE email = ? RETURNING *",
        [String(body.reason || "").trim() || "Broke the pledge.", new Date().toISOString(), email],
      )
    : await one(
        store,
        "UPDATE signatures SET status = 'signed', ban_reason = NULL, banned_at = NULL WHERE email = ? RETURNING *",
        [email],
      );

  return { code: 200, body: { ok: true, signature: publicRow(updated) } };
}
