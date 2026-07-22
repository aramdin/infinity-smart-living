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

// --- shared client-side GA4 event tracking (single source of truth) ---
// Injected into every page: templates via {{TRACKING}}, blog/guarantee via ${trackingEvents}
// in blogShell. Vanilla JS, no external scripts. Delegated listeners fire call_click and
// booking_click; the form success path fires generate_lead separately. Fully guarded:
// no-op if gtag is unavailable (ad blockers) so links and the form never break.
const trackingEvents = `<script>
(function(){
  function track(name, params){
    try { if (typeof window.gtag === 'function') { window.gtag('event', name, params || {}); } } catch (e) {}
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      track('call_click', { link_location: a.getAttribute('data-loc') || 'page', page_path: location.pathname });
    } else if (href.indexOf('leadconnectorhq.com') !== -1) {
      track('booking_click', { page_path: location.pathname });
    }
  }, true);
})();
</script>`;
base.TRACKING = trackingEvents;

const homeTpl = readFileSync('./template-home.html', 'utf8');

// --- homepage + packages page ---
writeFileSync('index.html', stamp(homeTpl, base));
console.log('✓ index.html (home / consult)');
writeFileSync('packages.html', stamp(readFileSync('./template-packages.html', 'utf8'), base));
console.log('✓ packages.html');

// --- city pages ---
const cityTpl = readFileSync('./template-city.html', 'utf8');
// packages.html is deliberately excluded: the page is orphaned + noindexed and
// pricing stays hidden site-wide. free-guide / free-floor-plan are static
// lead-capture pages kept out of the nav but included in the sitemap.
const pages = ['', 'privacy.html', 'terms.html', 'free-guide.html', 'free-floor-plan.html'];

for (const c of cfg.cities) {
  const slug = slugify(c.city);
  // Unique per-city intro paragraph rendered above the local booking copy.
  // Empty for cities without an intro set, so their page is unchanged.
  const intro = c.intro && c.intro.trim()
    ? `<p style="color:var(--slate);font-size:1.06rem;margin-bottom:1rem">${c.intro.trim()}</p>\n    `
    : '';
  const html = stamp(cityTpl, { ...base, CITY: c.city, AREAS: c.areas, CITY_SLUG: slug, LOCAL_INTRO: intro });
  writeFileSync(`${slug}.html`, html);
  pages.push(`${slug}.html`);
  console.log(`✓ ${slug}.html  (${c.city})`);
}

