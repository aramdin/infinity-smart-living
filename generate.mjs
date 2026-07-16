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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

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

// Footer "Service areas" links to every city page, so no city page is orphaned
// (internal linking for local SEO). Rendered into templates via {{CITY_LINKS}}.
base.CITY_LINKS = cfg.cities
  .map((c) => `<a href="/${slugify(c.city)}" style="color:#cfe0ff">${c.city}</a>`)
  .join(' · ');

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

// Brand gradient sits behind each post photo as a fallback + side fill, varied by index.
const ANGLES = [135, 120, 150, 162, 110, 142, 128, 156];
const grad = (i) => `linear-gradient(${ANGLES[i % ANGLES.length]}deg,#06203f 0%,#0a4f8c 52%,#00B2FC 100%)`;

// Real intrinsic dimensions of each post photo: [heroHeight, thumbHeight] (widths 1600 / 800),
// used for explicit width/height attributes so the images do not cause layout shift.
const IMG_DIMS = {
  'why-smart-home-automation-worth-it': [1067, 533],
  'smart-home-installation-cost-south-florida': [1067, 533],
  'smart-home-installation-near-me-choosing-installer': [1067, 533],
  'smart-lighting-installation-room-by-room': [900, 450],
  'smart-thermostats-florida-cut-ac-bill': [900, 450],
  'home-automation-what-to-automate-first': [1067, 534],
  'voice-control-whole-home-automation-guide': [1068, 534],
  'free-smart-home-consultation-what-to-expect': [1068, 534],
  'what-is-a-smart-home': [1018, 509],
  'smart-home-automation-explained': [1068, 534],
  'best-smart-home-devices-to-start-with': [1067, 533],
  'best-smart-home-hubs': [1067, 533],
  'how-to-set-up-a-smart-home': [1067, 533],
  'smart-home-technology-trends-2026': [1068, 534],
  'best-video-doorbells': [1200, 600],
  'best-smart-locks': [1067, 533],
};
const heroH = (slug) => (IMG_DIMS[slug] || [900])[0];
const thumbH = (slug) => (IMG_DIMS[slug] || [0, 533])[1];

const BLOG_CSS = `<style>
.post-hero{position:relative;overflow:hidden;padding:100px 0 60px;color:#fff;text-align:center}
.post-hero .pwrap{max-width:780px;margin:0 auto;padding:0 24px;position:relative;z-index:1}
.post-hero h1{font-size:clamp(2rem,4.6vw,3.05rem);font-weight:800;line-height:1.1;margin:.6rem 0 .8rem;color:#fff}
.post-hero .post-cat{display:inline-block;font-family:var(--font-display);font-weight:600;font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;background:rgba(255,255,255,.18);padding:.36rem .8rem;border-radius:999px}
.post-hero .post-meta{color:rgba(255,255,255,.86);font-size:.92rem;margin:0}
.post-hero .hero-photo{position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover}
.post-hero .hero-shade{position:absolute;inset:0;z-index:0;background:rgba(5,25,65,.55)}
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
.card-hero .card-photo{position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover}
.card-hero::after{content:"";position:absolute;inset:0;z-index:0;background:rgba(5,25,65,.30)}
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
      <a href="/guarantee">Guarantee</a>
      <a href="/blog">Blog</a>
    </nav>
    <div class="nav-cta">
      <a href="tel:${site.phoneHref}" class="nav-call" aria-label="Call ${site.phone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="nav-call-num">${site.phone}</span><span class="nav-call-lbl">Call</span></a>
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
          <li><a href="/guarantee">Guarantee</a></li>
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
    <div style="text-align:center;color:var(--cyan);font-weight:600;font-size:.9rem;padding:6px 0 16px">Free consultation and custom room-by-room plan · No obligation · <a href="/guarantee" style="color:inherit">30-Day Money-Back Guarantee</a></div>
    <div class="foot-areas" style="padding:22px 0;margin-top:8px;border-top:1px solid rgba(255,255,255,.1)">
      <h4 style="margin-bottom:12px">Smart home service areas</h4>
      <p style="font-size:.9rem;line-height:2;color:#b9c8e6;margin:0">${base.CITY_LINKS}</p>
    </div>
    <div class="foot-bot">
      <span>© 2026 Simple Safe Technologies LLC DBA Infinity Smart Living. All rights reserved.</span>
      <span><a href="/privacy" style="color:inherit">Privacy</a> · <a href="/terms" style="color:inherit">Terms</a></span>
    </div>
  </div>
</footer>`;

const origin = (site.origin || 'https://YOUR-DOMAIN.com').replace(/\/$/, '');

