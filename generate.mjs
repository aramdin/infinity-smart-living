#!/usr/bin/env node
// generate.mjs — builds the whole site from templates + cities.json + blog.json
// Run:  node generate.mjs        (requires Node 18+)
//
// Reads:  template-home.html, template-packages.html, template-city.html,
//         cities.json, blog.json, posts/<file>.html
// Writes: index.html, packages.html, <city-slug>.html (one per city),
//         blog.html, blog/<post-slug>.html (one per post), sitemap.xml
//
// Edit cities.json (booking link, GHL webhook, phone, email, city list) and/or
// blog.json (+ a posts/ file per article), then re-run this script.
// privacy.html / terms.html are static and left untouched.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

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

const homeTpl = readFileSync('./template-home.html', 'utf8');

// --- homepage + packages page ---
writeFileSync('index.html', stamp(homeTpl, base));
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
      : `We install and set up smart homes across ${c.city} and nearby, including ${c.areas}. Whether you want to start with one room or do the whole house, we make it simple.`;
  const html = stamp(cityTpl, { ...base, CITY: c.city, AREAS: c.areas, CITY_SLUG: slug, LOCAL_INTRO: intro });
  writeFileSync(`${slug}.html`, html);
  pages.push(`${slug}.html`);
  console.log(`✓ ${slug}.html  (${c.city})`);
}

// ========================= BLOG =========================
// Reuse the real site CSS + logo from the home template so the blog matches.
const styleBlock = (homeTpl.match(/<style[\s\S]*?<\/style>/i) || [''])[0];
const logo = (homeTpl.match(/class="logo" src="(data:[^"]+)"/) || [null, ''])[1];

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

// Inline SVG banner — the post "image". Brand gradient + circuit motif, varied by index.
const ANGLES = [135, 120, 150, 162, 110, 142, 128, 156];
const grad = (i) => `linear-gradient(${ANGLES[i % ANGLES.length]}deg,#06203f 0%,#0a4f8c 52%,#00B2FC 100%)`;
const DECO = `<svg class="deco" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M90 150c0-33 27-60 60-60s60 27 60 60-27 60-60 60-60-27-60-60zm120 0c0-33 27-60 60-60s60 27 60 60-27 60-60 60-60-27-60-60zm120 0c0-33 27-60 60-60s60 27 60 60-27 60-60 60-60-27-60-60zm120 0c0-33 27-60 60-60s60 27 60 60-27 60-60 60-60-27-60-60z" stroke="#fff" stroke-width="2" opacity=".45"/></svg>`;

