#!/usr/bin/env bash
# new-post.sh - make a new blog post and wire it into the index pages.
#
#   ./new-post.sh "Title Of The Post"                 -> post with placeholder body
#   ./new-post.sh "Title Of The Post" draft.txt       -> plain text, blank lines = paragraphs
#   ./new-post.sh "Title Of The Post" draft.html      -> raw HTML body, pasted in as-is
#   ./new-post.sh "Title" draft.txt --publish         -> also git add/commit/push
#
# No dependencies beyond bash + python3. Deterministic; nothing here calls a model.

set -euo pipefail
cd "$(dirname "$0")"

TITLE="${1:-}"
BODY_FILE="${2:-}"
PUBLISH="no"
for arg in "$@"; do [ "$arg" = "--publish" ] && PUBLISH="yes"; done
[ "${BODY_FILE:-}" = "--publish" ] && BODY_FILE=""

if [ -z "$TITLE" ]; then
  echo "usage: ./new-post.sh \"Post Title\" [body.txt|body.html] [--publish]" >&2
  exit 1
fi

TITLE="$TITLE" BODY_FILE="$BODY_FILE" python3 - <<'PY'
import os, re, html, datetime, pathlib

title = os.environ["TITLE"]
body_file = os.environ.get("BODY_FILE") or ""

today = datetime.date.today()
iso = today.isoformat()
pretty = f"{today.strftime('%B')} {today.day}, {today.year}"

slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
post_path = pathlib.Path("blog") / f"{iso}-{slug}.html"
if post_path.exists():
    raise SystemExit(f"refusing to overwrite existing post: {post_path}")

if body_file and body_file.endswith(".html"):
    body = pathlib.Path(body_file).read_text()
elif body_file:
    raw = pathlib.Path(body_file).read_text().strip()
    paras = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
    body = "\n\n".join("<p>\n" + html.escape(p) + "\n</p>" for p in paras)
else:
    body = "<p>\nWrite the post here.\n</p>"

tpl = pathlib.Path("_template.html").read_text()
post = tpl.replace("{{TITLE}}", html.escape(title)).replace("{{DATE}}", pretty).replace("{{BODY}}", body)
post_path.write_text(post)

entry = (f'<li><a href="{{prefix}}blog/{iso}-{slug}.html">{html.escape(title)}</a> '
         f'&mdash; <span class="date">{pretty}</span></li>')

def insert(page, start, end, prefix, limit=None):
    text = pathlib.Path(page).read_text()
    block = re.search(re.escape(start) + r"(.*?)" + re.escape(end), text, re.S)
    items = re.findall(r"<li>.*?</li>", block.group(1), re.S)
    items.insert(0, entry.format(prefix=prefix))
    if limit:
        items = items[:limit]
    new_block = start + "\n<ul>\n" + "\n".join(items) + "\n</ul>\n" + end
    pathlib.Path(page).write_text(text[:block.start()] + new_block + text[block.end():])

insert("blog.html", "<!-- POSTS_START -->", "<!-- POSTS_END -->", "")
insert("index.html", "<!-- LATEST_START -->", "<!-- LATEST_END -->", "", limit=5)

# keep the "Last updated" line on the home page honest
home = pathlib.Path("index.html")
home.write_text(re.sub(r"Last updated: [^<]*", f"Last updated: {pretty}", home.read_text()))

print(post_path)
PY

if [ "$PUBLISH" = "yes" ]; then
  git add -A
  git commit -m "blog: $TITLE"
  git push
  echo "published."
else
  echo "not committed. run: git add -A && git commit -m \"blog: $TITLE\" && git push"
fi
