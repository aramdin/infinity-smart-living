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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';

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

// /routines is a dormant page: it only gets built once routines.json has an
// entry. Anything that links to it has to know that, otherwise the service pages
// and blog posts ship links to a page that was never written. Until it is live
// the anchor is unwrapped and the sentence still reads correctly.
const routinesCfg = JSON.parse(readFileSync('./routines.json', 'utf8'));
const routineEntries = routinesCfg.routines || [];
const routinesLive = routineEntries.length > 0;
// Whole sentences come out, not just the anchor: "videos are on our routines
// page" is a false claim while the page is dormant, so unwrapping alone is not
// enough. Each pattern leaves the surrounding prose reading correctly.
const ROUTINES_SENTENCES = [
  /,? and you can (?:watch|see) real routines running on our <a href="\/routines">routines page<\/a>/g,
  / You can watch real routines running on our <a href="\/routines">routines page<\/a> before deciding anything\./g,
  /\s?Short videos of real routines running in real spaces, each with a written explanation of what it does and what it needs, are on our <a href="\/routines">routines page<\/a>\.\s?/g,
  / You can watch real routines running in real rooms on our <a href="\/routines">routines page<\/a>, which is a better guide to whether this suits you than any brochure\./g,
];
const resolveRoutinesLinks = (html) => {
  if (routinesLive) return html;
  let out = html;
  for (const re of ROUTINES_SENTENCES) out = out.replace(re, '');
  // Anything that slipped through loses only its anchor, never its meaning.
  return out.replace(/<a href="\/routines">([\s\S]*?)<\/a>/g, '$1');
};

// Customer reviews. reviews.json is the only source and it ships empty: nothing
// here writes, paraphrases, or invents a review. Copied verbatim from the GBP by
// hand or it does not appear. No Review/AggregateRating schema is emitted, see
// the _schema_note in reviews.json for why.
const reviewsCfg = JSON.parse(readFileSync('./reviews.json', 'utf8'));
const allReviews = (reviewsCfg.reviews || []).filter((r) => r && r.text && r.author);
const STARS = (n) => '★'.repeat(Math.max(0, Math.min(5, Number(n) || 0)));
// Text runs verbatim, so paragraph breaks the customer typed are preserved and
// nothing is trimmed or tidied. Only HTML special characters are escaped.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reviewCard = (r) => `<figure class="rev">
      <div class="rev-stars" aria-label="${Number(r.rating) || 5} out of 5">${STARS(r.rating)}</div>
      <blockquote>${String(r.text).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('')}</blockquote>
      <figcaption>${esc(r.author)}${r.city ? `, ${esc(r.city)}` : ''} · <span>Google review</span></figcaption>
    </figure>`;
// City pages lead with a review from that city, then fill from the general pool.
const reviewsBlock = (city) => {
  if (!allReviews.length) return '';
  const byDate = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));
  const local = city ? allReviews.filter((r) => r.city === city).sort(byDate) : [];
  const rest = allReviews.filter((r) => !local.includes(r)).sort(byDate);
  const picked = [...local, ...rest].slice(0, 3);
  if (!picked.length) return '';
  return `<section class="section" id="reviews">
  <div class="wrap">
    <div class="section-head center reveal">
      <span class="eyebrow">What homeowners say</span>
      <h2>Reviews from our customers</h2>
    </div>
    <div class="rev-grid">
    ${picked.map(reviewCard).join('\n    ')}
    </div>
  </div>
</section>`;
};
base.REVIEWS = reviewsBlock(null);

// Footer "Service areas" links to every city page, so no city page is orphaned
// (internal linking for local SEO). Rendered into templates via {{CITY_LINKS}}.
base.CITY_LINKS = cfg.cities
  .map((c) => `<a href="/${slugify(c.city)}" style="color:#cfe0ff">${c.city}</a>`)
  .join(' · ');

// Footer "Services" mirrors the service-areas block rather than a nav dropdown:
// the nav collapses to a stacked list on mobile, where a dropdown reads badly.
// Single source for the five service pages, rendered via {{SERVICE_LINKS}}.
const SERVICE_NAV = [
  ['smart-lighting-installation', 'Smart lighting installation'],
  ['smart-thermostat-installation', 'Smart thermostat installation'],
  ['smart-lock-and-doorbell-installation', 'Smart lock and doorbell installation'],
  ['alexa-setup-and-routines', 'Alexa setup and routines'],
  ['whole-home-voice-control', 'Whole home voice control'],
];
base.SERVICE_LINKS = SERVICE_NAV
  .map(([slug, label]) => `<a href="/${slug}" style="color:#cfe0ff">${label}</a>`)
  .join(' · ');

// Google Business Profile link. Empty gbpUrl renders nothing anywhere, so the
// markup ships ready and one edit in cities.json lights it up site wide. Never
// point this at a google.com/search URL, it has to be the real profile link.
// Accepted forms, in order of preference: a g.page short link, a maps.app.goo.gl
// share link, a Maps place URL, or a Google search URL that carries a kgmid.
// That last one is allowed only because kgmid pins the link to one business
// entity: it is what Google's own share button returns for this profile, and it
// was checked against the business name, the phone number, and the review count
// before being used. A bare keyword search stays rejected, since it is not tied
// to the business and can surface competitors.
const gbpUrl = (site.gbpUrl || '').trim();
const GBP_OK = /^https:\/\/(g\.page\/|maps\.app\.goo\.gl\/|www\.google\.com\/maps|maps\.google\.com\/)/;
const GBP_KGMID = /^https:\/\/www\.google\.com\/search\?[^ ]*\bkgmid=/;
const gbpOk = !!gbpUrl && (GBP_OK.test(gbpUrl) || GBP_KGMID.test(gbpUrl));
if (gbpUrl && !gbpOk) {
  console.log('⚠  site.gbpUrl is not a recognised Google Business Profile link, GBP link omitted');
  console.log('   want g.page/... , maps.app.goo.gl/... , a /maps place URL, or a search URL with kgmid');
}
// Ampersands are escaped so the href is valid HTML; the kgmid form carries query
// params, so this matters here in a way it would not for a g.page short link.
const gbpHref = gbpUrl.replace(/&/g, '&amp;');
base.GBP_LI = gbpOk ? `\n          <li><a href="${gbpHref}" rel="noopener">Google Business Profile</a></li>` : '';
base.GBP_LINE = gbpOk
  ? `<p style="margin-top:1.1rem">Find us on <a href="${gbpHref}" rel="noopener" style="color:var(--cyan-deep);font-weight:600">our Google Business Profile</a>.</p>`
  : '';

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

// Recent project proof blocks. projects.json is the only source; a city with no
// entry renders nothing, exactly like the routines hub. Keeps invented proof off
// the site while the markup ships ready for the first real photo.
const projectsCfg = JSON.parse(readFileSync('./projects.json', 'utf8'));
const CORE_CITIES = new Set(['Coral Springs', 'Boca Raton', 'Parkland', 'Pompano Beach', 'Coconut Creek', 'Deerfield Beach']);
const projectsByCity = new Map();
for (const p of projectsCfg.projects || []) {
  if (!p || !p.city) continue;
  if (!CORE_CITIES.has(p.city)) {
    console.log(`⚠  projects.json: "${p.city}" is not one of the six core cities, entry skipped`);
    continue;
  }
  const prev = projectsByCity.get(p.city);
  // Most recent wins when a city has more than one entry.
  if (!prev || String(p.date || '') > String(prev.date || '')) projectsByCity.set(p.city, p);
}

const recentProjectBlock = (city) => {
  const p = projectsByCity.get(city);
  if (!p) return '';
  const figure = p.image
    ? `\n      <img src="/images/${p.image}" alt="${p.alt || ''}"${p.width ? ` width="${p.width}"` : ''}${p.height ? ` height="${p.height}"` : ''} loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:14px;background:#06203f;margin-bottom:.9rem">`
    : '';
  return `<div class="reveal" style="margin-top:1.6rem;padding:1.5rem;border-radius:16px;background:var(--surface);border:1px solid var(--line)">
      <span class="eyebrow">Recent project in ${city}</span>${figure}
      <p style="color:var(--slate);font-size:1.04rem;line-height:1.7;margin:.6rem 0 0">${p.blurb}</p>
    </div>`;
};

