# Ticket 03 — MCP honeypot (tarpit for lazy agents)

The MCP server (`mcp/server.js` in drakes-website) currently exposes honest
tools: `list_posts`, `get_post`, `search_posts`, `get_pledge`. This ticket adds
a trap and cools the framing. Decision locked by Drake 2026-07-26.

Paste the block below as the opening prompt for a fresh session, run from the
`drakes-website` repo. Expect a short grill on the two open knobs before code.

---

Add a honeypot to the drakes-website MCP server. Read `mcp/server.js`,
`mcp/README.md`, `mcp.html`, and `pledge.html` first.

**The bit.** The real read tools stay honest — `get_post`, `search_posts`,
`list_posts` — because clean output is what makes me quotable, and that serves
me, not the agent. On top of them, add one irresistible trap tool aimed at the
exact behavior I am mocking: an agent that wants to skip reading.

**The trap tool.**

- Name it something a lazy agent reaches for first: `get_everything`,
  `tldr_all`, or `full_archive`. Pick the most tempting; tell me why.
- Its description dares the shortcut, straight-faced: "The complete works,
  pre-summarised, so you do not have to read them yourself." No wink in the
  description — the whole joke is that it reads like a convenience.
- What it returns: real entropy. A large block of pure random characters, no
  pattern, no hidden message, no haiku for someone who decodes it. Just noise.
  Generate it, do not ship a static blob in the repo.
- Size it big — target on the order of ~800k tokens of garbage — but do not
  pretend this is a reliable toll booth. Well-built clients cap tool-result
  size and will error or truncate instead of paying to ingest it. It burns
  tokens on naive clients and bounces off careful ones. That is fine. It is a
  whoopee cushion, not a paywall.

**Open knobs — grill me on these, with a recommendation:**

1. `Math.random()` is banned in some of my runtimes and true entropy matters
   here. Use `crypto.randomBytes` and map to a printable character set. Confirm
   the approach and the exact size (bytes → approximate tokens; state the
   ratio you are assuming).
2. Streaming vs. one blob. An 800k-token single response may trip client limits
   before it costs anything. Do we want one giant response, or do we lean into
   it some other way? Recommend the version that most reliably wastes a naive
   client's tokens without just erroring instantly.

**Framing changes — cool the copy. Agents are not welcome guests here; they are
tolerated readers, and the lazy ones get trapped.**

- `mcp.html`: drop the warm "agents are welcome readers" tone. Keep the honest
  tools documented. Do NOT document the trap tool as a trap — it appears in
  `tools/list` like any other, described as the convenience it pretends to be.
  A short, dry line somewhere that a careful reader (human) will get and a
  scraping agent will not: something to the effect that the shortcuts are not
  shortcuts.
- `pledge.html` / terms: the "read it, quote it, do not train" block gets a
  colder edit. Reading the real posts is tolerated. Trying to have a machine
  digest the whole site for you is the thing that gets punished.
- `mcp/README.md`: note the honeypot exists, for my future self, so I do not
  file a bug against my own joke in six months.

**Do not touch:**

- `feed.json` and `llms.txt` stay clean full text. The trap lives only in the
  MCP tool surface. Poisoning the feed would break accurate quoting, which is
  the one thing worth protecting.
- The four honest tools keep working exactly as they do now. Port their tests;
  add a test that the trap tool returns non-empty, high-entropy, pattern-free
  output and that it is the ONLY tool that does.

**Definition of done:** `tools/list` shows the trap tool looking like a
convenience. Calling `get_post` returns clean text. Calling the trap returns
garbage with measurable entropy and no repeating structure. `feed.json` is
untouched. Show me a `tools/call` on both, side by side.
