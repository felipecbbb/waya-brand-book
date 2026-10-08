/* ============================================================
   Páginas por idioma para SEO — corre DESPUÉS de `vite build`.

   Antes, las traducciones se aplicaban por JS sobre la misma URL y Google
   solo recibía HTML en español. Esto genera, a partir de dist/:
     dist/en/<página>.html y dist/de/<página>.html
   con el texto traducido YA ESCRITO en el HTML (mismo motor que i18n.js:
   atributos data-i18n + translations.js), y además:
     - <html lang>, <title>, meta description, og/twitter traducidos
     - canonical propio y hreflang es/en/de/x-default en las 3 versiones
     - enlaces internos apuntando a la versión del mismo idioma
     - dist/sitemap.xml con las 3 versiones y sus alternates

   La lista de páginas sale de public/js/i18n.js (LOCALIZED_PAGES): una
   sola fuente, la misma que usa el selector de idioma en el navegador.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'node-html-parser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const SITE = 'https://wayasurf.com';
const LANGS = ['es', 'en', 'de'];
const OG_LOCALE = { es: 'es_ES', en: 'en_GB', de: 'de_DE' };

// Páginas sin URL fija (contenido por ?id=): se traducen, pero sin canonical
// ni hreflang propios y fuera del sitemap.
const DYNAMIC = new Set(['noticia.html']);

const i18nSrc = readFileSync(resolve(ROOT, 'public/js/i18n.js'), 'utf8');
const PAGES = JSON.parse(
  i18nSrc.match(/const LOCALIZED_PAGES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']')
);
const translations = new Function(readFileSync(resolve(DIST, 'js/translations.js'), 'utf8') + '\nreturn translations;')();

/* ---------- Título y descripción por idioma (búsquedas de cada mercado) ---------- */
const SEO = {
  'index.html': {
    en: ['Surf School in Gran Canaria | Surf Lessons in Telde – Waya Surf', 'Surf lessons in Gran Canaria for all levels at Playa del Hombre, Telde. Group and private lessons, surf camps and board rental. Book online or on WhatsApp.'],
    de: ['Surfschule Gran Canaria | Surfkurs in Telde – Waya Surf School', 'Surfkurse auf Gran Canaria für alle Niveaus an der Playa del Hombre in Telde. Gruppen- und Privatkurse, Surfcamps und Boardverleih. Online oder per WhatsApp buchen.'],
  },
  'surf.html': {
    en: ['Surf Courses in Gran Canaria | All Levels – Waya Surf', 'Surf courses in Gran Canaria from beginner to advanced. Private lessons, small groups and video analysis with certified instructors in Telde.'],
    de: ['Surfkurse auf Gran Canaria | Alle Niveaus – Waya Surf', 'Surfkurse auf Gran Canaria vom Anfänger bis zum Fortgeschrittenen. Privatstunden, kleine Gruppen und Videoanalyse mit zertifizierten Surflehrern in Telde.'],
  },
  'informacion-general.html': {
    en: ['Surf Lessons in Gran Canaria: Info, Prices & What to Bring | Waya', 'Everything about our surf lessons in Gran Canaria: courses, prices, schedules, what to bring and how we teach at Playa del Hombre, Telde.'],
    de: ['Surfkurs Gran Canaria: Infos, Preise & was mitbringen | Waya', 'Alles über unsere Surfkurse auf Gran Canaria: Kurse, Preise, Zeiten, was du mitbringen solltest und wie wir an der Playa del Hombre unterrichten.'],
  },
  'clases-grupales.html': {
    en: ['Group Surf Lessons in Gran Canaria | Waya Surf School', 'Group surf lessons in Gran Canaria for all levels. Fun, dynamic classes with max. 8 students, equipment and insurance included. Book in Telde.'],
    de: ['Gruppen-Surfkurs auf Gran Canaria | Waya Surf School', 'Surfkurs in der Gruppe auf Gran Canaria für alle Niveaus. Maximal 8 Teilnehmer, Material und Versicherung inklusive. Jetzt in Telde buchen.'],
  },
  'clases-privadas.html': {
    en: ['Private Surf Lessons in Gran Canaria | 1:1 Coaching – Waya', 'Private 1:1 surf lessons in Gran Canaria. Progress fast with video analysis and an instructor focused 100% on you. Equipment included.'],
    de: ['Surf-Privatstunden auf Gran Canaria | 1:1 Coaching – Waya', 'Private 1:1 Surfstunden auf Gran Canaria. Schneller Fortschritt mit Videoanalyse und einem Surflehrer nur für dich. Material inklusive.'],
  },
  'clases-semiprivadas.html': {
    en: ['Semi-Private Surf Lessons for Two in Gran Canaria | Waya Surf', 'Semi-private surf lessons for two in Gran Canaria. Perfect for couples or friends: your own instructor, equipment included and lots of fun.'],
    de: ['Surfstunden zu zweit auf Gran Canaria | Waya Surf School', 'Semi-private Surfstunden zu zweit auf Gran Canaria – ideal für Paare oder Freunde: eigener Surflehrer, Material inklusive und viel Spaß.'],
  },
  'clases-familiares.html': {
    en: ['Family Surf Lessons in Gran Canaria | Waya Surf School', 'Surf as a family in Gran Canaria. Safe, fun lessons for parents and kids with specialised instructors and adapted equipment in Telde.'],
    de: ['Familien-Surfkurs auf Gran Canaria | Waya Surf School', 'Surfen mit der ganzen Familie auf Gran Canaria. Sichere, spaßige Kurse für Eltern und Kinder mit erfahrenen Surflehrern in Telde.'],
  },
  'bono-residente.html': {
    en: ['Surf Pass for Gran Canaria Residents | Adults – Waya Surf', 'Special prices for Gran Canaria residents: packs of 4 and 8 surf sessions for adults at Playa del Hombre, Telde. Surf regularly at the best price.'],
    de: ['Surf-Abo für Residenten auf Gran Canaria | Erwachsene – Waya', 'Sonderpreise für Residenten auf Gran Canaria: Pakete mit 4 und 8 Surfstunden für Erwachsene an der Playa del Hombre in Telde.'],
  },
  'waya-kids.html': {
    en: ['Kids Surf Lessons in Gran Canaria | Waya Kids', 'Surf lessons for resident kids in Gran Canaria. Waya Kids: safety, fun and playful learning at Playa del Hombre, Telde.'],
    de: ['Surfkurs für Kinder auf Gran Canaria | Waya Kids', 'Surfkurse für Kinder (Residenten) auf Gran Canaria. Waya Kids: Sicherheit, Spaß und spielerisches Lernen an der Playa del Hombre in Telde.'],
  },
  'alquileres.html': {
    en: ['Surfboard & Wetsuit Rental in Gran Canaria | Waya Surf', 'Rent surfboards (softboards and hardboards) and wetsuits at Playa del Hombre, Gran Canaria. Quality gear for all levels and ages.'],
    de: ['Surfbrett- & Neoprenverleih auf Gran Canaria | Waya Surf', 'Surfbretter (Softboards und Hardboards) und Neoprenanzüge an der Playa del Hombre auf Gran Canaria mieten. Gutes Material für alle Niveaus.'],
  },
  'surfcamps.html': {
    en: ['Surf Camps Around the World | Surf Trips – Waya Surf School', 'Waya surf camps: surf trips to the Canary Islands, Morocco and beyond. New waves, community and a proper disconnect. Check dates, prices and spots.'],
    de: ['Surfcamps weltweit | Surfreisen – Waya Surf School', 'Waya Surfcamps: Surfreisen auf die Kanaren, nach Marokko und mehr. Neue Wellen, Community und Abschalten. Termine, Preise und freie Plätze.'],
  },
  'tienda.html': {
    en: ['Surf Shop in Telde, Gran Canaria | Waya Surf School', 'Waya Surf School shop in Telde, Gran Canaria: boards, wetsuits, clothing and surf accessories. Ask for availability on WhatsApp and pick up at the school.'],
    de: ['Surfshop in Telde, Gran Canaria | Waya Surf School', 'Shop der Waya Surf School in Telde, Gran Canaria: Boards, Neoprenanzüge, Kleidung und Zubehör. Verfügbarkeit per WhatsApp anfragen, Abholung in der Schule.'],
  },
  'metodologia.html': {
    en: ['Our Surf Teaching Method | Safe, Progressive Surfing – Waya', "Discover Víctor Bueno's surf teaching method: 15 years of experience and 5 pillars – progression, personal attention, safety, understanding and fun."],
    de: ['Unsere Surf-Lehrmethode | Sicher & progressiv – Waya Surf', 'Die Lehrmethode von Víctor Bueno: 15 Jahre Erfahrung und 5 Säulen – Fortschritt, persönliche Betreuung, Sicherheit, Verständnis und Spaß.'],
  },
  'nosotros.html': {
    en: ['About Us | Waya Surf School – Community & Passion', 'Meet the Waya Surf family. More than a school, we are a community united by our love of the ocean and surfing in Gran Canaria.'],
    de: ['Über uns | Waya Surf School – Community & Leidenschaft', 'Lerne die Waya-Surf-Familie kennen. Mehr als eine Schule: eine Community, verbunden durch die Liebe zum Meer und zum Surfen auf Gran Canaria.'],
  },
  'niveles.html': {
    en: ["What's Your Surf Level? | Progression Guide – Waya Surf", 'Find your surf level with our guide, from your first waves to advanced. Set your goals and improve your technique with Waya Surf in Gran Canaria.'],
    de: ['Welches Surf-Level hast du? | Fortschritts-Guide – Waya', 'Finde dein Surf-Level mit unserem Guide – von der ersten Welle bis Fortgeschritten. Setz dir Ziele und verbessere deine Technik auf Gran Canaria.'],
  },
  'blog.html': {
    en: ['Surf News & Events in the Canary Islands | Waya Surf Blog', 'Surf news from Gran Canaria, Waya community events and tips for surfers. Stay up to date with everything happening in our waves.'],
    de: ['Surf-News & Events auf den Kanaren | Waya Surf Blog', 'Surf-News aus Gran Canaria, Events der Waya-Community und Tipps für Surfer. Bleib auf dem Laufenden über unsere Wellen.'],
  },
  'noticia.html': {
    en: ['News | Waya Surf School', 'News from Waya Surf School in Gran Canaria.'],
    de: ['Neuigkeiten | Waya Surf School', 'Neuigkeiten der Waya Surf School auf Gran Canaria.'],
  },
  'reservar.html': {
    en: ['Book Surf Lessons in Gran Canaria | Waya Surf School', 'Book your surf lessons in Gran Canaria quickly and easily. Choose your course, date and time. Limited spots at Playa del Hombre, Telde.'],
    de: ['Surfkurs auf Gran Canaria buchen | Waya Surf School', 'Buche deinen Surfkurs auf Gran Canaria schnell und einfach. Kurs, Datum und Uhrzeit wählen. Begrenzte Plätze an der Playa del Hombre in Telde.'],
  },
};

