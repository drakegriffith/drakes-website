# Ticket 01 — The Hub (submissions + slop detector + RAG search)

Paste the block below as the opening prompt for a fresh session. Run it from a
new repo directory, not from `drakes-website`. Expect a grill pass before code.

---

I want to build the Hub: a public blog platform where anyone can publish and
nobody is allowed to use AI to write. The manifesto is already live at
https://drakegriffith.github.io/drakes-website/pledge.html — read it first, plus
`HUB.md` in that repo, because they are the spec's starting point and the
constraints in them are non-negotiable.

Do NOT write code yet. Grill me first, round by round, in plain English, on the
decisions below. Give me a recommendation with each question and explain what
each option means in practice. Then produce a spec, then tickets, then build.

**What it is.** Three subsystems, in dependency order:

1. **Submissions + publishing.** Author submits plain text or Markdown, signs
   the pledge, post renders into the same 2010-era HTML as drakes-website (one
   shared stylesheet, Times New Roman, no framework, no JS required to read a
   post). Flat files in a git repo as the store until a database is the thing
   that hurts. Every post shows a verdict badge: human / flagged / disputed.
2. **Slop detector.** Gates publication. Signals to implement: burstiness
   (sentence-length variance), perplexity (small local LM), lexical tells
   (delve/tapestry/testament, "not just X but Y", relentless rule-of-three),
   structural uniformity (section lengths, topic-sentence-first paragraphs),
   and over-resolution (nothing left loose). Copy the essay-grading literature
   rather than inventing the science; cite what you copy.
3. **RAG search.** A search box over the whole corpus. Section-boundary chunks
   of 300-600 tokens keeping the heading path, hybrid BM25 + embeddings fused
   with RRF, cross-encoder rerank on the top ~50. Results are quotes with
   links, never a generated answer — the writing is the product. Expose the
   same index over MCP, matching the shape of `mcp/server.js` in drakes-website.

**Hard rules for the detector, from the pledge page, already public:**

- It flags; a human decides. It never auto-deletes and it never gets the final vote.
- Publish the false-positive rate. If we cannot state it, we do not ship it.
- It must beat the rubber-stamp baseline (approve-everything) on a sealed,
  pre-registered holdout set. If it does not, it ships advisory-only. Context:
  my own tuned LLM reviewer flagged 82% of specs when 35% were actually bad —
  a stamp that read nothing scored better. Read
  `blog/2026-07-26-two-ai-reviewers.html` in drakes-website before designing
  the eval.
- Authors see the reasons and can appeal. A detector nobody can argue with is a censor.
- Thresholds come from the labelled holdout, pre-registered, not tuned until
  the numbers feel nice.

**Things I want you to push back on in the grill:**

- Identity: how does an author prove they are a person without collecting IDs?
- Moderation load at volume: who reads the flags, what does that cost per post?
- What we do the first time the detector is publicly wrong about a real writer.
  Answer this before launch, not after.
- Whether the detector should run at submission time, at publish time, or on a
  delay after publication (and what each does to the author's experience).
- Local model vs. hosted for perplexity, and what that means for cost, latency,
  and the optics of using AI to police AI.
- Reranker size. A 1.3GB cross-encoder is a deployment problem, not a feature.
  Budget it before choosing it.

**Corpus for prototyping retrieval:** use my vault at
`~/brain-actual-intelligence` as the test set. It is a test set only — none of
it gets published.

Start the grill. One round at a time. Assume no codebase knowledge on my part
for anything technical: say what the thing is, why it matters, what each option
means in practice, and what you recommend.
