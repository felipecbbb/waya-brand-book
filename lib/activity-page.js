/* ============================================================
   Activity Page — Dynamic content from Supabase
   Loads activity data and replaces static HTML with live DB content.
   Works on existing activity pages and the generic /actividad/ page.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { addItem, updateCartPill } from '/lib/cart.js';
import { openClassPicker } from '/lib/class-picker.js';

/* ---------- Determine which activity to load ---------- */
function getActivitySlug() {
  // 1. data attribute on body/main
  const attr = document.body.dataset.activitySlug || document.querySelector('main')?.dataset.activitySlug;
  if (attr) return attr;

  // 2. URL query param ?slug=xxx
  const params = new URLSearchParams(window.location.search);
  if (params.get('slug')) return params.get('slug');

  // 3. Derive from pathname: /clases-de-surf-grupales/ → clases-de-surf-grupales
  const path = window.location.pathname.replace(/^\/|\/$/g, '');
  if (path && path !== 'actividad') return path;

  return null;
}

/* ---------- Fetch activity + related data ---------- */
async function fetchActivity(slug) {
  const { data: activity, error } = await supabase
    .from('activities')
    .select('*')
    .eq('slug', slug)
    .eq('activo', true)
    .single();

  if (error) { console.error('[activity-page] Supabase error:', error.message, error.code); return null; }
  if (!activity) return null;

  const [packs, photos, testimonials, faqs] = await Promise.all([
    supabase.from('activity_packs').select('*').eq('activity_id', activity.id).eq('public', true).order('sessions'),
    supabase.from('activity_photos').select('*').eq('activity_id', activity.id).order('sort_order'),
    supabase.from('activity_testimonials').select('*').eq('activity_id', activity.id).order('sort_order'),
    supabase.from('activity_faqs').select('*').eq('activity_id', activity.id).order('sort_order'),
  ]);

  return {
    ...activity,
    packs: packs.data || [],
    photos: photos.data || [],
    testimonials: testimonials.data || [],
    faqs: faqs.data || [],
  };
}

/* ---------- Render functions ---------- */
function renderHero(a) {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  if (a.hero_image) {
    const next = `url('${a.hero_image}')`;
    if (hero.style.getPropertyValue('--hero-image') !== next) {
      hero.style.setProperty('--hero-image', next);
    }
  }
  if (a.color) {
    document.documentElement.style.setProperty('--activity-color', a.color);
    // Apply accent color to buttons and key elements
    document.querySelectorAll('.btn.red').forEach(btn => btn.style.background = a.color);
    document.querySelectorAll('.pack-card.featured').forEach(c => c.style.borderColor = a.color);
    document.querySelectorAll('.kicker').forEach(k => k.style.color = a.color);
  }
  const kicker = hero.querySelector('.kicker');
  const title = hero.querySelector('.page-title');
  const lead = hero.querySelector('.lead');
  if (kicker && a.hero_kicker) kicker.textContent = a.hero_kicker;
  if (title && a.hero_title) title.textContent = a.hero_title;
  if (lead && a.hero_subtitle) lead.textContent = a.hero_subtitle;
}

function renderPacks(a) {
  const packGrid = document.querySelector('.pack-grid');
  if (!packGrid || !a.packs.length) return;

  // Update pre-section intro
  const pageIntro = packGrid.closest('section')?.querySelector('.page-intro');
  if (pageIntro) {
    const k = pageIntro.querySelector('.kicker');
    const t = pageIntro.querySelector('.title');
    const l = pageIntro.querySelector('.lead');
    if (k && a.pre_section_kicker) k.textContent = a.pre_section_kicker;
    if (t && a.pre_section_title) t.textContent = a.pre_section_title;
    if (l && a.pre_section_lead) l.textContent = a.pre_section_lead;
  }

  const basePrice = Number(a.packs[0].price);
  const deposit = Number(a.deposit) || 15;
  const validity = a.pack_validity || 180;
  const duracion = a.duracion || 90;
  const maxCap = a.capacidad_max || 6;
  const typeKey = a.type_key;

  packGrid.innerHTML = a.packs.map(p => {
    const n = p.sessions;
    const price = Number(p.price);
    const perSession = (price / n).toFixed(2);
    const fullPrice = basePrice * n;
    const saved = fullPrice - price;
    const pct = n > 1 && fullPrice > 0 ? Math.round((saved / fullPrice) * 100) : 0;
    const rest = price - deposit;

    return `
      <article class="pack-card${p.featured ? ' featured' : ''}">
        <div class="pack-card-header">
          <h3>${n} Clase${n > 1 ? 's' : ''}</h3>
          <span class="pack-sessions">${duracion} min${n > 1 ? ` × ${n} sesiones` : ` · ${n} sesion`}</span>
        </div>
        <div class="pack-card-pricing">
          <span class="price-now">${price}€</span>
          <span class="price-per">por persona</span>
          ${saved > 0 ? `<div><span class="price-was">${fullPrice}€</span></div>
            <span class="pack-discount-badge">Ahorras ${saved}€${pct > 0 ? ` · -${pct}%` : ''}</span>` : ''}
        </div>
        <div class="pack-card-details">
          <ul>
            ${n > 1 ? `<li>${perSession}€ por clase</li>` : `<li>Maximo ${maxCap} personas</li>`}
            <li>Material incluido</li>
            <li>Seguro de accidentes</li>
            <li>${n > 1 ? `Valido ${validity} dias` : 'Todos los niveles'}</li>
          </ul>
        </div>
        <div class="pack-card-cta">
          <button class="btn red" data-reserve-class="${a.id}" data-class-name="${esc(a.nombre)} × ${n}" data-class-price="${price}" data-class-deposit="${deposit}" data-class-sessions="${n}" data-class-type="${typeKey}">Reservar ${deposit}€</button>
          <span class="cta-note">${rest > 0 ? `Resto: ${rest}€ en la primera clase` : ''}</span>
        </div>
      </article>`;
  }).join('');

  // Re-bind reserve buttons → abre el picker de calendario (elegir cuándo usar las clases)
  packGrid.querySelectorAll('[data-reserve-class]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const name = btn.dataset.className;
      const price = Number(btn.dataset.classPrice);
      const sessions = Number(btn.dataset.classSessions) || 1;
      const classType = btn.dataset.classType || 'grupal';
      const dep = Number(btn.dataset.classDeposit) || deposit;

      openClassPicker({
        classType,
        sessions,
        packName: name,
        deposit: dep,
        fullPrice: price,
      });
    });
  });
}