const blogShell = ({ title, ogTitle, description, canonical, ogType = 'article', image = '', jsonLd = '', body }) => `<!doctype html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QHTJ4PTKQV"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-QHTJ4PTKQV');
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-navy-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${origin}/${canonical}">
<meta property="og:title" content="${ogTitle || title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${origin}/${canonical}">
${image ? `<meta property="og:image" content="${image}">\n` : ''}${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : ''}${styleBlock}
${BLOG_CSS}
</head>
<body>
${blogHeader}
${body}
${blogFooter}
<!-- MOBILE STICKY CALL BAR (mobile viewports only) -->
<div class="mobile-cta-bar" aria-label="Quick contact">
  <a href="tel:${site.phoneHref}" class="mcb-call"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Call now</a>
  <a href="${site.bookUrl}" target="_blank" rel="noopener" class="mcb-book">Free plan</a>
</div>
</body>
</html>
`;

const posts = [...(JSON.parse(readFileSync('./blog.json', 'utf8')).posts || [])]
  .sort((a, b) => (a.date < b.date ? 1 : -1));

mkdirSync('blog', { recursive: true });

posts.forEach((post, i) => {
  const inner = readFileSync(`./${post.file}`, 'utf8').trim();
  // Only render the hero photo when the image file actually exists; otherwise the
  // brand gradient behind it stands in on its own (no broken image, no layout shift).
  const heroImg = existsSync(`images/blog-${post.slug}.jpg`)
    ? `\n  <img class="hero-photo" src="/images/blog-${post.slug}.jpg" alt="${post.title}" width="1600" height="${heroH(post.slug)}">`
    : '';
  const ogImage = existsSync(`images/blog-${post.slug}.jpg`) ? `${origin}/images/blog-${post.slug}.jpg` : '';
  const metaTitle = post.metaTitle || post.title;
  const canonical = `blog/${post.slug}`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: 'Infinity Smart Living', url: origin },
    publisher: { '@type': 'Organization', name: 'Infinity Smart Living', url: origin },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${origin}/${canonical}` },
    url: `${origin}/${canonical}`,
    ...(ogImage ? { image: ogImage } : {}),
  });
  const body = `<main>
<section class="post-hero" style="background:${grad(i)}">${heroImg}
  <span class="hero-shade"></span>
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
  <p>See a custom layout and an honest quote for your home before you spend a dollar. Serving homeowners across Broward County, Boca Raton, Delray Beach, and Boynton Beach.</p>
  <a href="${site.bookUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-lg">Book free consult</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
</div>
<p class="back"><a href="/blog">← All articles</a></p>
</article>
</main>`;
  writeFileSync(`blog/${post.slug}.html`, blogShell({
    title: `${metaTitle} | Infinity Smart Living`,
    ogTitle: post.title,
    description: post.description,
    canonical,
    image: ogImage,
    jsonLd,
    body,
  }));
  pages.push(`blog/${post.slug}.html`);
  console.log(`✓ blog/${post.slug}.html`);
});

// --- blog index ---
const cards = posts.map((post, i) => `      <a class="post-card" href="/blog/${post.slug}">
        <div class="card-hero" style="background:${grad(i)}">${existsSync(`images/blog-${post.slug}-thumb.jpg`) ? `<img class="card-photo" src="/images/blog-${post.slug}-thumb.jpg" alt="${post.title}" width="800" height="${thumbH(post.slug)}" loading="lazy">` : ''}<span class="post-cat">${post.category}</span></div>
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

// --- guarantee page ---
const guaranteeBody = `<main>
<section class="post-hero" style="background:linear-gradient(135deg,#06203f 0%,#0a4f8c 55%,#00B2FC 100%)">
  <div class="pwrap">
    <span class="post-cat">Our promise</span>
    <h1>The 30-Day Money-Back Guarantee</h1>
    <p class="post-meta">A free plan before you spend a dollar, and 30 days to be sure after your install.</p>
  </div>
</section>
<article class="post-body">
<p>We want you confident before you spend a dollar. Your virtual consultation and your custom room-by-room plan are free, and you review the full plan and your exact price before you make any decision.</p>
<h2>Free before you commit</h2>
<p>Your consultation and your custom Amazon Alexa plan cost nothing. Share your floor plan or a few measurements and we map your smart lighting, thermostats, and voice control onto your actual home, room by room. You see the full plan and your exact price before you decide. Like it and you move forward. Do not like it and you keep the plan and owe nothing.</p>
<h2>30 days to live with it</h2>
<p>After your install is complete, live with your system for 30 days. If it is not right for your home, contact us and we will make it right, up to a full refund. Full guarantee details are confirmed in your written proposal.</p>
<h2>No pressure, no obligation</h2>
<p>There is no cost and no obligation to get your plan. You decide if and when to move forward. When you do, a licensed local electrician under contract handles the regulated electrical work and licensed local installers complete your Alexa smart home.</p>
<h2>How it works</h2>
<ul>
<li>Book a free virtual consultation and receive your custom Amazon Alexa room-by-room plan at no cost.</li>
<li>Review the full plan and your exact price before you decide anything.</li>
<li>Approve the plan and licensed local installers schedule and complete the work.</li>
</ul>
<h2>Simple and honest</h2>
<p>No pressure and no surprises. The plan is yours to keep either way, and your exact price is clear before any work begins. For how the agreement and the licensed local electrician are handled, see our <a href="/terms">Terms</a>.</p>
<div class="cta-box">
  <h3>Book your free smart home consultation</h3>
  <p>See your custom Alexa room-by-room plan and your exact price before you spend a dollar. Serving homeowners across Broward County, Boca Raton, Delray Beach, and Boynton Beach.</p>
  <a href="${site.bookUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-lg">Book free consult</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
</div>
</article>
</main>`;
writeFileSync('guarantee.html', blogShell({
  title: 'The 30-Day Money-Back Guarantee | Infinity Smart Living',
  description: 'A free custom Amazon Alexa room-by-room plan before you spend a dollar, plus a 30-day money-back guarantee after your install. Serving South Florida.',
  canonical: 'guarantee',
  body: guaranteeBody,
}));
pages.push('guarantee.html');
console.log('✓ guarantee.html');

// --- links page (linktree-style: bare logo + buttons, noindex, NOT in sitemap/nav/footer) ---
const LINK_UTM = '?utm_source=linktree&utm_medium=bio&utm_campaign=links';
const linksHtml = `<!doctype html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-QHTJ4PTKQV"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-QHTJ4PTKQV');
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-navy-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Infinity Smart Living | Links</title>
<meta name="description" content="Quick links for Infinity Smart Living: book a free consultation, see packages and pricing, and explore our Amazon Alexa smart home service in South Florida.">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${origin}/links">
${styleBlock}
<style>
body.links-page{background:var(--surface);min-height:100vh}
.links-wrap{width:100%;max-width:480px;margin:0 auto;padding:58px 22px 48px;display:flex;flex-direction:column;align-items:center;text-align:center}
.links-logo{height:46px;width:auto;margin-bottom:16px}
.links-tag{color:var(--slate);font-size:1.05rem;line-height:1.55;margin:0 0 28px;max-width:32ch}
.links-stack{width:100%;display:flex;flex-direction:column;gap:14px}
.link-btn{display:block;width:100%;text-align:center;padding:18px 22px;border-radius:14px;font-family:var(--font-display);font-weight:600;font-size:1.05rem;border:1.5px solid var(--line);color:var(--ink);background:#fff;transition:transform .15s ease,box-shadow .15s ease,border-color .15s}
.link-btn:hover{transform:translateY(-2px);box-shadow:0 12px 26px -14px rgba(5,25,65,.4);border-color:var(--cyan)}
.link-btn.primary{background:var(--cyan);border-color:var(--cyan);box-shadow:0 10px 26px -8px rgba(0,178,252,.6)}
.link-btn.primary:hover{background:#1cbcff}
.link-btn.guarantee{background:var(--ink);border-color:var(--ink);color:#fff;box-shadow:0 12px 28px -10px rgba(5,25,65,.55)}
.link-btn.guarantee:hover{background:var(--ink-2);border-color:var(--ink-2)}
</style>
</head>
<body class="links-page">
<main class="links-wrap">
  <img class="links-logo" src="${logo}" alt="Infinity Smart Living">
  <p class="links-tag">Your complete Amazon Alexa smart home. Serving Broward County and South Palm Beach.</p>
  <div class="links-stack">
    <a class="link-btn primary" href="${site.bookUrl}${LINK_UTM}" target="_blank" rel="noopener">Book a Free Consultation</a>
    <a class="link-btn guarantee" href="/guarantee${LINK_UTM}">Free Plan, No Obligation</a>
    <a class="link-btn" href="/${LINK_UTM}">Visit Our Website</a>
    <a class="link-btn" href="tel:+17543454871">Call Us: (754) 345-4871</a>
    <a class="link-btn" href="/blog${LINK_UTM}">Smart Home Guides</a>
  </div>
</main>
</body>
</html>`;
writeFileSync('links.html', linksHtml);
console.log('✓ links.html (bare bio page, noindex, excluded from sitemap/nav/footer)');



// --- sitemap.xml (clean URLs, matching vercel.json cleanUrls) ---
// Glob every generated page under blog/ so no blog URL can be dropped from the
// sitemap on a rebuild, even one added outside this script. Union + dedupe with
// the pages already collected above (blog/<slug>.html get pushed as posts render).
for (const f of readdirSync('blog').filter((f) => f.endsWith('.html'))) {
  const rel = `blog/${f}`;
  if (!pages.includes(rel)) pages.push(rel);
}
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
