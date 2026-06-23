# Infinity Smart Living

Static marketing site for Infinity Smart Living, built from HTML templates and a
single config file. No build dependencies, just Node 18+.

## How it works

`cities.json` holds the site config (booking link, GHL form webhook, phone, email,
origin) and the list of service-area cities. `blog.json` lists the blog posts (their
body HTML lives in `posts/`). `generate.mjs` reads the templates plus that config and
writes the final site.

- **Templates** (edit these for design/copy changes): `template-home.html`,
  `template-packages.html`, `template-city.html`
- **Config** (edit this for content/cities): `cities.json`
- **Blog** (edit for articles): `blog.json` (metadata) + `posts/<slug>.html` (body)
- **Static pages** (edited by hand, left untouched by the generator): `privacy.html`,
  `terms.html`
- **Generated output** (do not edit by hand, regenerated each run): `index.html`,
  `packages.html`, one `<city-slug>.html` per city, `blog.html`, `blog/<slug>.html`
  per post, `sitemap.xml`

## Edit loop

1. Edit `cities.json` and/or the `template-*.html` files.
2. Regenerate the site:
   ```sh
   node generate.mjs
   ```
3. Review the output, then commit:
   ```sh
   git add -A
   git commit -m "Update site content"
   ```

## Adding a blog post

1. Create `posts/<slug>.html` with the article body only (`<p>`, `<h2>`, `<ul>`, …).
   No `<h1>`, no hero, no closing call-to-action — the generator adds those.
2. Add an entry to `blog.json` (`slug`, `title`, `description`, `category`, `date`,
   `read`, `file`). Posts are sorted newest-first by `date`.
3. Run `node generate.mjs`. The post, the `/blog` index, and `sitemap.xml` update.

Post hero banners are generated as on-brand inline SVG (no image files to manage). To
use real photos instead, add an image field per post and swap the `.post-hero` markup
in `generate.mjs`.

## Booking calendar embed (stashed for later)

The site currently links out to the GoHighLevel booking calendar (`bookUrl`). To embed
it inline on a page instead, drop in:

```html
<iframe src="https://api.leadconnectorhq.com/widget/booking/fYvTpTurGkoZCLMCcdIa"
  style="width:100%;border:none;overflow:hidden;" scrolling="no"
  id="fYvTpTurGkoZCLMCcdIa_1782246067024"></iframe>
<script src="https://api.leadconnectorhq.com/js/form_embed.js" type="text/javascript"></script>
```

## Deploy

Hosted on Vercel. `vercel.json` enables `cleanUrls` so pages resolve without the
`.html` extension (e.g. `/packages`, `/coral-springs`). Pushing to the default branch
deploys.
