# drakes-website

Drake Griffith's personal website. Plain HTML, one CSS file, Times New Roman, no
build step, no framework, no blog platform. Looks like it was made in 2010 because
that is the point. Also speaks Model Context Protocol, because that is also the point.

Live at: https://drakegriffith.github.io/drakes-website/

## Layout

```
index.html        home page + latest posts
blog.html         full post list
about.html        one paragraph + photos
pledge.html       the No-AI blog hub pledge (manifesto; the hub is live)
sign.html         signpost only - signing moved to the hub's own /pledge page
banned.html       static stub pointing at the hub's ban explainer and public record
mcp.html          how agents should read this site
links.html        email / github / machine endpoints
style.css         the entire design system
_template.html    blueprint for a new post
new-post.sh       makes a post, wires it into both index pages, rebuilds the feed
build-feed.py     regenerates feed.json + llms.txt from blog/*.html
feed.json         GENERATED - every post, full text, one request
llms.txt          GENERATED - the map, plain text
mcp/server.js     MCP server (zero deps, stdio) exposing the site to agents
sign/server.js    pledge registry: SQLite, zero deps, also serves the site locally
tickets/          paste-ready prompts for the hub build and the registry deploy
blog/             one .html file per post
images/           photos
HUB.md            SUPERSEDED scoping sketch; pledge.html is the commitment
```

`feed.json` and `llms.txt` are generated. Edit `build-feed.py`, not them.

## Posting

```bash
./new-post.sh "Why I Left Substack"                  # placeholder body
./new-post.sh "Why I Left Substack" draft.txt        # plain text, blank line = new paragraph
./new-post.sh "Why I Left Substack" draft.html       # raw HTML body
./new-post.sh "Why I Left Substack" draft.txt --publish   # also commits and pushes
```

The script creates `blog/YYYY-MM-DD-slug.html`, prepends the link to `blog.html`
and to the top-5 list on `index.html`, updates the "Last updated" line, and reruns
`build-feed.py`. Pure bash + python3 — nothing in the publishing path calls a model.

## MCP

```bash
claude mcp add drakes-website -- node ./mcp/server.js
```

Tools: `list_posts`, `get_post`, `search_posts`, `get_pledge`. Details in
[`mcp/README.md`](mcp/README.md). Smoke test:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
              '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp/server.js
```

## The pledge registry

The API is deployed: a Cloudflare Worker at
`https://pledge-registry.actualintelligence.workers.dev`, backed by D1, currently
holding zero rows. No page on this site calls it: signing moved to the hub's own
`/pledge` page before the wiring landed, so `sign.html` is a signpost, `banned.html`
is a stub, and the wiring issue #9 describes was overtaken, not done.

Two adapters, one set of rules. `sign/registry.mjs` holds the rules and knows
nothing about HTTP; `sign/server.js` runs them on Node against a local SQLite
file, `sign/worker.js` runs them on Cloudflare against D1. Deploy with
`npx wrangler deploy --config sign/wrangler.toml`.

```bash
ADMIN_TOKEN=something node sign/server.js   # http://localhost:8787, serves the site too
```

Ban someone:

```bash
./sign/ban.sh them@example.com "Every paragraph the same length."
./sign/ban.sh --unban them@example.com
./sign/ban.sh --local them@example.com "reason"   # against node sign/server.js
```

It hits the deployed registry by default, prints the row it changed, then reads
the public list back so you can see the ban took. A ban is not a deletion: the
row stays listed with the reason and date showing. The token comes from
`~/brain-actual-intelligence/.secrets/pledge-registry.env` and is never an
argument — arguments land in shell history. It tells you what to do when the
file is missing (no token file), when the token is stale (`401`), and when
nobody by that email has signed (`404`).

Underneath it is one `POST /api/ban` with an `x-admin-token` header, so curl
still works if you would rather. The API allows the Pages origin and localhost
and nothing else, so a page opened with a `file://` URL cannot sign; use the
local server for that.

`sign/signatures.db` is gitignored and is the local server's state only. The
deployed registry's rows live in D1, which nothing in this repo can hold.

## Notes for Claude

When Drake says "post this to my blog":

1. Write the post body to a scratch file (`draft.txt`, plain text, blank lines
   between paragraphs — the script escapes and wraps it).
2. `./new-post.sh "The Title" draft.txt --publish`
3. Delete the scratch file. Give Drake the live URL.

House style: dry, short declaratives, a joke that lands by being true. Never the
"it's not just X, it's Y" construction — that one is named and shamed on
`pledge.html`, so using it here would be embarrassing.

Do not add a static site generator, a package.json at the root, Tailwind, or dark
mode. The ugliness is load-bearing. `mcp/package.json` exists only so the server
can be installed as a bin; it has no dependencies and never will.

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
