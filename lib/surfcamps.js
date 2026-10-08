/* ============================================================
   Surfcamps — listado + detalle en vivo desde Supabase.
   Renderiza los surf_camps creados en el panel (tabla surf_camps)
   y permite reservar la plaza con señal (deposit) vía carrito.
   - Sin ?camp  → listado de ediciones (grid de tarjetas).
   - ?camp=slug → detalle de una edición + reserva.
   - Sin camps activos → estado "próximamente" + lista de espera.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { addItem, updateCartPill } from '/lib/cart.js';
import { pagarAhora } from '/lib/pagar.js';

/* ---------- Idioma ---------- */
// El selector ES/EN/DE guarda el idioma en localStorage (ver public/js/i18n.js).
// El contenido de los camps vive en la BD, así que no pasa por data-i18n:
// hay que traducirlo aquí leyendo la columna i18n.
function currentLang() {
  try { return localStorage.getItem('siteLanguage') || 'es'; } catch { return 'es'; }
}

// Devuelve el campo traducido al idioma activo, o el español si no hay
// traducción. Nunca deja un hueco: mejor en español que vacío.
function tr(obj, campo, lang = currentLang()) {
  const base = obj?.[campo];
  if (lang === 'es') return base;
  const t = obj?.i18n?.[lang]?.[campo];
  if (t == null || t === '') return base;
  if (Array.isArray(base) && (!Array.isArray(t) || !t.length)) return base;
  return t;
}


/* ---------- Textos de la interfaz ----------
   Los literales de este módulo se pintan por JS, así que no los cubre el
   sistema data-i18n del HTML. Aquí van sus tres versiones. */
