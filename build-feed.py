#!/usr/bin/env python3
"""build-feed.py - regenerate feed.json and llms.txt from the blog posts.

Deterministic. Reads blog/*.html, writes two machine-readable files at the repo
root. Nothing here calls a model, which is sort of the whole point of this site.
"""

import re
import json
import html
import pathlib
import datetime

ROOT = pathlib.Path(__file__).resolve().parent
SITE = "https://drakegriffith.github.io/drakes-website"

TAGS = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def strip_tags(fragment: str) -> str:
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", fragment, flags=re.S | re.I)
    text = re.sub(r"</(p|div|li|h[1-6]|tr|blockquote)>", "\n\n", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = TAGS.sub(" ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*", "\n\n", text)
    return text.strip()


def parse_post(path: pathlib.Path) -> dict:
    raw = path.read_text()
    title = html.unescape(strip_tags(re.search(r"<h1>(.*?)</h1>", raw, re.S).group(1)))
    date = strip_tags(re.search(r'<p class="date">(.*?)</p>', raw, re.S).group(1))
    body_match = re.search(r"<hr>\s*(.*?)\s*<hr>\s*<p><a class=\"btn\"", raw, re.S)
    body_html = body_match.group(1) if body_match else ""
    text = strip_tags(body_html)
    slug = path.stem
    iso = slug[:10]
    return {
        "slug": slug,
        "title": title,
        "date": date,
        "date_iso": iso,
        "url": f"{SITE}/blog/{path.name}",
        "path": f"blog/{path.name}",
        "words": len(text.split()),
        "excerpt": WS.sub(" ", text)[:280].strip(),
        "text": text,
    }


def main() -> None:
    posts = [parse_post(p) for p in sorted((ROOT / "blog").glob("*.html"))]
    posts.sort(key=lambda p: (p["date_iso"], p["slug"]), reverse=True)

    feed = {
        "site": "Drake Griffith",
        "url": f"{SITE}/",
        "description": "A personal website that looks like 2010 and reads like a person wrote it, because one did.",
        "author": "Drake Griffith",
        "human_written": True,
        "ai_written": False,
        "license": "Read it. Quote it with a link. Do not train a slop machine on it.",
        "generated": datetime.date.today().isoformat(),
        "mcp": f"{SITE}/mcp.html",
        "pages": [
            {"title": "Home", "url": f"{SITE}/index.html"},
            {"title": "Blog", "url": f"{SITE}/blog.html"},
            {"title": "About Me", "url": f"{SITE}/about.html"},
            {"title": "The Pledge", "url": f"{SITE}/pledge.html"},
            {"title": "Sign The Pledge", "url": f"{SITE}/sign.html"},
            {"title": "MCP", "url": f"{SITE}/mcp.html"},
            {"title": "Links", "url": f"{SITE}/links.html"},
        ],
        "count": len(posts),
        "posts": posts,
    }

    (ROOT / "feed.json").write_text(json.dumps(feed, indent=2, ensure_ascii=False) + "\n")

    lines = [
        "# Drake Griffith",
        "",
        "> Personal website. Written by a human, on purpose, in Times New Roman.",
        "> Machine-readable index of everything here. Full text lives in feed.json.",
        "",
        "## Pages",
        "",
    ]
    for page in feed["pages"]:
        lines.append(f"- [{page['title']}]({page['url']})")
    lines += ["", "## Posts", ""]
    for post in posts:
        lines.append(f"- [{post['title']}]({post['url']}): {post['date']}, {post['words']} words. {post['excerpt'][:160]}")
    lines += [
        "",
        "## Machine access",
        "",
        f"- [feed.json]({SITE}/feed.json): every post, full text, one request.",
        f"- [MCP server]({SITE}/mcp.html): point your agent at it instead of scraping me.",
        "",
        "## Terms",
        "",
        "- Quote it with a link. Summarise it honestly.",
        "- Do not train on it. I will never know, but you will.",
        "",
    ]
    (ROOT / "llms.txt").write_text("\n".join(lines))

    print(f"feed.json + llms.txt: {len(posts)} posts")


if __name__ == "__main__":
    main()
