/* ============================================================
   Control Horario — Rejilla semanal de monitores (tipo Excel)
   ------------------------------------------------------------
   · Monitores = lista propia (no cuentas). Categoría 'monitor'
     (pago por horas) o 'carpa' (pago fijo por día: corto/largo/trabaja).
   · Rejilla: fechas en filas, monitores en columnas, editable,
     con TOTAL y PAGO por semana. Navegable por semanas + filtros.
   Acceso: admin + encargado (sección 'control-horario').
   ============================================================ */
import { openModal, closeModal, showToast, formatCurrency } from '../modules/ui.js';
import { isAdmin } from '../modules/auth.js';
import { supabase } from '/lib/supabase.js';

const esc = (s) => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAY_TYPE_OPTS = [
  { v: 'dia_corto', label: 'Día corto' },
  { v: 'dia_largo', label: 'Día largo' },
  { v: 'trabaja', label: 'Trabaja' },
  { v: 'fija', label: 'Fija' },
];

/* ---- Helpers de fecha (semana europea Lun→Dom) ---- */
function getDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getWeekDates(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const out = [];
  for (let i = 0; i < 7; i++) { const dd = new Date(monday); dd.setDate(monday.getDate() + i); out.push(dd); }
  return out;
}
function fmtHours(h) { return (Math.round(h * 100) / 100).toLocaleString('es-ES', { maximumFractionDigits: 2 }); }