const UI = {
  es: {
    soldout: 'Agotado', soon: 'Próximamente', offer: 'Oferta', last: 'Últimas plazas',
    from: 'Desde', details: 'Ver detalles', days: 'días', nights: 'noches',
    spot: 'plaza', spots: 'plazas', upcoming: 'Próximas ediciones',
    pick: 'Elige tu Surfcamp', live: 'Fechas, precios y plazas se actualizan en tiempo real.',
    allEditions: '← Todas las ediciones', includes: 'Qué incluye', idealFor: 'Ideal para ti si…',
    reviews: 'Lo que dicen quienes ya vinieron', faqTitle: 'Preguntas frecuentes',
    dates: 'Fechas', duration: 'Duración', spotsLabel: 'Plazas', perPerson: 'por persona',
    save: 'Ahorras', available: 'disponible', availables: 'disponibles',
    full: 'Esta edición está completa.', book: 'Reservar plaza · señal',
    depositNote: 'Reservas tu plaza con una señal de {n}€. El resto se abona antes del trip.',
    openPhoto: 'Ampliar foto', close: 'Cerrar', prev: 'Anterior', next: 'Siguiente',
    heroTitle: 'Vive el surf por el mundo', heroSub: 'Viajes de surf con la familia Waya. Elige tu próxima edición.',
    added: 'Plaza añadida al carrito', loadError: 'No se pudieron cargar los surfcamps. Inténtalo más tarde.',
    waitlist: 'Apúntate a la lista', soonTag: 'Muy pronto', soonTitle: 'Estamos preparando el próximo Surfcamp',
    soonText: 'Déjanos tu email y serás el primero en enterarte cuando abramos plazas. Sin spam, solo el aviso.',
    emailPh: 'Tu email', notifyMe: 'Avísame', wlOk: '¡Listo! Te avisaremos en cuanto abramos plazas.',
    wlErr: 'No se pudo registrar tu email. Inténtalo de nuevo.',
    wlNote: 'Aún no hay plazas abiertas. Déjanos tu email y te avisamos el primero.',
  },
  en: {
    soldout: 'Sold out', soon: 'Coming soon', offer: 'Offer', last: 'Last spots',
    from: 'From', details: 'View details', days: 'days', nights: 'nights',
    spot: 'spot', spots: 'spots', upcoming: 'Upcoming editions',
    pick: 'Choose your Surfcamp', live: 'Dates, prices and spots update in real time.',
    allEditions: '← All editions', includes: "What's included", idealFor: 'This is for you if…',
    reviews: 'What past guests say', faqTitle: 'Frequently asked questions',
    dates: 'Dates', duration: 'Duration', spotsLabel: 'Spots', perPerson: 'per person',
    save: 'You save', available: 'available', availables: 'available',
    full: 'This edition is fully booked.', book: 'Book your spot · deposit',
    depositNote: 'Secure your spot with a {n}€ deposit. The rest is paid before the trip.',
    openPhoto: 'Enlarge photo', close: 'Close', prev: 'Previous', next: 'Next',
    heroTitle: 'Surf your way around the world', heroSub: 'Surf trips with the Waya family: new waves, community and a proper disconnect. Pick your next edition.',
    added: 'Spot added to cart', loadError: 'Could not load the surfcamps. Please try again later.',
    waitlist: 'Join the waitlist', soonTag: 'Coming soon', soonTitle: "We're preparing the next Surfcamp",
    soonText: "Leave your email and you'll be the first to know when spots open. No spam, just the heads-up.",
    emailPh: 'Your email', notifyMe: 'Notify me', wlOk: "Done! We'll let you know as soon as spots open.",
    wlErr: 'Could not save your email. Please try again.',
    wlNote: "Spots aren't open yet. Leave your email and we'll tell you first.",
  },
  de: {
    soldout: 'Ausgebucht', soon: 'Demnächst', offer: 'Angebot', last: 'Letzte Plätze',
    from: 'Ab', details: 'Details ansehen', days: 'Tage', nights: 'Nächte',
    spot: 'Platz', spots: 'Plätze', upcoming: 'Nächste Editionen',
    pick: 'Wähle deinen Surfcamp', live: 'Termine, Preise und Plätze werden live aktualisiert.',
    allEditions: '← Alle Editionen', includes: 'Was ist inklusive', idealFor: 'Das passt zu dir, wenn…',
    reviews: 'Das sagen frühere Gäste', faqTitle: 'Häufige Fragen',
    dates: 'Termine', duration: 'Dauer', spotsLabel: 'Plätze', perPerson: 'pro Person',
    save: 'Du sparst', available: 'verfügbar', availables: 'verfügbar',
    full: 'Diese Edition ist ausgebucht.', book: 'Platz reservieren · Anzahlung',
    depositNote: 'Sichere dir deinen Platz mit {n}€ Anzahlung. Der Rest wird vor der Reise bezahlt.',
    openPhoto: 'Foto vergrößern', close: 'Schließen', prev: 'Zurück', next: 'Weiter',
    heroTitle: 'Surfe um die ganze Welt', heroSub: 'Surfreisen mit der Waya-Familie: neue Wellen, Community und Abschalten. Wähle deine nächste Edition.',
    added: 'Platz zum Warenkorb hinzugefügt', loadError: 'Die Surfcamps konnten nicht geladen werden. Bitte später erneut versuchen.',
    waitlist: 'Auf die Warteliste', soonTag: 'Demnächst', soonTitle: 'Wir bereiten das nächste Surfcamp vor',
    soonText: 'Hinterlass deine E-Mail und erfahre als Erste/r, wenn Plätze frei werden. Kein Spam, nur die Info.',
    emailPh: 'Deine E-Mail', notifyMe: 'Benachrichtige mich', wlOk: 'Fertig! Wir melden uns, sobald Plätze frei sind.',
    wlErr: 'Deine E-Mail konnte nicht gespeichert werden. Bitte erneut versuchen.',
    wlNote: 'Noch keine Plätze offen. Hinterlass deine E-Mail und wir sagen dir zuerst Bescheid.',
  },
};
const t = (k) => (UI[currentLang()] || UI.es)[k] ?? UI.es[k];

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TODAY = new Date().setHours(0, 0, 0, 0);

const esc = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Number(n).toLocaleString('es-ES');