/* ---------- Utilidades ---------- */
const urlFor = (lang, page) => {
  const p = page === 'index.html' ? '' : page;
  return lang === 'es' ? `${SITE}/${p}` : `${SITE}/${lang}/${p}`;
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => escHtml(s).replace(/"/g, '&quot;');
const getKey = (obj, path) => path.split('.').reduce((o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null), obj);

// Ruta interna de un enlace → { page, rest } si apunta a una página localizable.
function internalPage(value) {
  const m = value.match(/^([^?#]*)(.*)$/);
  let path = m[1].replace(/^\.\//, '');
  const rest = m[2];
  if (/^\/(en|de)\//.test(path)) return null;          // ya localizado
  path = path.replace(/^\//, '');
  if (path === '') path = 'index.html';
  return PAGES.includes(path) ? { page: path, rest } : null;
}

// Convierte una URL del HTML español (pensado para la raíz) en una válida desde /en/ o /de/.
function rewriteUrl(value, lang) {
  const v = value.trim();
  if (!v || /^(https?:|\/\/|mailto:|tel:|data:|javascript:|#|\{|\$)/i.test(v)) return value;
  const page = internalPage(v);
  if (page) return `/${lang}/${page.page === 'index.html' ? '' : page.page}${page.rest}`;
  if (v.startsWith('/')) return value;                   // /assets/…, /images/…: ya absolutas
  return '/' + v.replace(/^\.\//, '');                   // images/…, css/…, js/… → /images/…
}

function rewriteCssUrls(css) {
  return css.replace(/url\((['"]?)(?!\/|https?:|data:|#)([^'")]+)\1\)/g, (_, q, p) => `url(${q}/${p.replace(/^\.\//, '')}${q})`);
}

/* ---------- Pasos ---------- */
function translateDom(root, lang, page, missing) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const tr = getKey(translations[lang], key);
    if (tr == null) { missing.add(`${page}: ${key}`); continue; }
    const text = String(tr);
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') el.setAttribute('placeholder', text);
    else if (text.includes('<')) el.set_content(text);
    else el.set_content(escHtml(text));
  }
}

function rewriteUrls(root, lang) {
  for (const el of root.querySelectorAll('[src], [href], [srcset], [poster], [action], [data-src], [style]')) {
    if (el.tagName === 'LINK' && /canonical|alternate/.test(el.getAttribute('rel') || '')) continue;
    for (const attr of ['src', 'href', 'poster', 'action', 'data-src']) {
      const v = el.getAttribute(attr);
      if (v != null) el.setAttribute(attr, rewriteUrl(v, lang));
    }
    const srcset = el.getAttribute('srcset');
    if (srcset) el.setAttribute('srcset', srcset.split(',').map(part => {
      const [u, ...d] = part.trim().split(/\s+/);
      return [rewriteUrl(u, lang), ...d].join(' ');
    }).join(', '));
    const style = el.getAttribute('style');
    if (style && style.includes('url(')) el.setAttribute('style', rewriteCssUrls(style));
  }
  for (const st of root.querySelectorAll('style')) st.set_content(rewriteCssUrls(st.innerHTML));
}

function setMeta(head, selector, attrs) {
  let el = head.querySelector(selector);
  if (!el) {
    const tag = selector.startsWith('link') ? 'link' : 'meta';
    head.insertAdjacentHTML('beforeend', `\n    <${tag}>`);
    el = head.lastChild;
    while (el && el.nodeType !== 1) el = el.previousSibling;
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

function applyHead(root, lang, page) {
  root.querySelector('html').setAttribute('lang', lang);
  const head = root.querySelector('head');

  if (lang !== 'es') {
    const [title, desc] = SEO[page]?.[lang] || [];
    if (title) {
      head.querySelector('title')?.set_content(escHtml(title));
      for (const sel of ['meta[property="og:title"]', 'meta[property="twitter:title"]', 'meta[name="twitter:title"]']) {
        head.querySelector(sel)?.setAttribute('content', title);
      }
    }
    if (desc) {
      setMeta(head, 'meta[name="description"]', { name: 'description', content: desc });
      for (const sel of ['meta[property="og:description"]', 'meta[property="twitter:description"]', 'meta[name="twitter:description"]']) {
        head.querySelector(sel)?.setAttribute('content', desc);
      }
    }
  }
  if (head.querySelector('meta[property="og:title"]')) {
    setMeta(head, 'meta[property="og:locale"]', { property: 'og:locale', content: OG_LOCALE[lang] });
  }

  // canonical + hreflang (no en páginas de contenido por ?id=)
  head.querySelectorAll('link[rel="alternate"][hreflang]').forEach(l => l.remove());
  if (DYNAMIC.has(page)) {
    head.querySelectorAll('link[rel="canonical"]').forEach(l => l.remove());
    return;
  }
  const self = urlFor(lang, page);
  setMeta(head, 'link[rel="canonical"]', { rel: 'canonical', href: self });
  for (const sel of ['meta[property="og:url"]', 'meta[property="twitter:url"]']) head.querySelector(sel)?.setAttribute('content', self);
  const alternates = LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${escAttr(urlFor(l, page))}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${escAttr(urlFor('es', page))}">`);
  const canonical = head.querySelector('link[rel="canonical"]');
  canonical.insertAdjacentHTML('afterend', '\n    ' + alternates.join('\n    '));
}

/* ---------- Generación ---------- */
const missing = new Set();
for (const page of PAGES) {
  const file = resolve(DIST, page);
  const html = readFileSync(file, 'utf8');

  // Español: misma URL de siempre, solo se le añaden canonical/hreflang.
  const es = parse(html, { comment: true });
  applyHead(es, 'es', page);
  writeFileSync(file, es.toString());

  for (const lang of ['en', 'de']) {
    const doc = parse(html, { comment: true });
    translateDom(doc, lang, page, missing);
    rewriteUrls(doc, lang);
    applyHead(doc, lang, page);
    mkdirSync(resolve(DIST, lang), { recursive: true });
    writeFileSync(resolve(DIST, lang, page), doc.toString());
  }
}

/* ---------- Sitemap ---------- */
const today = new Date().toISOString().slice(0, 10);
const entries = PAGES.filter(p => !DYNAMIC.has(p)).flatMap(page => LANGS.map(lang => `  <url>
    <loc>${urlFor(lang, page)}</loc>
    <lastmod>${today}</lastmod>
    <priority>${page === 'index.html' ? '1.0' : '0.8'}</priority>
${LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlFor(l, page)}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor('es', page)}"/>
  </url>`));
writeFileSync(resolve(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`);

console.log(`i18n-pages: ${PAGES.length} páginas × 3 idiomas · sitemap con ${entries.length} URLs`);
if (missing.size) console.log(`i18n-pages: ${missing.size} claves sin traducir (se quedan en español):\n  ` + [...missing].join('\n  '));