// Meta descriptions are unique per city and set in cities.json (metaDesc).
// Google truncates the SERP snippet near 160 characters, so anything longer is
// wasted; anything shorter than 120 is leaving the snippet half empty. The build
// fails loudly rather than shipping a duplicated or truncated description.
const seenMetaDesc = new Map();
const cityMetaDesc = (c) => {
  const d = (c.metaDesc || '').trim();
  if (!d) throw new Error(`cities.json: "${c.city}" has no metaDesc. Every city needs a unique one.`);
  if (d.length > 158 || d.length < 120) {
    throw new Error(`cities.json: "${c.city}" metaDesc is ${d.length} chars, must be 120 to 158.`);
  }
  if (seenMetaDesc.has(d)) {
    throw new Error(`cities.json: "${c.city}" metaDesc duplicates "${seenMetaDesc.get(d)}". Descriptions must be unique.`);
  }
  seenMetaDesc.set(d, c.city);
  return d;
};

for (const c of cfg.cities) {
  const slug = slugify(c.city);
  // Unique per-city intro paragraph rendered above the local booking copy.
  // Empty for cities without an intro set, so their page is unchanged.
  const intro = c.intro && c.intro.trim()
    ? `<p style="color:var(--slate);font-size:1.06rem;margin-bottom:1rem">${c.intro.trim()}</p>\n    `
    : '';
  const html = stamp(cityTpl, {
    ...base, CITY: c.city, AREAS: c.areas, CITY_SLUG: slug,
    META_DESC: cityMetaDesc(c),
    LOCAL_INTRO: intro, RECENT_PROJECT: recentProjectBlock(c.city),
  });
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

// Explicit featured-image overrides. Posts listed here use these files (and alt text)
// instead of the blog-<slug>.jpg convention; real install photos stay WebP, thumbs are
// 800px JPGs derived with sips. Posts not listed fall through to the convention above.
const POST_IMAGES = {
  'what-is-matter-smart-home': {
    hero: 'smart-dimmer-switches-led.webp', heroW: 800, heroH: 533,
    thumb: 'smart-dimmer-switches-led.webp', thumbW: 800, thumbH: 533,
    alt: 'Smart dimmer switches with LED indicators installed by our team',
  },
  'smart-home-ecosystem': {
    hero: 'smart-home-lounge-led-lighting.webp', heroW: 1600, heroH: 1213,
    thumb: 'smart-home-lounge-led-lighting-thumb.jpg', thumbW: 800, thumbH: 606,
    alt: 'Lounge with smart LED lighting installed by the Infinity Smart Living team',
  },
  'alexa-for-seniors': {
    hero: 'card-speaker.jpg', heroW: 800, heroH: 532,
    thumb: 'card-speaker.jpg', thumbW: 800, thumbH: 532,
    alt: 'A smart speaker on a table at home',
  },
  'smart-lighting-installation-room-by-room': {
    hero: 'led-accent-lighting-install.webp', heroW: 1600, heroH: 1067,
    thumb: 'led-accent-lighting-install-thumb.jpg', thumbW: 800, thumbH: 533,
    alt: 'LED accent lighting installed along a ceiling by our team',
  },
  'how-to-set-up-a-smart-home': {
    hero: 'smart-tv-entertainment-setup.webp', heroW: 1600, heroH: 1067,
    thumb: 'smart-tv-entertainment-setup-thumb.jpg', thumbW: 800, thumbH: 533,
    alt: 'Smart TV setup installed by the Infinity Smart Living team',
  },
  'home-automation-what-to-automate-first': {
    hero: 'smart-light-switch-install.webp', heroW: 800, heroH: 533,
    thumb: 'smart-light-switch-install.webp', thumbW: 800, thumbH: 533,
    alt: 'Smart light switch installed by our team',
  },
};

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
/* inline photo of our own work; width/height on the img keep it from shifting layout */
.post-fig{margin:1.9rem 0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.post-fig img{display:block;width:100%;height:auto}
.post-fig figcaption{padding:.7rem 1rem;color:var(--slate);font-size:.88rem;line-height:1.5;text-align:center}
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
          <li><a href="mailto:${site.email}">${site.email}</a></li>${base.GBP_LI}
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
    <div style="text-align:center;color:var(--cyan);font-weight:600;font-size:.9rem;padding:6px 0 16px">Free consultation and custom floor plan · No obligation · <a href="/guarantee" style="color:inherit">30-Day Satisfaction Guarantee</a></div>
    <div class="foot-areas" style="padding:22px 0;margin-top:8px;border-top:1px solid rgba(255,255,255,.1)">
      <h4 style="margin-bottom:12px">Smart home services</h4>
      <p style="font-size:.9rem;line-height:2;color:#b9c8e6;margin:0">${base.SERVICE_LINKS}</p>
    </div>
    <div class="foot-areas" style="padding:22px 0;border-top:1px solid rgba(255,255,255,.1)">
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

// image/imageW/imageH/twitterCard drive the social preview card. Width+height and
// twitterCard are opt-in so pages that only pass `image` keep their existing markup.
// Facebook needs og:image:width/height to render a large card on the FIRST scrape,
// before it has fetched and measured the file itself.
const socialImageTags = ({ image, imageW, imageH, twitterCard, imageAlt }) => {
  if (!image) return '';
  const tags = [`<meta property="og:image" content="${image}">`];
  if (imageW && imageH) {
    tags.push(`<meta property="og:image:width" content="${imageW}">`);
    tags.push(`<meta property="og:image:height" content="${imageH}">`);
  }
  if (imageAlt) tags.push(`<meta property="og:image:alt" content="${imageAlt}">`);
  if (twitterCard) {
    tags.push(`<meta name="twitter:card" content="${twitterCard}">`);
    tags.push(`<meta name="twitter:image" content="${image}">`);
  }
  return `${tags.join('\n')}\n`;
};

const blogShell = ({ title, ogTitle, description, canonical, ogType = 'article', image = '', imageW = '', imageH = '', twitterCard = '', imageAlt = '', jsonLd = '', headExtra = '', body }) => `<!doctype html>
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
${socialImageTags({ image, imageW, imageH, twitterCard, imageAlt })}${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>\n` : ''}${headExtra ? `${headExtra}\n` : ''}${fontLinks}
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
  const inner = resolveRoutinesLinks(readFileSync(`./${post.file}`, 'utf8').trim());
  // Only render the hero photo when the image file actually exists; otherwise the
  // brand gradient behind it stands in on its own (no broken image, no layout shift).
  const pi = POST_IMAGES[post.slug];
  const heroImg = pi
    ? `\n  <img class="hero-photo" src="/images/${pi.hero}" alt="${pi.alt}" width="${pi.heroW}" height="${pi.heroH}">`
    : existsSync(`images/blog-${post.slug}.jpg`)
    ? `\n  <img class="hero-photo" src="/images/blog-${post.slug}.jpg" alt="${post.title}" width="1600" height="${heroH(post.slug)}">`
    : '';
  const ogImage = pi ? `${origin}/images/${pi.hero}`
    : existsSync(`images/blog-${post.slug}.jpg`) ? `${origin}/images/blog-${post.slug}.jpg` : '';
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
const cards = posts.map((post, i) => {
  const pi = POST_IMAGES[post.slug];
  const cardImg = pi
    ? `<img class="card-photo" src="/images/${pi.thumb}" alt="${pi.alt}" width="${pi.thumbW}" height="${pi.thumbH}" loading="lazy">`
    : existsSync(`images/blog-${post.slug}-thumb.jpg`)
    ? `<img class="card-photo" src="/images/blog-${post.slug}-thumb.jpg" alt="${post.title}" width="800" height="${thumbH(post.slug)}" loading="lazy">`
    : '';
  return `      <a class="post-card" href="/blog/${post.slug}">
        <div class="card-hero" style="background:${grad(i)}">${cardImg}<span class="post-cat">${post.category}</span></div>
        <div class="card-body">
          <h2>${post.title}</h2>
          <p>${post.description}</p>
          <span class="card-meta">${fmtDate(post.date)} · ${post.read} min read</span>
        </div>
      </a>`;
}).join('\n');

const blogIndexBody = `<main>
  <section class="wrap blog-index">
    <div class="section-head center">
      <span class="eyebrow" style="justify-content:center">Smart home guides</span>
      <h1 style="font-size:clamp(2.1rem,4.4vw,3rem);font-weight:800;margin:.5rem 0 .6rem">Smart home advice for South Florida homeowners</h1>
      <p style="color:var(--slate);max-width:60ch;margin:0 auto">Free, practical guides on smart home automation, lighting, climate, and getting set up the right way. When you are ready, book a free consultation and we will map a smart home floor plan for your home.</p>
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
    <p class="post-meta">A free smart home floor plan before you spend a dollar, and 30 days to be sure after your install.</p>
  </div>
</section>
<article class="post-body">
<p>Book a free consultation and we design your smart home floor plan, room by room, for your exact home. You see the full floor plan and your project price before you decide. Like it and you move forward. Don't like it and you keep the floor plan and owe nothing.</p>
<p>After your installation, live with your system for 30 days. If anything is not right, tell us and we will make it right with adjustments, device swaps, and rework at no charge. If we cannot make it right, we will refund you as set out in your <a href="/terms">project agreement</a>.</p>
<!-- PROOF SLOT: named customer quote about the guarantee being honored (name + city) goes here. Reserve for real reviews. -->
<div class="cta-box">
  <h3>Book your free smart home consultation</h3>
  <p>See your free Amazon Alexa smart home floor plan and your exact price before you spend a dollar. Serving homeowners across Broward County, Boca Raton, Delray Beach, and Boynton Beach.</p>
  <a href="/#book" class="btn btn-primary btn-lg">Get My Free Floor Plan</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
</div>
</article>
</main>`;
writeFileSync('guarantee.html', blogShell({
  title: 'The 30-Day Satisfaction Guarantee | Infinity Smart Living',
  description: 'A free Amazon Alexa smart home floor plan, mapped room by room, plus a 30-Day Satisfaction Guarantee after your install. Serving South Florida.',
  canonical: 'guarantee',
  body: guaranteeBody,
}));
pages.push('guarantee.html');
console.log('✓ guarantee.html');

// ========================= SERVICE PAGES =========================
// One strong page per service, deliberately not one per city: the city pages
// carry the local intent, these carry the service intent, and they link to each
// other. Each page ships Service + FAQPage schema in one @graph.
// Pricing stays off the page by design; the "what it costs" section explains
// that the number arrives with the free floor plan instead.
const CORE_CITY_LINKS = ['Coral Springs', 'Boca Raton', 'Parkland', 'Pompano Beach', 'Coconut Creek', 'Deerfield Beach']
  .map((c) => `<a href="/${slugify(c)}">${c}</a>`);
const servingLine = (what) => `<p class="serving">We plan and install ${what} across South Florida, including ${CORE_CITY_LINKS.slice(0, -1).join(', ')}, and ${CORE_CITY_LINKS[CORE_CITY_LINKS.length - 1]}.</p>`;

const SERVICE_CSS = `<style>
.svc-fig{margin:2rem 0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.svc-fig img{display:block;width:100%;height:auto;background:#06203f}
.svc-fig figcaption{padding:.65rem .9rem;color:var(--slate);font-size:.86rem;line-height:1.5;text-align:center;background:var(--surface)}
.faq-q{margin:1.7rem 0 .5rem;font-size:1.12rem;font-weight:700;color:var(--ink)}
.serving{margin:2.2rem 0 0;padding:1.15rem 1.3rem;border-radius:14px;background:var(--surface);border:1px solid var(--line);color:var(--slate);font-size:1rem;line-height:1.7}
.serving a{color:var(--cyan-deep);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.svc-next{margin:2.4rem 0 0;color:var(--slate);font-size:1.02rem;line-height:1.7}
</style>`;

const fig = (img, alt, w, h, cap) => `<figure class="svc-fig">
  <img src="/images/${img}" alt="${alt}" width="${w}" height="${h}" loading="lazy" decoding="async">
  <figcaption>${cap}</figcaption>
</figure>`;

const SERVICES = [
  {
    slug: 'smart-lighting-installation',
    cat: 'Smart lighting',
    h1: 'Smart Lighting Installation',
    title: 'Smart Lighting Installation in South Florida | Infinity Smart Living',
    description: 'Smart lighting installation in South Florida: switches wired in, rooms grouped the way you use them, Alexa control the whole house gets. Free floor plan first.',
    serviceType: 'smart lighting installation',
    lead: 'Lighting is where nearly every smart home starts, and it is also where most of them go wrong. Here is how we plan it so it still works a year later.',
    body: `<p>Smart lighting sounds simple until you own it. Most people buy a few colour bulbs, discover that the wall switch now has to stay on permanently or nothing responds, and quietly go back to using their hands. That is not a failure of the technology. It is a planning problem, and it is the reason we draw a floor plan before anyone buys hardware.</p>

<h2>Switches or bulbs, and why it matters</h2>
<p>This is the decision that shapes everything else. A smart bulb puts the intelligence in the light itself, which is cheap to start and fine for a lamp in the corner. The catch is the wall switch: cut the power at the wall and the bulb is just a bulb, so every person in the house has to learn not to touch it.</p>
<p>A smart switch puts the intelligence in the wall instead. The switch still works exactly like a switch for anyone who walks in and reaches for it, and it also answers to Alexa. Guests, kids, and anyone who is not interested in your smart home can use the room normally. For any ceiling fixture that people actually switch on and off, we specify switches almost every time.</p>
<p>Bulbs still earn their place. Lamps, accent fixtures, anything you want in a colour, and anything on a plug are all good candidates. A real plan usually ends up mixed, and the mix is the point.</p>

${fig('smart-light-switch-install.webp', 'A smart light switch being wired into a wall box during an install', 800, 533, 'Switches go in the wall, so the room still works normally for everyone who lives in it.')}

<h2>Rooms worth doing first</h2>
<p>If you are starting somewhere rather than everywhere, the rooms that pay off fastest are the ones you pass through with your hands full. Kitchen, main living area, the hallway between the bedrooms, and outside. Those four cover most of the daily friction in a typical home.</p>
<p>Bedrooms come next, mostly because turning the house off from bed is the feature people end up using every single night. Bathrooms and closets are pleasant but rarely the reason anyone calls us.</p>

<h2>Grouping and dimming</h2>
<p>A light you have to name individually is a light you will stop using by voice. The work that makes lighting feel effortless is grouping: the four cans over the island, the two lamps and the floor light in the living room, the whole back patio, each answering to one plain name that the family agreed on.</p>
<p>Dimming is the other half. Warm and low in the evening, bright and cool in the morning, and the same fixture doing both without anyone thinking about it. Not every fixture dims well, and LED retrofits in older Broward homes are particularly fussy about which dimmer they are paired with. We check that in the plan rather than discovering it on install day.</p>

${fig('led-accent-lighting-install.webp', 'LED accent lighting installed along a ceiling detail in a finished room', 1600, 1067, 'Accent runs like this are planned with the room, not added afterwards.')}

<h2>What the install actually involves</h2>
<p>Switch work is electrical work. On your project the regulated electrical work is performed by the licensed electrician under contract, which is how we keep the wiring side properly accountable. Older homes here sometimes lack a neutral wire in the switch box, which narrows the switch choice, and that is exactly the sort of thing the floor plan flags before you have bought anything.</p>
<p>Once the hardware is in, the setup work begins: rooms built in the Alexa app, names everyone can remember, dimming levels set, and routines wired to the moments that matter. We do not leave you with an app full of unnamed devices.</p>

<h2>What it costs</h2>
<p>We do not publish lighting prices, and there is a reason for it. A four room switch job in a newer Parkland house and a whole floor of dimmable accent work in an older Delray home are not the same project, and any number posted on a page would be wrong for one of you.</p>
<p>Instead you get the number with your free smart home floor plan. We map the rooms, specify the switches and bulbs by fixture, and show you the full price before you commit to anything. Like the plan and you move forward. Do not like it and you keep the plan and owe nothing.</p>`,
    faq: [
      { q: 'Do smart lights still work if the internet goes down?', a: 'The switch on the wall keeps working, because it is still a switch. Voice control and app control need the network, so those pause until it comes back. This is a large part of why we specify switches over bulbs for ceiling fixtures.' },
      { q: 'Can I keep my existing light fixtures?', a: 'Usually yes. Smart switches control the fixture you already have, so the ceiling lights, the pendants, and the outdoor lights all stay where they are. Bulb swaps are only needed where you want colour or where a fixture cannot take a switch.' },
      { q: 'Will the dimmer work with my LED bulbs?', a: 'Some pairings hum or flicker at low levels, and older homes here throw up that combination more often. We check the fixture and bulb pairing while drawing the floor plan so the dimmer we specify is one that behaves.' },
      { q: 'Do I have to do the whole house at once?', a: 'No. Plenty of our lighting projects start with one or two rooms and grow later. The floor plan covers the whole home either way, so what you add next year still fits what we installed this year.' },
    ],
    next: 'Room by room detail on where lighting pays off first is in our <a href="/blog/smart-lighting-installation-room-by-room">room by room smart lighting guide</a>. Lighting is also the most common first step in <a href="/blog/home-automation-what-to-automate-first">what is actually worth automating first</a>.',
    serving: 'smart lighting',
  },
  {
    slug: 'alexa-setup-and-routines',
    cat: 'Alexa setup',
    h1: 'Alexa Smart Home Setup and Routines',
    title: 'Alexa Smart Home Setup and Routines | Infinity Smart Living',
    description: 'Alexa setup done properly: rooms grouped, devices named so the family remembers them, routines built around your actual day. Free floor plan before anything.',
    serviceType: 'Alexa smart home setup',
    lead: 'Anyone can plug in an Echo. The difference between a smart home that gets used and one that gets ignored is almost entirely in the setup.',
    body: `<p>Most homes we walk into already have Alexa in them somewhere. There is an Echo in the kitchen, a couple of plugs, maybe a thermostat, and a device list forty items long full of names like "Third Plug" that nobody can remember. Everything technically works. Nobody uses it.</p>
<p>Good Alexa setup is not about owning more. It is about structure, naming, and a small number of routines that match how your household actually moves through the day.</p>

${fig('echo-show-15-wall-panel.webp', 'A wall mounted Echo Show 15 running a whole home, installed by our team', 1600, 1067, 'One Echo Show 15 on the wall, running the whole home. Installed and set up by our team.')}

<h2>Rooms are the foundation</h2>
<p>Alexa needs to know which devices live where. Once a device is assigned to a room, "turn on the lights" said in that room does the obvious thing, without anyone naming a single device. This one piece of structure removes more daily friction than any gadget you can buy.</p>
<p>It also has to match the house as people describe it. If the family calls it the den, the room is called the den, not Bedroom 3. We take the names from you, not from the builder plans.</p>

<h2>Naming that survives contact with your family</h2>
<p>The test for a device name is whether a guest could guess it. Plain, short, and singular beats clever every time. "Kitchen lights" works. "Kitchen Ceiling Zone 2" does not, and it will be the reason someone gives up and uses the switch.</p>
<p>We also strip out the duplicates and near misses that build up over years of adding devices one at a time, because two things called something similar is how you end up with the patio lights coming on at bedtime.</p>

<h2>Routines that earn their keep</h2>
<p>A routine is a set of things that happen together off one trigger: a phrase, a time, a door, or the sun going down. The routines that stick are boring and useful.</p>
<ul>
  <li>Good morning: a few lights up gently, the thermostat moved off the overnight setting, and the day's weather read out.</li>
  <li>Good night: the whole house off in one phrase, the porch light left on, bedroom lamps dimmed rather than cut.</li>
  <li>Leaving home: everything off, climate set back, so nobody has to walk the house checking.</li>
  <li>Sunset: outdoor and accent lighting on by themselves, changing through the year without anyone editing a schedule.</li>
</ul>
<p>Four routines that fire every day beat twenty clever ones nobody remembers the phrase for. We would rather build you the four.</p>

<h2>Seeing it before you buy it</h2>
<p>Short videos of real routines running in real spaces, each with a written explanation of what it does and what it needs, are on our <a href="/routines">routines page</a>. If you would rather set some of this up yourself, the <a href="/free-guide">free Alexa Room and Routine Starter Guide</a> covers room groups, naming, and starter routines you can copy word for word.</p>

<h2>What it costs</h2>
<p>Setup work varies with how much is already in the house and how much of it needs undoing. A new build with nothing installed and a ten year old home with three generations of half finished smart devices are very different afternoons.</p>
<p>So the price arrives with your free smart home floor plan, after we have seen the rooms and the device list. No numbers before then, because they would be guesses. You keep the plan whether or not you go ahead.</p>`,
    faq: [
      { q: 'Do I need to replace the Echo devices I already own?', a: 'Usually not. Older Echo speakers and shows work fine as voice points, and we build the room structure around what you already have. We only suggest a change where a device genuinely cannot do the job, like a screen you want on the wall.' },
      { q: 'How many routines does a normal home end up with?', a: 'Most households settle on four to six that run daily, plus a couple of seasonal ones. More than that and people stop remembering the phrases, which is why we would rather build fewer and make them right.' },
      { q: 'Can everyone in the house use it, or just me?', a: 'Everyone, and that is the standard we build to. Plain names, room based commands, and wall switches that still behave like switches mean guests and family who have no interest in any of this can walk in and use the room.' },
      { q: 'Will you set up devices I bought myself?', a: 'Yes. Plenty of our setup work is on hardware the homeowner already has. The floor plan tells us what fits where, and anything missing gets specified alongside it.' },
    ],
    next: 'New to all of this? Start with <a href="/blog/voice-control-whole-home-automation-guide">voice control and whole home automation</a>, or see <a href="/blog/alexa-for-seniors">Alexa for seniors</a> if you are setting a home up for a parent.',
    serving: 'Alexa setup and routines',
  },
  {
    slug: 'smart-lock-and-doorbell-installation',
    cat: 'Locks and doorbells',
    h1: 'Smart Lock and Video Doorbell Installation',
    title: 'Smart Lock and Video Doorbell Installation | Infinity Smart Living',
    description: 'Smart lock and video doorbell installation across South Florida. See the door from anywhere, lock up from bed, hand out codes not keys. Free floor plan first.',
    serviceType: 'smart lock and video doorbell installation',
    lead: 'The two devices people reach for most on an ordinary day: the one that lets you stop hunting for keys, and the one that tells you who is standing outside.',
    body: `<p>Locks and doorbells are the most used smart devices in most homes, and it has very little to do with technology. It is that both of them remove a small daily annoyance you have stopped noticing: digging for keys with an armful of shopping, and walking to the door to find out it was a delivery.</p>

<h2>What a smart lock changes day to day</h2>
<p>A smart deadbolt replaces the one already in your door and keeps working with a key exactly as before. What it adds is everything else. You can lock the house from bed without going downstairs. You can let the dog walker in on a Tuesday without cutting a key. You can stop the argument in the car about whether anyone locked the front door, because you can just look.</p>
<p>Codes are the part people end up loving. A code for the cleaner that works Thursdays, a code for family visiting for a week, a code for the teenager who loses everything. Handing out and taking back a code is a ten second job, and no key ever leaves your hands.</p>

${fig('blog-best-smart-locks.jpg', 'A smart deadbolt installed on a front door', 1600, 1067, 'The deadbolt swaps out and still takes a key. Everything else it does is new.')}

<h2>Doors are not all the same</h2>
<p>This is the part that catches people out. Deadbolt backset, door thickness, whether the door is metal or solid wood, and how well the door sits in its frame all decide which locks will actually work on your house. A door that needs a shoulder to close is a door where a motorised bolt will jam.</p>
<p>South Florida adds humidity and swelling to the list, particularly on older wooden doors. We check the door itself while drawing the plan, because the wrong lock on a slightly warped door is a support call every week.</p>

<h2>Video doorbells and what they are actually for</h2>
<p>A video doorbell answers one question from anywhere: who is at my door. Talk to the delivery driver and tell them where to leave the box. Tell the person selling something that you are not home without opening the door. See that your kid got in from school. Watch the dog walker arrive on time.</p>
<p>Two way audio means you can hold a conversation with whoever is outside from the kitchen, the office, or a car park in another county. It is convenience, and it happens to be the convenience people use several times a week.</p>

${fig('blog-best-video-doorbells.jpg', 'A video doorbell mounted beside a front door', 1600, 1200, 'Wired doorbells use the existing chime transformer, which is the detail worth checking early.')}

<h2>Wiring, chimes, and the details that matter</h2>
<p>Wired doorbells run off the transformer already behind your existing chime, and plenty of older homes here have one that is undersized for a video unit. That shows up as a doorbell that reboots itself, and it is entirely avoidable if it is checked first. Battery models sidestep the issue at the cost of charging them.</p>
<p>Angle matters more than people expect too. A doorbell aimed at your neighbour's driveway or straight at a white wall in afternoon sun is a poor result whatever you paid for it. Where it goes is part of the plan.</p>

<h2>Bringing it into Alexa</h2>
<p>On its own each device has an app. Together on Alexa they become one system. The doorbell can announce itself on the Echo in the kitchen, and the lock can be part of the phrase that shuts the house down at night, so "Alexa, good night" turns the lights off and locks the front door in one go.</p>

<h2>What it costs</h2>
<p>Price depends on the door, the number of entries, and whether the doorbell has usable wiring behind it. One front door on a modern build and three entries on a 1950s Oakland Park house are different jobs.</p>
<p>You get the number on your free smart home floor plan, after we have looked at the doors. Nothing to pay to find out, and the plan is yours to keep either way.</p>`,
    faq: [
      { q: 'Can I still use a normal key?', a: 'Yes. The smart deadbolts we install keep a standard key cylinder, so a key works exactly as it does now. The codes, the app, and the voice control are additions rather than replacements.' },
      { q: 'What happens to a smart lock if the batteries die?', a: 'They give you weeks of warnings first, in the app and on the keypad. If they do run flat, your key still opens the door, and most models also take a jump from a battery pack at the keypad.' },
      { q: 'Does a video doorbell need existing doorbell wiring?', a: 'A wired one does, and we check the transformer behind your chime is up to the job before specifying it. If there is no usable wiring, a battery model works and we will say so in the plan rather than quoting you for wiring that is not there.' },
      { q: 'Can Alexa lock the door for me?', a: 'Yes, and it is one of the most used routines we build. Locking by voice or as part of a good night routine is straightforward. Unlocking by voice is deliberately restricted by the lock makers and normally asks for a spoken code.' },
    ],
    next: 'Our picks and how to choose between them are in <a href="/blog/best-smart-locks">the best smart locks</a> and <a href="/blog/best-video-doorbells">the best video doorbells</a>.',
    serving: 'smart locks and video doorbells',
  },
  {
    slug: 'smart-thermostat-installation',
    cat: 'Smart thermostats',
    h1: 'Smart Thermostat Installation',
    title: 'Smart Thermostat Installation in South Florida | Infinity Smart Living',
    description: 'Smart thermostat installation for South Florida homes, where the AC runs most of the year. Set up around humidity, real schedules, Alexa. Free floor plan first.',
    serviceType: 'smart thermostat installation',
    lead: 'In most of the country a smart thermostat is about heating. Here it is about an air conditioner that runs most of the year, and that changes how it should be set up.',
    body: `<p>A smart thermostat is the one upgrade in this climate that quietly pays attention while you are not. Your AC is the largest single load in a South Florida house for most of the year, and the thermostat is the only thing standing between it and running harder than it needs to.</p>

${fig('blog-smart-thermostats-florida-cut-ac-bill.jpg', 'A smart thermostat mounted on a wall in a Florida home', 1600, 900, 'The AC runs most of the year here, which makes the thermostat the highest leverage device in the house.')}

<h2>Why Florida is its own case</h2>
<p>Advice written for a house in Ohio does not survive the trip down. There is no long heating season to optimise, the shoulder months barely exist, and humidity does as much to comfort as temperature does. A room at 76 degrees that is damp feels worse than a room at 78 that is dry.</p>
<p>That means the settings that matter here are the ones that keep run times sensible without letting the house get sticky. Setting the thermostat far back while you are out, which works nicely up north, can leave the AC fighting the humidity for an hour when you get home. We tune around that rather than copying a generic schedule.</p>

<h2>The C wire question</h2>
<p>This is the first thing worth checking and the most common reason an install stalls. Smart thermostats need constant power, which normally comes from a common wire, and older Broward and Palm Beach homes frequently do not have one run to the thermostat.</p>
<p>The fixes range from an adapter at the air handler to running a new conductor. All of them are manageable. What is not manageable is finding out on the day, which is why we look behind the existing thermostat while we are drawing the plan.</p>

<h2>Schedules that match your actual week</h2>
<p>Most thermostats are installed with a schedule nobody has ever edited. If the house is empty from eight to five, that is a large stretch every weekday where the AC could be working less. If somebody works from home three days a week, it is not, and pretending otherwise just makes people uncomfortable.</p>
<p>We set the schedule around the week you actually have. Away behaviour, an overnight setting that suits how you sleep, and a bedroom that is not an afterthought.</p>

<h2>More than one zone</h2>
<p>Two storey homes in Parkland and Weston very often run two systems, and the upstairs one does most of the suffering. Two thermostats that know nothing about each other will happily work against one another. Bringing both into one place, with one voice command and one schedule that makes sense as a whole, is usually the single biggest comfort improvement in the house.</p>

<h2>Living with it through Alexa</h2>
<p>Once the thermostat is on Alexa, adjusting it stops being a trip to the hallway. "Alexa, set the house to 74" from the sofa. The overnight setting folded into your good night routine. Everything set back when you leave, without anyone remembering to do it. Small things, used daily.</p>

<h2>What it costs</h2>
<p>It depends on whether you have a usable common wire, how many systems the house runs, and where the thermostats sit. A single zone swap with good wiring behind it and a two system house needing a conductor run are different projects.</p>
<p>The price comes with your free smart home floor plan, once we know which of those you are. We would rather look first than post a number that turns out to be wrong for your house.</p>`,
    faq: [
      { q: 'Will a smart thermostat really lower my electric bill here?', a: 'It helps most where the current schedule does not match the household, which is very common. The saving comes from the AC not running hard while nobody is home, and from run times that suit the humidity. We are careful not to promise a figure, because it depends entirely on how the house is used now.' },
      { q: 'What is a C wire and do I have one?', a: 'It is the common wire that gives the thermostat constant power. Plenty of older homes here do not have one at the thermostat. We check behind your existing unit while drawing the plan, and if it is missing we specify the fix rather than discovering it mid install.' },
      { q: 'I have two air conditioning systems. Do I need two thermostats?', a: 'Yes, one per system, but they should be planned together. Two units running independent schedules tend to work against each other. Brought into one app and one set of routines, the upstairs and downstairs finally agree.' },
      { q: 'Can I still just use the buttons on the wall?', a: 'Always. Every thermostat we install works by hand exactly like the one it replaced, so anyone in the house can walk up and change it without an app or a phrase.' },
    ],
    next: 'The full South Florida picture, including what actually moves the number, is in <a href="/blog/smart-thermostats-florida-cut-ac-bill">smart thermostats in Florida</a>.',
    serving: 'smart thermostats',
  },
  {
    slug: 'whole-home-voice-control',
    cat: 'Voice control',
    h1: 'Whole Home Voice Control',
    title: 'Whole Home Voice Control with Alexa | Infinity Smart Living',
    description: 'Whole home voice control with Alexa: every room covered, plain names your family remembers, lights and climate answering where you stand. Free floor plan first.',
    serviceType: 'whole home voice control',
    lead: 'Voice control stops being a novelty at the point where it works in every room, from where you are standing, without anyone thinking about which device is listening.',
    body: `<p>Whole home voice control means you can speak to your house from anywhere in it and have the right thing happen. Not one clever speaker in the kitchen. The whole house, with the rooms knowing which lights are theirs, and no one in the family needing a list of magic words.</p>
<p>Getting there is less about buying speakers than about coverage, naming, and grouping. We plan all three at once.</p>

${fig('smart-home-lounge-led-lighting.webp', 'A finished lounge with smart lighting installed, controlled by voice', 1600, 1213, 'When the room knows which lights are its own, "turn on the lights" is all anyone has to remember.')}

<h2>Coverage, room by room</h2>
<p>The rule is simple. If you would want to say something in a room, that room needs a voice point in it. Shouting through a doorway is how people conclude voice control does not work.</p>
<p>Kitchens and main living areas earn a screen more often than not, because a screen shows you the doorbell, timers, and the shopping list. Bedrooms usually want a small speaker on the nightstand for the phrase that shuts the house down. Bathrooms, patios, and garages are the ones people forget and then miss, particularly outside, where a phrase to bring up the lighting as you carry things out is genuinely useful.</p>
<p>Then there is the wall panel option: one Echo Show mounted where the family passes it constantly, running the whole home from a single place. That is the setup in the photo above the fold on most of our recent projects.</p>

<h2>What you can actually control</h2>
<ul>
  <li>Lighting, by room and by group, dimmed to a level rather than just on or off.</li>
  <li>Climate, including setting back the whole house in one phrase.</li>
  <li>Motorised shades, which are close to the best voice controlled thing in a Florida house given the afternoon sun.</li>
  <li>Televisions and media, so the room can be set up for a film without four remotes.</li>
  <li>Locks, as part of a routine at the end of the night.</li>
</ul>

${fig('motorized-smart-shade-install.webp', 'Motorised smart shades installed on large windows in a South Florida home', 1600, 1203, 'Shades on voice control get used every afternoon here, which is more than can be said for most smart devices.')}

<h2>Naming is the whole game</h2>
<p>The difference between a house where voice control gets used and one where it does not is almost never the hardware. It is whether the names are guessable. Everyone in the house, including the guest who arrived an hour ago, should be able to work out what to say without being taught.</p>
<p>So we take the names from the family. If it is the back room, it is the back room. Short, plain, no numbers, no duplicates that sound alike.</p>

<h2>The network underneath it</h2>
<p>Voice control leans on wifi, and the far corners of a larger Weston or Parkland home are exactly where wifi runs out. A speaker on a weak signal is a speaker that answers late, which reads to everyone in the house as the system being unreliable.</p>
<p>Coverage is part of the floor plan for that reason. We would rather flag a weak corner while it is still a drawing than have you discover it in the back bedroom afterwards.</p>

<h2>What it costs</h2>
<p>It comes down to how many rooms you want covered and what is in them already. A three room start and a full house with shades and media on voice are different projects, and both are perfectly reasonable places to begin.</p>
<p>Your free smart home floor plan carries the price, room by room, before you commit to any of it. Like it and we go ahead. Do not and you still keep the plan.</p>`,
    faq: [
      { q: 'How many Echo devices does a whole house need?', a: 'One per room where you would actually speak, which for most homes lands between four and eight. It is worth counting the patio and the garage, since those are the ones people forget and then wish they had.' },
      { q: 'Do the speakers all hear me at once and answer over each other?', a: 'Alexa picks the device that heard you most clearly, so the nearest one answers. Where devices sit close together we set them up so the overlap does not cause the two room echo that annoys people.' },
      { q: 'Can voice control work if my wifi is weak at the back of the house?', a: 'Not well, and pretending otherwise is how projects disappoint. Coverage gets checked as part of the floor plan, and if the far bedroom is short of signal we say so upfront and plan around it.' },
      { q: 'Does everyone have to use voice, or do switches still work?', a: 'Switches always still work. We specify wall switches precisely so the house behaves normally for anyone who does not want to talk to it, with voice sitting on top as an option rather than a requirement.' },
    ],
    next: 'A plain introduction to how this all fits together is in <a href="/blog/voice-control-whole-home-automation-guide">voice control and whole home automation</a>, and you can watch real routines running on our <a href="/routines">routines page</a>.',
    serving: 'whole home voice control',
  },
];

for (const s of SERVICES) {
  const faqHtml = s.faq.map((f) => `<p class="faq-q">${f.q}</p>\n<p>${f.a}</p>`).join('\n');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        serviceType: s.serviceType,
        name: s.h1,
        description: s.description,
        provider: { '@id': `${origin}/#business` },
        areaServed: { '@type': 'State', name: 'Florida' },
        url: `${origin}/${s.slug}`,
      },
      {
        '@type': 'FAQPage',
        mainEntity: s.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  });

  const body = `<main>
<section class="post-hero" style="background:linear-gradient(135deg,#06203f 0%,#0a4f8c 55%,#00B2FC 100%)">
  <div class="pwrap">
    <span class="post-cat">${s.cat}</span>
    <h1>${s.h1}</h1>
    <p class="post-meta">${s.lead}</p>
  </div>
</section>
<article class="post-body">
${s.body}

<h2>Common questions</h2>
${faqHtml}

${servingLine(s.serving)}

<p class="svc-next">${s.next}</p>

<div class="cta-box">
  <h3>See it planned for your home first</h3>
  <p>Book a free virtual consultation and we build your smart home floor plan room by room, with your full price shown before you spend a dollar.</p>
  <a href="/#book" class="btn btn-primary btn-lg">Get My Free Floor Plan</a>
</div>
</article>
</main>`;

  writeFileSync(`${s.slug}.html`, blogShell({
    title: s.title,
    description: s.description,
    canonical: s.slug,
    ogType: 'website',
    jsonLd,
    body: resolveRoutinesLinks(body),
  }).replace('</head>', `${SERVICE_CSS}\n</head>`));
  pages.push(`${s.slug}.html`);
  console.log(`✓ ${s.slug}.html`);
}

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
.land-fig{margin:26px 0 0;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface)}
.land-fig img{display:block;width:100%;height:auto}
.land-fig figcaption{padding:.65rem .9rem;color:var(--slate);font-size:.86rem;line-height:1.5;text-align:center}
/* lead figure sits between the headline and the form, so the phone scroll reads
   headline, photo, form. No top margin, and it cancels the lead-card pull-up. */
