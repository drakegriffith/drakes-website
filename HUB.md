# The Hub — design notes (SUPERSEDED)

Status: **superseded, 2026-07-28.** This file was the scoping sketch written
before the build had a map. It no longer describes what is being built, and it is
kept for the record rather than as a spec. Where it disagrees with anything, the
order is: [`pledge.html`](pledge.html) is the public commitment, the build's own
issue tracker is the working map, and this file loses to both.

## What it is

A blog hub. Anyone can publish. Nobody is allowed to use AI to write it. A person
reads every submission and decides. Search across the hub is retrieval-based, not
keyword-and-ads.

## What the sketch got wrong

**A slop detector.** The bulk of this file was a signal set (burstiness,
perplexity, lexical tells, structural uniformity) plus rules about flagging
rather than deleting, publishing a false-positive rate, and beating a
rubber-stamp baseline on a sealed holdout. None of it is being built. The
mechanism is one person reading, and the discipline the detector would have been
held to now applies to the reviewer: a blind labelled set, a measured accuracy, a
published number, the rubber stamp as the bar to beat. The rules that section was
protecting survive in a stronger form: flag never delete, appeals are real,
publish the number. What changed is that the thing being measured is now the
thing making the call.

**Flat files in a git repo.** Pending and rejected submissions live in a
database, never in git. A public repo full of somebody's rejected drafts is a
pillory, not a queue. Git holds published writing only.

**A verdict badge on every post.** There is no `flagged` state to render when
nothing automatic produces one. A post is published or it is not.

**Identity left as an open question.** Settled: signing the pledge is account
creation. The email is private and used only for bans and appeals, display names
may be pen names, and the sign-up page moves to the hub itself rather than
staying here.

## What survived

- Retrieval over the corpus instead of a keyword index sold to advertisers.
  Hybrid retrieval, results as quotes with links rather than a generated answer.
  The writing is the product, so do not replace it with a summary of itself.
- The same index exposed over MCP, same shape as [`mcp/server.js`](mcp/server.js).
- Posts rendered into the same 2010 HTML as this site, one shared stylesheet.
- The `~/brain-actual-intelligence` vault as a private test corpus for the
  retrieval work. It is a test set, not published writing.

## Still open

- Review turnaround, and what happens when more arrives than one person can read.
- What a rejected author receives, through what channel, and how the appeal is
  filed and decided when the only reviewer is also the person being appealed
  against.
- The first time a rejection is publicly disputed by a real writer.

All three belong to the build's tracker, not to this file.
