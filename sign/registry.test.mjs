/*
 * Unit tests for the registry's rules.
 *
 * No server, no network, no file on disk — an in-memory node:sqlite store
 * standing in for D1. Zero dependencies, like everything else here.
 *
 *   node --test 'sign/*.test.mjs'
 *
 * Quote the glob — the shell must not expand it, and `node --test sign/` does
 * not search the directory.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { normaliseEmail, validEmail, publicRow, sign, listSignatures, status, setBan } from "./registry.mjs";

/* A fresh store per test, so no test can see another's rows. */
function freshStore() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE signatures (
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
  return { async query(sql, params) { return db.prepare(sql).all(...params); } };
}

const GOOD = { name: "Drake Griffith", email: "drake@example.com", agreed: true };

test("normaliseEmail trims and lowercases", () => {
  assert.equal(normaliseEmail("  Drake@Example.COM "), "drake@example.com");
  assert.equal(normaliseEmail(undefined), "");
});

test("validEmail wants exactly one @ and a dot after it", () => {
  assert.ok(validEmail("a@b.co"));
  assert.ok(!validEmail("a@b"));
  assert.ok(!validEmail("a b@c.co"));
  assert.ok(!validEmail("a@@b.co"));
  assert.ok(!validEmail(""));
});

test("publicRow hides the email, and the ban fields until banned", () => {
  const row = { id: 4, name: "X", email: "x@y.co", url: "", signed_at: "T", status: "signed", ban_reason: "r", banned_at: "B" };
  assert.deepEqual(publicRow(row), { number: 4, name: "X", url: null, signed_at: "T", status: "signed", ban_reason: null, banned_at: null });
  assert.deepEqual(publicRow({ ...row, status: "banned" }).ban_reason, "r");
});

test("a good signature is 201, numbered from one, and counted", async () => {
  const store = freshStore();
  const out = await sign(store, { ...GOOD, url: "https://drake.example" });
  assert.equal(out.code, 201);
  assert.equal(out.body.status, "signed");
  assert.equal(out.body.signature.number, 1);
  assert.equal(out.body.signature.name, "Drake Griffith");
  assert.equal(out.body.signature.url, "https://drake.example");
  assert.equal(out.body.count, 1);
  assert.equal(out.body.signature.email, undefined);
});

test("signing twice is 200 already_signed, not a second row", async () => {
  const store = freshStore();
  await sign(store, GOOD);
  const out = await sign(store, { ...GOOD, name: "Someone Else", email: "  DRAKE@Example.com " });
  assert.equal(out.code, 200);
  assert.equal(out.body.status, "already_signed");
  assert.equal(out.body.signature.name, "Drake Griffith");
  assert.equal(out.body.count, 1);
});

test("a signature is refused without a name, a real email, or agreement", async () => {
  const store = freshStore();
  for (const body of [
    { ...GOOD, name: "  " },
    { ...GOOD, name: "x".repeat(121) },
    { ...GOOD, email: "not-an-email" },
    { ...GOOD, agreed: false },
    { ...GOOD, agreed: "yes" },
  ]) {
    const out = await sign(store, body);
    assert.equal(out.code, 400, JSON.stringify(body));
    assert.equal(out.body.ok, false);
  }
  assert.equal((await listSignatures(store)).body.count, 0);
});

test("a banned email cannot sign again, and gets told why", async () => {
  const store = freshStore();
  await sign(store, GOOD);
  await setBan(store, { email: GOOD.email, reason: "GPT wrote paragraph four" }, true);

  const out = await sign(store, GOOD);
  assert.equal(out.code, 403);
  assert.equal(out.body.status, "banned");
  assert.equal(out.body.ban_reason, "GPT wrote paragraph four");
  assert.ok(out.body.banned_at);
});

test("the list is oldest first, and counts the banned separately", async () => {
  const store = freshStore();
  await sign(store, GOOD);
  await sign(store, { name: "Slop Enjoyer", email: "slop@example.com", agreed: true });
  await setBan(store, { email: "slop@example.com", reason: "Slop" }, true);

  const out = await listSignatures(store);
  assert.equal(out.code, 200);
  assert.equal(out.body.count, 1);
  assert.equal(out.body.banned, 1);
  assert.deepEqual(out.body.signatures.map((s) => s.number), [1, 2]);
  assert.equal(out.body.signatures[1].ban_reason, "Slop");
});

test("status reports unknown, signed, and banned", async () => {
  const store = freshStore();
  assert.equal((await status(store, "nobody@example.com")).body.status, "unknown");
  assert.equal((await status(store, "nonsense")).code, 400);

  await sign(store, GOOD);
  assert.equal((await status(store, " DRAKE@example.com ")).body.status, "signed");

  await setBan(store, { email: GOOD.email }, true);
  const banned = await status(store, GOOD.email);
  assert.equal(banned.body.status, "banned");
  assert.equal(banned.body.signature.ban_reason, "Broke the pledge.");
});

test("banning an unknown email is 404, a bad one is 400", async () => {
  const store = freshStore();
  assert.equal((await setBan(store, { email: "nobody@example.com" }, true)).code, 404);
  assert.equal((await setBan(store, { email: "nonsense" }, true)).code, 400);
});

test("unbanning restores the signature and clears the reason", async () => {
  const store = freshStore();
  await sign(store, GOOD);
  await setBan(store, { email: GOOD.email, reason: "Slop" }, true);

  const out = await setBan(store, { email: GOOD.email }, false);
  assert.equal(out.code, 200);
  assert.equal(out.body.signature.status, "signed");
  assert.equal(out.body.signature.ban_reason, null);
  assert.equal(out.body.signature.banned_at, null);
  assert.equal((await listSignatures(store)).body.count, 1);
});