const LOCALES = { es: 'es-ES', en: 'en-GB', de: 'de-DE' };
function locale() { return LOCALES[currentLang()] || 'es-ES'; }
function mesDe(d) { return d.toLocaleDateString(locale(), { month: 'long' }); }

function dateRange(a, b) {
  if (!a || !b) return '';
  const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${mesDe(s)}`;
  return `${s.getDate()} ${mesDe(s)} – ${e.getDate()} ${mesDe(e)}`;
}
function longDate(a, b) {
  if (!a || !b) return '';
  const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  return `${s.toLocaleDateString(locale(), { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString(locale(), opts)}`;
}

function campState(c) {
  const isPast = c.date_end && new Date(c.date_end + 'T00:00:00').getTime() < TODAY;
  const isSoldOut = isPast || c.sold_out || c.status === 'full' || (c.max_spots && c.spots_taken >= c.max_spots);
  const remaining = Math.max((c.max_spots || 0) - (c.spots_taken || 0), 0);
  const hasOffer = c.original_price && Number(c.original_price) > Number(c.price);
  const isComingSoon = c.status === 'coming_soon';
  return { isPast, isSoldOut, remaining, hasOffer, isComingSoon };
}

/* ---------- Data ---------- */
async function loadCamps() {
  const { data, error } = await supabase
    .from('surf_camps')
    .select('*')
    .neq('status', 'closed')
    .order('date_start');
  if (error) { console.warn('surfcamps:', error.message); return []; }
  // Oculta ediciones ya pasadas
  return (data || []).filter(c => !(c.date_end && new Date(c.date_end + 'T00:00:00').getTime() < TODAY));
}

async function fetchCampFull(slug) {
  const { data: camp, error } = await supabase.from('surf_camps').select('*').eq('slug', slug).single();
  if (error || !camp) return null;
  const [ph, ts, fq] = await Promise.all([
    supabase.from('camp_photos').select('*').eq('camp_id', camp.id).order('sort_order'),
    supabase.from('camp_testimonials').select('*').eq('camp_id', camp.id).order('sort_order'),
    supabase.from('camp_faqs').select('*').eq('camp_id', camp.id).order('sort_order'),
  ]);
  return { ...camp, photos: ph.data || [], testimonials: ts.data || [], faqs: fq.data || [] };
}

// Textos e imagen del hero del listado: editables desde el panel
// (tabla site_settings, clave 'surfcamps_hero').
async function loadHeroSettings() {
  const { data } = await supabase
    .from('site_settings').select('value').eq('key', 'surfcamps_hero').maybeSingle();
  return data?.value || null;
}

/* ---------- Toast ---------- */
function toast(msg) {
  let t = document.querySelector('.cart-toast');
  if (!t) { t = document.createElement('div'); t.className = 'cart-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Reserva (señal → carrito) ---------- */
function reserveCamp(c, boton) {
  // Directo a la pasarela: se cobra la señal. El importe lo fija el servidor
  // leyendo surf_camps.deposit, no este valor.
  const deposit = Number(c.deposit) || 180;
  pagarAhora({
    id: `camp-${c.id}`,
    type: 'camp',
    name: `Surfcamp: ${c.title}`,
    price: deposit,
    quantity: 1,
    metadata: { campId: c.id, edition: c.title, slug: c.slug, totalAmount: Number(c.price) },
  }, { boton });
}

/* ---------- Card ---------- */
function campCard(c) {
  const st = campState(c);
  const badge = st.isSoldOut ? `<span class="sc-badge sc-badge--soldout">${t('soldout')}</span>`
    : st.isComingSoon ? `<span class="sc-badge sc-badge--soon">${t('soon')}</span>`
    : st.hasOffer ? `<span class="sc-badge sc-badge--offer">${t('offer')}</span>`
    : st.remaining <= 5 ? `<span class="sc-badge sc-badge--last">${t('last')}</span>` : '';
  const priceHtml = st.hasOffer
    ? `<span class="sc-price-old">${num(c.original_price)}€</span> <strong>${num(c.price)}€</strong>`
    : `<strong>${num(c.price)}€</strong>`;
  const img = c.hero_image || '/images/surfcamp-hero.webp';
  const kicker = tr(c, 'kicker') || tr(c, 'hero_kicker') || 'Surfcamp';
  const titulo = tr(c, 'title') || c.title;
  const days = c.duration_days || '';
  const nights = days ? Math.max(days - 1, 0) : '';

  return `
    <article class="sc-card ${st.isSoldOut ? 'is-soldout' : ''}">
      <a class="sc-card-media" href="/surfcamps.html?camp=${encodeURIComponent(c.slug)}" aria-label="${esc(titulo)}">
        <img src="${esc(img)}" alt="${esc(titulo)}" loading="lazy">
        ${badge}
        <span class="sc-card-dates">${esc(dateRange(c.date_start, c.date_end))}</span>
      </a>
      <div class="sc-card-body">
        <span class="sc-card-kicker">${esc(kicker)}</span>
        <h3 class="sc-card-title">${esc(titulo)}</h3>
        <div class="sc-card-meta">
          ${c.duration_label
            ? `<span>🗓️ ${esc(tr(c, 'duration_label'))}</span>`
            : days ? `<span>🗓️ ${days} ${t('days')}${nights ? ` / ${nights} ${t('nights')}` : ''}</span>` : ''}
          ${!st.isSoldOut && st.remaining ? `<span>🏄 ${st.remaining} ${st.remaining === 1 ? t('spot') : t('spots')}</span>` : ''}
          ${c.card_vibe ? `<span>⚡ ${esc(String(tr(c, 'card_vibe')).toUpperCase())}</span>` : ''}
        </div>
        <div class="sc-card-foot">
          <span class="sc-card-price">${t('from')} ${priceHtml}</span>
          <a class="btn btn-primary sc-card-cta" href="/surfcamps.html?camp=${encodeURIComponent(c.slug)}">${t('details')}</a>
        </div>
      </div>
    </article>`;
}

/* ---------- List view ---------- */
function renderList(root, camps, hero, ajustes) {
  document.documentElement.classList.remove('sc-awaiting-hero');
  if (hero) {
    // Editable desde el panel. Los textos por defecto ya no dicen "Gran
    // Canaria": los camps son por todo el mundo.
    const s = ajustes || {};
    const kicker = tr(s, 'kicker') || 'Surfcamps';
    const titulo = tr(s, 'title') || t('heroTitle');
    const sub = tr(s, 'subtitle') || t('heroSub');
    hero.querySelector('[data-sc-hero-kicker]')?.replaceChildren(document.createTextNode(kicker));
    hero.querySelector('[data-sc-hero-title]')?.replaceChildren(document.createTextNode(titulo));
    hero.querySelector('[data-sc-hero-sub]')?.replaceChildren(document.createTextNode(sub));
    if (s.image) {
      hero.style.backgroundImage =
        `linear-gradient(180deg, rgba(26,26,26,.28), rgba(26,26,26,.74)), url('${s.image}')`;
    }
  }
  if (!camps.length) return renderEmpty(root);

  root.innerHTML = `
    <section class="sc-list-section">
      <div class="sc-container">
        <div class="sc-list-head">
          <span class="section-tag">${t('upcoming')}</span>
          <h2>${t('pick')}</h2>
          <p>${t('live')}</p>
        </div>
        <div class="sc-grid">
          ${camps.map(campCard).join('')}
        </div>
      </div>
    </section>`;
}

/* ---------- Empty / próximamente ---------- */
function renderEmpty(root) {
  root.innerHTML = `
    <section class="sc-empty">
      <div class="sc-container sc-empty-inner">
        <span class="section-tag">${t('soonTag')}</span>
        <h2>${t('soonTitle')}</h2>
        <p>${t('soonText')}</p>
        <form id="surfcamp-form" class="sc-waitlist">
          <input type="email" placeholder="${t('emailPh')}" required aria-label="Email">
          <button type="submit" class="btn btn-primary">${t('notifyMe')}</button>
        </form>
        <p class="sc-waitlist-note" data-sc-msg></p>
      </div>
    </section>`;
  wireWaitlist(root);
}

function wireWaitlist(root) {
  const form = root.querySelector('#surfcamp-form');
  if (!form) return;
  const msg = root.querySelector('[data-sc-msg]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input[type="email"]');
    const btn = form.querySelector('button');
    const email = (input.value || '').trim();
    if (!email) return;
    btn.disabled = true;
    try {
      const { error } = await supabase.from('surfcamp_waitlist').insert({ email });
      if (error) throw error;
      form.reset();
      if (msg) { msg.textContent = t('wlOk'); msg.className = 'sc-waitlist-note ok'; }
    } catch (err) {
      if (msg) { msg.textContent = t('wlErr'); msg.className = 'sc-waitlist-note err'; }
    } finally {
      btn.disabled = false;
    }
  });
}


/* ---------- Lightbox de la galería ---------- */
// Las fotos del camp se ven en miniatura cuadrada y recortada; al pulsarlas
// se abren a tamaño completo, con teclado y navegación entre ellas.
function openLightbox(fotos, inicio = 0) {
  let i = inicio;

  const overlay = document.createElement('div');
  overlay.className = 'sc-lightbox';
  overlay.innerHTML = `
    <button class="sc-lb-close" aria-label="${t('close')}">&times;</button>
    ${fotos.length > 1 ? `<button class="sc-lb-nav sc-lb-prev" aria-label="${t('prev')}">‹</button>` : ''}
    <figure class="sc-lb-figure">
      <img class="sc-lb-img" src="" alt="">
      <figcaption class="sc-lb-caption"></figcaption>
    </figure>
    ${fotos.length > 1 ? `<button class="sc-lb-nav sc-lb-next" aria-label="${t('next')}">›</button>` : ''}`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const img = overlay.querySelector('.sc-lb-img');
  const cap = overlay.querySelector('.sc-lb-caption');

  function pintar() {
    const f = fotos[i];
    img.src = f.url;
    img.alt = f.alt_text || '';
    cap.textContent = fotos.length > 1 ? `${i + 1} / ${fotos.length}` : (f.alt_text || '');
  }
  function mover(paso) { i = (i + paso + fotos.length) % fotos.length; pintar(); }
  function cerrar() {
    document.body.style.overflow = '';
    overlay.remove();
    document.removeEventListener('keydown', teclas);
  }
  function teclas(e) {
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowRight') mover(1);
    else if (e.key === 'ArrowLeft') mover(-1);
  }

  overlay.querySelector('.sc-lb-close').addEventListener('click', cerrar);
  overlay.querySelector('.sc-lb-prev')?.addEventListener('click', () => mover(-1));
  overlay.querySelector('.sc-lb-next')?.addEventListener('click', () => mover(1));
  // Clic en el fondo cierra; sobre la imagen o los botones, no.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  document.addEventListener('keydown', teclas);

  pintar();
  overlay.querySelector('.sc-lb-close').focus();
}

/* ---------- Detail view ---------- */
function renderDetail(root, c, hero) {
  const st = campState(c);
  document.title = tr(c, 'meta_title') || `${tr(c, 'title') || c.title} | Waya Surf`;
  const metaDesc = document.querySelector('meta[name="description"]');
  const md = tr(c, 'meta_description');
  if (metaDesc && md) metaDesc.content = md;

  // Hero dinámico
  if (hero) {
    // La imagen definitiva. Si el camp no tiene una propia se usa la genérica,
    // que es la misma del CSS: hay que ponerla explícitamente porque la clase
    // anti-destello bloquea el background del CSS.
    const foto = c.hero_image || '/images/surfcamp-hero.webp';
    const pintarFondo = () => {
      hero.style.backgroundImage =
        `linear-gradient(180deg, rgba(26,26,26,.25), rgba(26,26,26,.72)), url('${foto}')`;
      document.documentElement.classList.remove('sc-awaiting-hero');
    };
    // Se espera a que la foto esté descargada para que aparezca de golpe y no
    // a medio cargar. Si falla, se pinta igual: mejor eso que quedarse en gris.
    const pre = new Image();
    pre.onload = pintarFondo;
    pre.onerror = pintarFondo;
    pre.src = foto;
    hero.querySelector('[data-sc-hero-kicker]')?.replaceChildren(document.createTextNode(tr(c, 'hero_kicker') || tr(c, 'kicker') || 'Surfcamp'));
    hero.querySelector('[data-sc-hero-title]')?.replaceChildren(document.createTextNode(tr(c, 'hero_title') || tr(c, 'title') || c.title));
    hero.querySelector('[data-sc-hero-sub]')?.replaceChildren(document.createTextNode(tr(c, 'hero_subtitle') || longDate(c.date_start, c.date_end)));
    const tags = hero.querySelector('[data-sc-hero-tags]');
    const heroTags = tr(c, 'hero_tags');
    if (tags && Array.isArray(heroTags) && heroTags.length) {
      tags.innerHTML = heroTags.map(t => `<span class="sc-hero-tag">${esc(t)}</span>`).join('');
    }
  }

  const priceBox = st.hasOffer
    ? `<span class="sc-detail-price-old">${num(c.original_price)}€</span><span class="sc-detail-price">${num(c.price)}€</span>`
    : `<span class="sc-detail-price">${num(c.price)}€</span>`;

  const trIncluded = tr(c, 'whats_included');
  const trIdeal = tr(c, 'ideal_for');
  const includes = Array.isArray(trIncluded) && trIncluded.length
    ? `<div class="sc-block">
         <h2>${esc(tr(c, 'whats_included_title') || t('includes'))}</h2>
         <ul class="sc-includes">${trIncluded.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
       </div>` : '';

  const ideal = Array.isArray(trIdeal) && trIdeal.length
    ? `<div class="sc-block">
         <h2>${esc(tr(c, 'ideal_for_title') || t('idealFor'))}</h2>
         <ul class="sc-ideal">${trIdeal.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
       </div>` : '';

  const gallery = c.photos.length
    ? `<div class="sc-block sc-block--gallery">
         <div class="sc-gallery">${c.photos.map((p, i) => `
           <button type="button" class="sc-gallery-item" data-photo="${i}"
                   aria-label="${t('openPhoto')} ${i + 1}">
             <img src="${esc(p.url)}" alt="${esc(p.alt_text || c.title)}" loading="lazy">
           </button>`).join('')}</div>
       </div>` : '';

  const reviews = c.testimonials.length
    ? `<div class="sc-block sc-reviews-block">
         <h2>${t('reviews')}</h2>
         <div class="sc-reviews">${c.testimonials.map(t => `
           <article class="sc-review">
             <div class="sc-review-stars">${'★'.repeat(t.stars || 5)}${'☆'.repeat(5 - (t.stars || 5))}</div>
             <blockquote>«${esc(t.quote)}»</blockquote>
             <p class="sc-review-name">${esc(t.author_name)}</p>
           </article>`).join('')}</div>
       </div>` : '';

  const faqs = c.faqs.length
    ? `<div class="sc-block">
         <h2>${t('faqTitle')}</h2>
         <div class="sc-faqs">${c.faqs.map(f => `
           <details class="sc-faq"><summary>${esc(f.question)}</summary><div class="sc-faq-body"><p>${esc(f.answer)}</p></div></details>`).join('')}</div>
       </div>` : '';

  const ctaLabel = st.isSoldOut ? t('soldout') : st.isComingSoon ? t('waitlist') : `${t('book')} ${num(c.deposit || 180)}€`;

  root.innerHTML = `
    <section class="sc-detail">
      <div class="sc-container sc-detail-grid">
        <div class="sc-detail-main">
          <a class="sc-back" href="/surfcamps.html">${t('allEditions')}</a>
          ${tr(c, 'description') ? `<div class="sc-block"><p class="sc-lead">${esc(tr(c, 'description'))}</p></div>` : ''}
          ${includes}
          ${ideal}
          ${gallery}
          ${reviews}
          ${faqs}
        </div>
        <aside class="sc-detail-aside">
          <!-- El "color de acento" del panel (surf_camps.color) se aplica aquí,
               como franja superior de la tarjeta de reserva. Solo al borde: de
               fondo, un color claro dejaría el texto ilegible. -->
          <div class="sc-book-card"${c.color ? ` style="border-top:4px solid ${esc(c.color)}"` : ''}>
            <span class="sc-book-dates">${esc(dateRange(c.date_start, c.date_end))}</span>
            <div class="sc-book-price">${priceBox}<span class="sc-book-per">${t('perPerson')}</span></div>
            ${st.hasOffer && !st.isSoldOut ? `<p class="sc-book-save">${t('save')} ${num(Number(c.original_price) - Number(c.price))}€</p>` : ''}
            <ul class="sc-book-facts">
              <li><span>${t('dates')}</span><strong>${esc(longDate(c.date_start, c.date_end))}</strong></li>
              ${tr(c, 'duration_label')
                ? `<li><span>${t('duration')}</span><strong>${esc(tr(c, 'duration_label'))}</strong></li>`
                : c.duration_days ? `<li><span>${t('duration')}</span><strong>${c.duration_days} ${t('days')}${c.duration_days > 1 ? ` / ${c.duration_days - 1} ${t('nights')}` : ''}</strong></li>` : ''}
              <li><span>${t('spotsLabel')}</span><strong>${st.isSoldOut ? t('soldout') : `${st.remaining} ${st.remaining === 1 ? t('available') : t('availables')}`}</strong></li>
            </ul>
            ${st.isComingSoon && !st.isSoldOut ? `
            <form id="surfcamp-form" class="sc-waitlist sc-waitlist--aside">
              <input type="email" placeholder="${t('emailPh')}" required aria-label="Email">
              <button type="submit" class="btn btn-primary sc-book-cta">${ctaLabel}</button>
            </form>
            <p class="sc-waitlist-note" data-sc-msg></p>
            <p class="sc-book-note">${t('wlNote')}</p>` : `
            <button class="btn btn-primary sc-book-cta" data-reserve ${st.isSoldOut ? 'disabled' : ''}>${ctaLabel}</button>
            <p class="sc-book-note">${st.isSoldOut ? t('full') : t('depositNote').replace('{n}', num(c.deposit || 180))}</p>`}
          </div>
        </aside>
      </div>
    </section>`;

  root.querySelectorAll('[data-photo]').forEach(el => {
    el.addEventListener('click', () => openLightbox(c.photos, Number(el.dataset.photo)));
  });

  const btn = root.querySelector('[data-reserve]');
  if (btn && !st.isSoldOut && !st.isComingSoon) {
    btn.addEventListener('click', (ev) => reserveCamp(c, ev.currentTarget));
  }
  // Edición "próximamente": el botón es el envío del formulario de lista de espera.
  wireWaitlist(root);
}

/* ---------- Init ---------- */
async function init() {
  const root = document.getElementById('surfcamps-root');
  if (!root) return;
  const hero = document.querySelector('[data-sc-hero]');
  const slug = new URLSearchParams(location.search).get('camp');

  root.innerHTML = '<div class="sc-loading"><span class="sc-spinner"></span></div>';

  try {
    if (slug) {
      const camp = await fetchCampFull(slug);
      if (!camp) { window.location.replace('/surfcamps.html'); return; }
      renderDetail(root, camp, hero);
    } else {
      // En paralelo: los ajustes del hero no dependen de los camps.
      const [camps, ajustes] = await Promise.all([loadCamps(), loadHeroSettings()]);
      renderList(root, camps, hero, ajustes);
    }
  } catch (err) {
    console.error('surfcamps init:', err);
    root.innerHTML = `<div class="sc-container" style="padding:4rem 0;text-align:center;color:#666">${t('loadError')}</div>`;
  }
}

init();

// Repintar al cambiar de idioma: el contenido de los camps sale de la base de
// datos, así que no lo cubre el sistema data-i18n del HTML estático.
document.addEventListener('wayaLanguageChange', () => { init(); });