// ========================= BLOG =========================
// Reuse the real site CSS + logo from the home template so the blog matches.
const styleBlock = (homeTpl.match(/<style[\s\S]*?<\/style>/i) || [''])[0];
const logo = (homeTpl.match(/class="logo" src="([^"]+)"/) || [null, ''])[1];
// Same Google Fonts tags the templates use, so blog/guarantee pages render
// Sora + Plus Jakarta Sans instead of falling back to system fonts.
const fontLinks = (homeTpl.match(/<link rel="preconnect"[\s\S]*?display=swap" rel="stylesheet">/i) || [''])[0];

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
      <a href="/guarantee">Guarantee</a>
      <a href="/blog">Blog</a>
    </nav>
    <div class="nav-cta">
      <a href="tel:${site.phoneHref}" class="nav-call" aria-label="Call ${site.phone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="nav-call-num">${site.phone}</span><span class="nav-call-lbl">Call</span></a>
      <a href="/#book" class="btn btn-primary">Get My Free Floor Plan</a>
    </div>
  </div>
</header>`;

const blogFooter = `<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <img class="flogo" src="/images/logo-light.png" alt="infinity smart living">
        <p>Professional smart home installation and support for real homes across South Florida.</p>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="/">Home</a></li>
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
          <li><a href="/#book">Get My Free Floor Plan</a></li>
        </ul>
      </div>
    </div>
    <div style="text-align:center;color:var(--cyan);font-weight:600;font-size:.9rem;padding:6px 0 16px">Free consultation and smart home layout · No obligation · <a href="/guarantee" style="color:inherit">30-Day Satisfaction Guarantee</a></div>
    <div class="foot-areas" style="padding:22px 0;margin-top:8px;border-top:1px solid rgba(255,255,255,.1)">
      <h4 style="margin-bottom:12px">Smart home service areas</h4>
      <p style="font-size:.9rem;line-height:2;color:#b9c8e6;margin:0">${base.CITY_LINKS}</p>
    </div>
    <div class="foot-bot">
      <!-- PROOF SLOT: legitimacy line (electrician license number + "Simple Safe Technologies LLC DBA Infinity Smart Living") goes here once the license number is confirmed. -->
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
${image ? `<meta property="og:image" content="${image}">\n` : ''}${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : ''}${fontLinks}
${styleBlock}
${BLOG_CSS}
</head>
<body>
${blogHeader}
${body}
${blogFooter}
<!-- MOBILE STICKY CALL BAR (mobile viewports only) -->
<div class="mobile-cta-bar" aria-label="Quick contact">
  <a href="tel:${site.phoneHref}" class="mcb-call"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>Call now</a>
  <a href="/#book" class="mcb-book">Free floor plan</a>
</div>
${trackingEvents}
</body>
</html>
`;

const posts = [...(JSON.parse(readFileSync('./blog.json', 'utf8')).posts || [])]
  .sort((a, b) => (a.date < b.date ? 1 : -1));

mkdirSync('blog', { recursive: true });

// National-intent posts pull most of their traffic from outside our service area,
// so their CTA leads with the free guide (works anywhere) and offers the local
// build as a second line. Local-intent posts keep the floor plan CTA primary.
const NATIONAL_POSTS = new Set([
  'best-smart-home-hubs',
  'what-is-matter-smart-home',
  'smart-home-ecosystem',
  'smart-home-technology-trends-2026',
  'what-is-a-smart-home',
  'best-smart-home-devices-to-start-with',
]);
const ctaBox = (slug) => NATIONAL_POSTS.has(slug)
  ? `<div class="cta-box">
  <h3>Set up your Echo like a pro</h3>
  <p>Room groups, simple device names, and starter routines you can copy word for word. Free download, works with any Echo.</p>
  <a href="/free-guide" class="btn btn-primary btn-lg">Get the free Alexa Room and Routine Starter Guide</a>
  <p style="margin:1.1rem 0 0;font-size:.97rem"><a href="/free-floor-plan" style="color:#fff;text-decoration:underline;text-underline-offset:2px;font-weight:600">In South Florida? We also build the whole thing for you, room by room.</a></p>
</div>`
  : `<div class="cta-box">
  <h3>Book your free smart home consultation</h3>
  <p>See a custom floor plan and an honest price for your home before you spend a dollar. Serving homeowners across Broward County, Boca Raton, Delray Beach, and Boynton Beach.</p>
  <a href="/#book" class="btn btn-primary btn-lg">Get My Free Floor Plan</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
  <p style="margin:1.1rem 0 0;font-size:.97rem"><a href="/free-guide" style="color:#fff;text-decoration:underline;text-underline-offset:2px;font-weight:600">Prefer to start on your own? Get the free Alexa Room and Routine Starter Guide.</a></p>
</div>`;

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
${ctaBox(post.slug)}
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
      <p style="color:var(--slate);max-width:60ch;margin:0 auto">Free, practical guides on smart home automation, lighting, climate, and getting set up the right way. When you are ready, book a free consultation and we will map a smart home layout for your home.</p>
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
    <h1>The 30-Day Satisfaction Guarantee</h1>
    <p class="post-meta">A free smart home layout before you spend a dollar, and 30 days to be sure after your install.</p>
  </div>
</section>
<article class="post-body">
<p>Book a free consultation and we design your smart home layout, room by room, for your exact home. You see the full layout and your project price before you decide. Like it and you move forward. Don't like it and you keep the layout and owe nothing.</p>
<p>After your installation, live with your system for 30 days. If anything is not right, tell us and we will make it right with adjustments, device swaps, and rework at no charge. If we cannot make it right, we will refund you as set out in your <a href="/terms">project agreement</a>.</p>
<!-- PROOF SLOT: named customer quote about the guarantee being honored (name + city) goes here. Reserve for real reviews. -->
<div class="cta-box">
  <h3>Book your free smart home consultation</h3>
  <p>See your free Amazon Alexa smart home layout and your exact price before you spend a dollar. Serving homeowners across Broward County, Boca Raton, Delray Beach, and Boynton Beach.</p>
  <a href="/#book" class="btn btn-primary btn-lg">Get My Free Floor Plan</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
</div>
</article>
</main>`;
writeFileSync('guarantee.html', blogShell({
  title: 'The 30-Day Satisfaction Guarantee | Infinity Smart Living',
  description: 'A free Amazon Alexa smart home layout, mapped room by room, before you spend a dollar, plus a 30-day satisfaction guarantee after your install. Serving South Florida.',
  canonical: 'guarantee',
  body: guaranteeBody,
}));
pages.push('guarantee.html');
console.log('✓ guarantee.html');

// --- lead capture landing pages: /free-guide + /free-floor-plan ---
// Out of the nav on purpose (traffic arrives from social DMs/comments), in the
// sitemap. Mobile first: compact hero, form within one scroll, single CTA each.
// Forms POST to the same GHL inbound webhook as the homepage form and fire the
// same generate_lead event on a 2xx. The guide PDF path is deliberately
// non-guessable and /guides/ is disallowed in robots.txt.
const GUIDE_PDF_PATH = '/guides/alexa-starter-guide-k7m2.pdf';
const LANDING_CITIES = ['Coral Springs', 'Boca Raton', 'Parkland', 'Pompano Beach', 'Coconut Creek', 'Deerfield Beach', 'Other nearby'];

const LANDING_CSS = `<style>
.land-hero{position:relative;overflow:hidden;padding:52px 0 40px;color:#fff;text-align:center;background:linear-gradient(135deg,#06203f 0%,#0a4f8c 55%,#00B2FC 100%)}
.land-hero .pwrap{max-width:680px;margin:0 auto;padding:0 22px}
.land-hero h1{font-size:clamp(1.75rem,5.4vw,2.6rem);font-weight:800;line-height:1.12;margin:.55rem 0 .7rem;color:#fff}
.land-hero .post-cat{display:inline-block;font-family:var(--font-display);font-weight:600;font-size:.72rem;letter-spacing:.15em;text-transform:uppercase;background:rgba(255,255,255,.18);padding:.36rem .8rem;border-radius:999px}
.land-hero .sub{color:rgba(255,255,255,.9);font-size:1.05rem;line-height:1.6;margin:0;max-width:46ch;margin-inline:auto}
.land-main{max-width:560px;margin:0 auto;padding:34px 20px 30px}
.land-main .lead-card{margin-top:-4px}
.field select{width:100%;padding:.9rem 1rem;border:1.5px solid var(--line);border-radius:12px;font:inherit;font-size:1rem;color:var(--ink);background:var(--surface);transition:border-color .15s,background .15s;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23536178' stroke-width='2' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 1rem center}
.field select:focus{outline:none;border-color:var(--cyan);background-color:#fff}
.land-points{list-style:none;margin:26px 0 0;display:flex;flex-direction:column;gap:.85rem;color:var(--slate);font-size:1rem;line-height:1.55}
.land-points li{display:flex;gap:.6rem;align-items:flex-start}
.land-points svg{flex:none;margin-top:3px}
.land-cross{margin:30px 0 6px;padding:1.5rem;border-radius:16px;background:var(--surface);border:1px solid var(--line);text-align:center;color:var(--slate);font-size:.98rem;line-height:1.6}
.land-cross a{color:var(--cyan-deep);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.land-bonus{margin:14px 0 0;text-align:center;color:var(--slate);font-size:.95rem}
.land-note{margin:12px 0 0;color:var(--slate);font-size:.9rem;line-height:1.5}
@media(max-width:460px){.land-hero{padding:40px 0 32px}.land-main{padding:26px 16px 24px}.land-main .lead-card{padding:22px 18px}}
</style>`;

const landingHeader = `<header id="top">
  <div class="wrap nav">
    <a href="/" aria-label="infinity smart living home"><img class="logo" src="${logo}" alt="infinity smart living"></a>
    <div class="nav-cta">
      <a href="tel:${site.phoneHref}" class="nav-call" aria-label="Call ${site.phone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="nav-call-num">${site.phone}</span><span class="nav-call-lbl">Call</span></a>
    </div>
  </div>
</header>`;

const CHECK_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00B2FC" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>`;

const CONSENT_HTML = `<label class="consent">
  <input type="checkbox" id="consent" name="consent" required>
  <span>I agree that Infinity Smart Living and the licensed local electrician under contract for my project may call, text, and email me at the contact details I provide about my inquiry, plan, and services, including by automated technology. Consent is not a condition of purchase. Message frequency varies and message and data rates may apply. Reply STOP to opt out, HELP for help. I agree to the <a href="/privacy.html">Privacy Policy</a> and <a href="/terms.html">Terms</a>.</span>
</label>`;

const cityOptions = ['<option value="" disabled selected>Choose your city</option>']
  .concat(LANDING_CITIES.map((c) => `<option value="${c}">${c}</option>`)).join('\n            ');

const landingFields = `<div class="field">
            <label for="name">First name</label>
            <input id="name" name="name" type="text" placeholder="Jane" required>
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" placeholder="you@email.com" required>
          </div>
          <div class="field">
            <label for="phone">Mobile number</label>
            <input id="phone" name="phone" type="tel" placeholder="Best number to reach you" required>
          </div>
          <div class="field">
            <label for="city">City</label>
            <select id="city" name="city" required>
            ${cityOptions}
            </select>
          </div>
          ${CONSENT_HTML}`;

// Same attribution + submit pattern as the homepage form: capture UTM/click ids
// on landing, POST JSON to GHL, fire generate_lead only on a genuine 2xx, and
// ALWAYS advance the user to the success step even if the POST fails.
const landingFormScript = (leadSource) => `<script>
var ISL_ATTR_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','msclkid'];
(function(){
  try {
    var qs = new URLSearchParams(location.search);
    var stored = JSON.parse(sessionStorage.getItem('isl_attr') || '{}');
    ISL_ATTR_KEYS.forEach(function(k){ var v = qs.get(k); if (v) stored[k] = v; });
    sessionStorage.setItem('isl_attr', JSON.stringify(stored));
  } catch (e) {}
})();
document.getElementById('leadForm').addEventListener('submit', async function(e){
  e.preventDefault();
  var stored = {};
  try { stored = JSON.parse(sessionStorage.getItem('isl_attr') || '{}'); } catch (err) {}
  // page_url keeps the UTMs even if the visitor navigated after landing
  var pageUrl = new URL(location.href);
  ISL_ATTR_KEYS.forEach(function(k){ if (stored[k] && !pageUrl.searchParams.get(k)) pageUrl.searchParams.set(k, stored[k]); });
  var payload = {
    name: document.getElementById('name').value.trim(),
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value.trim(),
    city: document.getElementById('city').value,
    lead_source: '${leadSource}',
    consent: document.getElementById('consent').checked,
    consent_timestamp: new Date().toISOString(),
    page_url: pageUrl.href
  };
  var leadOk = false;
  try {
    var res = await fetch('${site.formEndpoint}', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    leadOk = !!(res && res.ok);
  } catch (err) { /* never block the next step */ }
  if (leadOk) {
    try { if (typeof gtag === 'function') gtag('event', 'generate_lead', { page_path: location.pathname, form_city: payload.city || 'none' }); } catch (e) {}
  }
  document.getElementById('formFields').style.display = 'none';
  document.getElementById('formSuccess').classList.add('show');
});
</script>`;

const landingShell = ({ title, description, canonical, body }) => blogShell({
  title, description, canonical, ogType: 'website', body,
}).replace(blogHeader, landingHeader)
  .replace('<!-- MOBILE STICKY CALL BAR (mobile viewports only) -->', '<!-- sticky call bar omitted: single CTA per landing page -->')
  .replace(/<div class="mobile-cta-bar"[\s\S]*?<\/div>\n/, '')
  // single CTA per page: the footer's "Get started" column would add a second one
  .replace(/<div>\s*<h4>Get started<\/h4>[\s\S]*?<\/div>\n/, '')
  .replace(`${BLOG_CSS}`, `${BLOG_CSS}\n${LANDING_CSS}`);

// --- /free-guide ---
const guideBody = `<main>
<section class="land-hero">
  <div class="pwrap">
    <span class="post-cat">Free download</span>
    <h1>The Alexa Room and Routine Starter Guide</h1>
    <p class="sub">Set up your Echo the way the pros do: room groups, plain names your family will remember, and starter routines you can copy word for word.</p>
  </div>
</section>
<div class="land-main">
  <div class="lead-card">
    <div id="formFields">
      <h3>Get the guide free</h3>
      <p class="sub">Tell us where to send it and the download opens right here.</p>
      <form id="leadForm" method="POST">
          ${landingFields}
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Send Me the Free Guide</button>
          <!-- PROOF SLOT: one line trust stat under the form button (star rating + homes-done count). Reserve for showcase-home assets. -->
      </form>
    </div>
    <div class="success" id="formSuccess">
      <div class="check">✓</div>
      <h3>Your guide is ready</h3>
      <p>A copy is also on its way to your inbox.</p>
      <a href="${GUIDE_PDF_PATH}" class="btn btn-primary btn-lg" style="width:100%;margin-top:12px" download>Download the Guide</a>
      <p style="margin-top:16px;font-size:.95rem">Want it planned for your exact home? <a href="/free-floor-plan" style="color:var(--cyan-deep);font-weight:600">Get a free custom floor plan</a>.</p>
    </div>
  </div>
  <ul class="land-points">
    <li>${CHECK_SVG}Room groups that teach Alexa which devices live where, so "turn on the lights" just works</li>
    <li>${CHECK_SVG}Simple naming tips the whole household will actually remember</li>
    <li>${CHECK_SVG}Starter routines for good morning, good night, and leaving home, ready to copy</li>
  </ul>
  <div class="land-cross">Prefer it done for you? Get a free 20 minute virtual consult and a <a href="/free-floor-plan">free custom floor plan</a> for your exact home.</div>
</div>
</main>`;

writeFileSync('free-guide.html', landingShell({
  title: 'Free Alexa Starter Guide (Rooms + Routines) | Infinity Smart Living',
  description: 'Get the free Alexa Room and Routine Starter Guide: set up room groups, name devices simply, and copy starter routines for morning, night, and leaving home.',
  canonical: 'free-guide',
  body: guideBody,
}) .replace('</body>', `${landingFormScript('guide download page')}\n</body>`));
console.log('✓ free-guide.html');

// --- /free-floor-plan ---
const floorPlanBody = `<main>
<section class="land-hero">
  <div class="pwrap">
    <span class="post-cat">Free virtual consultation + free floor plan</span>
    <h1>A smart home floor plan for your exact home, free</h1>
    <p class="sub">A custom plan for your exact home, room by room, with your full price shown before you spend a dollar. It takes one quick 20 minute video call, and the plan is yours to keep.</p>
  </div>
</section>
<div class="land-main">
  <div class="lead-card">
    <div id="formFields">
      <h3>Get my free floor plan</h3>
      <p class="sub">A few quick details and we will map your home room by room.</p>
      <form id="leadForm" method="POST">
          ${landingFields}
          <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Get My Free Floor Plan</button>
      </form>
      <!-- PROOF SLOT: one line trust stat under the form button (star rating + homes-done count). Reserve for showcase-home assets. -->
      <p class="land-note"><b>Bonus:</b> sign up today and the free Alexa Room and Routine Starter Guide comes with it.</p>
      <p class="land-note">Free plan and price before you decide · No obligation · <a href="/guarantee" style="color:var(--cyan-deep);font-weight:600">30-Day Satisfaction Guarantee</a></p>
    </div>
    <div class="success" id="formSuccess">
      <div class="check">✓</div>
      <h3>You are all set</h3>
      <p>We will reach out shortly to schedule your free 20 minute virtual consult. Your free Alexa starter guide is on its way to your inbox too.</p>
      <a href="${site.bookUrl}" class="btn btn-primary btn-lg" style="width:100%;margin-top:12px">Pick Your Consult Time Now</a>
    </div>
  </div>
  <ul class="land-points">
    <li>${CHECK_SVG}Free plan and price before you decide</li>
    <li>${CHECK_SVG}Licensed electrical work is performed by the licensed electrician under contract on your project.</li>
  </ul>
</div>
</main>`;

writeFileSync('free-floor-plan.html', landingShell({
  title: 'Free Smart Home Floor Plan + 20 Minute Consult | Infinity Smart Living',
  description: 'Book a free 20 minute virtual consult and get a custom smart home floor plan for your exact home, room by room, with your full price shown before you spend a dollar.',
  canonical: 'free-floor-plan',
  body: floorPlanBody,
}) .replace('</body>', `${landingFormScript('floor plan squeeze page')}\n</body>`));
console.log('✓ free-floor-plan.html');

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
    <a class="link-btn primary" href="/${LINK_UTM}#book">Get My Free Floor Plan</a>
    <a class="link-btn guarantee" href="/guarantee${LINK_UTM}">Free Layout, No Obligation</a>
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
