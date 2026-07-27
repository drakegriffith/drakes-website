# The Hub — design notes

Status: **not built.** `pledge.html` is the public commitment; this file is the
scoping sketch behind it. Nothing here is locked. Before any of it gets built it
should go through a proper grill → spec → tickets pass, because it is a
multi-session build with a real trust boundary in it.

## What it is

A blog hub. Anyone can publish. Nobody is allowed to use AI to write it.
Enforcement is a slop detector that **flags for a human**, never auto-deletes.
Search across the hub is retrieval-based, not keyword-and-ads.

Three pieces, in dependency order:

1. Submission + publishing (the boring part that has to work first)
2. Slop detection gate
3. RAG search over the corpus

## 1. Submission

- Author submits plain text or Markdown plus a signed pledge checkbox.
- Post renders into the same 2010 HTML as this site. One shared stylesheet.
- Every post carries a verdict badge: `human` / `flagged` / `disputed`.
- Storage: flat files in a git repo, same as this site. No database until a
  database is the thing that hurts.

## 2. Slop detection

Do not invent a new science. The essay-grading world has been scoring these for
two years; copy the signal set, then calibrate it on real submissions.

Signals worth stealing:

| Signal | What it measures | Cheap implementation |
| --- | --- | --- |
| Burstiness | Variance in sentence length. Humans spike, models flatline. | stdev of sentence token counts |
| Perplexity | How predictable each next token is | small local LM scoring pass |
| Lexical tells | delve, tapestry, testament, "not just X but Y", rule-of-three everywhere | regex + phrase list, weighted |
| Structural uniformity | Section lengths, paragraph counts, every para topic-sentence-first | plain statistics on the parse |
| Resolution | Slop ties every thread off; real writing leaves one loose | hardest signal, likely a human check |

Rules that matter more than the signals:

- **Flag, never delete.** The detector produces a score plus the top three
  reasons. A person makes the call.
- **Publish the false-positive rate.** If we cannot state it, we cannot use it.
- **Beat the rubber stamp.** Baseline: a detector that approves everything. If
  ours does not beat that baseline on a sealed holdout set, it ships as advisory
  only. See `blog/2026-07-26-two-ai-reviewers.html` — 82% flag rate against a
  35% real failure rate is what happens when you skip this step.
- **Appeals are a feature.** The author sees the reasons and can respond. A
  detector nobody can argue with is a censor.
- Threshold gets set from a labelled holdout set, pre-registered, not tuned
  until the numbers feel nice.

## 3. RAG search — the mini-Google part

Search box at the top of the hub. Behind it, retrieval over the corpus rather
than a keyword index sold to advertisers.

- Chunk on section boundaries, roughly 300–600 tokens, keep the heading path.
- Hybrid retrieval: BM25 + embeddings, reciprocal-rank fusion. Neither alone.
- Rerank the top ~50 with a cross-encoder. Watch the model size; a 1.3GB
  reranker is a deployment problem, not a search feature.
- Results are quotes with links, not a generated answer. The hub's whole premise
  is that the writing is the product; do not replace it with a summary of itself.
- The `~/brain-actual-intelligence` vault is the working corpus for prototyping
  the retrieval stack before real submissions exist. Vault content is not
  published — it is a test set.
- Expose the same index over MCP, same shape as `mcp/server.js` here.

## Open questions

- Identity: how does an author prove they are a person without collecting IDs?
- Moderation load: who reads the flags at volume, and what does that cost?
- What happens the first time the detector is publicly wrong about a real writer?
  (Answer it before it happens, not after.)
- Is the hub a separate repo? Almost certainly yes. This site links to it.
