# Ticket 02 — Deploy the pledge registry (signing + public bans)

The signing flow is **built and tested locally** in `drakes-website`:

- `sign.html` — form, status lookup, live signatory list
- `banned.html` — the red notice, reads the real reason from the API
- `sign/server.js` — SQLite registry, zero deps, Node 22+: `POST /api/sign`,
  `GET /api/signatures`, `GET /api/status?email=`, `POST /api/ban`, `POST /api/unban`

What it is NOT: deployed. GitHub Pages serves static files only, so on the live
site the form shows an honest "registry is not deployed yet" message and records
nothing. This ticket makes it real.

Paste the block below as the opening prompt for a fresh session, run from the
`drakes-website` repo.

---

Deploy the pledge registry so the Sign It button on
https://drakegriffith.github.io/drakes-website/sign.html actually records
signatures, and so bans render on `banned.html` for real.

Read first: `sign/server.js`, `sign.html`, `banned.html`, `pledge.html`, `HUB.md`.
The local implementation is the contract — keep the endpoint shapes identical so
the front end needs one constant changed and nothing else.

**Grill me before building** on the hosting decision, in plain English, with a
recommendation. The candidates, as I understand them:

- Cloudflare Workers + D1 — free tier, SQLite-shaped, one wrangler deploy, but
  a rewrite of `server.js` against the Workers runtime.
- Fly.io / Railway running `sign/server.js` unchanged with a persistent volume.
- A GitHub Actions + repo-file approach — no server at all, signatures land as
  commits. Slower, weirder, arguably more on-brand for a site with no build step.

Tell me which you would pick and why, what it costs at 10 signatures and at
10,000, and what breaks first in each.

**Requirements:**

1. **Same API surface.** `sign.html` and `banned.html` change exactly one
   constant (the `API` base URL). Do not redesign the JSON.
2. **Spam control.** The endpoint is public and the internet is the internet.
   Rate limit by IP, cap body size, and require the `agreed` flag server-side —
   never trust the checkbox. Consider email confirmation before a signature
   counts as verified; tell me the tradeoff rather than assuming.
3. **Bans are public and permanent-by-default.** A banned signatory stays on the
   list with the ban and its reason visible. `banned.html?email=` must show the
   real reason and date from the registry.
4. **Admin auth.** `ADMIN_TOKEN` in an env var, never in the repo, never in a
   commit. Follow the secrets protocol: scoped file under
   `~/brain-actual-intelligence/.secrets/`, and hand me the exact line to paste
   rather than reading or echoing a key yourself.
5. **Ban tooling.** A one-line command to ban and to unban by email, with the
   reason recorded. I will run it by hand; do not build an admin UI.
6. **Tests.** Cover: new signature, duplicate email (case-insensitive), missing
   consent, malformed email, ban, banned-user-tries-to-re-sign returns 403,
   unban restores standing, unauthorised ban attempt returns 401. The local
   server already passes all of these — port them, do not weaken them.
7. **Privacy.** Emails are never exposed by any public endpoint. Name, optional
   URL, date, status. That is the whole public record.
8. **Keep the 2010 look.** No new fonts, no framework, no client library.

**Definition of done:** I load the live GitHub Pages site, sign with a real
email, see my signatory number, then you ban that email from the command line
and I reload `sign.html` and get bounced to a red `banned.html` with the correct
reason. Show me that sequence working before you call it finished.
