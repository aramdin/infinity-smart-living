#!/usr/bin/env node
// generate.mjs — builds the whole site from templates + cities.json
// Run:  node generate.mjs        (requires Node 18+)
//
// Reads:  template-home.html, template-packages.html, template-city.html, cities.json
// Writes: index.html, packages.html, <city-slug>.html (one per city), sitemap.xml
//
// Edit cities.json (booking link, GHL webhook, phone, email, and the city list),
// then re-run this script. privacy.html / terms.html are static and left untouched.

import { readFileSync, writeFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync('./cities.json', 'utf8'));
const site = cfg.site;

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const stamp = (tpl, vars) =>
  Object.entries(vars).reduce((out, [k, v]) => out.split(`{{${k}}}`).join(v), tpl);

const base = {
  BOOK_URL: site.bookUrl,
  FORM_ENDPOINT: site.formEndpoint,
  PHONE: site.phone,
  PHONE_HREF: site.phoneHref,
  EMAIL: site.email,
};

// --- homepage + packages page ---
writeFileSync('index.html', stamp(readFileSync('./template-home.html', 'utf8'), base));
console.log('✓ index.html (home / consult)');
writeFileSync('packages.html', stamp(readFileSync('./template-packages.html', 'utf8'), base));
console.log('✓ packages.html');

// --- city pages ---
const cityTpl = readFileSync('./template-city.html', 'utf8');
const pages = ['', 'packages.html', 'privacy.html', 'terms.html'];

for (const c of cfg.cities) {
  const slug = slugify(c.city);
  const intro =
    c.intro && c.intro.trim()
      ? c.intro.trim()
      : `We install and set up smart homes across ${c.city} and nearby — including ${c.areas}. Whether you want to start with one room or do the whole house, we make it simple.`;
  const html = stamp(cityTpl, { ...base, CITY: c.city, AREAS: c.areas, CITY_SLUG: slug, LOCAL_INTRO: intro });
  writeFileSync(`${slug}.html`, html);
  pages.push(`${slug}.html`);
  console.log(`✓ ${slug}.html  (${c.city})`);
}

// --- sitemap.xml ---
const origin = (site.origin || 'https://YOUR-DOMAIN.com').replace(/\/$/, '');
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.map((u) => `  <url><loc>${origin}/${u}</loc></url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync('sitemap.xml', sitemap);
console.log('✓ sitemap.xml');

console.log(`\nDone. Built ${cfg.cities.length} city pages + home, packages, sitemap.`);
if (site.bookUrl.includes('YOUR_') || site.formEndpoint.includes('YOUR_')) {
  console.log('\n⚠  Heads up: bookUrl / formEndpoint still have placeholders in cities.json.');
}
