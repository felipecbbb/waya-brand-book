/* ============================================================
   Surf Camps Section — Full content management with tabs
   ============================================================ */
import { showToast } from '../modules/ui.js';
import {
  fetchCamps, upsertCamp, deleteCamp, duplicateCamp, fetchCampFull,
  upsertCampPhoto, deleteCampPhoto, uploadCampImage,
  upsertCampTestimonial, deleteCampTestimonial,
  upsertCampFaq, deleteCampFaq,
} from '../modules/api.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

const STATUSES = ['open', 'full', 'closed', 'coming_soon'];
const STATUS_LABELS = { open: 'Abierto', full: 'Completo', closed: 'Cerrado', coming_soon: 'Proximamente' };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function slugify(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
// Parte descriptiva del título (marca/sitio): quita "surf camp", números, meses y conectores.
function campDescriptor(title) {
  const stop = new Set(['surf', 'camp', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'x', ...MESES]);
  return slugify(title).split('-').filter(t => t && !stop.has(t) && !/^\d+$/.test(t)).join('-');
}
// Slug derivado de las FECHAS (+ descriptor del título): así la URL siempre refleja
// las fechas reales del camp. Ej: surf-camp-9-13-septiembre-sambatrips.
function buildCampSlug(title, dateStart, dateEnd) {
  if (!dateStart) return slugify(title);
  const a = new Date(dateStart + 'T00:00:00');
  const b = new Date((dateEnd || dateStart) + 'T00:00:00');
  const seg = a.getMonth() === b.getMonth()
    ? `${a.getDate()}-${b.getDate()}-${MESES[a.getMonth()]}`
    : `${a.getDate()}-${MESES[a.getMonth()]}-${b.getDate()}-${MESES[b.getMonth()]}`;
  return ['surf-camp', seg, campDescriptor(title)].filter(Boolean).join('-');
}
// Garantiza unicidad frente a los demás camps (añade -2, -3… si colisiona).
function uniqueCampSlug(base, camps, excludeId) {
  const taken = new Set(camps.filter(c => c.id !== excludeId).map(c => c.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / 86400000);
}

function spotsBar(taken, max) {
  const pct = max > 0 ? Math.min((taken / max) * 100, 100) : 0;
  const color = pct >= 90 ? '#ef4444' : pct >= 60 ? '#f59e0b' : '#22c55e';
  return `<div class="sc-spots">
    <div class="sc-spots-track"><div class="sc-spots-fill" style="width:${pct}%;background:${color}"></div></div>
    <span class="sc-spots-label">${taken}/${max} plazas</span>
  </div>`;
}

/* SVG Icons */
const iconDoc = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const iconImage = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const iconCamera = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const iconStar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const iconHelp = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const iconLayout = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
const iconSettings = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
const iconMoney = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';

/* ============================================================ */
export async function renderCamps(container) {
  let selectedId = null;
  let campFull = null;
  let activeTab = 'general';

  let camps = await fetchCamps();

  /* ==================== LIST VIEW ==================== */
  function renderList() {
    const now = new Date().toISOString().slice(0, 10);
    const upcoming = camps.filter(c => c.date_end >= now).sort((a, b) => a.date_start.localeCompare(b.date_start));
    const past = camps.filter(c => c.date_end < now).sort((a, b) => b.date_start.localeCompare(a.date_start));

    container.innerHTML = `
      <div class="sc-header">
        <span class="sc-count">${camps.length} camp${camps.length !== 1 ? 's' : ''}</span>
        <button class="sc-new-btn" id="sc-new">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo Camp
        </button>
      </div>

      ${upcoming.length ? `<div class="sc-group-label">Proximos</div><div class="sc-grid">${upcoming.map(campCard).join('')}</div>` : ''}
      ${past.length ? `<div class="sc-group-label sc-group-past">Pasados</div><div class="sc-grid sc-grid-past">${past.map(campCard).join('')}</div>` : ''}
      ${!camps.length ? `<div class="sc-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        <p>Aun no hay surf camps</p>
      </div>` : ''}`;

    container.querySelector('#sc-new')?.addEventListener('click', () => openCreate());

    container.querySelectorAll('.sc-card').forEach(card => {
      card.addEventListener('click', async () => {
        selectedId = card.dataset.id;
        activeTab = 'general';
        await openDetail();
      });
    });

    container.querySelectorAll('[data-quick="delete"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const c = camps.find(x => x.id === btn.dataset.id);
        if (!c || !confirm(`Eliminar "${c.title}"?`)) return;
        try {
          await deleteCamp(c.id);
          camps = await fetchCamps();
          showToast('Camp eliminado', 'success');
          renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    container.querySelectorAll('[data-quick="duplicate"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const c = camps.find(x => x.id === btn.dataset.id);
        if (!c) return;
        try {
          const newCamp = await duplicateCamp(c.id);
          showToast('Camp duplicado', 'success');
          camps = await fetchCamps();
          selectedId = newCamp.id;
          activeTab = 'general';
          await openDetail();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });
  }

  function campCard(c) {
    const days = daysUntil(c.date_start);
    const isPast = c.date_end < new Date().toISOString().slice(0, 10);
    const isSoldOut = c.sold_out || c.spots_taken >= c.max_spots;
    const countdown = !isPast && days > 0 ? `<span class="sc-countdown">${days}d</span>` : '';

    return `
      <article class="sc-card${isPast ? ' sc-card-past' : ''}" data-id="${c.id}">
        ${c.hero_image ? `<div class="sc-card-thumb" style="background-image:url('${esc(c.hero_image)}')">
          ${isSoldOut ? '<span class="sc-sold-out-badge">SOLD OUT</span>' : ''}
        </div>` : ''}
        <div class="sc-card-body">
          <div class="sc-card-top">
            <span class="admin-badge" data-status="${c.status}">${STATUS_LABELS[c.status] || c.status}</span>
            ${countdown}
          </div>
          <h3 class="sc-card-title">${esc(c.title)}</h3>
          <div class="sc-card-dates">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${fmtDate(c.date_start)} — ${fmtDate(c.date_end)}
          </div>
          <div class="sc-card-meta">
            <span class="sc-card-price">${Number(c.price).toLocaleString('es-ES')}€</span>
            ${c.original_price ? `<span class="sc-card-original">${Number(c.original_price).toLocaleString('es-ES')}€</span>` : ''}
          </div>
          ${spotsBar(c.spots_taken, c.max_spots)}
        </div>
        <button class="sc-card-duplicate" data-quick="duplicate" data-id="${c.id}" title="Duplicar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
        <button class="sc-card-delete" data-quick="delete" data-id="${c.id}" title="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </article>`;
  }

  /* ==================== CREATE FORM ==================== */
  function openCreate() {
    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="sc-back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div class="act-detail-topbar-info"><strong class="act-detail-topbar-name">Nuevo Surf Camp</strong></div>
        </div>
        <div style="max-width:600px;padding:24px 0">
          <div class="act-form-card">
            <div class="act-form-field"><label class="act-form-label">TITULO</label><input type="text" class="act-form-input" id="new-title" placeholder="Surf Camp Conil 20-23 Marzo" /></div>
            <div class="act-form-field"><label class="act-form-label">SLUG (URL)</label><input type="text" class="act-form-input" id="new-slug" placeholder="surf-camp-20-23-marzo" /><small class="act-form-hint">Se genera automaticamente.</small></div>
            <div class="act-form-field"><label class="act-form-label">FECHA INICIO</label><input type="date" class="act-form-input" id="new-start" /></div>
            <div class="act-form-field"><label class="act-form-label">FECHA FIN</label><input type="date" class="act-form-input" id="new-end" /></div>
            <div class="act-form-field"><label class="act-form-label">PRECIO (€)</label><input type="number" class="act-form-input" id="new-price" step="0.01" value="480" /></div>
            <div style="margin-top:20px;display:flex;gap:12px">
              <button class="act-action-btn primary" id="new-save">Crear camp</button>
              <button class="act-action-link" id="new-cancel">Cancelar</button>
            </div>
          </div>
        </div>
      </div>`;

    const titleInput = container.querySelector('#new-title');
    const slugInput = container.querySelector('#new-slug');
    // Preview del slug: depende del t\u00edtulo Y de las fechas (la URL refleja las fechas).
    const syncNewSlug = () => {
      slugInput.value = buildCampSlug(titleInput.value.trim(), container.querySelector('#new-start')?.value, container.querySelector('#new-end')?.value);
    };
    titleInput.addEventListener('input', syncNewSlug);
    container.querySelector('#new-start')?.addEventListener('change', syncNewSlug);
    container.querySelector('#new-end')?.addEventListener('change', syncNewSlug);

    container.querySelector('#new-cancel')?.addEventListener('click', () => renderList());
    container.querySelector('#sc-back')?.addEventListener('click', () => renderList());

    container.querySelector('#new-save')?.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const date_start = container.querySelector('#new-start')?.value;
      const date_end = container.querySelector('#new-end')?.value;
      const price = parseFloat(container.querySelector('#new-price')?.value) || 480;
      if (!title || !date_start || !date_end) { showToast('Titulo y fechas son obligatorios', 'error'); return; }
      // El slug se deriva de las FECHAS (+ descriptor del título) para que la URL siempre
      // refleje las fechas reales del camp. Único frente a los demás camps.
      const slug = uniqueCampSlug(buildCampSlug(title, date_start, date_end), camps);
      try {
        const saved = await upsertCamp({ title, slug, date_start, date_end, price, deposit: 180, max_spots: 17, status: 'open' });
        showToast('Camp creado', 'success');
        camps = await fetchCamps();
        // Open detail of the new camp
        const newCamp = camps.find(c => c.slug === slug);
        if (newCamp) { selectedId = newCamp.id; await openDetail(); }
        else renderList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  /* ==================== DETAIL VIEW (TABBED) ==================== */
  async function openDetail() {
    try { campFull = await fetchCampFull(selectedId); }
    catch (err) { showToast('Error cargando camp', 'error'); return renderList(); }
    renderDetail();
  }

  function renderDetail() {
    const c = campFull;
    if (!c) return renderList();

    const isSoldOut = c.sold_out || c.spots_taken >= c.max_spots;

    const TABS = [
      { group: 'CONTENIDO', items: [
        { id: 'general', label: 'General', icon: iconDoc },
        { id: 'hero', label: 'Hero / Cabecera', icon: iconImage },
        { id: 'pagina', label: 'Pagina', icon: iconLayout },
        { id: 'fotos', label: 'Fotos', icon: iconCamera },
        { id: 'testimonios', label: 'Testimonios', icon: iconStar },
        { id: 'faq', label: 'FAQ', icon: iconHelp },
      ]},
      { group: 'CONFIGURACION', items: [
        { id: 'precios', label: 'Precios / Plazas', icon: iconMoney },
        { id: 'ajustes', label: 'Ajustes', icon: iconSettings },
      ]},
    ];

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="sc-back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${esc(c.title)}</strong>
            <div class="act-detail-topbar-meta">
              <span class="admin-badge" data-status="${c.status}">${STATUS_LABELS[c.status] || c.status}</span>
              ${isSoldOut ? '<span class="admin-badge" data-status="cancelled">SOLD OUT</span>' : ''}
              <span class="act-detail-topbar-id">/${esc(c.slug)}/</span>
            </div>
          </div>
        </div>

        <div class="act-detail-layout">
          <nav class="act-detail-sidebar">
            ${TABS.map(g => `
              <div class="act-nav-group-label">${g.group}</div>
              ${g.items.map(t => `<a class="act-nav-item ${activeTab===t.id?'active':''}" data-tab="${t.id}">${t.icon} ${t.label}</a>`).join('')}
            `).join('')}
          </nav>

          <main class="act-detail-main">${renderTabContent(c)}</main>

          <aside class="act-detail-actions">
            <button class="act-action-btn primary" id="sc-save"><span>Guardar</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></button>
            <button class="act-action-link" id="sc-preview"><span>Ver en web</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            <button class="act-action-link danger" id="sc-delete"><span>Eliminar</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
          </aside>
        </div>
      </div>`;

    bindDetailEvents(c);
  }

  /* ==================== TAB CONTENT ==================== */
  function renderTabContent(c) {
    switch (activeTab) {
      case 'general': return tabGeneral(c);
      case 'hero': return tabHero(c);
      case 'pagina': return tabPagina(c);
      case 'fotos': return tabFotos(c);
      case 'testimonios': return tabTestimonios(c);
      case 'faq': return tabFaq(c);
      case 'precios': return tabPrecios(c);
      case 'ajustes': return tabAjustes(c);
      default: return '';
    }
  }

  function tabGeneral(c) {
    return `
      <h3 class="act-detail-section-title">Datos generales</h3>
      <div class="act-form-card">
        <div class="act-form-field"><label class="act-form-label">TITULO</label><input type="text" class="act-form-input" id="f-title" value="${esc(c.title)}" /></div>
        <div class="act-form-field"><label class="act-form-label">SLUG (URL)</label><input type="text" class="act-form-input" id="f-slug" value="${esc(c.slug)}" readonly style="background:#f3f4f6;cursor:not-allowed" /><small class="act-form-hint">Se genera automáticamente desde las fechas al guardar. Al cambiar fechas/título, la URL del camp cambia (los enlaces antiguos dejan de funcionar).</small></div>
        <div class="act-form-field"><label class="act-form-label">KICKER (texto bajo el título en las cards)</label><input type="text" class="act-form-input" id="f-kicker" value="${esc(c.kicker||'')}" placeholder="Ej: Conil x Sambatrips" /></div>
        <div class="act-form-field"><label class="act-form-label">VIBE / TAGS DE LA CARD</label><input type="text" class="act-form-input" id="f-card-vibe" value="${esc(c.card_vibe||'')}" placeholder="Ej: SURF, SOCIAL" /><small class="act-form-hint">Texto del ⚡ en la card (se muestra en mayúsculas).</small></div>
        <div class="act-form-field"><label class="act-form-label">DURACIÓN (TEXTO DE LA CARD)</label><input type="text" class="act-form-input" id="f-duration-label" value="${esc(c.duration_label||'')}" placeholder="Ej: 4 días / 3 noches" /><small class="act-form-hint">Si lo dejas vacío, se calcula automáticamente desde las fechas.</small></div>
        <div class="act-form-field"><label class="act-form-label">DESCRIPCION</label><textarea class="act-form-textarea" id="f-description" rows="4">${esc(c.description||'')}</textarea></div>
        <div class="act-form-field"><label class="act-form-label">COLOR DE ACENTO</label><input type="color" class="act-form-input" id="f-color" value="${c.color||'#0f2f39'}" style="height:40px;padding:4px" /></div>
        <div class="act-form-field"><label class="act-form-label">FECHA INICIO</label><input type="date" class="act-form-input" id="f-date-start" value="${c.date_start||''}" /></div>
        <div class="act-form-field"><label class="act-form-label">FECHA FIN</label><input type="date" class="act-form-input" id="f-date-end" value="${c.date_end||''}" /></div>
      </div>`;
  }

  function tabHero(c) {
    const heroTags = c.hero_tags || [];
    return `
      <h3 class="act-detail-section-title">Hero / Cabecera</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">IMAGEN DEL HERO</label>
          ${c.hero_image ? `<img src="${esc(c.hero_image)}" style="max-width:100%;border-radius:8px;margin-bottom:12px" />` : ''}
          <input type="file" id="f-hero-file" accept="image/*" style="margin-bottom:8px" />
          <input type="text" class="act-form-input" id="f-hero-image" value="${esc(c.hero_image||'')}" placeholder="O pega una URL" />
        </div>
        <div class="act-form-field"><label class="act-form-label">KICKER (texto sobre el titulo)</label><input type="text" class="act-form-input" id="f-hero-kicker" value="${esc(c.hero_kicker||'')}" /></div>
        <div class="act-form-field"><label class="act-form-label">TITULO PRINCIPAL</label><input type="text" class="act-form-input" id="f-hero-title" value="${esc(c.hero_title||'')}" /></div>
        <div class="act-form-field"><label class="act-form-label">SUBTITULO</label><input type="text" class="act-form-input" id="f-hero-subtitle" value="${esc(c.hero_subtitle||'')}" /></div>
        <div class="act-form-field"><label class="act-form-label">TAGS DEL HERO (uno por línea)</label><textarea class="act-form-textarea" id="f-hero-tags" rows="5" placeholder="Ej:&#10;9-13 Septiembre&#10;Roche, Cádiz&#10;Plazas limitadas&#10;Transporte incluido&#10;+18">${heroTags.map(esc).join('\n')}</textarea><small class="act-form-hint">Las píldoras que aparecen bajo el subtítulo en la página de detalle.</small></div>
      </div>`;
  }

  function tabPagina(c) {
    const included = c.whats_included || [];
    const ideal = c.ideal_for || [];
    return `
      <h3 class="act-detail-section-title">Contenido de la pagina</h3>
      <div class="act-form-card">
        <h4 style="margin:0 0 12px;font-size:.95rem;color:var(--color-navy)">Que incluye</h4>
        <div class="act-form-field"><label class="act-form-label">TITULO DE LA SECCION</label><input type="text" class="act-form-input" id="f-includes-title" value="${esc(c.whats_included_title||'')}" placeholder="Que incluye el Surf Camp?" /></div>
        <div class="act-form-field"><label class="act-form-label">ITEMS (uno por linea)</label><textarea class="act-form-textarea" id="f-includes" rows="5">${included.map(esc).join('\n')}</textarea></div>
      </div>
      <div class="act-form-card" style="margin-top:16px">
        <h4 style="margin:0 0 12px;font-size:.95rem;color:var(--color-navy)">Ideal para</h4>
        <div class="act-form-field"><label class="act-form-label">TITULO DE LA SECCION</label><input type="text" class="act-form-input" id="f-ideal-title" value="${esc(c.ideal_for_title||'')}" placeholder="Ideal para" /></div>
        <div class="act-form-field"><label class="act-form-label">ITEMS (uno por linea)</label><textarea class="act-form-textarea" id="f-ideal" rows="5">${ideal.map(esc).join('\n')}</textarea></div>
      </div>`;
  }

  function tabFotos(c) {
    const photos = c.photos || [];
    return `
      <h3 class="act-detail-section-title">Galeria de fotos</h3>
      <div class="act-form-card">
        <div class="act-photos-grid">
          ${photos.map(p => `
            <div class="act-photo-item" data-photo-id="${p.id}">
              <img src="${esc(p.url)}" alt="${esc(p.alt_text||'')}" style="width:100%;height:120px;object-fit:cover;border-radius:8px" />
              <button class="act-photo-delete" data-id="${p.id}" title="Eliminar">✕</button>
            </div>`).join('')}
          <label class="act-photo-upload" id="photo-upload-zone">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Subir foto</span>
            <input type="file" id="f-photo-file" accept="image/*" style="display:none" />
          </label>
        </div>
        <div class="act-form-field" style="margin-top:16px">
          <label class="act-form-label">O pega una URL</label>
          <div style="display:flex;gap:8px">
            <input type="text" class="act-form-input" id="f-photo-url" placeholder="https://..." style="flex:1" />
            <button class="act-action-btn primary" id="f-photo-add-url" style="white-space:nowrap">Anadir</button>
          </div>
        </div>
      </div>`;
  }

  function tabTestimonios(c) {
    const testimonials = c.testimonials || [];
    return `
      <h3 class="act-detail-section-title">Testimonios</h3>
      <div class="act-form-card">
        ${testimonials.map(t => `
          <div class="cli-bono-card" style="margin-bottom:12px" data-test-id="${t.id}">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
              <div style="flex:1">
                <div class="act-form-field" style="margin-bottom:8px"><label class="act-form-label">NOMBRE</label><input type="text" class="act-form-input test-name" value="${esc(t.author_name)}" /></div>
                <div class="act-form-field" style="margin-bottom:8px"><label class="act-form-label">CITA</label><textarea class="act-form-textarea test-quote" rows="2">${esc(t.quote)}</textarea></div>
                <div class="act-form-field"><label class="act-form-label">ESTRELLAS</label><select class="act-form-input test-stars" style="width:80px">${[5,4,3,2,1].map(n => `<option value="${n}" ${t.stars===n?'selected':''}>${n}</option>`).join('')}</select></div>
              </div>
              <button class="act-action-link danger test-delete" data-id="${t.id}" style="margin-top:20px">Eliminar</button>
            </div>
          </div>`).join('')}
        <button class="act-action-btn primary" id="test-add" style="margin-top:12px">+ Anadir testimonio</button>
      </div>`;
  }

  function tabFaq(c) {
    const faqs = c.faqs || [];
    return `
      <h3 class="act-detail-section-title">Preguntas frecuentes</h3>
      <div class="act-form-card">
        ${faqs.map(f => `
          <div class="cli-bono-card" style="margin-bottom:12px" data-faq-id="${f.id}">
            <div class="act-form-field" style="margin-bottom:8px"><label class="act-form-label">PREGUNTA</label><input type="text" class="act-form-input faq-q" value="${esc(f.question)}" /></div>
            <div class="act-form-field" style="margin-bottom:8px"><label class="act-form-label">RESPUESTA</label><textarea class="act-form-textarea faq-a" rows="2">${esc(f.answer)}</textarea></div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div class="act-form-field" style="margin:0"><label class="act-form-label" style="margin:0">COLUMNA</label><select class="act-form-input faq-col" style="width:120px"><option value="0" ${f.col_index===0?'selected':''}>Izquierda</option><option value="1" ${f.col_index===1?'selected':''}>Derecha</option></select></div>
              <button class="act-action-link danger faq-delete" data-id="${f.id}">Eliminar</button>
            </div>
          </div>`).join('')}
        <button class="act-action-btn primary" id="faq-add" style="margin-top:12px">+ Anadir pregunta</button>
      </div>`;
  }

  function tabPrecios(c) {
    const isSoldOut = c.sold_out || c.spots_taken >= c.max_spots;
    return `
      <h3 class="act-detail-section-title">Precios y plazas</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">SOLD OUT (manual)</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="f-sold-out" ${c.sold_out ? 'checked' : ''} />
            <span style="font-size:.88rem;color:var(--color-navy)">Marcar como agotado</span>
          </label>
          <small class="act-form-hint">Cuando esta activo o las plazas estan llenas, se muestra "SOLD OUT" en el frontend y no se puede reservar.</small>
        </div>
        ${isSoldOut ? '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:.85rem;color:#b91c1c;font-weight:600">Este camp se muestra como SOLD OUT en la web</div>' : ''}
        <div class="act-form-field"><label class="act-form-label">PLAZAS OCUPADAS</label><input type="number" class="act-form-input" id="f-spots-taken" value="${c.spots_taken||0}" min="0" style="width:100px" /><small class="act-form-hint">Cuando las plazas ocupadas igualen o superen el maximo, se comporta como sold out.</small></div>
        <div class="act-form-field"><label class="act-form-label">PLAZAS MAXIMAS</label><input type="number" class="act-form-input" id="f-max-spots" value="${c.max_spots||17}" min="1" style="width:100px" /></div>
        ${spotsBar(c.spots_taken, c.max_spots)}
      </div>
      <div class="act-form-card" style="margin-top:16px">
        <div class="act-form-field">
          <label class="act-form-label">PRECIO</label>
          <div style="display:flex;align-items:center;gap:8px"><input type="number" class="act-form-input" id="f-price" value="${c.price||''}" step="0.01" style="width:120px" /><span>€</span></div>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">PRECIO ORIGINAL (tachado)</label>
          <div style="display:flex;align-items:center;gap:8px"><input type="number" class="act-form-input" id="f-original-price" value="${c.original_price||''}" step="0.01" style="width:120px" /><span>€</span></div>
          <small class="act-form-hint">Dejar vacio si no hay descuento.</small>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">DEPOSITO</label>
          <div style="display:flex;align-items:center;gap:8px"><input type="number" class="act-form-input" id="f-deposit" value="${c.deposit||180}" step="0.01" style="width:120px" /><span>€</span></div>
        </div>
        <div class="act-form-field"><label class="act-form-label">ESTADO</label>
          <select class="act-form-input" id="f-status" style="width:180px">${STATUSES.map(s => `<option value="${s}" ${c.status===s?'selected':''}>${STATUS_LABELS[s]||s}</option>`).join('')}</select>
        </div>
      </div>`;
  }

  function tabAjustes(c) {
    return `
      <h3 class="act-detail-section-title">Ajustes</h3>
      <div class="act-form-card">
        <div class="act-form-field"><label class="act-form-label">META TITLE (SEO)</label><input type="text" class="act-form-input" id="f-meta-title" value="${esc(c.meta_title||'')}" /></div>
        <div class="act-form-field"><label class="act-form-label">META DESCRIPTION (SEO)</label><textarea class="act-form-textarea" id="f-meta-desc" rows="2">${esc(c.meta_description||'')}</textarea></div>
      </div>`;
  }

  /* ==================== EVENTS ==================== */
  function bindDetailEvents(c) {
    container.querySelector('#sc-back')?.addEventListener('click', () => { selectedId = null; campFull = null; renderList(); });

    container.querySelectorAll('.act-nav-item').forEach(item => {
      item.addEventListener('click', e => { e.preventDefault(); activeTab = item.dataset.tab; renderDetail(); });
    });

    container.querySelector('#sc-save')?.addEventListener('click', async () => {
      try {
        await saveCurrentTab(c);
        showToast('Guardado', 'success');
        campFull = await fetchCampFull(c.id);
        camps = await fetchCamps();
        renderDetail();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    container.querySelector('#sc-preview')?.addEventListener('click', () => window.open(`/${c.slug}/`, '_blank'));

    container.querySelector('#sc-delete')?.addEventListener('click', async () => {
      if (!confirm(`Eliminar "${c.title}"?`)) return;
      try {
        await deleteCamp(c.id);
        camps = await fetchCamps();
        selectedId = null; campFull = null;
        showToast('Camp eliminado', 'success');
        renderList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    bindTabEvents(c);
  }

  function bindTabEvents(c) {
    /* General — preview en vivo del slug desde título + fechas */
    if (activeTab === 'general') {
      const slugEl = container.querySelector('#f-slug');
      const syncSlug = () => {
        if (slugEl) slugEl.value = uniqueCampSlug(
          buildCampSlug(container.querySelector('#f-title')?.value.trim(), container.querySelector('#f-date-start')?.value, container.querySelector('#f-date-end')?.value),
          camps, c.id);
      };
      container.querySelector('#f-title')?.addEventListener('input', syncSlug);
      container.querySelector('#f-date-start')?.addEventListener('change', syncSlug);
      container.querySelector('#f-date-end')?.addEventListener('change', syncSlug);
    }

    /* Hero — file upload */
    if (activeTab === 'hero') {
      container.querySelector('#f-hero-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const url = await uploadCampImage(file, c.slug);
          container.querySelector('#f-hero-image').value = url;
          showToast('Imagen subida', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    }

    /* Fotos */
    if (activeTab === 'fotos') {
      container.querySelector('#f-photo-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const url = await uploadCampImage(file, c.slug);
          await upsertCampPhoto({ camp_id: c.id, url, alt_text: '', sort_order: (c.photos||[]).length });
          campFull = await fetchCampFull(c.id);
          renderDetail();
          showToast('Foto subida', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelector('#f-photo-add-url')?.addEventListener('click', async () => {
        const url = container.querySelector('#f-photo-url')?.value.trim();
        if (!url) return;
        try {
          await upsertCampPhoto({ camp_id: c.id, url, alt_text: '', sort_order: (c.photos||[]).length });
          campFull = await fetchCampFull(c.id);
          renderDetail();
          showToast('Foto anadida', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.act-photo-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Eliminar foto?')) return;
          try {
            await deleteCampPhoto(btn.dataset.id);
            campFull = await fetchCampFull(c.id);
            renderDetail();
            showToast('Foto eliminada', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    /* Testimonios */
    if (activeTab === 'testimonios') {
      container.querySelector('#test-add')?.addEventListener('click', async () => {
        try {
          await upsertCampTestimonial({ camp_id: c.id, author_name: 'Nombre', quote: 'Cita', stars: 5, sort_order: (c.testimonials||[]).length });
          campFull = await fetchCampFull(c.id);
          renderDetail();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.test-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await deleteCampTestimonial(btn.dataset.id);
            campFull = await fetchCampFull(c.id);
            renderDetail();
            showToast('Testimonio eliminado', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    /* FAQ */
    if (activeTab === 'faq') {
      container.querySelector('#faq-add')?.addEventListener('click', async () => {
        try {
          await upsertCampFaq({ camp_id: c.id, question: 'Pregunta', answer: 'Respuesta', col_index: 0, sort_order: (c.faqs||[]).length });
          campFull = await fetchCampFull(c.id);
          renderDetail();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.faq-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await deleteCampFaq(btn.dataset.id);
            campFull = await fetchCampFull(c.id);
            renderDetail();
            showToast('FAQ eliminada', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }
  }

  /* ==================== SAVE LOGIC ==================== */
  async function saveCurrentTab(c) {
    const updates = {};

    if (activeTab === 'general') {
      updates.title = container.querySelector('#f-title')?.value.trim() || c.title;
      updates.kicker = container.querySelector('#f-kicker')?.value.trim() || null;
      updates.card_vibe = container.querySelector('#f-card-vibe')?.value.trim() || null;
      updates.duration_label = container.querySelector('#f-duration-label')?.value.trim() || null;
      updates.description = container.querySelector('#f-description')?.value.trim() || null;
      updates.color = container.querySelector('#f-color')?.value || '#0f2f39';
      updates.date_start = container.querySelector('#f-date-start')?.value || c.date_start;
      updates.date_end = container.querySelector('#f-date-end')?.value || c.date_end;
      // Regenera el slug desde las fechas (+ descriptor del título) SOLO si cambiaron las
      // fechas o el título → la URL refleja las fechas reales sin cambiarla por editar otra cosa.
      if (updates.title !== c.title || updates.date_start !== c.date_start || updates.date_end !== c.date_end) {
        updates.slug = uniqueCampSlug(buildCampSlug(updates.title, updates.date_start, updates.date_end), camps, c.id);
      }
    }

    if (activeTab === 'hero') {
      updates.hero_image = container.querySelector('#f-hero-image')?.value.trim() || null;
      updates.hero_kicker = container.querySelector('#f-hero-kicker')?.value.trim() || null;
      updates.hero_title = container.querySelector('#f-hero-title')?.value.trim() || null;
      updates.hero_subtitle = container.querySelector('#f-hero-subtitle')?.value.trim() || null;
      updates.hero_tags = (container.querySelector('#f-hero-tags')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    }

    if (activeTab === 'pagina') {
      updates.whats_included_title = container.querySelector('#f-includes-title')?.value.trim() || null;
      updates.whats_included = (container.querySelector('#f-includes')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      updates.ideal_for_title = container.querySelector('#f-ideal-title')?.value.trim() || null;
      updates.ideal_for = (container.querySelector('#f-ideal')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    }

    if (activeTab === 'precios') {
      updates.sold_out = container.querySelector('#f-sold-out')?.checked || false;
      updates.spots_taken = parseInt(container.querySelector('#f-spots-taken')?.value) || 0;
      updates.max_spots = parseInt(container.querySelector('#f-max-spots')?.value) || 17;
      updates.price = parseFloat(container.querySelector('#f-price')?.value) || c.price;
      updates.original_price = parseFloat(container.querySelector('#f-original-price')?.value) || null;
      updates.deposit = parseFloat(container.querySelector('#f-deposit')?.value) || c.deposit;
      updates.status = container.querySelector('#f-status')?.value || c.status;
    }

    if (activeTab === 'ajustes') {
      updates.meta_title = container.querySelector('#f-meta-title')?.value.trim() || null;
      updates.meta_description = container.querySelector('#f-meta-desc')?.value.trim() || null;
    }

    if (activeTab === 'testimonios') {
      const cards = container.querySelectorAll('[data-test-id]');
      for (const card of cards) {
        await upsertCampTestimonial({
          id: card.dataset.testId,
          camp_id: c.id,
          author_name: card.querySelector('.test-name')?.value.trim() || '',
          quote: card.querySelector('.test-quote')?.value.trim() || '',
          stars: parseInt(card.querySelector('.test-stars')?.value) || 5,
        });
      }
      return;
    }

    if (activeTab === 'faq') {
      const cards = container.querySelectorAll('[data-faq-id]');
      for (const card of cards) {
        await upsertCampFaq({
          id: card.dataset.faqId,
          camp_id: c.id,
          question: card.querySelector('.faq-q')?.value.trim() || '',
          answer: card.querySelector('.faq-a')?.value.trim() || '',
          col_index: parseInt(card.querySelector('.faq-col')?.value) || 0,
        });
      }
      return;
    }

    if (Object.keys(updates).length > 0) {
      updates.id = c.id;
      await upsertCamp(updates);
    }
  }

  /* start */
  renderList();
}
