# Infinity Smart Living

Static marketing site for Infinity Smart Living, built from HTML templates and a
single config file. No build dependencies — just Node 18+.

## How it works

`cities.json` holds the site config (booking link, GHL form webhook, phone, email,
origin) and the list of service-area cities. `generate.mjs` reads the templates plus
that config and writes the final site.

- **Templates** (edit these for design/copy changes): `template-home.html`,
  `template-packages.html`, `template-city.html`
- **Config** (edit this for content/cities): `cities.json`
- **Static pages** (edited by hand, left untouched by the generator): `privacy.html`,
  `terms.html`
- **Generated output** (do not edit by hand — regenerated each run): `index.html`,
  `packages.html`, one `<city-slug>.html` per city, `sitemap.xml`

## Edit loop

1. Edit `cities.json` (and/or the `template-*.html` files).
2. Regenerate the site:
   ```sh
   node generate.mjs
   ```
3. Review the output, then commit:
   ```sh
   git add -A
   git commit -m "Update site content"
   ```

## Deploy

Hosted on Vercel. `vercel.json` enables `cleanUrls` so pages resolve without the
`.html` extension (e.g. `/packages`, `/coral-springs`). Pushing to the default branch
deploys.
