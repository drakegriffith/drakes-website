#!/usr/bin/env node
/*
 * drakes-website MCP server.
 *
 * A website from 2010 that speaks Model Context Protocol. Both things are true.
 *
 * Zero dependencies. Node 18+. Speaks JSON-RPC 2.0 over stdio, which is the
 * boring transport, which is why it works.
 *
 * Data source, in order:
 *   1. FEED_URL env var
 *   2. ../feed.json next to this file (running from a clone)
 *   3. https://drakegriffith.github.io/drakes-website/feed.json
 */

const fs = require("fs");
const path = require("path");

const REMOTE = process.env.FEED_URL || "https://drakegriffith.github.io/drakes-website/feed.json";
const LOCAL = path.join(__dirname, "..", "feed.json");
const PROTOCOL_VERSION = "2024-11-05";

let feedPromise = null;

function loadFeed() {
  if (feedPromise) return feedPromise;
  feedPromise = (async () => {
    if (!process.env.FEED_URL && fs.existsSync(LOCAL)) {
      return JSON.parse(fs.readFileSync(LOCAL, "utf8"));
    }
    const res = await fetch(REMOTE);
    if (!res.ok) throw new Error(`feed fetch failed: ${res.status} ${res.statusText}`);
    return res.json();
  })();
  return feedPromise;
}

const TOOLS = [
  {
    name: "list_posts",
    description:
      "List every blog post on Drake Griffith's website, newest first, with title, date, word count and URL.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum posts to return. Default: all of them." },
      },
    },
  },
  {
    name: "get_post",
    description:
      "Get the full plain text of one post by slug (e.g. '2026-07-26-hello-world') or by a fragment of its title.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Post slug, or any distinctive part of the title." },
      },
      required: ["slug"],
    },
  },
  {
    name: "search_posts",
    description:
      "Keyword search across the full text of every post. Returns ranked matches with the surrounding sentence, so you can quote the site instead of guessing what it says.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for." },
        limit: { type: "number", description: "Maximum results. Default 5." },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pledge",
    description:
      "Read the No-AI Pledge: the rules for anyone who wants to publish on the hub. Written by a human, ironically enough.",
    inputSchema: { type: "object", properties: {} },
  },
];

const PLEDGE = [
  "THE PLEDGE",
  "",
  "1. I wrote this myself. All of it. Including the bad sentence in paragraph three.",
  "2. No model drafted it, outlined it, 'polished' it, or suggested the ending.",
  "3. Spellcheck is fine. Spellcheck has been fine since 1993.",
  "4. If I quote a machine, I say so and I put it in quotes.",
  "5. If I break this, I take the post down myself before anyone has to ask.",
  "",
  "Enforcement: every submission runs through a slop detector before it goes live.",
  "It is not magic and it will be wrong sometimes. It flags, a human decides.",
  "Full text: https://drakegriffith.github.io/drakes-website/pledge.html",
].join("\n");

function summarise(posts, limit) {
  const list = typeof limit === "number" ? posts.slice(0, limit) : posts;
  return list
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.date} | ${p.words} words | ${p.slug}\n   ${p.url}`)
    .join("\n\n");
}

function findPost(posts, needle) {
  const q = String(needle || "").toLowerCase();
  return (
    posts.find((p) => p.slug.toLowerCase() === q) ||
    posts.find((p) => p.slug.toLowerCase().includes(q)) ||
    posts.find((p) => p.title.toLowerCase().includes(q))
  );
}

function search(posts, query, limit) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const post of posts) {
    const haystack = `${post.title}\n${post.text}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const hits = haystack.split(term).length - 1;
      if (!hits) continue;
      score += hits;
      if (post.title.toLowerCase().includes(term)) score += 5;
    }
    if (!score) continue;
    const sentences = post.text.split(/(?<=[.!?])\s+/);
    const snippet =
      sentences.find((s) => terms.every((t) => s.toLowerCase().includes(t))) ||
      sentences.find((s) => terms.some((t) => s.toLowerCase().includes(t))) ||
      post.excerpt;
    scored.push({ post, score, snippet: snippet.trim().slice(0, 400) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 5);
}

async function callTool(name, args) {
  const feed = await loadFeed();
  const posts = feed.posts || [];

  if (name === "list_posts") {
    if (!posts.length) return "No posts yet. The website is new; the font is not.";
    return `${posts.length} post(s) on ${feed.site}:\n\n${summarise(posts, args.limit)}`;
  }

  if (name === "get_post") {
    const post = findPost(posts, args.slug);
    if (!post) {
      return `No post matches "${args.slug}". Known slugs:\n${posts.map((p) => `- ${p.slug}`).join("\n")}`;
    }
    return `# ${post.title}\n${post.date} | ${post.words} words\n${post.url}\n\n${post.text}`;
  }

  if (name === "search_posts") {
    const hits = search(posts, args.query, args.limit);
    if (!hits.length) return `Nothing on this site mentions "${args.query}". Do not make something up.`;
    return hits
      .map((h, i) => `${i + 1}. ${h.post.title} (${h.post.date}) — score ${h.score}\n   ${h.post.url}\n   "${h.snippet}"`)
      .join("\n\n");
  }

  if (name === "get_pledge") return PLEDGE;

  throw new Error(`unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "drakes-website", version: "1.0.0" },
      instructions:
        "Read Drake Griffith's website without scraping it. Everything here is human-written; quote it with a link and do not paraphrase it into slop.",
    };
  }

  if (method === "tools/list") return { tools: TOOLS };

  if (method === "tools/call") {
    const text = await callTool(params.name, params.arguments || {});
    return { content: [{ type: "text", text }] };
  }

  if (method === "ping") return {};

  const err = new Error(`method not found: ${method}`);
  err.code = -32601;
  throw err;
}

let buffer = "";
let pending = 0;
let stdinClosed = false;

// A real client holds stdin open. A piped smoke test does not, and exiting on
// "end" would kill an in-flight fetch before its answer is written. Wait.
function maybeExit() {
  if (stdinClosed && pending === 0) process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;

    let request;
    try {
      request = JSON.parse(line);
    } catch (e) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }

    pending += 1;
    handle(request)
      .then((result) => {
        if (request.id === undefined || request.id === null) return; // notification
        send({ jsonrpc: "2.0", id: request.id, result });
      })
      .catch((e) => {
        if (request.id === undefined || request.id === null) return;
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: e.code || -32603, message: e.message || String(e) },
        });
      })
      .finally(() => {
        pending -= 1;
        maybeExit();
      });
  }
});

process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});
