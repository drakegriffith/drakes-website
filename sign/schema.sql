-- The pledge registry schema.
--
-- One table, same shape as the local server creates in server.js. Applied to
-- D1 with:
--
--   npx wrangler d1 execute pledge-registry --remote --file sign/schema.sql
--
-- Emails are stored but never leave the server: no public endpoint returns
-- one. The public record is name, url, date, status.

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
