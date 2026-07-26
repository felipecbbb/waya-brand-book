/* ============================================================
   Camp Page — Dynamic content from Supabase
   Loads camp data and replaces static HTML with live DB content.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { addItem, updateCartPill } from '/lib/cart.js';

/* ---------- Determine which camp to load ---------- */
function getCampSlug() {
  const attr = document.body.dataset.campSlug || document.querySelector('main')?.dataset.campSlug;
  if (attr) return attr;

  const params = new URLSearchParams(window.location.search);
  if (params.get('slug')) return params.get('slug');

  const path = window.location.pathname.replace(/^\/|\/$/g, '');
  if (path && path.startsWith('surf-camp') && path !== 'surf-camp') return path;

  return null;
}

/* ---------- Fetch camp + related data ---------- */
async function fetchCamp(slug) {
  const { data: camp, error } = await supabase
    .from('surf_camps')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !camp) return null;

  const [photos, testimonials, faqs] = await Promise.all([
    supabase.from('camp_photos').select('*').eq('camp_id', camp.id).order('sort_order'),
    supabase.from('camp_testimonials').select('*').eq('camp_id', camp.id).order('sort_order'),
    supabase.from('camp_faqs').select('*').eq('camp_id', camp.id).order('sort_order'),
  ]);

  return {
    ...camp,
    photos: photos.data || [],
    testimonials: testimonials.data || [],
    faqs: faqs.data || [],
  };
}

/* ---------- Render functions ---------- */
function renderHero(c) {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  if (c.hero_image) {
    // Evita re-pintar el hero si la imagen ya es la misma que trae el HTML
    const next = `url('${c.hero_image}')`;
    if (hero.style.getPropertyValue('--hero-image') !== next) {
      hero.style.setProperty('--hero-image', next);
    }
  }
  if (c.color) {
    document.documentElement.style.setProperty('--camp-color', c.color);
    document.querySelectorAll('.btn.red').forEach(btn => btn.style.background = c.color);
    document.querySelectorAll('.kicker').forEach(k => k.style.color = c.color);
  }
  const kicker = hero.querySelector('.kicker');
  const title = hero.querySelector('.page-title');
  const lead = hero.querySelector('.lead');
  if (kicker && c.hero_kicker) kicker.textContent = c.hero_kicker;
  if (title && c.hero_title) title.textContent = c.hero_title;
  if (lead && c.hero_subtitle) lead.textContent = c.hero_subtitle;

  // Hero tags (pills bajo el subtítulo)
  const tagRow = hero.querySelector('.hero-tags');
  if (tagRow && Array.isArray(c.hero_tags) && c.hero_tags.length) {
    tagRow.innerHTML = c.hero_tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  }
}

function renderPhotos(c) {
  const strip = document.querySelector('.class-photo-strip');
  if (!strip) return;
  const section = strip.closest('section');
  if (!c.photos.length) {
    if (section) section.style.display = 'none';
    return;
  }
  strip.innerHTML = c.photos.map(p =>
    `<figure><img src="${esc(p.url)}" alt="${esc(p.alt_text || c.title)}" loading="lazy"></figure>`
  ).join('');
}

function renderTestimonials(c) {
  const grid = document.querySelector('.hp-reviews-grid');
  if (!grid) return;
  if (!c.testimonials.length) {
    const section = grid.closest('section');
    if (section) section.style.display = 'none';
    return;
  }
  grid.innerHTML = c.testimonials.map(t => `
    <article class="hp-review-card">
      <div class="hp-review-stars">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)}</div>
      <blockquote>«${esc(t.quote)}»</blockquote>
      <p class="hp-review-name">${esc(t.author_name)}</p>
    </article>`).join('');
}

function renderFaqs(c) {
  const faqList = document.querySelector('.faq-accordion-list');
  if (!faqList || !c.faqs.length) return;

  const col0 = c.faqs.filter(f => f.col_index === 0);
  const col1 = c.faqs.filter(f => f.col_index === 1);

  const renderCol = items => items.map(f => `
    <details class="faq-acc-item">
      <summary>${esc(f.question)}</summary>
      <div class="faq-acc-body"><p>${esc(f.answer)}</p></div>
    </details>`).join('');

  faqList.innerHTML = `
    <div class="faq-accordion-col">${renderCol(col0)}</div>
    <div class="faq-accordion-col">${renderCol(col1)}</div>`;
}