/* ---- API ---- */
function isSchemaMissing(error) {
  if (!error) return false;
  const code = error.code || '';
  if (['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code)) return true;
  return /does not exist|schema cache|could not find/i.test(error.message || '');
}
async function fetchMonitors() {
  const { data, error } = await supabase.from('monitors')
    .select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}
async function fetchMonitorShifts(from, to) {
  const { data, error } = await supabase.from('monitor_shifts')
    .select('*').gte('work_date', from).lte('work_date', to);
  if (error) throw error;
  return data || [];
}
async function fetchPayroll() {
  const { data, error } = await supabase.from('payroll_config').select('dia_corto, dia_largo, dia_trabaja').eq('id', 1).maybeSingle();
  if (error && !isSchemaMissing(error)) throw error;
  return data || { dia_corto: 63, dia_largo: 70, dia_trabaja: 36 };
}
async function saveCell(monitor_id, work_date, pay_type, hours) {
  // Vacío → borrar la celda
  if (!pay_type || (pay_type === 'hora' && (hours === '' || hours == null))) {
    const { error } = await supabase.from('monitor_shifts').delete().eq('monitor_id', monitor_id).eq('work_date', work_date);
    if (error) throw error; return;
  }
  const row = { monitor_id, work_date, pay_type, hours: pay_type === 'hora' ? Number(hours) : null };
  const { error } = await supabase.from('monitor_shifts').upsert(row, { onConflict: 'monitor_id,work_date' });
  if (error) throw error;
}

/* ============================================================ */
export async function renderControlHorario(container) {
  let currentDate = new Date(); currentDate.setHours(0, 0, 0, 0);
  let catFilter = '';       // '' | 'monitor' | 'carpa'
  let search = '';
  let monitors = [], shifts = [], payroll = { dia_corto: 63, dia_largo: 70, dia_trabaja: 36 };

  const rateOf = (m) => m.hourly_rate != null ? Number(m.hourly_rate) : 0;
  function dayRate(pt, m) {
    if (pt === 'dia_corto') return Number(payroll.dia_corto) || 0;
    if (pt === 'dia_largo') return Number(payroll.dia_largo) || 0;
    if (pt === 'trabaja') return Number(payroll.dia_trabaja) || 0;
    if (pt === 'fija') return m?.fixed_rate != null ? Number(m.fixed_rate) : 0;
    return 0;
  }
  function shiftPago(s, m) {
    if (!s) return 0;
    if (s.pay_type === 'hora') return (Number(s.hours) || 0) * rateOf(m);
    return dayRate(s.pay_type, m);
  }

  async function render() {
    const wk = getWeekDates(currentDate);
    const from = getDateStr(wk[0]), to = getDateStr(wk[6]);
    try {
      [monitors, shifts, payroll] = await Promise.all([fetchMonitors(), fetchMonitorShifts(from, to), fetchPayroll()]);
    } catch (err) {
      if (isSchemaMissing(err)) {
        container.innerHTML = `<div class="admin-empty"><p><strong>Falta aplicar la migración de monitores.</strong><br>Ejecuta <code>supabase/migration-monitores.sql</code> en el SQL Editor de Supabase y recarga la página.</p></div>`;
      } else {
        container.innerHTML = `<div class="admin-empty"><p>Error al cargar: ${esc(err.message)}</p></div>`;
      }
      return;
    }

    // Columnas (monitores) según filtros
    let cols = monitors.filter(m => m.active);
    if (catFilter) cols = cols.filter(m => m.category === catFilter);
    if (search) cols = cols.filter(m => (m.name || '').toLowerCase().includes(search.toLowerCase()));

    const todayStr = getDateStr(new Date());
    const rangeLabel = `${wk[0].getDate()} – ${wk[6].getDate()} ${MONTH_NAMES[wk[6].getMonth()]} ${wk[6].getFullYear()}`;
    // Lookup de turnos: monitor|fecha → shift
    const map = {};
    shifts.forEach(s => { map[`${s.monitor_id}|${s.work_date}`] = s; });

    // ---- Cabecera de columnas ----
    const headCols = cols.map(m => `<th class="mon-col-head ${m.category === 'carpa' ? 'is-carpa' : ''}" title="${esc(m.name)}">${esc(m.name)}</th>`).join('');

    // ---- Filas por día ----
    const bodyRows = wk.map((d, i) => {
      const ds = getDateStr(d);
      const isToday = ds === todayStr;
      const cells = cols.map(m => {
        const s = map[`${m.id}|${ds}`];
        if (m.category === 'carpa') {
          const opts = `<option value="">—</option>` + DAY_TYPE_OPTS.map(o =>
            `<option value="${o.v}" ${s && s.pay_type === o.v ? 'selected' : ''}>${o.label}</option>`).join('');
          return `<td><select class="mon-cell mon-cell-sel" data-mid="${m.id}" data-date="${ds}">${opts}</select></td>`;
        }
        const val = s && s.pay_type === 'hora' && s.hours != null ? s.hours : '';
        return `<td><input type="number" min="0" step="0.5" class="mon-cell mon-cell-num" data-mid="${m.id}" data-date="${ds}" value="${val}" placeholder=""></td>`;
      }).join('');
      return `<tr class="${isToday ? 'is-today' : ''}">
        <th class="mon-day-head">${DAY_NAMES[i]} <span class="mon-day-num">${d.getDate()}</span></th>
        ${cells}
      </tr>`;
    }).join('');

    // ---- Fila TOTAL ----
    const totalCells = cols.map(m => {
      const dayShifts = wk.map(d => map[`${m.id}|${getDateStr(d)}`]).filter(Boolean);
      if (m.category === 'carpa') {
        const c = dayShifts.filter(s => s.pay_type === 'dia_corto').length;
        const l = dayShifts.filter(s => s.pay_type === 'dia_largo').length;
        const t = dayShifts.filter(s => s.pay_type === 'trabaja').length;
        const f = dayShifts.filter(s => s.pay_type === 'fija').length;
        const parts = [c && `${c}C`, l && `${l}L`, t && `${t}T`, f && `${f}F`].filter(Boolean).join(' ');
        return `<td class="mon-total-cell">${parts || '·'}</td>`;
      }
      const h = dayShifts.reduce((a, s) => a + (Number(s.hours) || 0), 0);
      return `<td class="mon-total-cell">${h > 0 ? fmtHours(h) + ' h' : '·'}</td>`;
    }).join('');

    // ---- Fila PAGO ----
    let grandTotal = 0;
    const pagoCells = cols.map(m => {
      const dayShifts = wk.map(d => map[`${m.id}|${getDateStr(d)}`]).filter(Boolean);
      const pago = dayShifts.reduce((a, s) => a + shiftPago(s, m), 0);
      grandTotal += pago;
      return `<td class="mon-pago-cell">${pago > 0 ? formatCurrency(pago) : '·'}</td>`;
    }).join('');

    container.innerHTML = `
      <div class="mon-page">
        <div class="ch-topbar">
          <div class="ch-nav">
            <button class="ch-nav-arrow" id="mon-prev" title="Semana anterior">‹</button>
            <button class="ch-today-btn" id="mon-today">Hoy</button>
            <button class="ch-nav-arrow" id="mon-next" title="Semana siguiente">›</button>
            <label class="ch-date-pick" title="Ir a una fecha">
              <span class="ch-date-ico" aria-hidden="true">📅</span>
              <input type="date" id="mon-date" value="${getDateStr(currentDate)}">
            </label>
          </div>
          <div class="ch-range">${rangeLabel}</div>
          <div class="ch-actions">
            <select id="mon-cat" class="mon-filter">
              <option value="" ${!catFilter ? 'selected' : ''}>Todas las categorías</option>
              <option value="monitor" ${catFilter === 'monitor' ? 'selected' : ''}>Monitores (horas)</option>
              <option value="carpa" ${catFilter === 'carpa' ? 'selected' : ''}>Carpa (día)</option>
            </select>
            <input type="search" id="mon-search" class="mon-filter" placeholder="Buscar monitor…" value="${esc(search)}">
            ${isAdmin() ? '<button class="btn line" id="mon-manage">Monitores</button><button class="btn line" id="mon-rates">Tarifas</button>' : ''}
          </div>
        </div>

        ${cols.length === 0 ? `<div class="admin-empty"><p>${monitors.length ? 'Ningún monitor con ese filtro.' : 'No hay monitores. Pulsa "Monitores" para añadirlos.'}</p></div>` : `
        <div class="mon-grid-wrap">
          <table class="mon-grid">
            <thead><tr><th class="mon-corner">Semana</th>${headCols}</tr></thead>
            <tbody>${bodyRows}</tbody>
            <tfoot>
              <tr class="mon-total-row"><th class="mon-day-head">TOTAL</th>${totalCells}</tr>
              <tr class="mon-pago-row"><th class="mon-day-head">PAGO</th>${pagoCells}</tr>
            </tfoot>
          </table>
        </div>
        <div class="mon-grandtotal">Total semana: <strong>${formatCurrency(grandTotal)}</strong></div>
        <div class="mon-legend">C = día corto · L = día largo · T = trabaja · F = fija</div>`}
      </div>`;

    bindEvents();
  }

  function bindEvents() {
    container.querySelector('#mon-prev')?.addEventListener('click', () => { currentDate.setDate(currentDate.getDate() - 7); render(); });
    container.querySelector('#mon-next')?.addEventListener('click', () => { currentDate.setDate(currentDate.getDate() + 7); render(); });
    container.querySelector('#mon-today')?.addEventListener('click', () => { currentDate = new Date(); currentDate.setHours(0, 0, 0, 0); render(); });
    container.querySelector('#mon-date')?.addEventListener('change', (e) => {
      const v = e.target.value; if (!v) return;
      const [y, m, d] = v.split('-').map(Number);
      currentDate = new Date(y, m - 1, d); currentDate.setHours(0, 0, 0, 0);
      render();
    });
    container.querySelector('#mon-cat')?.addEventListener('change', (e) => { catFilter = e.target.value; render(); });
    const searchEl = container.querySelector('#mon-search');
    if (searchEl) {
      let t = null;
      searchEl.addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => { search = v; render(); }, 300); });
    }
    container.querySelector('#mon-manage')?.addEventListener('click', openMonitorsModal);
    container.querySelector('#mon-rates')?.addEventListener('click', openRatesModal);

    // Celdas: guardar al cambiar
    container.querySelectorAll('.mon-cell-num').forEach(inp => {
      inp.addEventListener('change', async () => {
        try { await saveCell(inp.dataset.mid, inp.dataset.date, 'hora', inp.value); await render(); }
        catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });
    container.querySelectorAll('.mon-cell-sel').forEach(sel => {
      sel.addEventListener('change', async () => {
        try { await saveCell(sel.dataset.mid, sel.dataset.date, sel.value, null); await render(); }
        catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });
  }

  /* ---- Modal: gestionar monitores ---- */
  function openMonitorsModal() {
    const rows = monitors.map(m => `
      <div class="mon-row" data-id="${m.id}">
        <input type="text" class="act-form-input mon-m-name" value="${esc(m.name)}" placeholder="Nombre" style="flex:2">
        <select class="act-form-input mon-m-cat" style="flex:1">
          <option value="monitor" ${m.category === 'monitor' ? 'selected' : ''}>Monitor (horas)</option>
          <option value="carpa" ${m.category === 'carpa' ? 'selected' : ''}>Carpa (día)</option>
        </select>
        <input type="number" min="0" step="0.5" class="act-form-input mon-m-rate" value="${m.hourly_rate ?? ''}" placeholder="€/h" title="€/h (solo categoría monitor)" style="width:80px">
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem"><input type="checkbox" class="mon-m-active" ${m.active ? 'checked' : ''}>Activo</label>
      </div>`).join('');
    openModal('Monitores', `
      <p class="ch-rates-hint">Lista de monitores. El €/h solo aplica a categoría "Monitor". Los de "Carpa" se pagan por día (tarifas en el botón Tarifas).</p>
      <div class="mon-rows-list">${rows}</div>
      <div class="mon-row" style="margin-top:8px;border-top:1px dashed #e2e8f0;padding-top:10px">
        <input type="text" class="act-form-input" id="mon-new-name" placeholder="Nuevo monitor…" style="flex:2">
        <select class="act-form-input" id="mon-new-cat" style="flex:1"><option value="monitor">Monitor (horas)</option><option value="carpa">Carpa (día)</option></select>
        <input type="number" min="0" step="0.5" class="act-form-input" id="mon-new-rate" placeholder="€/h" style="width:80px">
        <button type="button" class="btn line" id="mon-add">Añadir</button>
      </div>
      <div class="ch-form-actions">
        <button type="button" class="btn line" id="mon-cancel">Cerrar</button>
        <button type="button" class="btn red" id="mon-save">Guardar cambios</button>
      </div>`);

    document.getElementById('mon-add').addEventListener('click', async () => {
      const name = document.getElementById('mon-new-name').value.trim();
      if (!name) { showToast('Escribe un nombre', 'error'); return; }
      const category = document.getElementById('mon-new-cat').value;
      const rateStr = document.getElementById('mon-new-rate').value;
      try {
        await supabase.from('monitors').insert({
          name, category, default_pay_type: category === 'carpa' ? 'dia_corto' : 'hora',
          hourly_rate: category === 'monitor' && rateStr !== '' ? Number(rateStr) : null,
          sort_order: monitors.length,
        });
        showToast('Monitor añadido', 'success'); closeModal(); await render(); openMonitorsModal();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
    document.getElementById('mon-cancel').addEventListener('click', closeModal);
    document.getElementById('mon-save').addEventListener('click', async () => {
      const btn = document.getElementById('mon-save'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        for (const row of document.querySelectorAll('.mon-row[data-id]')) {
          const id = row.dataset.id;
          const name = row.querySelector('.mon-m-name').value.trim();
          const category = row.querySelector('.mon-m-cat').value;
          const rateStr = row.querySelector('.mon-m-rate').value;
          const active = row.querySelector('.mon-m-active').checked;
          await supabase.from('monitors').update({
            name, category, active,
            hourly_rate: category === 'monitor' && rateStr !== '' ? Number(rateStr) : null,
          }).eq('id', id);
        }
        showToast('Monitores guardados', 'success'); closeModal(); await render();
      } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Guardar cambios'; }
    });
  }

  /* ---- Modal: tarifas globales de día (corto/largo/trabaja) ---- */
  function openRatesModal() {
    openModal('Tarifas de día', `
      <p class="ch-rates-hint">Importe fijo por día para la categoría "Carpa". El €/h de cada monitor se edita en el botón Monitores.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="act-form-field" style="flex:1;min-width:120px"><label class="act-form-label">DÍA CORTO €</label><input type="number" min="0" step="0.5" class="act-form-input" id="mon-r-corto" value="${Number(payroll.dia_corto)}"></div>
        <div class="act-form-field" style="flex:1;min-width:120px"><label class="act-form-label">DÍA LARGO €</label><input type="number" min="0" step="0.5" class="act-form-input" id="mon-r-largo" value="${Number(payroll.dia_largo)}"></div>
        <div class="act-form-field" style="flex:1;min-width:120px"><label class="act-form-label">TRABAJA €</label><input type="number" min="0" step="0.5" class="act-form-input" id="mon-r-trab" value="${Number(payroll.dia_trabaja)}"></div>
      </div>
      <div class="ch-form-actions">
        <button type="button" class="btn line" id="mon-r-cancel">Cancelar</button>
        <button type="button" class="btn red" id="mon-r-save">Guardar tarifas</button>
      </div>`);
    document.getElementById('mon-r-cancel').addEventListener('click', closeModal);
    document.getElementById('mon-r-save').addEventListener('click', async () => {
      const btn = document.getElementById('mon-r-save'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await supabase.from('payroll_config').update({
          dia_corto: Number(document.getElementById('mon-r-corto').value) || 0,
          dia_largo: Number(document.getElementById('mon-r-largo').value) || 0,
          dia_trabaja: Number(document.getElementById('mon-r-trab').value) || 0,
          updated_at: new Date().toISOString(),
        }).eq('id', 1);
        showToast('Tarifas guardadas', 'success'); closeModal(); await render();
      } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Guardar tarifas'; }
    });
  }

  await render();
}