const BLOG_CSS = `<style>
.post-hero{position:relative;overflow:hidden;padding:100px 0 60px;color:#fff;text-align:center}
.post-hero .pwrap{max-width:780px;margin:0 auto;padding:0 24px;position:relative;z-index:1}
.post-hero h1{font-size:clamp(2rem,4.6vw,3.05rem);font-weight:800;line-height:1.1;margin:.6rem 0 .8rem;color:#fff}
.post-hero .post-cat{display:inline-block;font-family:var(--font-display);font-weight:600;font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;background:rgba(255,255,255,.18);padding:.36rem .8rem;border-radius:999px}
.post-hero .post-meta{color:rgba(255,255,255,.86);font-size:.92rem;margin:0}
.post-hero .deco{position:absolute;inset:0;z-index:0;width:100%;height:100%}
.post-body{max-width:720px;margin:0 auto;padding:54px 24px 30px}
.post-body h2{font-size:clamp(1.4rem,2.6vw,1.9rem);font-weight:800;margin:2.2rem 0 .8rem;color:var(--ink)}
.post-body h3{font-size:1.2rem;font-weight:700;margin:1.6rem 0 .55rem;color:var(--ink)}
.post-body p{color:var(--slate);font-size:1.07rem;line-height:1.75;margin:0 0 1.15rem}
.post-body ul,.post-body ol{margin:0 0 1.35rem 1.15rem;color:var(--slate);font-size:1.07rem;line-height:1.7}
.post-body li{margin:.42rem 0}
.post-body a{color:var(--cyan-deep);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.cta-box{margin:2.8rem 0 1rem;padding:2.1rem;border-radius:18px;background:linear-gradient(135deg,#06203f,#00B2FC);color:#fff;text-align:center}
.cta-box h3{color:#fff;font-size:1.5rem;margin:0 0 .6rem}
.cta-box p{color:rgba(255,255,255,.92);margin:0 0 1.4rem}
.back{margin-top:1.6rem;text-align:center}
.back a{color:var(--slate);font-weight:600}
.blog-index{padding:72px 0 50px}
.post-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:28px;margin-top:42px}
.post-card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;transition:transform .18s ease,box-shadow .18s ease;color:inherit}
.post-card:hover{transform:translateY(-4px);box-shadow:0 18px 40px -22px rgba(5,25,65,.5)}
.card-hero{position:relative;height:152px;display:flex;align-items:flex-end;padding:16px;overflow:hidden}
.card-hero .post-cat{position:relative;z-index:1;font-family:var(--font-display);font-weight:600;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:rgba(3,18,40,.32);padding:.3rem .65rem;border-radius:999px}
.card-hero .deco{position:absolute;inset:0;width:100%;height:100%;opacity:.6}
.card-body{padding:20px 22px 24px;display:flex;flex-direction:column;gap:.55rem;flex:1}
.card-body h2{font-size:1.18rem;font-weight:700;line-height:1.28;color:var(--ink);margin:0}
.card-body p{color:var(--slate);font-size:.96rem;line-height:1.55;margin:0;flex:1}
.card-meta{color:#9aa7bd;font-size:.84rem;font-weight:600}
@media(max-width:680px){
  .post-hero{padding:60px 0 42px}
  .post-body{padding:38px 20px 24px}
  .cta-box{padding:1.6rem;margin:2.2rem 0 1rem}
  .cta-box h3{font-size:1.3rem}
  .blog-index{padding:50px 0 36px}
  .post-grid{gap:20px;margin-top:30px}
}
@media(max-width:460px){
  .post-hero h1{font-size:clamp(1.7rem,7.6vw,2.2rem)}
  .post-body p,.post-body ul,.post-body ol{font-size:1.02rem}
  .post-body h2{font-size:1.4rem}
}
</style>`;

const blogHeader = `<header id="top">
  <div class="wrap nav">
    <a href="/" aria-label="infinity smart living home"><img class="logo" src="${logo}" alt="infinity smart living"></a>
    <nav class="nav-links" aria-label="Primary">
      <a href="/packages">Packages</a>
      <a href="/blog">Blog</a>
    </nav>
    <div class="nav-cta">
      <a href="${site.bookUrl}" target="_blank" rel="noopener" class="btn btn-primary">Book free consult</a>
    </div>
  </div>
</header>`;

const blogFooter = `<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <img class="flogo" src="${logo}" alt="infinity smart living">
        <p>Professional smart home installation and support for real homes across South Florida.</p>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/packages">Packages</a></li>
          <li><a href="/blog">Blog</a></li>
        </ul>
      </div>
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="tel:${site.phoneHref}">${site.phone}</a></li>
          <li><a href="mailto:${site.email}">${site.email}</a></li>
          <li>South Florida</li>
        </ul>
      </div>
      <div>
        <h4>Get started</h4>
        <ul>
          <li><a href="${site.bookUrl}" target="_blank" rel="noopener">Book free consult</a></li>
        </ul>
      </div>
    </div>
    <div style="text-align:center;color:var(--cyan);font-weight:600;font-size:.9rem;padding:6px 0 16px">30-Day Money-Back Guarantee · Free consultation and floor plan</div>
    <div class="foot-bot">
      <span>© 2026 infinity smart living. All rights reserved.</span>
      <span><a href="/privacy" style="color:inherit">Privacy</a> · <a href="/terms" style="color:inherit">Terms</a></span>
    </div>
  </div>
</footer>`;