function renderIncludesIdealFor(c) {
  const grid = document.querySelector('.cards-2');
  if (!grid) return;

  const cards = grid.querySelectorAll('.card');
  const includesCard = cards[0];
  const idealCard = cards[1];

  if (includesCard && c.whats_included?.length) {
    const h3 = includesCard.querySelector('h3');
    if (h3 && c.whats_included_title) h3.textContent = c.whats_included_title;
    const tagRow = includesCard.querySelector('.tag-row');
    if (tagRow) tagRow.innerHTML = c.whats_included.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  }

  if (idealCard && c.ideal_for?.length) {
    const h3 = idealCard.querySelector('h3');
    if (h3 && c.ideal_for_title) h3.textContent = c.ideal_for_title;
    const list = idealCard.querySelector('.list');
    if (list) list.innerHTML = c.ideal_for.map(item => `<li>${esc(item)}</li>`).join('');
  }
}

function renderPrice(c) {
  if (!c.price) return;
  const priceBig = document.querySelector('.price-big');
  if (priceBig) {
    const price = Number(c.price).toLocaleString('es-ES');
    if (c.original_price && Number(c.original_price) > Number(c.price)) {
      const old = Number(c.original_price).toLocaleString('es-ES');
      const savings = Number(c.original_price) - Number(c.price);
      priceBig.innerHTML = `<span class="old-price">${old}€</span> ${price}€`;
      const savingsEl = document.querySelector('.savings');
      if (savingsEl) savingsEl.textContent = `Ahorras ${savings}€`;
    } else {
      priceBig.textContent = `${price}€`;
      const savingsEl = document.querySelector('.savings');
      if (savingsEl) savingsEl.style.display = 'none';
    }
  }

  // Also update deposit text
  const metaP = document.querySelector('.price-big + .savings + .meta, .price-big ~ .meta');
  if (metaP && c.deposit) {
    metaP.textContent = `Reserva con ${Number(c.deposit)}€ · resto la semana antes del trip.`;
  }
}

function renderSoldOut(c) {
  const isPast = c.date_start && new Date(c.date_start).getTime() < new Date().setHours(0, 0, 0, 0);
  const isSoldOut = isPast || c.sold_out || c.spots_taken >= c.max_spots;
  if (!isSoldOut) return;

  // Disable all reserve buttons
  document.querySelectorAll('[data-reserve-camp]').forEach(btn => {
    btn.disabled = true;
    btn.textContent = 'SOLD OUT';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.style.background = '#888';
    btn.removeAttribute('data-reserve-camp');
  });
}

function renderDeposit(c) {
  // Update reserve buttons with the correct deposit from Supabase
  document.querySelectorAll('[data-reserve-camp]').forEach(btn => {
    const deposit = Number(c.deposit) || 180;
    btn.dataset.campDeposit = deposit;
  });
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
  const slug = getCampSlug();
  if (!slug) return;

  const camp = await fetchCamp(slug);
  const isTemplate = document.body.dataset.campTemplate === '1';
  if (!camp) {
    // Template sirviendo un slug que no existe en BD → redirect
    if (isTemplate) window.location.replace('/surf-camp/');
    return;
  }

  // Update page title
  if (camp.meta_title) {
    document.title = camp.meta_title;
  } else if (camp.title) {
    document.title = `${camp.title} | Entre Olas`;
  }

  if (camp.meta_description) {
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.content = camp.meta_description;
  }

  renderHero(camp);
  renderPhotos(camp);
  renderIncludesIdealFor(camp);
  renderTestimonials(camp);
  renderFaqs(camp);
  renderPrice(camp);
  renderDeposit(camp);
  renderSoldOut(camp); // must be after renderDeposit

  // Re-bind reserve buttons with dynamic deposit
  document.querySelectorAll('[data-reserve-camp]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const deposit = Number(btn.dataset.campDeposit) || Number(camp.deposit) || 180;
      addItem({
        id: `camp-${camp.id}`,
        type: 'camp_reservation',
        name: `Reserva: ${camp.title}`,
        price: deposit,
        quantity: 1,
        metadata: { campId: camp.id, edition: camp.title, totalAmount: Number(camp.price) },
      });
      updateCartPill();
      showCartToast(`${camp.title} anadido al carrito`);
    });
  });
}

init();
