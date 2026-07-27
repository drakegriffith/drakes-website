# drakes-website

Drake Griffith's personal website. Plain HTML, one CSS file, Times New Roman, no
build step, no framework, no blog platform. Looks like it was made in 2010 because
that is the point.

Live at: https://drakegriffith.github.io/drakes-website/

## Layout

```
index.html        home page + latest posts
blog.html         full post list
about.html        one paragraph + one photo
links.html        email / github
style.css         the entire design system
_template.html    blueprint for a new post
new-post.sh       makes a post and wires it into both index pages
blog/             one .html file per post
images/           put me.jpg here
```

## Posting

```bash
./new-post.sh "Why I Left Substack"                  # placeholder body
./new-post.sh "Why I Left Substack" draft.txt        # plain text, blank line = new paragraph
./new-post.sh "Why I Left Substack" draft.html       # raw HTML body
./new-post.sh "Why I Left Substack" draft.txt --publish   # also commits and pushes
```

The script creates `blog/YYYY-MM-DD-slug.html`, prepends the link to `blog.html`
and to the top-5 list on `index.html`, and updates the "Last updated" line. It is
pure bash + python3 — nothing in the publishing path calls a model.

## Notes for Claude

When Drake says "post this to my blog":

1. Write the post body to a scratch file (`draft.txt`, plain text, blank lines
   between paragraphs — the script escapes and wraps it).
2. `./new-post.sh "The Title" draft.txt --publish`
3. Delete the scratch file. Give Drake the live URL.

Do not add a static site generator, a package.json, Tailwind, or dark mode. The
ugliness is load-bearing.

## Local preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