function renderPhotos(a) {
  const strip = document.querySelector('.class-photo-strip');
  if (!strip) return;
  const section = strip.closest('section');
  if (!a.photos.length) {
    if (section) section.style.display = 'none';
    return;
  }
  strip.innerHTML = a.photos.map(p =>
    `<figure><img src="${esc(p.url)}" alt="${esc(p.alt_text || a.nombre)}" loading="lazy"></figure>`
  ).join('');
}

function renderIncludesIdealFor(a) {
  const grid = document.querySelector('.cards-2');
  if (!grid) return;

  const cards = grid.querySelectorAll('.card');
  const includesCard = cards[0];
  const idealCard = cards[1];

  if (includesCard && a.whats_included?.length) {
    const h3 = includesCard.querySelector('h3');
    if (h3 && a.whats_included_title) h3.textContent = a.whats_included_title;
    const tagRow = includesCard.querySelector('.tag-row');
    if (tagRow) {
      tagRow.innerHTML = a.whats_included.map(t => `<span class="tag">${esc(t)}</span>`).join('');
    }
  }

  if (idealCard && a.ideal_for?.length) {
    const h3 = idealCard.querySelector('h3');
    if (h3 && a.ideal_for_title) h3.textContent = a.ideal_for_title;
    const list = idealCard.querySelector('.list');
    if (list) {
      list.innerHTML = a.ideal_for.map(item => `<li>${esc(item)}</li>`).join('');
    }
  }
}

function renderTestimonials(a) {
  const grid = document.querySelector('.hp-reviews-grid');
  if (!grid) return;
  if (!a.testimonials.length) {
    // Hide the whole testimonials section if empty
    const section = grid.closest('section');
    if (section) section.style.display = 'none';
    return;
  }
  grid.innerHTML = a.testimonials.map(t => `
    <article class="hp-review-card">
      <div class="hp-review-stars">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)}</div>
      <blockquote>«${esc(t.quote)}»</blockquote>
      <p class="hp-review-name">${esc(t.author_name)}</p>
    </article>`).join('');
}

function renderFaqs(a) {
  const faqList = document.querySelector('.faq-accordion-list');
  if (!faqList || !a.faqs.length) return;

  const col0 = a.faqs.filter(f => f.col_index === 0);
  const col1 = a.faqs.filter(f => f.col_index === 1);

  const renderCol = items => items.map(f => `
    <details class="faq-acc-item">
      <summary>${esc(f.question)}</summary>
      <div class="faq-acc-body"><p>${esc(f.answer)}</p></div>
    </details>`).join('');

  faqList.innerHTML = `
    <div class="faq-accordion-col">${renderCol(col0)}</div>
    <div class="faq-accordion-col">${renderCol(col1)}</div>`;
}

function renderContactSection(a) {
  // Update the CTA title with activity name
  const ctaSection = document.querySelector('.two-col');
  if (!ctaSection) return;
  const title = ctaSection.querySelector('.title');
  if (title) title.textContent = `Quieres empezar con ${a.nombre.toLowerCase()}?`;
}

/* ---------- Toast ---------- */
function showCartToast(msg) {
  let toast = document.querySelector('.cart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'cart-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ---------- Helpers ---------- */
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- Init ---------- */
async function init() {
  const slug = getActivitySlug();
  if (!slug) return;

  const activity = await fetchActivity(slug);
  if (!activity) {
    console.warn('[activity-page] Activity not found or deactivated for slug:', slug);
    // Show "not available" message
    const main = document.querySelector('main');
    if (main) {
      main.innerHTML = `
        <section class="hero" style="min-height:50vh;display:flex;align-items:center;justify-content:center;text-align:center">
          <div class="container">
            <h1 class="page-title" style="margin-bottom:16px">Actividad no disponible</h1>
            <p class="lead">Esta actividad no esta disponible actualmente.</p>
            <a class="btn red" href="/" style="margin-top:24px">Volver al inicio</a>
          </div>
        </section>`;
    }
    return;
  }

  // Update page title
  if (activity.meta_title) {
    document.title = activity.meta_title;
  } else if (activity.nombre) {
    document.title = `${activity.nombre} | Entre Olas`;
  }

  // Update meta description
  if (activity.meta_description) {
    let metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = activity.meta_description;
  }

  // Render all sections
  renderHero(activity);
  renderPacks(activity);
  renderPhotos(activity);
  renderIncludesIdealFor(activity);
  renderTestimonials(activity);
  renderFaqs(activity);
  renderContactSection(activity);
}

init();
