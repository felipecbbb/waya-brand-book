/* ============================================================
   Actividades Section — CRUD de actividades desde Supabase
   ============================================================ */
import { showToast } from '../modules/ui.js';
import { resizeImage, uploadAll } from '../modules/images.js';
import {
  fetchActivities, fetchActivityFull, upsertActivity, deleteActivity,
  toggleActivityStatus, upsertActivityPacks, upsertActivityPhoto,
  deleteActivityPhoto, upsertActivityTestimonial, deleteActivityTestimonial,
  upsertActivityFaq, deleteActivityFaq, uploadActivityImage,
} from '../modules/api.js';

/* helpers */
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
const fmtDate = d => d ? new Date(d).toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

/* cache */
let activitiesCache = null;
async function loadActivities() {
  activitiesCache = await fetchActivities();
  return activitiesCache;
}

/* public getters (used by other sections) */
export function getActivities() { return activitiesCache || []; }
export function getActivityById(id) { return (activitiesCache || []).find(a => a.id === id); }

/* ============================================================
   Main render
   ============================================================ */
export async function renderActividades(container) {
  let selectedId = null;
  let activityFull = null;   // full activity with packs, photos, etc.
  let activeTab = 'descripcion';

  const activities = await loadActivities();

  /* ---------- LIST VIEW ---------- */
  function renderList() {
    const count = activities.length;
    container.innerHTML = `
      <div class="act-list-page">
        <div class="act-list-header">
          <h2 class="act-list-title">Actividades (${count})</h2>
          <div class="act-list-actions">
            <button class="act-icon-btn" id="act-add" title="Crear actividad">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>

        <div class="act-table">
          <div class="act-table-head">
            <span class="act-col-img">Imagen</span>
            <span class="act-col-title">Título</span>
            <span class="act-col-date">Fecha</span>
            <span class="act-col-tags">Etiquetas</span>
            <span class="act-col-actions"></span>
          </div>
          ${activities.map(a => `
            <div class="act-table-row" data-id="${a.id}">
              <span class="act-col-img">
                ${a.hero_image
                  ? `<img src="${esc(a.hero_image)}" class="act-thumb" alt="" />`
                  : `<div class="act-img-placeholder" style="border-color:${a.color||'#0f2f39'}">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${a.color||'#0f2f39'}" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>`}
              </span>
              <span class="act-col-title">
                <strong class="act-name">${esc(a.nombre)}</strong>
                <span class="act-status-badge ${a.activo ? 'active' : 'inactive'}">${a.activo ? 'Activado' : 'Desactivado'}</span>
              </span>
              <span class="act-col-date">${fmtDate(a.created_at)}</span>
              <span class="act-col-tags">
                <span class="act-tag">${esc(a.type_key)}</span>
              </span>
              <span class="act-col-actions">
                <button class="act-duplicate-btn act-delete-quick" data-id="${a.id}" title="Eliminar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </span>
            </div>`).join('')}
        </div>
      </div>`;

    /* events */
    container.querySelectorAll('.act-table-row').forEach(row => {
      row.addEventListener('click', async e => {
        if (e.target.closest('.act-delete-quick')) return;
        selectedId = row.dataset.id;
        await openDetail();
      });
    });

    container.querySelectorAll('.act-delete-quick').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const a = activities.find(x => x.id === btn.dataset.id);
        if (!a) return;
        if (!confirm(`Eliminar "${a.nombre}"? Se borrara tambien del frontend.`)) return;
        try {
          await deleteActivity(a.id);
          showToast('Actividad eliminada', 'success');
          await loadActivities();
          renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    container.querySelector('#act-add')?.addEventListener('click', () => renderCreateForm());
  }

  /* ---------- CREATE FORM ---------- */
  function renderCreateForm() {
    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="act-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">Nueva actividad</strong>
          </div>
        </div>
        <div style="max-width:600px;padding:24px 0">
          <div class="act-form-card">
            <div class="act-form-field">
              <label class="act-form-label">NOMBRE</label>
              <input type="text" class="act-form-input" id="new-nombre" placeholder="Ej: Clases de Kitesurf" />
            </div>
            <div class="act-form-field">
              <label class="act-form-label">CLAVE INTERNA (type_key)</label>
              <input type="text" class="act-form-input" id="new-typekey" placeholder="Ej: kitesurf" />
              <small class="act-form-hint">Identificador unico, sin espacios ni acentos.</small>
            </div>
            <div class="act-form-field">
              <label class="act-form-label">SLUG (URL)</label>
              <input type="text" class="act-form-input" id="new-slug" placeholder="Ej: clases-de-kitesurf" />
              <small class="act-form-hint">Se generara automaticamente si lo dejas vacio.</small>
            </div>
            <div class="act-form-field">
              <label class="act-form-label">COLOR</label>
              <input type="color" class="act-form-input" id="new-color" value="#0f2f39" style="height:40px;padding:4px" />
            </div>
            <div style="margin-top:20px;display:flex;gap:12px">
              <button class="act-action-btn primary" id="new-save">Crear actividad</button>
              <button class="act-action-link" id="new-cancel">Cancelar</button>
            </div>
          </div>
        </div>
      </div>`;

    /* auto-generate slug from nombre */
    const nombreInput = container.querySelector('#new-nombre');
    const slugInput = container.querySelector('#new-slug');
    const keyInput = container.querySelector('#new-typekey');
    nombreInput.addEventListener('input', () => {
      const val = nombreInput.value.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      slugInput.value = val;
      if (!keyInput.value) keyInput.value = val.replace(/-/g,'_').replace(/^clases_de_/,'');
    });

    container.querySelector('#new-cancel')?.addEventListener('click', () => renderList());
    container.querySelector('#act-back')?.addEventListener('click', () => renderList());

    container.querySelector('#new-save')?.addEventListener('click', async () => {
      const nombre = nombreInput.value.trim();
      const type_key = keyInput.value.trim();
      const slug = slugInput.value.trim() || nombre.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      const color = container.querySelector('#new-color').value;

      if (!nombre || !type_key) { showToast('Nombre y clave son obligatorios', 'error'); return; }

      try {
        const saved = await upsertActivity({
          nombre, type_key, slug, color,
          hero_kicker: nombre,
          hero_title: nombre,
          hero_subtitle: '',
          descripcion: '',
          deposit: 15,
          pack_validity: 180,
          duracion: 90,
          capacidad_max: 6,
          activo: true,
          sort_order: activities.length,
        });
        showToast('Actividad creada', 'success');
        await loadActivities();
        selectedId = saved.id;
        await openDetail();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  /* ---------- DETAIL VIEW ---------- */
  async function openDetail() {
    try {
      activityFull = await fetchActivityFull(selectedId);
    } catch (err) {
      showToast('Error cargando actividad', 'error');
      return renderList();
    }
    renderDetail();
  }

  function renderDetail() {
    const a = activityFull;
    if (!a) return renderList();

    const TABS = [
      { group: 'CONTENIDO', items: [
        { id: 'descripcion', label: 'Descripción', icon: iconDoc },
        { id: 'hero', label: 'Hero / Cabecera', icon: iconImage },
        { id: 'pagina', label: 'Página', icon: iconLayout },
        { id: 'fotos', label: 'Fotos', icon: iconCamera },
        { id: 'testimonios', label: 'Testimonios', icon: iconStar },
        { id: 'faq', label: 'FAQ', icon: iconHelp },
      ]},
      { group: 'CONFIGURACIÓN', items: [
        { id: 'programacion', label: 'Programación', icon: iconClock },
        { id: 'tarifas', label: 'Tarifas / Packs', icon: iconMoney },
        { id: 'pagos', label: 'Pagos', icon: iconCard },
      ]},
    ];

    const tabContent = renderTabContent(a);

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="act-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${esc(a.nombre)}</strong>
            <div class="act-detail-topbar-meta">
              <span class="act-status-badge ${a.activo?'active':'inactive'}">${a.activo?'Activado':'Desactivado'}</span>
              <span class="act-detail-topbar-id">${esc(a.type_key)} · /${esc(a.slug)}.html</span>
            </div>
          </div>
        </div>

        <div class="act-detail-layout">
          <nav class="act-detail-sidebar">
            ${TABS.map(g => `
              <div class="act-nav-group-label">${g.group}</div>
              ${g.items.map(t => `
                <a class="act-nav-item ${activeTab===t.id?'active':''}" data-tab="${t.id}">
                  ${t.icon} ${t.label}
                </a>`).join('')}
            `).join('')}
          </nav>

          <main class="act-detail-main">
            ${tabContent}
          </main>

          <aside class="act-detail-actions">
            <button class="act-action-btn primary" id="act-save">
              <span>Guardar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            <button class="act-action-link" id="act-preview">
              <span>Ver en web</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button class="act-action-link" id="act-toggle-status">
              <span>${a.activo?'Desactivar':'Activar'}</span>
            </button>
            <button class="act-action-link danger" id="act-delete">
              <span>Eliminar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </aside>
        </div>
      </div>`;

    bindDetailEvents(a);
  }

  /* ---------- TAB CONTENT ---------- */
  function renderTabContent(a) {
    if (activeTab === 'descripcion') return tabDescripcion(a);
    if (activeTab === 'hero') return tabHero(a);
    if (activeTab === 'pagina') return tabPagina(a);
    if (activeTab === 'fotos') return tabFotos(a);
    if (activeTab === 'testimonios') return tabTestimonios(a);
    if (activeTab === 'faq') return tabFaq(a);
    if (activeTab === 'programacion') return tabProgramacion(a);
    if (activeTab === 'tarifas') return tabTarifas(a);
    if (activeTab === 'pagos') return tabPagos(a);
    return '';
  }

  /* -- Descripcion -- */
  function tabDescripcion(a) {
    return `
      <h3 class="act-detail-section-title">Descripción</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">NOMBRE</label>
          <input type="text" class="act-form-input" id="f-nombre" value="${esc(a.nombre)}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">NOMBRE INTERNO</label>
          <input type="text" class="act-form-input" id="f-nombre-interno" value="${esc(a.nombre_interno||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">SLUG (URL)</label>
          <input type="text" class="act-form-input" id="f-slug" value="${esc(a.slug)}" />
          <small class="act-form-hint">Ruta en la web: /${esc(a.slug)}.html</small>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">TYPE KEY</label>
          <input type="text" class="act-form-input" id="f-typekey" value="${esc(a.type_key)}" />
          <small class="act-form-hint">Clave interna. Cambiarlo puede romper reservas existentes.</small>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">DESCRIPCIÓN</label>
          <textarea class="act-form-textarea" id="f-descripcion" rows="4">${esc(a.descripcion||'')}</textarea>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">COLOR</label>
          <input type="color" class="act-form-input" id="f-color" value="${a.color||'#0f2f39'}" style="height:40px;padding:4px" />
        </div>
      </div>`;
  }

  /* -- Hero -- */
  function tabHero(a) {
    return `
      <h3 class="act-detail-section-title">Hero / Cabecera</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">IMAGEN DEL HERO</label>
          ${a.hero_image ? `<img src="${esc(a.hero_image)}" style="max-width:100%;border-radius:8px;margin-bottom:12px" />` : ''}
          <input type="file" id="f-hero-file" accept="image/*" style="margin-bottom:8px" />
          <input type="text" class="act-form-input" id="f-hero-image" value="${esc(a.hero_image||'')}" placeholder="O pega una URL de imagen" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">KICKER (texto pequeño encima del título)</label>
          <input type="text" class="act-form-input" id="f-hero-kicker" value="${esc(a.hero_kicker||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">TÍTULO PRINCIPAL</label>
          <input type="text" class="act-form-input" id="f-hero-title" value="${esc(a.hero_title||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">SUBTÍTULO</label>
          <input type="text" class="act-form-input" id="f-hero-subtitle" value="${esc(a.hero_subtitle||'')}" />
          <small class="act-form-hint">Ej: 90 minutos · Max. 6 personas · Material incluido</small>
        </div>
      </div>`;
  }

  /* -- Pagina (pre-section, whats included, ideal for) -- */
  function tabPagina(a) {
    const included = a.whats_included || [];
    const ideal = a.ideal_for || [];
    return `
      <h3 class="act-detail-section-title">Contenido de la pagina</h3>
      <div class="act-form-card">
        <h4 style="margin:0 0 12px;font-size:.95rem;color:var(--color-navy)">Seccion antes de los packs</h4>
        <div class="act-form-field">
          <label class="act-form-label">KICKER</label>
          <input type="text" class="act-form-input" id="f-pre-kicker" value="${esc(a.pre_section_kicker||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">TÍTULO</label>
          <input type="text" class="act-form-input" id="f-pre-title" value="${esc(a.pre_section_title||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">DESCRIPCIÓN</label>
          <textarea class="act-form-textarea" id="f-pre-lead" rows="3">${esc(a.pre_section_lead||'')}</textarea>
        </div>
      </div>
      <div class="act-form-card" style="margin-top:16px">
        <h4 style="margin:0 0 12px;font-size:.95rem;color:var(--color-navy)">${esc(a.whats_included_title||'Que incluye cada clase?')}</h4>
        <div class="act-form-field">
          <label class="act-form-label">TÍTULO DE LA SECCIÓN</label>
          <input type="text" class="act-form-input" id="f-includes-title" value="${esc(a.whats_included_title||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">ETIQUETAS (una por linea)</label>
          <textarea class="act-form-textarea" id="f-includes" rows="4">${included.map(esc).join('\n')}</textarea>
        </div>
      </div>
      <div class="act-form-card" style="margin-top:16px">
        <h4 style="margin:0 0 12px;font-size:.95rem;color:var(--color-navy)">${esc(a.ideal_for_title||'Ideal para')}</h4>
        <div class="act-form-field">
          <label class="act-form-label">TÍTULO DE LA SECCIÓN</label>
          <input type="text" class="act-form-input" id="f-ideal-title" value="${esc(a.ideal_for_title||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">ITEMS (uno por linea)</label>
          <textarea class="act-form-textarea" id="f-ideal" rows="4">${ideal.map(esc).join('\n')}</textarea>
        </div>
      </div>`;
  }

  /* -- Fotos -- */
  function tabFotos(a) {
    const photos = a.photos || [];
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
            <input type="file" id="f-photo-file" accept="image/*" multiple style="display:none" />
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

  /* -- Testimonios -- */
  function tabTestimonios(a) {
    const testimonials = a.testimonials || [];
    return `
      <h3 class="act-detail-section-title">Testimonios</h3>
      <div class="act-form-card">
        ${testimonials.map((t,i) => `
          <div class="cli-bono-card" style="margin-bottom:12px" data-test-id="${t.id}">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
              <div style="flex:1">
                <div class="act-form-field" style="margin-bottom:8px">
                  <label class="act-form-label">NOMBRE</label>
                  <input type="text" class="act-form-input test-name" value="${esc(t.author_name)}" />
                </div>
                <div class="act-form-field" style="margin-bottom:8px">
                  <label class="act-form-label">CITA</label>
                  <textarea class="act-form-textarea test-quote" rows="2">${esc(t.quote)}</textarea>
                </div>
                <div class="act-form-field">
                  <label class="act-form-label">ESTRELLAS</label>
                  <select class="act-form-input test-stars" style="width:80px">
                    ${[5,4,3,2,1].map(n => `<option value="${n}" ${t.stars===n?'selected':''}>${n}</option>`).join('')}
                  </select>
                </div>
              </div>
              <button class="act-action-link danger test-delete" data-id="${t.id}" style="margin-top:20px">Eliminar</button>
            </div>
          </div>`).join('')}
        <button class="act-action-btn primary" id="test-add" style="margin-top:12px">+ Anadir testimonio</button>
      </div>`;
  }

  /* -- FAQ -- */
  function tabFaq(a) {
    const faqs = a.faqs || [];
    return `
      <h3 class="act-detail-section-title">Preguntas frecuentes</h3>
      <div class="act-form-card">
        ${faqs.map(f => `
          <div class="cli-bono-card" style="margin-bottom:12px" data-faq-id="${f.id}">
            <div class="act-form-field" style="margin-bottom:8px">
              <label class="act-form-label">PREGUNTA</label>
              <input type="text" class="act-form-input faq-q" value="${esc(f.question)}" />
            </div>
            <div class="act-form-field" style="margin-bottom:8px">
              <label class="act-form-label">RESPUESTA</label>
              <textarea class="act-form-textarea faq-a" rows="2">${esc(f.answer)}</textarea>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div class="act-form-field" style="margin:0">
                <label class="act-form-label" style="margin:0">COLUMNA</label>
                <select class="act-form-input faq-col" style="width:120px">
                  <option value="0" ${f.col_index===0?'selected':''}>Izquierda</option>
                  <option value="1" ${f.col_index===1?'selected':''}>Derecha</option>
                </select>
              </div>
              <button class="act-action-link danger faq-delete" data-id="${f.id}">Eliminar</button>
            </div>
          </div>`).join('')}
        <button class="act-action-btn primary" id="faq-add" style="margin-top:12px">+ Anadir pregunta</button>
      </div>`;
  }

  /* -- Programacion -- */
  function tabProgramacion(a) {
    return `
      <h3 class="act-detail-section-title">Programación</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">DURACION (minutos)</label>
          <input type="number" class="act-form-input" id="f-duracion" value="${a.duracion||90}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">CAPACIDAD MAXIMA</label>
          <input type="number" class="act-form-input" id="f-capacidad" value="${a.capacidad_max||6}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">UBICACION</label>
          <input type="text" class="act-form-input" id="f-ubicacion" value="${esc(a.ubicacion||'Playa del Hombre')}" />
        </div>
      </div>`;
  }

  /* -- Tarifas / Packs -- */
  function tabTarifas(a) {
    const packs = a.packs || [];
    const basePrice = packs.length ? packs.reduce((min, p) => p.sessions === 1 ? Number(p.price) : min, packs[0]?.price || 0) : 0;
    return `
      <h3 class="act-detail-section-title">Tarifas — Packs / Bonos</h3>
      <div class="act-form-card">
        <small class="act-form-hint" style="margin-bottom:16px;display:block">Los packs marcados como <strong>público</strong> se muestran en la web. Los que no son públicos se usan como regla interna para reservas manuales y ampliaciones de bonos.</small>
        <table class="act-tariff-table">
          <thead>
            <tr><th>Sesiones</th><th>Precio total</th><th>Precio/sesión</th><th>Ahorro</th><th>Público</th><th>Destacado</th><th></th></tr>
          </thead>
          <tbody id="packs-body">
            ${packs.map(p => {
              const perSession = (Number(p.price) / p.sessions).toFixed(2);
              const singlePrice = packs.find(x => x.sessions === 1)?.price || basePrice;
              const fullPrice = Number(singlePrice) * p.sessions;
              const saved = fullPrice - Number(p.price);
              const pct = p.sessions > 1 && fullPrice > 0 ? Math.round((saved / fullPrice) * 100) : 0;
              return `<tr data-sessions="${p.sessions}">
                <td><input type="number" class="pack-sessions" value="${p.sessions}" min="1" style="width:64px;font-weight:600;text-align:center" /></td>
                <td><input type="number" class="pack-price" value="${p.price}" step="0.01" min="0" style="width:80px;font-weight:600" /></td>
                <td class="pack-per-session">${perSession}€</td>
                <td class="pack-savings">${saved > 0 ? `<span class="act-save-badge">-${saved.toFixed(2)}€ (${pct}%)</span>` : '—'}</td>
                <td><input type="checkbox" class="pack-public" ${p.public !== false ? 'checked' : ''} /></td>
                <td><input type="checkbox" class="pack-featured" ${p.featured?'checked':''} /></td>
                <td><button class="pack-remove" data-sessions="${p.sessions}" title="Eliminar">✕</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <button class="act-action-btn primary" id="pack-add" style="margin-top:12px">+ Añadir pack</button>
      </div>`;
  }

  /* -- Pagos -- */
  function tabPagos(a) {
    return `
      <h3 class="act-detail-section-title">Pagos</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">ANTICIPO OBLIGATORIO</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" class="act-form-input" id="f-deposit" value="${a.deposit||15}" step="0.01" style="width:100px" /> <span>€</span>
          </div>
          <small class="act-form-hint">El resto se paga en la primera clase.</small>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">PRECIO CLASE EXTRA (despues del pack maximo)</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="number" class="act-form-input" id="f-extra-class-price" value="${a.extra_class_price||0}" step="0.01" style="width:100px" /> <span>€ / clase</span>
          </div>
          <small class="act-form-hint">Precio por cada clase adicional cuando el cliente ya tiene el pack mas grande. Pon 0 para desactivar.</small>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">VALIDEZ DE PACKS (dias)</label>
          <input type="number" class="act-form-input" id="f-validity" value="${a.pack_validity||180}" style="width:120px" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">META TITLE (SEO)</label>
          <input type="text" class="act-form-input" id="f-meta-title" value="${esc(a.meta_title||'')}" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">META DESCRIPTION (SEO)</label>
          <textarea class="act-form-textarea" id="f-meta-desc" rows="2">${esc(a.meta_description||'')}</textarea>
        </div>
      </div>`;
  }

  /* ---------- DETAIL EVENTS ---------- */
  function bindDetailEvents(a) {
    container.querySelector('#act-back')?.addEventListener('click', () => {
      selectedId = null; activityFull = null; renderList();
    });

    // Guardar ANTES de repintar: renderDetail() reconstruye el formulario
    // desde activityFull (lo que hay en la base de datos), así que lo escrito
    // y no guardado se perdía en silencio al cambiar de pestaña. Si el
    // guardado falla no se cambia de pestaña, para no perder el texto.
    container.querySelectorAll('.act-nav-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        const destino = item.dataset.tab;
        if (!destino || destino === activeTab) return;
        try {
          if (await saveCurrentTab(a)) {
            activityFull = await fetchActivityFull(a.id);
            await loadActivities();
          }
        } catch (err) {
          showToast('No se pudo guardar: ' + err.message, 'error');
          return;
        }
        activeTab = destino;
        renderDetail();
      });
    });

    /* Save */
    container.querySelector('#act-save')?.addEventListener('click', async () => {
      try {
        await saveCurrentTab(a);
        showToast('Guardado correctamente', 'success');
        activityFull = await fetchActivityFull(a.id);
        // update cache
        await loadActivities();
        // re-render to show saved values
        renderDetail();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    /* Toggle status */
    container.querySelector('#act-toggle-status')?.addEventListener('click', async () => {
      try {
        await toggleActivityStatus(a.id, !a.activo);
        a.activo = !a.activo;
        showToast(a.activo ? 'Actividad activada' : 'Actividad desactivada', 'success');
        await loadActivities();
        renderDetail();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    /* Delete */
    container.querySelector('#act-delete')?.addEventListener('click', async () => {
      if (!confirm(`Eliminar "${a.nombre}"? Se eliminara del frontend tambien.`)) return;
      try {
        await deleteActivity(a.id);
        showToast('Actividad eliminada', 'success');
        await loadActivities();
        selectedId = null; activityFull = null;
        renderList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    /* Preview */
    container.querySelector('#act-preview')?.addEventListener('click', () => {
      window.open(`/${a.slug}.html`, '_blank');
    });

    /* Tab-specific events */
    bindTabEvents(a);
  }

  function bindTabEvents(a) {
    /* Fotos tab */
    if (activeTab === 'fotos') {
      container.querySelector('#f-photo-file')?.addEventListener('change', async e => {
        const files = [...e.target.files];
        e.target.value = '';               // permite volver a elegir las mismas
        if (!files.length) return;
        const base = (a.photos || []).length;
        showToast(`Subiendo ${files.length} foto${files.length > 1 ? 's' : ''}…`, 'info');
        try {
          // Comprimidas y de 3 en 3: subir el original de una foto de móvil
          // (3–8 MB) era lo que hacía que pareciera colgado.
          const urls = await uploadAll(files, async (file) => {
            const opt = await resizeImage(file);
            return uploadActivityImage(opt, a.slug);
          });
          const ok = urls.filter(Boolean);
          for (let i = 0; i < ok.length; i++) {
            await upsertActivityPhoto({ activity_id: a.id, url: ok[i], alt_text: '', sort_order: base + i });
          }
          // Un único refresco al final, no uno por foto.
          activityFull = await fetchActivityFull(a.id);
          renderDetail();
          const fallidas = urls.length - ok.length;
          showToast(
            fallidas ? `${ok.length} subidas, ${fallidas} fallaron` : `${ok.length} foto${ok.length > 1 ? 's' : ''} subida${ok.length > 1 ? 's' : ''}`,
            fallidas ? 'error' : 'success');
        } catch (err) { showToast('Error subiendo fotos: ' + err.message, 'error'); }
      });

      container.querySelector('#f-photo-add-url')?.addEventListener('click', async () => {
        const url = container.querySelector('#f-photo-url')?.value.trim();
        if (!url) return;
        try {
          await upsertActivityPhoto({ activity_id: a.id, url, alt_text: '', sort_order: (a.photos||[]).length });
          activityFull = await fetchActivityFull(a.id);
          renderDetail();
          showToast('Foto anadida', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.act-photo-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Eliminar foto?')) return;
          try {
            await deleteActivityPhoto(btn.dataset.id);
            activityFull = await fetchActivityFull(a.id);
            renderDetail();
            showToast('Foto eliminada', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    /* Testimonios tab */
    if (activeTab === 'testimonios') {
      container.querySelector('#test-add')?.addEventListener('click', async () => {
        try {
          await upsertActivityTestimonial({ activity_id: a.id, author_name: 'Nombre', quote: 'Cita', stars: 5, sort_order: (a.testimonials||[]).length });
          activityFull = await fetchActivityFull(a.id);
          renderDetail();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.test-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await deleteActivityTestimonial(btn.dataset.id);
            activityFull = await fetchActivityFull(a.id);
            renderDetail();
            showToast('Testimonio eliminado', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    /* FAQ tab */
    if (activeTab === 'faq') {
      container.querySelector('#faq-add')?.addEventListener('click', async () => {
        try {
          await upsertActivityFaq({ activity_id: a.id, question: 'Pregunta', answer: 'Respuesta', col_index: 0, sort_order: (a.faqs||[]).length });
          activityFull = await fetchActivityFull(a.id);
          renderDetail();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      container.querySelectorAll('.faq-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await deleteActivityFaq(btn.dataset.id);
            activityFull = await fetchActivityFull(a.id);
            renderDetail();
            showToast('FAQ eliminada', 'success');
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    /* Tarifas tab — add/remove packs + live recalc */
    if (activeTab === 'tarifas') {
      function recalcPackRow(tr) {
        const sessions = Number(tr.querySelector('.pack-sessions')?.value) || 1;
        const price = parseFloat(tr.querySelector('.pack-price')?.value) || 0;
        tr.dataset.sessions = sessions;
        const perSession = sessions > 0 ? (price / sessions).toFixed(2) : '0.00';
        const perSessionTd = tr.querySelector('.pack-per-session');
        if (perSessionTd) perSessionTd.textContent = perSession + '€';
        // Recalc savings based on single-session price
        const tbody = container.querySelector('#packs-body');
        const allRows = [...tbody.querySelectorAll('tr')];
        const singleRow = allRows.find(r => Number(r.querySelector('.pack-sessions')?.value) === 1);
        const singlePrice = singleRow ? parseFloat(singleRow.querySelector('.pack-price')?.value) || 0 : 0;
        const fullPrice = singlePrice * sessions;
        const saved = fullPrice - price;
        const pct = sessions > 1 && fullPrice > 0 ? Math.round((saved / fullPrice) * 100) : 0;
        const savingsTd = tr.querySelector('.pack-savings');
        if (savingsTd) savingsTd.innerHTML = saved > 0 ? `<span class="act-save-badge">-${saved.toFixed(2)}€ (${pct}%)</span>` : '—';
      }

      // Live recalc on input
      container.querySelectorAll('#packs-body .pack-sessions, #packs-body .pack-price').forEach(input => {
        input.addEventListener('input', () => {
          const tr = input.closest('tr');
          recalcPackRow(tr);
          // If single session price changed, recalc all rows
          if (input.classList.contains('pack-price') && Number(tr.querySelector('.pack-sessions')?.value) === 1) {
            container.querySelectorAll('#packs-body tr').forEach(r => recalcPackRow(r));
          }
        });
      });

      container.querySelector('#pack-add')?.addEventListener('click', () => {
        const tbody = container.querySelector('#packs-body');
        const rows = tbody.querySelectorAll('tr');
        const maxSessions = rows.length > 0 ? Math.max(...[...rows].map(r => Number(r.dataset.sessions) || 0)) : 0;
        const nextSessions = maxSessions + 1;
        const tr = document.createElement('tr');
        tr.dataset.sessions = nextSessions;
        tr.innerHTML = `
          <td><input type="number" class="pack-sessions" value="${nextSessions}" min="1" style="width:64px;font-weight:600;text-align:center" /></td>
          <td><input type="number" class="pack-price" value="0" step="0.01" min="0" style="width:80px;font-weight:600" /></td>
          <td class="pack-per-session">—</td>
          <td class="pack-savings">—</td>
          <td><input type="checkbox" class="pack-public" checked /></td>
          <td><input type="checkbox" class="pack-featured" /></td>
          <td><button class="pack-remove" data-sessions="${nextSessions}" title="Eliminar">✕</button></td>`;
        tbody.appendChild(tr);
        tr.querySelector('.pack-remove').addEventListener('click', () => tr.remove());
        tr.querySelector('.pack-sessions').addEventListener('input', () => recalcPackRow(tr));
        tr.querySelector('.pack-price').addEventListener('input', () => recalcPackRow(tr));
      });

      container.querySelectorAll('.pack-remove').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('tr').remove());
      });
    }

    /* Hero tab — file upload preview */
    if (activeTab === 'hero') {
      container.querySelector('#f-hero-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const url = await uploadActivityImage(await resizeImage(file), a.slug);
          container.querySelector('#f-hero-image').value = url;
          showToast('Imagen subida', 'success');
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    }
  }

  /* ---------- SAVE LOGIC ---------- */
  async function saveCurrentTab(a) {
    const updates = {};

    if (activeTab === 'descripcion') {
      updates.nombre = container.querySelector('#f-nombre')?.value.trim() || a.nombre;
      updates.nombre_interno = container.querySelector('#f-nombre-interno')?.value.trim() || null;
      updates.slug = container.querySelector('#f-slug')?.value.trim() || a.slug;
      updates.type_key = container.querySelector('#f-typekey')?.value.trim() || a.type_key;
      updates.descripcion = container.querySelector('#f-descripcion')?.value.trim() || null;
      updates.color = container.querySelector('#f-color')?.value || a.color;
    }

    if (activeTab === 'hero') {
      updates.hero_image = container.querySelector('#f-hero-image')?.value.trim() || null;
      updates.hero_kicker = container.querySelector('#f-hero-kicker')?.value.trim() || null;
      updates.hero_title = container.querySelector('#f-hero-title')?.value.trim() || null;
      updates.hero_subtitle = container.querySelector('#f-hero-subtitle')?.value.trim() || null;
    }

    if (activeTab === 'pagina') {
      updates.pre_section_kicker = container.querySelector('#f-pre-kicker')?.value.trim() || null;
      updates.pre_section_title = container.querySelector('#f-pre-title')?.value.trim() || null;
      updates.pre_section_lead = container.querySelector('#f-pre-lead')?.value.trim() || null;
      updates.whats_included_title = container.querySelector('#f-includes-title')?.value.trim() || null;
      updates.whats_included = (container.querySelector('#f-includes')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      updates.ideal_for_title = container.querySelector('#f-ideal-title')?.value.trim() || null;
      updates.ideal_for = (container.querySelector('#f-ideal')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    }

    if (activeTab === 'programacion') {
      updates.duracion = parseInt(container.querySelector('#f-duracion')?.value) || a.duracion;
      updates.capacidad_max = parseInt(container.querySelector('#f-capacidad')?.value) || a.capacidad_max;
      updates.ubicacion = container.querySelector('#f-ubicacion')?.value.trim() || a.ubicacion;
    }

    if (activeTab === 'pagos') {
      updates.deposit = parseFloat(container.querySelector('#f-deposit')?.value) || a.deposit;
      updates.extra_class_price = parseFloat(container.querySelector('#f-extra-class-price')?.value) || 0;
      updates.pack_validity = parseInt(container.querySelector('#f-validity')?.value) || a.pack_validity;
      updates.meta_title = container.querySelector('#f-meta-title')?.value.trim() || null;
      updates.meta_description = container.querySelector('#f-meta-desc')?.value.trim() || null;
    }

    if (activeTab === 'tarifas') {
      const packs = [];
      container.querySelectorAll('#packs-body tr').forEach(tr => {
        const sessions = Number(tr.querySelector('.pack-sessions')?.value) || Number(tr.dataset.sessions);
        packs.push({
          sessions,
          price: parseFloat(tr.querySelector('.pack-price')?.value) || 0,
          featured: tr.querySelector('.pack-featured')?.checked || false,
          public: tr.querySelector('.pack-public')?.checked ?? true,
        });
      });
      await upsertActivityPacks(a.id, packs);
      return true; // packs saved separately
    }

    if (activeTab === 'testimonios') {
      const cards = container.querySelectorAll('[data-test-id]');
      for (const card of cards) {
        await upsertActivityTestimonial({
          id: card.dataset.testId,
          activity_id: a.id,
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
        await upsertActivityFaq({
          id: card.dataset.faqId,
          activity_id: a.id,
          question: card.querySelector('.faq-q')?.value.trim() || '',
          answer: card.querySelector('.faq-a')?.value.trim() || '',
          col_index: parseInt(card.querySelector('.faq-col')?.value) || 0,
        });
      }
      return;
    }

    // Save activity fields
    if (Object.keys(updates).length > 0) {
      updates.id = a.id;
      await upsertActivity(updates);
      return true;
    }
    return false;
  }

  /* start */
  renderList();
}

/* ============================================================
   SVG Icons
   ============================================================ */
const iconDoc = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const iconImage = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const iconCamera = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const iconLayout = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
const iconStar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const iconHelp = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const iconClock = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const iconMoney = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
const iconCard = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
