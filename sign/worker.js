/*
 * The pledge registry, as a Cloudflare Worker.
 *
 * Placeholder. Right now this only proves the deploy works and the D1 binding
 * is wired; the real endpoints land with the port (issue #4), which will make
 * this a thin adapter over sign/registry.js — the same core server.js uses.
 *
 *   npx wrangler deploy   --config sign/wrangler.toml
 *   npx wrangler dev      --config sign/wrangler.toml
 *
 * Unlike server.js this serves no static files. GitHub Pages already does
 * that; the Worker is API-only.
 */

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      let db = "unreachable";
      try {
        const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM signatures").first();
        db = `ok, ${row.n} row(s)`;
      } catch (e) {
        db = `error: ${e.message}`;
      }
      return Response.json({ ok: true, service: "pledge-registry", db });
    }

    return Response.json(
      { ok: false, error: "The registry is deployed but not yet wired up. See issue #4." },
      { status: 501 },
    );
  },
};
