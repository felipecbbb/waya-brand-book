/* ============================================================
   Material Section — Rental equipment catalog + detail
   ============================================================ */
import { openModal, closeModal, showToast, formatDate, formatCurrency } from '../modules/ui.js';
const RENTAL_DEPOSIT = 5;
import { supabase } from '/lib/supabase.js';
import { fetchSiteSetting, upsertSiteSetting } from '../modules/api.js';
import { compareSizes } from '/lib/shared-constants.js';

// ---- API helpers ----
async function fetchEquipment() {
  const { data, error } = await supabase
    .from('rental_equipment')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function upsertEquipment(item) {
  item.updated_at = new Date().toISOString();
  if (item.id) {
    const id = item.id;
    delete item.id;
    const { data, error } = await supabase.from('rental_equipment').update(item).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase.from('rental_equipment').insert(item).select().single();
    if (error) throw error;
    return data;
  }
}

async function deleteEquipment(id) {
  const { error } = await supabase.from('rental_equipment').delete().eq('id', id);
  if (error) throw error;
}

async function fetchEquipmentReservations(equipmentId) {
  const { data, error } = await supabase
    .from('equipment_reservations')
    .select('*')
    .eq('equipment_id', equipmentId)
    .order('date_start', { ascending: false });
  if (error) { console.warn('fetchEquipmentReservations:', error.message); return []; }
  return data || [];
}

// ---- Inventario por unidad (inventory_units) ----
// Orden natural por número: numérico primero (1,2,3…), texto (Invento, Quillas) al final
function cmpUnitNumber(a, b) {
  const na = parseFloat(a.number), nb = parseFloat(b.number);
  const aNum = !Number.isNaN(na), bNum = !Number.isNaN(nb);
  if (aNum && bNum) return na - nb || String(a.number).localeCompare(String(b.number));
  if (aNum) return -1;
  if (bNum) return 1;
  return String(a.number || '').localeCompare(String(b.number || ''), 'es');
}

async function fetchUnits(category) {
  const { data, error } = await supabase
    .from('inventory_units')
    .select('*')
    .eq('category', category);
  if (error) throw error;
  // Orden de pantalla por sort_order (manual, arrastrable); fallback a número.
  return (data || []).sort((a, b) => {
    const sa = a.sort_order, sb = b.sort_order;
    if (sa != null && sb != null) return sa - sb;
    if (sa != null) return -1;
    if (sb != null) return 1;
    return cmpUnitNumber(a, b);
  });
}

async function upsertUnit(unit) {
  unit.updated_at = new Date().toISOString();
  if (unit.id) {
    const id = unit.id; const u = { ...unit }; delete u.id;
    const { data, error } = await supabase.from('inventory_units').update(u).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('inventory_units').insert(unit).select().single();
  if (error) throw error;
  return data;
}

async function deleteUnit(id) {
  const { error } = await supabase.from('inventory_units').delete().eq('id', id);
  if (error) throw error;
}

function unitRentalSize(u) {
  if (u.category === 'tabla' && u.pies != null) {
    const t = Math.trunc(u.pies);
    return `${t}'${Math.round((u.pies - t) * 10)}`;
  }
  return u.talla || '—';
}

// Stock real de un ítem de catálogo a partir de sus unidades de inventario.
// { sizes: {talla:{disponible,total}}, totalDisp, totalOwned, count }
async function fetchUnitStockFor(equipmentId) {
  const { data } = await supabase.from('inventory_units')
    .select('estado, talla, pies, category').eq('equipment_id', equipmentId);
  const sizes = {}; let totalDisp = 0, totalOwned = 0;
  (data || []).forEach(u => {
    const sz = unitRentalSize(u);
    if (!sizes[sz]) sizes[sz] = { disponible: 0, total: 0 };
    if (u.estado !== 'baja') { sizes[sz].total++; totalOwned++; }
    if (u.estado === 'disponible') { sizes[sz].disponible++; totalDisp++; }
  });
  return { sizes, totalDisp, totalOwned, count: (data || []).length };
}

const INV_CATEGORIES = {
  neopreno:  { label: 'Neoprenos',  cols: ['number', 'tipo', 'grosor', 'talla', 'marca', 'descripcion'], fields: ['number', 'tipo', 'grosor', 'talla', 'marca', 'descripcion', 'estado', 'notes'] },
  licra:     { label: 'Licras',     cols: ['number', 'talla', 'genero', 'descripcion'],                  fields: ['number', 'talla', 'genero', 'descripcion', 'estado', 'notes'] },
  tabla:     { label: 'Tablas',     cols: ['number', 'marca', 'pies', 'descripcion'],                    fields: ['number', 'marca', 'pies', 'descripcion', 'estado', 'notes'] },
  bodyboard: { label: 'Bodyboards', cols: ['number', 'marca', 'talla', 'descripcion'],                   fields: ['number', 'marca', 'talla', 'descripcion', 'estado', 'notes'] },
  accesorio: { label: 'Accesorios', cols: ['number', 'marca', 'pies', 'descripcion'],                    fields: ['number', 'marca', 'pies', 'descripcion', 'estado', 'notes'], internal: true },
  gorros:    { label: 'Gorros',     cols: ['number', 'marca', 'descripcion'],                            fields: ['number', 'marca', 'descripcion', 'estado', 'notes'], internal: true },
};

const INV_FIELDS = {
  number:      { label: 'Número', type: 'text', placeholder: 'Ej: 12' },
  tipo:        { label: 'Tipo', type: 'select', options: ['', 'Corto', 'Largo'] },
  grosor:      { label: 'Grosor', type: 'text', placeholder: 'Ej: 3.2mm' },
  talla:       { label: 'Talla', type: 'text', placeholder: 'Ej: M, 10, 150' },
  genero:      { label: 'Género', type: 'text', placeholder: 'Ej: Niño, Hombre, Mujer' },
  marca:       { label: 'Marca', type: 'text', placeholder: 'Ej: Billabong' },
  pies:        { label: 'Pies (largo)', type: 'number', step: '0.1', placeholder: 'Ej: 7.6' },
  descripcion: { label: 'Descripción', type: 'text', placeholder: 'Ej: AZUL/ESCUELA' },
  estado:      { label: 'Estado', type: 'select', options: ['disponible', 'en_uso', 'reparacion', 'perdido', 'baja'] },
  notes:       { label: 'Notas', type: 'textarea', placeholder: 'Anotaciones internas…' },
};

const INV_ESTADOS = {
  disponible: { label: 'Disponible', color: '#16a34a', bg: '#dcfce7' },
  en_uso:     { label: 'En uso',     color: '#1a1a1a', bg: '#e0f2fe' },
  reparacion: { label: 'Reparación', color: '#b45309', bg: '#fef3c7' },
  perdido:    { label: 'Perdido',    color: '#b91c1c', bg: '#fee2e2' },
  baja:       { label: 'Baja',       color: '#4b5563', bg: '#e5e7eb' },
};

function invEstadoBadge(estado) {
  const e = INV_ESTADOS[estado] || { label: estado, color: '#4b5563', bg: '#e5e7eb' };
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:600;color:${e.color};background:${e.bg}">${e.label}</span>`;
}

const TYPE_ICONS = {
  con_talla: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  basico: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
};

const TYPE_LABELS = {
  con_talla: 'Con talla',
  basico: 'Básico',
};

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderMaterial(container) {
  let selectedItem = null;
  let activeTab = 'descripcion';
  let view = 'inventario';       // 'inventario' | 'catalogo'
  let invCategory = 'neopreno';  // categoría activa del inventario
  let invFilter = 'todos';       // filtro por estado
  let invSearch = '';            // búsqueda libre
  const invCache = {};           // unidades por categoría (evita refetch en búsqueda)
  let catalogList = null;        // ítems de rental_equipment (para asignar unidad ↔ catálogo)
  let rentalsOn = true;          // ¿se puede alquilar desde la web? (site_settings)

  function viewSwitcher(active) {
    return `
      <div class="mat-viewswitch" style="display:inline-flex;background:#eef2f7;border-radius:10px;padding:3px;gap:2px">
        <button class="mat-vs-btn ${active === 'inventario' ? 'on' : ''}" data-view="inventario"
          style="border:none;cursor:pointer;padding:7px 16px;border-radius:8px;font-weight:600;font-size:.88rem;background:${active === 'inventario' ? '#fff' : 'transparent'};color:${active === 'inventario' ? 'var(--color-navy,#0f172a)' : '#64748b'};box-shadow:${active === 'inventario' ? '0 1px 3px rgba(0,0,0,.1)' : 'none'}">Inventario</button>
        <button class="mat-vs-btn ${active === 'catalogo' ? 'on' : ''}" data-view="catalogo"
          style="border:none;cursor:pointer;padding:7px 16px;border-radius:8px;font-weight:600;font-size:.88rem;background:${active === 'catalogo' ? '#fff' : 'transparent'};color:${active === 'catalogo' ? 'var(--color-navy,#0f172a)' : '#64748b'};box-shadow:${active === 'catalogo' ? '0 1px 3px rgba(0,0,0,.1)' : 'none'}">Catálogo y precios</button>
      </div>`;
  }

  function wireViewSwitcher() {
    container.querySelectorAll('.mat-vs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === view) return;
        view = v;
        if (v === 'inventario') renderInventory(); else renderList();
      });
    });
  }

  /* ==================== INTERRUPTOR DE ALQUILERES ====================
     Los alquileres se pueden cerrar al público sin desmontar nada: la página
     sigue mostrando material y precios, pero el botón pasa a "Próximamente".
     El catálogo de aquí abajo se sigue gestionando igual, y el panel puede
     seguir apuntando alquileres hechos en persona. */
  function switchAlquileres() {
    return `
      <div class="mat-rentals-switch" style="display:flex;align-items:center;gap:14px;justify-content:space-between;
        background:${rentalsOn ? '#f0fdf4' : '#fff7ed'};border:1px solid ${rentalsOn ? '#bbf7d0' : '#fed7aa'};
        border-radius:12px;padding:14px 18px;margin-bottom:18px">
        <div>
          <strong style="display:block;font-size:.95rem;color:var(--color-navy,#0f172a)">
            Alquileres en la web: ${rentalsOn ? 'abiertos' : 'cerrados'}
          </strong>
          <span style="font-size:.85rem;color:#64748b">
            ${rentalsOn
              ? 'Los clientes pueden reservar material online.'
              : 'La página sigue visible, pero el botón muestra “Próximamente”. Tú puedes seguir apuntando alquileres a mano.'}
          </span>
        </div>
        <button id="mat-rentals-toggle" role="switch" aria-checked="${rentalsOn}"
          aria-label="Alquileres en la web"
          style="flex:none;position:relative;width:52px;height:30px;border:none;cursor:pointer;border-radius:999px;
            background:${rentalsOn ? '#22c55e' : '#cbd5e1'};transition:background .18s">
          <span style="position:absolute;top:3px;left:${rentalsOn ? '25px' : '3px'};width:24px;height:24px;
            border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .18s"></span>
        </button>
      </div>`;
  }

  function wireSwitchAlquileres() {
    const btn = container.querySelector('#mat-rentals-toggle');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const nuevo = !rentalsOn;
      btn.disabled = true;
      try {
        await upsertSiteSetting('alquileres_activos', { activo: nuevo });
        rentalsOn = nuevo;
        showToast(nuevo ? 'Alquileres abiertos en la web' : 'Alquileres cerrados en la web', 'success');
        renderList();
      } catch (e) {
        // Sin esto el interruptor se quedaría "movido" aparentando un cambio
        // que la base de datos ha rechazado.
        showToast(e.message || 'No se pudo cambiar el estado', 'error');
        btn.disabled = false;
      }
    });
  }

  // ===================== LIST VIEW =====================
  async function renderList() {
    selectedItem = null;
    const items = await fetchEquipment();
    try {
      const cfg = await fetchSiteSetting('alquileres_activos');
      rentalsOn = cfg?.activo !== false;   // sin fila guardada → abiertos
    } catch { rentalsOn = true; }
    const count = items.length;

    container.innerHTML = `
      <div class="act-list-page">
        <div style="margin-bottom:18px">${viewSwitcher('catalogo')}</div>
        ${switchAlquileres()}
        <div class="act-list-header">
          <h2 class="act-list-title">Catálogo y precios (${count})</h2>
          <div class="act-list-actions">
            <button class="act-icon-btn" id="mat-add" title="Añadir material">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>

        <div class="act-table">
          <div class="act-table-head">
            <span class="act-col-img">Imagen</span>
            <span class="act-col-title">Título</span>
            <span class="mat-col-type">Tipo</span>
            <span class="act-col-date">Fecha de creación</span>
            <span class="act-col-tags">Etiquetas</span>
          </div>
          ${items.length ? items.map(item => {
            const dateStr = new Date(item.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const tags = item.tags || [];
            return `
              <div class="act-table-row" data-id="${item.id}">
                <span class="act-col-img">
                  ${item.image_url
                    ? `<img src="${esc(item.image_url)}" class="mat-img-thumb" alt="" />`
                    : `<div class="act-img-placeholder" style="border-color:#1a1a1a">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      </div>`}
                </span>
                <span class="act-col-title">
                  <strong class="act-name">${esc(item.name)}</strong>
                  <span class="act-status-badge ${item.active ? 'active' : 'inactive'}">${item.active ? 'Activado' : 'Desactivado'}</span>
                </span>
                <span class="mat-col-type">
                  <span class="mat-type-badge">${TYPE_ICONS[item.type] || ''} ${TYPE_LABELS[item.type] || item.type}</span>
                </span>
                <span class="act-col-date">${dateStr}</span>
                <span class="act-col-tags">
                  ${tags.slice(0, 3).map(t => `<span class="act-tag">${esc(t)}</span>`).join('')}
                </span>
              </div>`;
          }).join('') : '<div class="admin-empty" style="padding:40px"><p>No hay material registrado</p></div>'}
        </div>
      </div>`;

    // Row click → detail
    container.querySelectorAll('.act-table-row').forEach(row => {
      row.addEventListener('click', () => {
        const item = items.find(i => i.id === row.dataset.id);
        if (item) {
          selectedItem = item;
          activeTab = 'descripcion';
          renderDetail();
        }
      });
    });

    // Add new
    container.querySelector('#mat-add')?.addEventListener('click', () => {
      selectedItem = {
        id: null,
        name: '',
        type: 'basico',
        description: '',
        image_url: null,
        price_hour: 0,
        price_day: 0,
        deposit: 0,
        stock: 1,
        sizes: [],
        tags: [],
        active: true,
        created_at: new Date().toISOString(),
      };
      activeTab = 'descripcion';
      renderDetail();
    });

    wireViewSwitcher();
    wireSwitchAlquileres();
  }

  // ===================== INVENTARIO (unidades) =====================
  async function renderInventory() {
    selectedItem = null;
    let units;
    try {
      if (!catalogList) catalogList = await fetchEquipment();
      if (!invCache[invCategory]) invCache[invCategory] = await fetchUnits(invCategory);
      units = invCache[invCategory];
    } catch (err) {
      container.innerHTML = `<div class="act-list-page"><div style="margin-bottom:18px">${viewSwitcher('inventario')}</div><div class="admin-empty" style="padding:40px"><p>Error cargando inventario: ${esc(err.message)}</p></div></div>`;
      wireViewSwitcher();
      return;
    }

    const cfg = INV_CATEGORIES[invCategory];
    // counts por estado (sobre todas las unidades de la categoría, sin filtrar)
    const counts = {};
    units.forEach(u => { counts[u.estado] = (counts[u.estado] || 0) + 1; });

    // aplicar filtro de estado + búsqueda
    const q = invSearch.trim().toLowerCase();
    const filtered = units.filter(u => {
      if (invFilter !== 'todos' && u.estado !== invFilter) return false;
      if (!q) return true;
      return [u.number, u.tipo, u.grosor, u.talla, u.genero, u.marca, u.descripcion, u.notes]
        .some(v => v != null && String(v).toLowerCase().includes(q));
    });

    const estadoChips = Object.keys(INV_ESTADOS).filter(e => counts[e]).map(e =>
      `<button class="mat-estado-chip" data-estado="${e}" style="border:1px solid ${invFilter === e ? INV_ESTADOS[e].color : '#e2e8f0'};background:${invFilter === e ? INV_ESTADOS[e].bg : '#fff'};color:${INV_ESTADOS[e].color};border-radius:999px;padding:4px 12px;font-size:.8rem;font-weight:600;cursor:pointer">${INV_ESTADOS[e].label} ${counts[e]}</button>`
    ).join('');

    const showCat = !cfg.internal;   // accesorios: internos, sin catálogo web
    // Celda editable (input/select) según el tipo del campo — hoja tipo Excel
    const cellInput = (u, field) => {
      const meta = INV_FIELDS[field];
      const val = u[field] == null ? '' : u[field];
      const attrs = `class="inv-cell" data-id="${u.id || ''}" data-field="${field}"`;
      if (meta && meta.type === 'select') {
        return `<select ${attrs}>${meta.options.map(o => {
          const label = field === 'estado' ? (INV_ESTADOS[o]?.label || o) : (o || '—');
          return `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(label)}</option>`;
        }).join('')}</select>`;
      }
      const t = meta && meta.type === 'number' ? 'number' : 'text';
      const step = meta && meta.step ? ` step="${meta.step}"` : '';
      return `<input type="${t}"${step} ${attrs} value="${esc(val)}" />`;
    };
    const catCellInput = (u) => `<select class="inv-cell" data-id="${u.id || ''}" data-field="equipment_id">
        <option value="">— sin asignar —</option>
        ${(catalogList || []).map(c => `<option value="${c.id}" ${u.equipment_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>`;
    const rowInner = (u) => {
      const handleCell = `<td class="inv-handle-cell"><span class="inv-grip" draggable="true" title="Arrastrar para reordenar">⠿</span><button type="button" class="inv-insert-below" title="Insertar unidad debajo">+</button></td>`;
      const tds = cfg.cols.map(c => `<td>${cellInput(u, c)}</td>`).join('');
      const notesCell = `<td>${cellInput(u, 'notes')}</td>`;
      const catCell = showCat ? `<td>${catCellInput(u)}</td>` : '';
      const estadoCell = `<td>${cellInput(u, 'estado')}</td>`;
      const delCell = `<td style="text-align:center"><button class="inv-del-row" title="Eliminar unidad" style="background:none;border:none;color:#b91c1c;cursor:pointer;padding:4px"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>`;
      return `${handleCell}${tds}${notesCell}${catCell}${estadoCell}${delCell}`;
    };
    const headCells = '<th class="inv-handle-cell"></th>' + cfg.cols.map(c => `<th>${INV_FIELDS[c].label}</th>`).join('')
      + '<th>Notas</th>' + (showCat ? '<th>Catálogo</th>' : '') + '<th>Estado</th><th></th>';
    const rows = filtered.map(u => `<tr class="inv-row" data-id="${u.id}">${rowInner(u)}</tr>`).join('');
    const colCount = cfg.cols.length + 4 + (showCat ? 1 : 0);

    container.innerHTML = `
      <div class="act-list-page">
        <div style="margin-bottom:18px">${viewSwitcher('inventario')}</div>
        <div class="act-list-header">
          <h2 class="act-list-title">Inventario — ${cfg.label} (${units.length})</h2>
          <div class="act-list-actions">
            <button class="act-icon-btn" id="inv-add" title="Añadir unidad">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>

        <div class="mat-inv-cats" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
          ${Object.keys(INV_CATEGORIES).map(cat => `
            <button class="mat-cat-tab ${invCategory === cat ? 'on' : ''}" data-cat="${cat}"
              style="border:none;cursor:pointer;padding:8px 18px;border-radius:8px;font-weight:600;font-size:.9rem;background:${invCategory === cat ? 'var(--color-navy,#0f172a)' : '#f1f5f9'};color:${invCategory === cat ? '#fff' : '#475569'}">${INV_CATEGORIES[cat].label}</button>
          `).join('')}
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
          <input type="search" id="inv-search" value="${esc(invSearch)}" placeholder="Buscar por número, marca, talla…"
            style="flex:1;min-width:220px;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem" />
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button class="mat-estado-chip" data-estado="todos" style="border:1px solid ${invFilter === 'todos' ? 'var(--color-navy,#0f172a)' : '#e2e8f0'};background:${invFilter === 'todos' ? '#0f172a' : '#fff'};color:${invFilter === 'todos' ? '#fff' : '#475569'};border-radius:999px;padding:4px 12px;font-size:.8rem;font-weight:600;cursor:pointer">Todos ${units.length}</button>
            ${estadoChips}
          </div>
        </div>

        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table class="inv-sheet">
              <thead><tr>${headCells}</tr></thead>
              <tbody id="inv-tbody">${rows || `<tr><td colspan="${colCount}" style="padding:30px;text-align:center;color:var(--color-muted,#888)">Sin unidades</td></tr>`}</tbody>
            </table>
          </div>
        </div>
        <p style="margin-top:10px;font-size:.82rem;color:var(--color-muted,#888)">${filtered.length} de ${units.length} unidades · Edita las celdas directamente (se guarda al salir de la celda) · El botón "+" añade una fila · Orden por número al recargar</p>
      </div>`;

    wireViewSwitcher();

    container.querySelectorAll('.mat-cat-tab').forEach(b => b.addEventListener('click', () => {
      invCategory = b.dataset.cat; invFilter = 'todos'; invSearch = ''; renderInventory();
    }));
    container.querySelectorAll('.mat-estado-chip').forEach(b => b.addEventListener('click', () => {
      invFilter = b.dataset.estado; renderInventory();
    }));
    const searchEl = container.querySelector('#inv-search');
    searchEl?.addEventListener('input', (e) => {
      invSearch = e.target.value;
      // re-render manteniendo el foco
      renderInventory().then(() => {
        const s = container.querySelector('#inv-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      });
    });
    // ---- Edición en línea (hoja tipo Excel) ----
    const tbody = container.querySelector('#inv-tbody');
    const flashRow = (tr, ok) => {
      tr.style.transition = 'background-color .25s';
      tr.style.backgroundColor = ok ? '#dcfce7' : '#fee2e2';
      setTimeout(() => { tr.style.backgroundColor = ''; }, 600);
    };
    const normalize = (field, raw) => {
      let v = typeof raw === 'string' ? raw.trim() : raw;
      if (field === 'pies') return (v === '' || v == null) ? null : parseFloat(v);
      return v === '' ? null : v;
    };

    // Catálogo al que se auto-enlaza una unidad nueva según su categoría
    // (así sale en el selector de alquiler sin tener que ponerlo a mano).
    const CAT_TO_SLUG = { neopreno: 'neopreno', licra: 'licra', bodyboard: 'body-board' };
    const makeDraftRow = () => {
      const slug = CAT_TO_SLUG[invCategory];
      const eq = slug ? (catalogList || []).find(c => c.slug === slug) : null;
      const tr = document.createElement('tr');
      tr.className = 'inv-row';
      tr.dataset.draft = '1';
      tr.innerHTML = rowInner({ category: invCategory, estado: 'disponible', equipment_id: eq ? eq.id : null });
      return tr;
    };

    // Añadir unidad → fila nueva editable arriba (se guarda al rellenar el número)
    container.querySelector('#inv-add')?.addEventListener('click', () => {
      if (!tbody) return;
      tbody.querySelector('td[colspan]')?.closest('tr')?.remove();
      const tr = makeDraftRow();
      tbody.prepend(tr);
      tr.querySelector('[data-field="number"]')?.focus();
    });

    // sort_order de una fila según sus vecinas en el DOM (punto medio → permite insertar entre dos)
    const sortOrderForRow = (tr) => {
      const soOf = (el) => { if (!el) return null; const u = units.find(x => x.id === el.dataset.id); return (u && u.sort_order != null) ? u.sort_order : null; };
      const p = soOf(tr.previousElementSibling), n = soOf(tr.nextElementSibling);
      if (p == null && n == null) return 100;
      if (p == null) return n - 50;
      if (n == null) return p + 100;
      return (p + n) / 2;
    };
    async function persistRowOrder(tr) {
      if (!tr.dataset.id || tr.dataset.draft) return;
      const so = sortOrderForRow(tr);
      try {
        await upsertUnit({ id: tr.dataset.id, sort_order: so });
        const u = units.find(x => x.id === tr.dataset.id); if (u) u.sort_order = so;
        flashRow(tr, true);
      } catch (err) { showToast('Error al reordenar: ' + err.message, 'error'); }
    }

    // "+" entre filas: inserta una unidad nueva justo debajo de esa fila
    tbody?.addEventListener('click', (e) => {
      const ins = e.target.closest('.inv-insert-below');
      if (!ins) return;
      e.preventDefault();
      const refTr = ins.closest('tr');
      const tr = makeDraftRow();
      refTr.after(tr);
      tr.querySelector('[data-field="number"]')?.focus();
    });

    // Arrastrar por el "agarrador" para reordenar
    let dragRow = null;
    tbody?.addEventListener('dragstart', (e) => {
      const grip = e.target.closest('.inv-grip');
      if (!grip) { e.preventDefault(); return; }
      dragRow = grip.closest('tr');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragRow.dataset.id || ''); } catch (_) {}
      dragRow.classList.add('inv-dragging');
    });
    tbody?.addEventListener('dragover', (e) => {
      if (!dragRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const over = e.target.closest('tr.inv-row');
      if (!over || over === dragRow) return;
      const rect = over.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      tbody.insertBefore(dragRow, after ? over.nextElementSibling : over);
    });
    tbody?.addEventListener('dragend', async () => {
      if (!dragRow) return;
      const moved = dragRow; dragRow = null;
      moved.classList.remove('inv-dragging');
      await persistRowOrder(moved);
    });

    // Guardar al cambiar/salir de una celda
    tbody?.addEventListener('change', async (e) => {
      const el = e.target.closest('.inv-cell');
      if (!el) return;
      const tr = el.closest('tr');
      const field = el.dataset.field;

      // Fila nueva: se crea al tener número (recoge todas sus celdas)
      if (tr.dataset.draft) {
        const numEl = tr.querySelector('[data-field="number"]');
        if (!(numEl && numEl.value.trim())) return;
        if (tr.dataset.saving) return;
        tr.dataset.saving = '1';
        const obj = { category: invCategory };
        tr.querySelectorAll('.inv-cell').forEach(c => { obj[c.dataset.field] = normalize(c.dataset.field, c.value); });
        if (!obj.estado) obj.estado = 'disponible';
        obj.sort_order = sortOrderForRow(tr); // se queda donde se insertó/arrastró
        try {
          const saved = await upsertUnit(obj);
          delete tr.dataset.draft; delete tr.dataset.saving;
          tr.dataset.id = saved.id;
          tr.querySelectorAll('.inv-cell').forEach(c => { c.dataset.id = saved.id; });
          units.push(saved);
          flashRow(tr, true);
          showToast('Unidad creada', 'success');
        } catch (err) { delete tr.dataset.saving; showToast('Error: ' + err.message, 'error'); flashRow(tr, false); }
        return;
      }

      // Fila existente: actualiza solo ese campo
      const id = tr.dataset.id;
      const unit = units.find(x => x.id === id);
      const val = normalize(field, el.value);
      if (field === 'number' && val == null) { showToast('El número no puede quedar vacío', 'error'); el.value = unit?.number || ''; return; }
      try {
        await upsertUnit({ id, category: invCategory, [field]: val });
        if (unit) unit[field] = val;
        flashRow(tr, true);
      } catch (err) { showToast('Error: ' + err.message, 'error'); flashRow(tr, false); }
    });

    // Borrar fila
    tbody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.inv-del-row');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (tr.dataset.draft || !tr.dataset.id) { tr.remove(); return; }
      const unit = units.find(x => x.id === tr.dataset.id);
      if (!confirm(`¿Eliminar la unidad ${unit?.number || ''}? No se puede deshacer.`)) return;
      try {
        await deleteUnit(tr.dataset.id);
        const i = units.findIndex(x => x.id === tr.dataset.id); if (i >= 0) units.splice(i, 1);
        tr.remove();
        showToast('Unidad eliminada', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  // ---- Modal crear/editar unidad (NO USADO tras P5: el inventario se edita en línea; se conserva por referencia) ----
  function openUnitModal(unit) {
    const isNew = !unit;
    const cfg = INV_CATEGORIES[invCategory];
    const u = unit || { category: invCategory, estado: 'disponible' };

    const fieldsHTML = cfg.fields.map(f => {
      const meta = INV_FIELDS[f];
      const val = u[f] == null ? '' : u[f];
      let input;
      if (meta.type === 'select') {
        input = `<select class="act-form-input" id="inv-f-${f}" style="cursor:pointer">
          ${meta.options.map(o => {
            const label = f === 'estado' ? (INV_ESTADOS[o]?.label || o) : (o || '—');
            return `<option value="${esc(o)}" ${String(val) === o ? 'selected' : ''}>${esc(label)}</option>`;
          }).join('')}
        </select>`;
      } else if (meta.type === 'textarea') {
        input = `<textarea class="act-form-input" id="inv-f-${f}" rows="2" placeholder="${esc(meta.placeholder || '')}" style="resize:vertical">${esc(val)}</textarea>`;
      } else {
        input = `<input type="${meta.type}" ${meta.step ? `step="${meta.step}"` : ''} class="act-form-input" id="inv-f-${f}" value="${esc(val)}" placeholder="${esc(meta.placeholder || '')}" />`;
      }
      return `<div class="act-form-field"><label class="act-form-label">${meta.label.toUpperCase()}</label>${input}</div>`;
    }).join('');

    // Selector de catálogo (a qué ítem de alquiler web pertenece la unidad).
    // Las categorías internas (accesorios) no se alquilan online → sin selector.
    const catOptions = `<option value="">— Sin catálogo (no alquilable online) —</option>` +
      (catalogList || []).map(c => `<option value="${c.id}" ${u.equipment_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const catalogField = cfg.internal ? '' : `
      <div class="act-form-field">
        <label class="act-form-label">CATÁLOGO (ALQUILER WEB)</label>
        <select class="act-form-input" id="inv-f-equipment_id" style="cursor:pointer">${catOptions}</select>
        <small class="act-form-hint">Determina en qué producto de la web cuenta esta unidad para la disponibilidad.</small>
      </div>`;

    openModal(isNew ? `Nueva unidad — ${cfg.label}` : `Unidad ${u.number || ''} — ${cfg.label}`, `
      <div class="act-form-card" style="box-shadow:none;padding:0">
        ${fieldsHTML}
        ${catalogField}
      </div>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;align-items:center">
        ${!isNew ? `<button class="btn line" id="inv-del" style="margin-right:auto;color:#b91c1c;border-color:#b91c1c">Eliminar</button>` : ''}
        <button class="btn line" id="inv-cancel">Cancelar</button>
        <button class="btn red" id="inv-save">${isNew ? 'Crear unidad' : 'Guardar'}</button>
      </div>`);

    document.getElementById('inv-cancel')?.addEventListener('click', closeModal);

    document.getElementById('inv-save')?.addEventListener('click', async () => {
      const obj = { category: invCategory };
      cfg.fields.forEach(f => {
        const el = document.getElementById(`inv-f-${f}`);
        if (!el) return;
        let v = el.value;
        if (typeof v === 'string') v = v.trim();
        if (f === 'pies') v = v === '' ? null : parseFloat(v);
        obj[f] = v === '' ? null : v;
      });
      const eqEl = document.getElementById('inv-f-equipment_id');
      obj.equipment_id = eqEl && eqEl.value ? eqEl.value : null;
      if (!obj.number) { showToast('El número es obligatorio', 'error'); return; }
      if (!obj.estado) obj.estado = 'disponible';
      if (u.id) obj.id = u.id;
      try {
        await upsertUnit(obj);
        showToast(isNew ? 'Unidad creada' : 'Unidad guardada', 'success');
        closeModal();
        invCache[invCategory] = null;
        renderInventory();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('inv-del')?.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la unidad ${u.number || ''}? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteUnit(u.id);
        showToast('Unidad eliminada', 'success');
        closeModal();
        invCache[invCategory] = null;
        renderInventory();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  // ===================== DETAIL VIEW =====================
  async function renderDetail() {
    const item = selectedItem;
    if (!item) return renderList();
    const isNew = !item.id;

    const TABS = [
      { group: 'CONTENIDO', items: [
        { id: 'descripcion', label: 'Descripción', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
        { id: 'precios', label: 'Precios y stock', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
        { id: 'tallas', label: 'Tallas / Variantes', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' },
      ]},
      { group: 'OPERACIONES', items: [
        { id: 'reservas', label: 'Reservas', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
      ]},
    ];

    // Stock real desde el inventario por unidad (cacheado en el item)
    if (item.id && item._unitStock === undefined) {
      try { item._unitStock = await fetchUnitStockFor(item.id); }
      catch { item._unitStock = null; }
    }
    const hasUnits = !!(item._unitStock && item._unitStock.count > 0);

    let tabContent = '';
    if (activeTab === 'descripcion') tabContent = renderDescripcionTab(item, hasUnits);
    else if (activeTab === 'precios') tabContent = renderPreciosTab(item, hasUnits);
    else if (activeTab === 'tallas') tabContent = renderTallasTab(item, hasUnits);
    else if (activeTab === 'reservas') tabContent = '<div class="act-form-card"><p style="color:var(--color-muted)">Cargando reservas…</p></div>';

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="mat-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${esc(item.name) || 'Nuevo material'}</strong>
            <div class="act-detail-topbar-meta">
              <span class="act-status-badge ${item.active ? 'active' : 'inactive'}">${item.active ? 'Activado' : 'Desactivado'}</span>
              <span class="mat-type-badge small">${TYPE_ICONS[item.type] || ''} ${TYPE_LABELS[item.type] || item.type}</span>
            </div>
          </div>
        </div>

        <div class="act-detail-layout">
          <nav class="act-detail-sidebar">
            ${TABS.map(group => `
              <div class="act-nav-group-label">${group.group}</div>
              ${group.items.map(tab => `
                <a class="act-nav-item ${activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">
                  ${tab.icon} ${tab.label}
                </a>
              `).join('')}
            `).join('')}
          </nav>

          <main class="act-detail-main" id="mat-tab-content">
            ${tabContent}
          </main>

          <aside class="act-detail-actions">
            <button class="act-action-btn primary" id="mat-save">
              <span>${isNew ? 'Crear' : 'Guardar'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            <button class="act-action-link" id="mat-toggle-status">
              <span>${item.active ? 'Desactivar' : 'Activar'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            ${!isNew ? `<button class="act-action-link danger" id="mat-delete">
              <span>Eliminar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>` : ''}

            ${!isNew ? `<div style="margin-top:16px">
              <div class="act-nav-group-label">STOCK</div>
              <p class="cli-detail-note" style="font-size:.95rem;font-weight:600;color:var(--color-navy)">
                ${hasUnits ? `${item._unitStock.totalDisp} disponibles / ${item._unitStock.totalOwned}` : `${item.stock || 0} unidades`}
              </p>
              ${hasUnits ? `<small style="color:var(--color-muted,#888)">Desde Inventario</small>` : ''}
            </div>` : ''}
          </aside>
        </div>
      </div>`;

    // ---- Events ----
    container.querySelector('#mat-back').addEventListener('click', () => renderList());
    // Guardar ANTES de repintar: renderDetail() reconstruye el formulario y
    // se llevaba por delante lo escrito y no guardado. En material NUEVO no
    // se auto-guarda: crearía la ficha a medias sin que el usuario lo pida.
    container.querySelectorAll('.act-nav-item').forEach(nav => {
      nav.addEventListener('click', async (e) => {
        e.preventDefault();
        const destino = nav.dataset.tab;
        if (!destino || destino === activeTab) return;
        if (item.id) {
          try {
            await saveItem(item, { silent: true });
          } catch (err) {
            showToast('No se pudo guardar: ' + err.message, 'error');
            return;
          }
        }
        activeTab = destino;
        renderDetail();
      });
    });

    container.querySelector('#mat-save')?.addEventListener('click', () => saveItem(item));
    container.querySelector('#mat-toggle-status')?.addEventListener('click', async () => {
      item.active = !item.active;
      if (item.id) {
        try {
          await upsertEquipment({ id: item.id, active: item.active, updated_at: new Date().toISOString() });
          showToast(item.active ? 'Material activado' : 'Material desactivado', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          item.active = !item.active;
        }
      }
      renderDetail();
    });

    container.querySelector('#mat-delete')?.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${item.name}"? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteEquipment(item.id);
        showToast('Material eliminado', 'success');
        renderList();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    // Ir al inventario filtrado por la categoría de este material
    container.querySelector('#mat-go-inventory')?.addEventListener('click', () => {
      const slug = item.slug || '';
      invCategory = slug === 'neopreno' ? 'neopreno' : slug === 'licra' ? 'licra' : 'tabla';
      invFilter = 'todos'; invSearch = ''; view = 'inventario';
      renderInventory();
    });

    // Load async tabs
    if (activeTab === 'reservas' && item.id) loadReservasTab(item);
  }

  // ===================== TABS =====================

  function renderDescripcionTab(item) {
    return `
      <h3 class="act-detail-section-title">Descripción</h3>
      <div class="act-form-card">
        <div class="act-form-field">
          <label class="act-form-label">NOMBRE</label>
          <input type="text" class="act-form-input" id="mat-name" value="${esc(item.name)}" placeholder="Ej: Tabla de Surf Softboard" />
        </div>
        <div class="act-form-field">
          <label class="act-form-label">TIPO</label>
          <select class="act-form-input" id="mat-type" style="cursor:pointer">
            <option value="basico" ${item.type === 'basico' ? 'selected' : ''}>Básico — sin variantes de talla</option>
            <option value="con_talla" ${item.type === 'con_talla' ? 'selected' : ''}>Con talla — tiene variantes de talla/medida</option>
          </select>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">DESCRIPCIÓN</label>
          <textarea class="act-form-input" id="mat-description" rows="4" placeholder="Descripción del material…" style="resize:vertical">${esc(item.description)}</textarea>
        </div>
        <div class="act-form-field">
          <label class="act-form-label">URL DE IMAGEN</label>
          <input type="url" class="act-form-input" id="mat-image" value="${esc(item.image_url)}" placeholder="https://..." />
          ${item.image_url ? `<img src="${esc(item.image_url)}" style="margin-top:8px;max-width:200px;border-radius:8px" alt="" />` : ''}
        </div>
        <div class="act-form-field">
          <label class="act-form-label">ETIQUETAS</label>
          <input type="text" class="act-form-input" id="mat-tags" value="${(item.tags || []).join(', ')}" placeholder="surf, tabla, principiante" />
          <small class="act-form-hint">Separadas por coma. Se usarán para filtrar en el frontend.</small>
        </div>
      </div>`;
  }

  function renderPreciosTab(item, hasUnits) {
    const pricing = item.pricing || {};
    // Standard durations (shown by default even if price is 0)
    const STANDARD = { '1h': '1 hora', '2h': '2 horas', '4h': '4 horas', '1d': '1 día', '1w': '1 semana', '2w': '2 semanas', '1m': '1 mes' };
    // Get all keys: standard ones + any custom ones from DB
    const allKeys = [...new Set([...Object.keys(STANDARD), ...Object.keys(pricing)])];
    // Only show keys that are in STANDARD or have a price > 0
    const activeKeys = allKeys.filter(k => k in STANDARD || (pricing[k] && pricing[k] > 0));

    // Bloque de stock: real (desde inventario) o manual (ítems sin unidades)
    const stockBlock = hasUnits
      ? `<div class="act-form-field" style="flex:1">
            <label class="act-form-label">STOCK</label>
            <div style="font-size:1.1rem;font-weight:700;color:var(--color-navy,#0f172a)">${item._unitStock.totalDisp} disponibles <span style="font-weight:400;color:var(--color-muted,#888)">/ ${item._unitStock.totalOwned} en total</span></div>
            <small class="act-form-hint">Se calcula automáticamente desde el Inventario por unidad. Gestiona las unidades en la pestaña «Tallas / Unidades».</small>
          </div>`
      : `<div class="act-form-field">
            <label class="act-form-label">STOCK (unidades)</label>
            <input type="number" class="act-form-input" id="mat-stock" value="${item.stock || 1}" min="0" />
            <small class="act-form-hint">Este material no tiene inventario por unidad; el stock se gestiona aquí.</small>
          </div>`;

    return `
      <h3 class="act-detail-section-title">Precios y stock</h3>
      <div class="act-form-card">
        <h4 style="font-family:'Space Grotesk',sans-serif;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted,#888);margin:0 0 12px">Tarifas por duración</h4>
        <div id="mat-durations-list">
          ${activeKeys.map(key => `
            <div class="mat-dur-row" data-key="${esc(key)}" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">
              <div class="act-form-field" style="flex:1;margin:0">
                <label class="act-form-label">${esc(STANDARD[key] || key).toUpperCase()}</label>
                <input type="number" class="act-form-input mat-pricing-input" data-key="${esc(key)}" value="${pricing[key] || 0}" step="0.01" min="0" placeholder="0" />
              </div>
              ${!(key in STANDARD) ? `<button class="mat-dur-remove" data-key="${esc(key)}" title="Eliminar" style="align-self:flex-end;padding:8px;cursor:pointer;background:none;border:none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>` : ''}
            </div>
          `).join('')}
        </div>
        <div id="mat-custom-durations"></div>
        <button class="tar-add-tier-btn" id="mat-add-duration" style="margin-top:12px">+ Añadir duración personalizada</button>
      </div>
      <div class="act-form-card" style="margin-top:16px">
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">DEPÓSITO / SEÑAL ONLINE (€)</label>
            <input type="number" class="act-form-input" id="mat-deposit" value="${item.deposit ?? 5}" step="0.01" min="0" />
            <small class="act-form-hint">Se cobra online al reservar. El resto se paga al recoger o desde la cuenta del cliente.</small>
          </div>
          ${stockBlock}
        </div>
      </div>`;
  }

  function renderTallasTab(item, hasUnits) {
    // Ítems con inventario por unidad: las tallas salen del inventario (no se editan a mano aquí)
    if (hasUnits) {
      const sizes = item._unitStock.sizes;
      const keys = Object.keys(sizes).sort(compareSizes);
      return `
        <h3 class="act-detail-section-title">Tallas / Unidades</h3>
        <div class="act-form-card">
          <small class="act-form-hint" style="margin-bottom:16px;display:block">Las tallas y el stock se calculan automáticamente desde las unidades del Inventario. El cliente verá solo las tallas con unidades disponibles.</small>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Talla</th><th>Disponibles</th><th>En total</th></tr></thead>
              <tbody>
                ${keys.map(k => `<tr>
                  <td><strong>${esc(k)}</strong></td>
                  <td>${sizes[k].disponible}</td>
                  <td>${sizes[k].total}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <button class="tar-add-tier-btn" id="mat-go-inventory" style="margin-top:14px">Gestionar unidades en Inventario →</button>
        </div>`;
    }

    const sizes = item.sizes || [];
    const isSized = item.type === 'con_talla';

    if (!isSized) {
      return `
        <h3 class="act-detail-section-title">Tallas / Variantes</h3>
        <div class="act-form-card">
          <div class="admin-empty" style="padding:30px">
            <p>Este material es de tipo <strong>Básico</strong> y no tiene variantes de talla.</p>
            <p style="font-size:.85rem;margin-top:8px">Cambia el tipo a "Con talla" en la pestaña Descripción, o asigna unidades de inventario a este material.</p>
          </div>
        </div>`;
    }

    return `
      <h3 class="act-detail-section-title">Tallas / Variantes</h3>
      <div class="act-form-card">
        <small class="act-form-hint" style="margin-bottom:16px;display:block">Este material no tiene inventario por unidad. Define las tallas manualmente; el cliente elegirá una al reservar.</small>
        <div id="mat-sizes-list" class="mat-sizes-list">
          ${sizes.map((s, i) => `
            <div class="mat-size-row" data-index="${i}">
              <input type="text" class="act-form-input mat-size-input" value="${esc(s)}" placeholder="Ej: M, L, 7'0..." />
              <button class="mat-size-remove" data-index="${i}" title="Eliminar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
        <button class="tar-add-tier-btn" id="mat-add-size" style="margin-top:12px">+ Añadir talla</button>
      </div>`;
  }

  async function loadReservasTab(item) {
    const el = container.querySelector('#mat-tab-content');
    try {
      const reservations = await fetchEquipmentReservations(item.id);

      if (!reservations.length) {
        el.innerHTML = `
          <h3 class="act-detail-section-title">Reservas</h3>
          <div class="act-form-card">
            <div class="admin-empty"><p>No hay reservas para este material</p></div>
          </div>`;
        return;
      }

      const rows = reservations.map(r => `<tr>
        <td>${formatDate(r.date_start)}</td>
        <td>${formatDate(r.date_end)}</td>
        <td>${r.size || '—'}</td>
        <td>${r.quantity}</td>
        <td>${formatCurrency(r.total_amount)}</td>
        <td>${r.guest_name || '—'}</td>
        <td><span class="admin-badge" data-status="${r.status}">${{
          pending: 'Pendiente', confirmed: 'Confirmada', active: 'Activa', returned: 'Devuelto', cancelled: 'Cancelada'
        }[r.status] || r.status}</span></td>
      </tr>`).join('');

      el.innerHTML = `
        <h3 class="act-detail-section-title">Reservas (${reservations.length})</h3>
        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Desde</th><th>Hasta</th><th>Talla</th><th>Cant.</th><th>Total</th><th>Cliente</th><th>Estado</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error: ${esc(err.message)}</p></div>`;
    }
  }

  // ===================== SAVE =====================
  // silent: auto-guardado al cambiar de pestaña — sin toast ni repintado,
  // y propaga el error para que el llamador decida si mueve de pestaña.
  async function saveItem(item, { silent = false } = {}) {
    // Read from DOM if available, otherwise keep existing value
    const name = container.querySelector('#mat-name')?.value?.trim() || item.name;
    const type = container.querySelector('#mat-type')?.value || item.type;
    const description = container.querySelector('#mat-description')?.value?.trim() ?? item.description;
    const image_url = container.querySelector('#mat-image')?.value?.trim() || item.image_url;
    const tagsStr = container.querySelector('#mat-tags')?.value;
    const deposit = container.querySelector('#mat-deposit')
      ? parseFloat(container.querySelector('#mat-deposit').value)
      : item.deposit;
    const stock = container.querySelector('#mat-stock')
      ? parseInt(container.querySelector('#mat-stock').value)
      : item.stock;

    // Pricing — only read from DOM if pricing inputs exist
    const pricingInputs = container.querySelectorAll('.mat-pricing-input');
    let pricing = item.pricing || {};
    if (pricingInputs.length) {
      pricing = {};
      pricingInputs.forEach(input => {
        const val = parseFloat(input.value) || 0;
        if (val > 0) pricing[input.dataset.key] = val;
      });
    }

    // Custom pricing rows
    const customRows = container.querySelectorAll('.mat-custom-dur-row');
    if (customRows.length) {
      customRows.forEach(row => {
        const label = row.querySelector('.mat-dur-label')?.value?.trim();
        const price = parseFloat(row.querySelector('.mat-dur-price')?.value) || 0;
        if (label && price > 0) pricing[label] = price;
      });
    }

    // Sizes — solo si el ítem NO usa inventario por unidad (si lo usa, las tallas
    // salen del inventario y no deben sobreescribirse desde aquí).
    const usesUnits = !!(item._unitStock && item._unitStock.count > 0);
    const sizeInputs = container.querySelectorAll('.mat-size-input');
    let sizes = item.sizes || [];
    if (!usesUnits && (sizeInputs.length || activeTab === 'tallas')) {
      sizes = Array.from(sizeInputs).map(i => i.value.trim()).filter(Boolean);
    }

    if (!name) {
      if (silent) throw new Error('El nombre es obligatorio');
      showToast('El nombre es obligatorio', 'error');
      return;
    }

    const tags = tagsStr != null ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : (item.tags || []);
    const slug = item.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const obj = {
      name, slug, type: type || 'basico', description: description || null,
      image_url: image_url || null, pricing, deposit: deposit ?? 5, stock: stock || 0,
      sizes, tags, active: item.active,
    };

    if (item.id) obj.id = item.id;

    try {
      const saved = await upsertEquipment(obj);
      if (!item.id) {
        if (!silent) { showToast('Material creado', 'success'); renderList(); }
      } else {
        Object.assign(item, saved || obj);
        if (!silent) { showToast('Material guardado', 'success'); renderDetail(); }
      }
      return true;
    } catch (err) {
      if (silent) throw err;
      showToast('Error: ' + err.message, 'error');
      return false;
    }
  }

  // ===================== SIZE MANAGEMENT (delegated events) =====================
  container.addEventListener('click', (e) => {
    // Add size
    if (e.target.closest('#mat-add-size')) {
      const list = container.querySelector('#mat-sizes-list');
      if (!list) return;
      const idx = list.children.length;
      const div = document.createElement('div');
      div.className = 'mat-size-row';
      div.dataset.index = idx;
      div.innerHTML = `
        <input type="text" class="act-form-input mat-size-input" value="" placeholder="Ej: M, L, 7'0..." />
        <button class="mat-size-remove" data-index="${idx}" title="Eliminar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
      list.appendChild(div);
      div.querySelector('input').focus();
      return;
    }

    // Remove size
    const removeBtn = e.target.closest('.mat-size-remove');
    if (removeBtn) {
      removeBtn.closest('.mat-size-row')?.remove();
      return;
    }

    // Add custom duration
    if (e.target.closest('#mat-add-duration')) {
      const customArea = container.querySelector('#mat-custom-durations');
      if (!customArea) return;
      const div = document.createElement('div');
      div.className = 'mat-custom-dur-row';
      div.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:8px';
      div.innerHTML = `
        <div class="act-form-field" style="flex:1;margin:0">
          <label class="act-form-label">NOMBRE</label>
          <input type="text" class="act-form-input mat-dur-label" placeholder="Ej: 3 días, 2 semanas..." />
        </div>
        <div class="act-form-field" style="flex:1;margin:0">
          <label class="act-form-label">PRECIO (€)</label>
          <input type="number" class="act-form-input mat-dur-price" value="0" step="0.01" min="0" />
        </div>
        <button class="mat-dur-remove-custom" title="Eliminar" style="padding:8px;cursor:pointer;background:none;border:none;margin-bottom:4px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
      customArea.appendChild(div);
      div.querySelector('.mat-dur-label').focus();
      return;
    }

    // Remove custom duration row
    if (e.target.closest('.mat-dur-remove-custom')) {
      e.target.closest('.mat-custom-dur-row')?.remove();
      return;
    }

    // Remove standard duration with price
    if (e.target.closest('.mat-dur-remove')) {
      e.target.closest('.mat-dur-row')?.remove();
      return;
    }
  });

  if (view === 'inventario') await renderInventory();
  else await renderList();
}
