/* ============================================================
   Camp Overview — Sync camp cards with Supabase
   Handles: prices, offers, sold out, past dates, next-camp highlight.
   Works on /surf-camp/ and homepage.
   ============================================================ */
import { supabase } from '/lib/supabase.js';

async function init() {
  const { data: camps, error } = await supabase
    .from('surf_camps')
    .select('slug, title, kicker, hero_kicker, description, whats_included, card_vibe, duration_label, sold_out, spots_taken, max_spots, price, original_price, deposit, status, hero_image, date_start, date_end')
    .order('date_start');

  if (error || !camps?.length) return;

  const bySlug = {};
  camps.forEach(c => { bySlug[c.slug] = c; });

  const MONTHS_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
  function formatDateRange(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const s = new Date(startStr + 'T00:00:00');
    const e = new Date(endStr + 'T00:00:00');
    if (s.getMonth() === e.getMonth()) return `${s.getDate()}-${e.getDate()} ${MONTHS_ES[s.getMonth()]}`;
    return `${s.getDate()} ${MONTHS_ES[s.getMonth()]} - ${e.getDate()} ${MONTHS_ES[e.getMonth()]}`;
  }

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const isPast = (d) => d && new Date(d).getTime() < todayMs;
  const isFuture = (d) => d && new Date(d).getTime() >= todayMs;
  let nextCampSlug = null;

  // Find the next upcoming available camp
  for (const c of camps) {
    const soldOut = c.sold_out || c.spots_taken >= c.max_spots || isPast(c.date_start);
    if (!soldOut && isFuture(c.date_start) && c.status !== 'coming_soon') {
      nextCampSlug = c.slug;
      break;
    }
  }
  if (!nextCampSlug) {
    const cs = camps.find(c => c.status === 'coming_soon');
    if (cs) nextCampSlug = cs.slug;
  }

  document.querySelectorAll('.camp-card').forEach(card => {
    const link = card.querySelector('a[href*="surf-camp"]');
    if (!link) return;

    const href = link.getAttribute('href').replace(/^\/|\/$/g, '');
    const camp = bySlug[href];

    // Hide cards that no longer exist in the DB (legacy HTML) or have expired dates
    if (!camp) {
      card.style.display = 'none';
      return;
    }
    if (camp.date_end && new Date(camp.date_end).getTime() < todayMs) {
      card.style.display = 'none';
      return;
    }

    const isSoldOut = isPast(camp.date_start) || camp.sold_out || camp.spots_taken >= camp.max_spots;
    const remaining = Math.max(camp.max_spots - camp.spots_taken, 0);
    const hasOffer = camp.original_price && Number(camp.original_price) > Number(camp.price);

    // --- Title (h3 in overlay): generated from dates ---
    const overlayH3 = card.querySelector('.camp-overlay h3');
    const dateRange = formatDateRange(camp.date_start, camp.date_end);
    if (overlayH3 && dateRange) overlayH3.textContent = dateRange;

    // --- Kicker / location below h3 ---
    const locEl = card.querySelector('.camp-loc');
    const kickerText = camp.kicker || camp.hero_kicker;
    if (locEl && kickerText) locEl.textContent = kickerText;

    // --- Body text (Incluye summary) — first 3 items from whats_included ---
    const bodyP = card.querySelector('.camp-body p');
    if (bodyP && Array.isArray(camp.whats_included) && camp.whats_included.length) {
      const short = camp.whats_included.slice(0, 3).map(s => {
        const clean = String(s).split('(')[0].trim();
        const firstWords = clean.split(' ').slice(0, 4).join(' ');
        return firstWords.replace(/[,.;:]$/, '');
      });
      bodyP.textContent = short.join(' • ');
    }

    // --- Price (always sync from DB) ---
    const priceEl = card.querySelector('.camp-from');
    if (priceEl && camp.price) {
      const price = Number(camp.price).toLocaleString('es-ES');
      if (hasOffer && !isSoldOut) {
        const original = Number(camp.original_price).toLocaleString('es-ES');
        priceEl.innerHTML = `<span class="old-price">${original}€</span> ${price}€`;
      } else {
        priceEl.textContent = `Desde ${price}€`;
      }
    }

    // --- Meta spans: first = duration / spots, last = deposit or vibe ---
    const metaSpans = card.querySelectorAll('.camp-meta span');

    // First span: duration (or AGOTADO / Últimas plazas)
    if (metaSpans[0]) {
      if (isSoldOut) {
        metaSpans[0].textContent = 'AGOTADO';
      } else if (remaining <= 5) {
        metaSpans[0].textContent = 'Últimas plazas';
      } else if (camp.duration_label) {
        metaSpans[0].textContent = camp.duration_label;
      } else if (camp.date_start && camp.date_end) {
        const days = Math.round((new Date(camp.date_end + 'T00:00:00') - new Date(camp.date_start + 'T00:00:00')) / 86400000) + 1;
        const nights = Math.max(days - 1, 0);
        metaSpans[0].textContent = `${days} días / ${nights} noches`;
      }
    }

    // Last span: deposit (home) or vibe (/surf-camp/ listing)
    const depositSpan = metaSpans[metaSpans.length - 1];
    if (depositSpan && depositSpan !== metaSpans[0]) {
      const text = depositSpan.textContent;
      if (text.includes('Reserva') && camp.deposit) {
        depositSpan.textContent = `Reserva ${Number(camp.deposit)}€`;
      } else if (camp.card_vibe) {
        depositSpan.textContent = `⚡ ${camp.card_vibe}`;
      }
    }

    // --- Badge ---
    const cover = card.querySelector('.camp-cover');
    const existingBadge = cover?.querySelector('.camp-badge');

    if (isSoldOut) {
      // --- SOLD OUT ---
      card.classList.add('camp-card-soldout');

      if (existingBadge) {
        existingBadge.textContent = 'SOLD OUT';
        existingBadge.className = 'camp-badge camp-badge-soldout';
      } else if (cover) {
        const b = document.createElement('span');
        b.className = 'camp-badge camp-badge-soldout';
        b.textContent = 'SOLD OUT';
        cover.appendChild(b);
      }

      // Disable all links
      card.querySelectorAll('a').forEach(a => {
        a.removeAttribute('href');
        a.style.pointerEvents = 'none';
      });

      // Replace buttons
      const actions = card.querySelector('.camp-actions');
      if (actions) {
        actions.innerHTML = '<span class="btn disabled" style="width:100%;text-align:center">SOLD OUT</span>';
      }
    } else if (hasOffer) {
      // --- OFERTA badge ---
      if (existingBadge) {
        existingBadge.textContent = 'OFERTA';
        existingBadge.className = 'camp-badge camp-badge-offer';
      } else if (cover) {
        const b = document.createElement('span');
        b.className = 'camp-badge camp-badge-offer';
        b.textContent = 'OFERTA';
        cover.appendChild(b);
      }
    } else if (existingBadge) {
      // No offer and not sold out — remove stale badge
      existingBadge.remove();
    }

    // --- Hero image ---
    const img = card.querySelector('.camp-cover img');
    if (img && camp.hero_image) img.src = camp.hero_image;

    // --- Highlight next camp ---
    if (href === nextCampSlug) {
      card.classList.add('camp-card-next');
    }
  });
}

init();