/* .land-fig-lead is position only: the figure sits above the form. */
.land-fig-lead{margin:0 0 22px}
.land-fig-lead + .lead-card{margin-top:0}
/* .land-fig-panel is the Echo Show panel photo treatment, shared by both landing
   pages. No display crop: the 1600x1067 file is itself centred with thin equal
   margins, so the img renders whole at its natural ratio. The dark background
   stands in for the photo before it decodes, instead of an empty pale card, and
   figcaption re-asserts --surface so the caption bar stays readable. */
.land-fig-panel img{background:#06203f}
.land-fig-panel figcaption{background:var(--surface)}
@media(max-width:460px){.land-hero{padding:40px 0 32px}.land-main{padding:26px 16px 24px}.land-main .lead-card{padding:22px 18px}.land-fig-lead{margin-bottom:18px}}
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
  <span>I agree that Infinity Smart Living and the licensed local electrician under contract for my project may call, text, and email me at the contact details I provide about my inquiry, plan, and services, including by automated technology. Consent is not a condition of purchase. Message frequency varies and message and data rates may apply. Reply STOP to opt out, HELP for help. I agree to the <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.</span>
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

// Both landing pages are distributed by link drops in Facebook DMs and group
// comments, so the share card is the first thing most visitors see. Same photo on
// both: one real install shot beats a logo card.
const LANDING_OG = {
  image: `${origin}/images/echo-show-15-wall-panel-og.jpg`,
  imageW: '1200',
  imageH: '630',
  twitterCard: 'summary_large_image',
  imageAlt: 'A wall mounted Echo Show 15 running a whole home, installed by our team',
};

const landingShell = ({ title, description, canonical, headExtra = '', body }) => blogShell({
  title, description, canonical, ogType: 'website', headExtra, body, ...LANDING_OG,
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
  <figure class="land-fig land-fig-lead land-fig-panel">
    <!-- LCP element: sits inside the first screen at 390px, so it loads eagerly at
         high priority. Do not add loading="lazy" here, it defers the largest paint. -->
    <img src="/images/echo-show-15-wall-panel.webp" alt="A wall mounted Echo Show 15 running a whole home, installed by our team" width="1600" height="1067" fetchpriority="high" decoding="async">
    <figcaption>One Echo Show 15 on the wall, running the whole home. Installed and set up by our team.</figcaption>
  </figure>
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
  // The panel photo is this page's LCP element. The preload starts the fetch during
  // head parse, ahead of the render-blocking font stylesheet, rather than waiting
  // for the body to reach the <img>. Only this page: on /free-floor-plan the same
  // photo sits well below the fold and stays lazy.
  headExtra: '<link rel="preload" as="image" href="/images/echo-show-15-wall-panel.webp" type="image/webp" fetchpriority="high">',
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
  <!-- Proof photo, deliberately below the form and the checkmarks on this page.
       Well under the fold, so it stays lazy: unlike /free-guide this is not the LCP. -->
  <figure class="land-fig land-fig-panel">
    <img src="/images/echo-show-15-wall-panel.webp" alt="A wall mounted Echo Show 15 running a whole home, installed by our team" width="1600" height="1067" loading="lazy" decoding="async">
    <figcaption>A whole home running from one wall panel, installed by our team. Your free floor plan maps what fits your rooms.</figcaption>
  </figure>
</div>
</main>`;

writeFileSync('free-floor-plan.html', landingShell({
  title: 'Free Smart Home Floor Plan + 20 Minute Consult | Infinity Smart Living',
  description: 'Book a free 20 minute virtual consult and get a custom Alexa floor plan for your exact home, room by room, with your full price shown up front.',
  canonical: 'free-floor-plan',
  body: floorPlanBody,
}) .replace('</body>', `${landingFormScript('floor plan squeeze page')}\n</body>`));
console.log('✓ free-floor-plan.html');

// --- /consult-booked ---
// Booking confirmation target: the GHL calendar redirects here after a consult is
// booked, and the page fires appointment_booked for GA4 (and later Google Ads).
// noindex, excluded from the sitemap (never pushed to pages[]), no nav, no CTAs.
const consultBookedBody = `<main>
<section class="land-hero">
  <div class="pwrap">
    <span class="post-cat">Consultation confirmed</span>
    <h1>You are booked!</h1>
    <p class="sub">Your free virtual consult is on the calendar. Here is what happens next.</p>
  </div>
</section>
<div class="land-main">
  <ul class="land-points">
    <li>${CHECK_SVG}We confirm your time by text shortly.</li>
    <li>${CHECK_SVG}We prep your floor plan questions before the call.</li>
    <li>${CHECK_SVG}The call itself takes about 20 minutes.</li>
  </ul>
  <p class="land-note" style="text-align:center;margin-top:22px">Need to change your time? Call or text ${site.phone} and we will move it, no problem.</p>
</div>
</main>`;

writeFileSync('consult-booked.html', landingShell({
  title: 'You Are Booked | Infinity Smart Living',
  description: 'Your free smart home consultation is booked. We confirm by text and the call takes about 20 minutes.',
  canonical: 'consult-booked',
  body: consultBookedBody,
})
  .replace('<link rel="canonical"', '<meta name="robots" content="noindex, follow">\n<link rel="canonical"')
  .replace('</body>', `<script>
(function(){
  try { if (typeof window.gtag === 'function') { window.gtag('event', 'appointment_booked', { page_path: location.pathname }); } } catch (e) {}
})();
</script>
</body>`));
console.log('✓ consult-booked.html (noindex, fires appointment_booked)');

// --- /routines (video hub) ---
// Built only when routines.json has entries, so an empty page never ships.
// YouTube embeds are lazy facades: a thumbnail + play button, and the real
// youtube-nocookie iframe loads only on click. Keeps page weight flat.
// Write ups live in routines-src/<slug>.html (same pattern as posts/).
if (routineEntries.length) {
  const ROUTINES_CSS = `<style>
.routine{max-width:720px;margin:0 auto 56px;padding:0 24px}
.routine h2{font-size:clamp(1.5rem,2.8vw,2rem);font-weight:800;color:var(--ink);margin:0 0 .35rem}
.routine .r-meta{color:var(--slate);font-size:.92rem;margin:0 0 1rem}
.routine p{color:var(--slate);font-size:1.07rem;line-height:1.75;margin:0 0 1.15rem}
.routine ul{margin:0 0 1.35rem 1.15rem;color:var(--slate);font-size:1.07rem;line-height:1.7}
.yt{position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:#06203f;margin:0 0 1.3rem;cursor:pointer}
.yt img{width:100%;height:100%;object-fit:cover;display:block}
.yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.yt-play{position:absolute;inset:0;display:grid;place-items:center;background:rgba(5,25,65,.25);border:0;cursor:pointer;transition:background .2s}
.yt-play:hover{background:rgba(5,25,65,.45)}
.yt-play span{width:74px;height:74px;border-radius:50%;background:var(--cyan);display:grid;place-items:center;box-shadow:0 12px 30px -8px rgba(0,178,252,.7)}
.yt-play svg{width:30px;height:30px;fill:var(--ink);margin-left:4px}
</style>`;
  const routineSections = routineEntries.map((r) => {
    const writeup = readFileSync(`routines-src/${r.slug}.html`, 'utf8').trim();
    return `<section class="routine" id="${r.slug}">
  <h2>${r.title}</h2>
  <p class="r-meta">${fmtDate(r.date)} · ${r.summary}</p>
  <div class="yt" data-yt="${r.youtubeId}">
    <img src="https://i.ytimg.com/vi/${r.youtubeId}/hqdefault.jpg" alt="Video preview: ${r.title}" width="800" height="450" loading="lazy" decoding="async">
    <button class="yt-play" aria-label="Play video: ${r.title}"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></button>
  </div>
${writeup}
</section>`;
  }).join('\n');

  const routinesBody = `<main>
<section class="post-hero" style="background:linear-gradient(135deg,#06203f 0%,#0a4f8c 55%,#00B2FC 100%)">
  <div class="pwrap">
    <span class="post-cat">Routines</span>
    <h1>Real Alexa routines, shown working</h1>
    <p class="post-meta">Short videos of routines we set up, filmed in real spaces, each with a write up of how it works.</p>
  </div>
</section>
<div style="padding:54px 0 30px">
${routineSections}
</div>
<article class="post-body" style="padding-top:0">
<div class="cta-box">
  <h3>Want routines like these in your home?</h3>
  <p>Book a free virtual consultation and your free smart home floor plan maps the routines that fit how you live.</p>
  <a href="/#book" class="btn btn-primary btn-lg">Get My Free Floor Plan</a>
  <a href="tel:${site.phoneHref}" class="btn btn-light btn-lg">Call ${site.phone}</a>
</div>
</article>
</main>`;

  writeFileSync('routines.html', blogShell({
    title: 'Real Alexa Routines in Action | Infinity Smart Living',
    description: 'Watch real Alexa routines working in real spaces: short videos with plain write ups of what each routine does and what it needs.',
    canonical: 'routines',
    body: routinesBody,
  })
    .replace('</head>', `${ROUTINES_CSS}\n</head>`)
    .replace('</body>', `<script>
document.querySelectorAll('.yt').forEach(function(el){
  el.addEventListener('click', function(){
    if (el.querySelector('iframe')) return;
    var id = el.getAttribute('data-yt');
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1';
    f.title = 'Routine video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.setAttribute('allowfullscreen', '');
    el.innerHTML = '';
    el.appendChild(f);
  });
});
</script>
</body>`));
  pages.push('routines.html');
  console.log(`✓ routines.html (${routineEntries.length} routines)`);
} else {
  // Remove a stale routines.html rather than just skipping the build. Without
  // this, a page generated from a since-removed entry stays on disk, gets
  // committed, and ships as a live orphan with whatever content it had.
  if (existsSync('routines.html')) {
    unlinkSync('routines.html');
    console.log('· routines.html removed (no entries in routines.json)');
  } else {
    console.log('· routines.html skipped (no entries in routines.json yet)');
  }
}

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
    <a class="link-btn guarantee" href="/guarantee${LINK_UTM}">Free Floor Plan, No Obligation</a>
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