const origin = (site.origin || 'https://YOUR-DOMAIN.com').replace(/\/$/, '');

const blogShell = ({ title, description, canonical, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${origin}/${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="article">
${styleBlock}
${BLOG_CSS}
</head>
<body>
${blogHeader}
${body}
${blogFooter}
</body>
</html>
`;

const posts = [...(JSON.parse(readFileSync('./blog.json', 'utf8')).posts || [])]
  .sort((a, b) => (a.date < b.date ? 1 : -1));

mkdirSync('blog', { recursive: true });

posts.forEach((post, i) => {
  const inner = readFileSync(`./${post.file}`, 'utf8').trim();
  const body = `<main>
<section class="post-hero" style="background:${grad(i)}">
  ${DECO}
  <div class="pwrap">
    <span class="post-cat">${post.category}</span>
    <h1>${post.title}</h1>
    <p class="post-meta">${fmtDate(post.date)} · ${post.read} min read</p>
  </div>
</section>
<article class="post-body">
${inner}
<div class="cta-box">
  <h3>Book your free smart home consultation</h3>
  <p>See a custom layout and an honest quote for your home before you spend a dollar. Serving Coral Springs, Boca Raton, Parkland, Pompano Beach, Coconut Creek, and Deerfield Beach.</p>
  <a href="${site.bookUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-lg">Book free consult →</a>
</div>
<p class="back"><a href="/blog">← All articles</a></p>
</article>
</main>`;
  writeFileSync(`blog/${post.slug}.html`, blogShell({
    title: `${post.title} | Infinity Smart Living`,
    description: post.description,
    canonical: `blog/${post.slug}`,
    body,
  }));
  pages.push(`blog/${post.slug}.html`);
  console.log(`✓ blog/${post.slug}.html`);
});

// --- blog index ---
const cards = posts.map((post, i) => `      <a class="post-card" href="/blog/${post.slug}">
        <div class="card-hero" style="background:${grad(i)}">${DECO}<span class="post-cat">${post.category}</span></div>
        <div class="card-body">
          <h2>${post.title}</h2>
          <p>${post.description}</p>
          <span class="card-meta">${fmtDate(post.date)} · ${post.read} min read</span>
        </div>
      </a>`).join('\n');

const blogIndexBody = `<main>
  <section class="wrap blog-index">
    <div class="section-head center">
      <span class="eyebrow" style="justify-content:center">Smart home guides</span>
      <h1 style="font-size:clamp(2.1rem,4.4vw,3rem);font-weight:800;margin:.5rem 0 .6rem">Smart home advice for South Florida homeowners</h1>
      <p style="color:var(--slate);max-width:60ch;margin:0 auto">Free, practical guides on smart home automation, lighting, climate, and getting set up the right way. When you are ready, book a free consultation and we will map a plan for your home.</p>
    </div>
    <div class="post-grid">
${cards}
    </div>
  </section>
</main>`;

writeFileSync('blog.html', blogShell({
  title: 'Smart Home Blog & Guides | Infinity Smart Living',
  description: 'Free smart home guides for South Florida: home automation, smart lighting, smart thermostats, voice control, costs, and how to choose a local installer.',
  canonical: 'blog',
  body: blogIndexBody,
}));
pages.push('blog.html');
console.log('✓ blog.html (index)');

// --- sitemap.xml (clean URLs, matching vercel.json cleanUrls) ---
const cleanPath = (u) => (u === '' ? '' : u.replace(/\.html$/, ''));
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.map((u) => `  <url><loc>${origin}/${cleanPath(u)}</loc></url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync('sitemap.xml', sitemap);
console.log('✓ sitemap.xml');

console.log(`\nDone. Built ${cfg.cities.length} city pages + home, packages, ${posts.length} blog posts, blog index, sitemap.`);
if (site.bookUrl.includes('YOUR_') || site.formEndpoint.includes('YOUR_')) {
  console.log('\n⚠  Heads up: bookUrl / formEndpoint still have placeholders in cities.json.');
}
