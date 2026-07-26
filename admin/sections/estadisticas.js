/* ============================================================
   Estadísticas — Tabs: Resumen · Cobrado · Pendiente
   Cobrado/Resumen: cifras clicables → drill-down con clientes.
   ============================================================ */
import {
  fetchPaymentsFiltered,
  enrichPaymentsWithClient,
  fetchPendingBookings, fetchPendingRentals, fetchPendingOrders, fetchPendingBonos, fetchPendingEnrollments,
  deletePayment, deleteReservationFully,
} from '../modules/api.js';
import { formatCurrency, showToast } from '../modules/ui.js';
import { openPaymentEditModal } from '../modules/payment-edit.js';

const esc = (s) => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CHANNEL_LABELS = { web: 'Web', in_person: 'Presencial (playa)' };
const METHOD_LABELS = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  voucher: 'Voucher', saldo: 'Saldo', online: 'Online (Stripe)',
};
const TYPE_LABELS = {
  enrollment: 'Clases', booking: 'Surf camps', order: 'Tienda',
  bono: 'Bonos', rental: 'Alquiler', custom: 'Custom',
};
const ENTITY_LABELS = {
  all: 'Todas',
  booking: 'Surf camps',
  rental: 'Alquileres material',
  order: 'Pedidos tienda',
  bono: 'Bonos / clases',
  enrollment: 'Clases sueltas (manual)',
};

function pad(n) { return String(n).padStart(2, '0'); }
function fmtYMD(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
}
function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function loadState() {
  try { return JSON.parse(localStorage.getItem('eos_estad_state') || '{}'); } catch { return {}; }
}
function saveState(s) { localStorage.setItem('eos_estad_state', JSON.stringify(s)); }

function defaultDates() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: fmtYMD(monthStart), to: fmtYMD(now) };
}

const TABS = [
  { id: 'resumen',   label: 'Resumen' },
  { id: 'cobrado',   label: 'Cobrado' },
  { id: 'pendiente', label: 'Pendiente' },
];

export async function renderEstadisticas(container) {
  const saved = loadState();
  const defaults = defaultDates();
  const validTabIds = TABS.map(t => t.id);
  const state = {
    tab:        validTabIds.includes(saved.tab) ? saved.tab : 'resumen',
    dateFrom:   saved.dateFrom   || defaults.from,
    dateTo:     saved.dateTo     || defaults.to,
    channel:    saved.channel    || 'all',
    method:     saved.method     || 'all',
    type:       saved.type       || 'all',
    pendingEnt: saved.pendingEnt || 'all',
  };

  function persist() { saveState(state); }

  // Cache de pagos enriquecidos por rango+filtros para evitar re-fetch en drill-down
  let cachedFiltered = null;
  let cachedEnriched = null;
  let cachedKey = '';

  async function fetchAndEnrich() {
    const key = JSON.stringify({ f: state.dateFrom, t: state.dateTo, c: state.channel, m: state.method, ty: state.type });
    if (cachedKey === key && cachedEnriched) return cachedEnriched;
    cachedFiltered = await fetchPaymentsFiltered({
      dateFrom: state.dateFrom, dateTo: state.dateTo,
      channel: state.channel, paymentMethod: state.method, reservationType: state.type,
    });
    cachedEnriched = await enrichPaymentsWithClient(cachedFiltered);
    cachedKey = key;
    return cachedEnriched;
  }

  function invalidateCache() { cachedKey = ''; cachedEnriched = null; }

  async function renderShell() {
    container.innerHTML = `
      <div class="estad-toolbar">
        <div class="estad-date-range">
          <div class="estad-presets">
            ${['Hoy', 'Semana', 'Mes', 'Trimestre', 'Año'].map(p => `
              <button class="estad-preset-btn" data-preset="${p.toLowerCase()}">${p}</button>
            `).join('')}
          </div>
          <div class="estad-custom-range">
            <input type="date" id="estad-from" value="${state.dateFrom}" />
            <span>—</span>
            <input type="date" id="estad-to" value="${state.dateTo}" />
          </div>
        </div>
      </div>

      <div class="estad-tabs">
        ${TABS.map(t => `
          <button class="estad-tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>
        `).join('')}
      </div>

      <div class="estad-tab-content" id="estad-content">
        <div class="estad-loading">Cargando…</div>
      </div>
    `;

    container.querySelectorAll('.estad-tab').forEach(b => {
      b.addEventListener('click', () => {
        state.tab = b.dataset.tab;
        persist();
        container.querySelectorAll('.estad-tab').forEach(x => x.classList.toggle('active', x === b));
        renderTab();
      });
    });

    container.querySelector('#estad-from').addEventListener('change', (e) => { state.dateFrom = e.target.value; invalidateCache(); persist(); renderTab(); });
    container.querySelector('#estad-to').addEventListener('change',   (e) => { state.dateTo   = e.target.value; invalidateCache(); persist(); renderTab(); });

    container.querySelectorAll('.estad-preset-btn').forEach(b => {
      b.addEventListener('click', () => {
        const d = presetDates(b.dataset.preset);
        state.dateFrom = d.from; state.dateTo = d.to;
        container.querySelector('#estad-from').value = d.from;
        container.querySelector('#estad-to').value = d.to;
        invalidateCache(); persist(); renderTab();
      });
    });

    await renderTab();
  }

  async function renderTab() {
    const content = container.querySelector('#estad-content');
    content.innerHTML = `<div class="estad-loading">Cargando…</div>`;
    try {
      if (state.tab === 'resumen')   await renderResumen(content);
      if (state.tab === 'cobrado')   await renderCobrado(content);
      if (state.tab === 'pendiente') await renderPendiente(content);
    } catch (err) {
      content.innerHTML = `<p style="color:#ef4444;padding:18px">Error: ${esc(err.message)}</p>`;
      console.error(err);
    }
  }

  // ============================================================
  // RESUMEN
  // ============================================================
  async function renderResumen(el) {
    // Resumen usa la versión sin filtros de channel/method/type
    const payments = await fetchPaymentsFiltered({ dateFrom: state.dateFrom, dateTo: state.dateTo });

    const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const byCh  = { web: 0, in_person: 0 };
    payments.forEach(p => { byCh[p.channel || 'in_person'] += Number(p.amount || 0); });
    const txCount = payments.length;
    const ticket  = txCount > 0 ? total / txCount : 0;
    const webPct  = total > 0 ? Math.round((byCh.web / total) * 100) : 0;

    el.innerHTML = `
      <div class="estad-kpis">
        <div class="estad-kpi estad-kpi-primary">
          <div class="estad-kpi-label">Cobrado en el período</div>
          <div class="estad-kpi-value">${formatCurrency(total)}</div>
          <div class="estad-kpi-sub">${txCount} transacciones · ticket medio ${formatCurrency(ticket)}</div>
        </div>
        <div class="estad-kpi estad-kpi-clickable" data-drill="channel:web">
          <div class="estad-kpi-label">Web</div>
          <div class="estad-kpi-value">${formatCurrency(byCh.web)}</div>
          <div class="estad-kpi-sub">${webPct}% del total · ver pagos →</div>
        </div>
        <div class="estad-kpi estad-kpi-clickable" data-drill="channel:in_person">
          <div class="estad-kpi-label">Presencial (playa)</div>
          <div class="estad-kpi-value">${formatCurrency(byCh.in_person)}</div>
          <div class="estad-kpi-sub">${100 - webPct}% del total · ver pagos →</div>
        </div>
      </div>

      <div class="estad-resumen-breakdown">
        <h4>Reparto por método de pago</h4>
        ${renderBreakdown(payments, 'payment_method', METHOD_LABELS)}
      </div>

      <div class="estad-resumen-breakdown">
        <h4>Reparto por tipo</h4>
        ${renderBreakdown(payments, 'reservation_type', TYPE_LABELS)}
      </div>

      <div id="estad-resumen-drill"></div>
    `;

    // KPI cards clicables → drill-down de canal
    el.querySelectorAll('[data-drill]').forEach(card => {
      card.addEventListener('click', async () => {
        const [field, value] = card.dataset.drill.split(':');
        await renderDrill(el.querySelector('#estad-resumen-drill'), field, value);
      });
    });

    // Barras del breakdown clicables (data-drill="payment_method:efectivo", etc.)
    el.querySelectorAll('.estad-bar-item[data-drill]').forEach(item => {
      item.addEventListener('click', async () => {
        const [field, value] = item.dataset.drill.split(':');
        await renderDrill(el.querySelector('#estad-resumen-drill'), field, value);
      });
    });
  }

  async function renderDrill(targetEl, field, value) {
    targetEl.innerHTML = `<div class="estad-loading">Cargando pagos…</div>`;
    const all = await fetchPaymentsFiltered({ dateFrom: state.dateFrom, dateTo: state.dateTo });
    const filtered = all.filter(p => (p[field] || 'in_person') === value);
    const enriched = await enrichPaymentsWithClient(filtered);

    const labelMap = field === 'channel' ? CHANNEL_LABELS
      : field === 'payment_method' ? METHOD_LABELS
      : field === 'reservation_type' ? TYPE_LABELS : {};

    const total = enriched.reduce((s, p) => s + Number(p.amount || 0), 0);

    targetEl.innerHTML = `
      <div class="estad-drill">
        <div class="estad-drill-head">
          <h4>Pagos · ${esc(labelMap[value] || value)} <small>(${enriched.length} · ${formatCurrency(total)})</small></h4>
          <button class="estad-drill-close" title="Cerrar">&times;</button>
        </div>
        ${enriched.length ? renderPaymentsTable(enriched) : '<p class="estad-empty">Sin pagos en esta categoría</p>'}
      </div>
    `;
    targetEl.querySelector('.estad-drill-close').addEventListener('click', () => { targetEl.innerHTML = ''; });
    bindPaymentRowActions(targetEl, () => renderDrill(targetEl, field, value));
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ============================================================
  // COBRADO
  // ============================================================
  async function renderCobrado(el) {
    el.innerHTML = `
      <div class="estad-filters">
        ${filterSelect('estad-f-channel', 'Canal', state.channel, [
          { v: 'all', l: 'Web + Presencial' },
          { v: 'web', l: 'Solo web' },
          { v: 'in_person', l: 'Solo presencial (playa)' },
        ])}
        ${filterSelect('estad-f-method', 'Método', state.method, [
          { v: 'all', l: 'Todos los métodos' },
          ...Object.entries(METHOD_LABELS).map(([v, l]) => ({ v, l })),
        ])}
        ${filterSelect('estad-f-type', 'Tipo', state.type, [
          { v: 'all', l: 'Todos los tipos' },
          ...Object.entries(TYPE_LABELS).map(([v, l]) => ({ v, l })),
        ])}
      </div>
      <div id="estad-cobrado-body"><div class="estad-loading">Cargando…</div></div>
    `;

    el.querySelector('#estad-f-channel').addEventListener('change', (e) => { state.channel = e.target.value; invalidateCache(); persist(); renderCobradoBody(); });
    el.querySelector('#estad-f-method').addEventListener('change',  (e) => { state.method  = e.target.value; invalidateCache(); persist(); renderCobradoBody(); });
    el.querySelector('#estad-f-type').addEventListener('change',    (e) => { state.type    = e.target.value; invalidateCache(); persist(); renderCobradoBody(); });

    await renderCobradoBody();

    async function renderCobradoBody() {
      const body = el.querySelector('#estad-cobrado-body');
      body.innerHTML = `<div class="estad-loading">Cargando…</div>`;
      const enriched = await fetchAndEnrich();

      const total = enriched.reduce((s, p) => s + Number(p.amount || 0), 0);

      // Matriz channel × method
      const matrix = {};
      enriched.forEach(p => {
        const ch = p.channel || 'in_person';
        const mt = p.payment_method || 'otros';
        matrix[ch] = matrix[ch] || {};
        matrix[ch][mt] = (matrix[ch][mt] || []).concat(p);
      });

      const methods = [...new Set(enriched.map(p => p.payment_method))].filter(Boolean).sort();
      const channels = Object.keys(matrix);

      body.innerHTML = `
        <div class="estad-total-card">
          <span class="estad-total-label">Total filtrado</span>
          <span class="estad-total-value">${formatCurrency(total)}</span>
          <span class="estad-total-sub">${enriched.length} transacciones</span>
        </div>

        ${methods.length ? `
          <div class="estad-table-wrap">
            <table class="estad-table estad-matrix">
              <thead>
                <tr>
                  <th>Canal · Método</th>
                  ${methods.map(m => `<th>${esc(METHOD_LABELS[m] || m)}</th>`).join('')}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${channels.map(ch => {
                  const rowPayments = Object.values(matrix[ch]).flat();
                  const rowTotal = rowPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
                  return `
                    <tr>
                      <td><strong>${esc(CHANNEL_LABELS[ch] || ch)}</strong></td>
                      ${methods.map(m => {
                        const cell = matrix[ch][m] || [];
                        const cellTotal = cell.reduce((s, p) => s + Number(p.amount || 0), 0);
                        if (!cell.length) return '<td class="estad-num">—</td>';
                        return `<td class="estad-num estad-cell-clickable" data-ch="${esc(ch)}" data-mt="${esc(m)}">
                          <strong>${formatCurrency(cellTotal)}</strong>
                          <span class="estad-cell-count">${cell.length} pago${cell.length === 1 ? '' : 's'}</span>
                        </td>`;
                      }).join('')}
                      <td class="estad-num estad-cell-clickable" data-ch="${esc(ch)}" data-mt="all">
                        <strong>${formatCurrency(rowTotal)}</strong>
                        <span class="estad-cell-count">${rowPayments.length} pago${rowPayments.length === 1 ? '' : 's'}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <div id="estad-cobrado-drill"></div>
        ` : `<p class="estad-empty">Sin pagos para los filtros aplicados</p>`}
      `;

      body.querySelectorAll('.estad-cell-clickable').forEach(cell => {
        cell.addEventListener('click', () => {
          const ch = cell.dataset.ch;
          const mt = cell.dataset.mt;
          const subset = (matrix[ch] && (mt === 'all' ? Object.values(matrix[ch]).flat() : matrix[ch][mt])) || [];
          const drillEl = body.querySelector('#estad-cobrado-drill');
          renderCellDrill(drillEl, subset, ch, mt);
          drillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      });
    }

    function renderCellDrill(targetEl, payments, ch, mt) {
      const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      const titleParts = [CHANNEL_LABELS[ch] || ch];
      if (mt !== 'all') titleParts.push(METHOD_LABELS[mt] || mt);

      targetEl.innerHTML = `
        <div class="estad-drill">
          <div class="estad-drill-head">
            <h4>${esc(titleParts.join(' · '))} <small>(${payments.length} · ${formatCurrency(total)})</small></h4>
            <button class="estad-drill-close" title="Cerrar">&times;</button>
          </div>
          ${payments.length ? renderPaymentsTable(payments) : '<p class="estad-empty">Sin pagos</p>'}
        </div>
      `;
      targetEl.querySelector('.estad-drill-close').addEventListener('click', () => { targetEl.innerHTML = ''; });
      bindPaymentRowActions(targetEl, () => {
        invalidateCache();
        renderCobrado(el);
      });
    }
  }

  // ============================================================
  // PENDIENTE
  // ============================================================
  async function renderPendiente(el) {
    el.innerHTML = `
      <div class="estad-filters">
        ${filterSelect('estad-f-entity', 'Mostrar', state.pendingEnt, [
          { v: 'all', l: 'Todas las entidades' },
          { v: 'booking', l: 'Surf camps' },
          { v: 'rental', l: 'Alquileres' },
          { v: 'order', l: 'Pedidos tienda' },
          { v: 'bono', l: 'Bonos sin cobrar' },
          { v: 'enrollment', l: 'Clases sueltas (manual)' },
        ])}
      </div>
      <div id="estad-pendiente-body"><div class="estad-loading">Cargando…</div></div>
    `;

    el.querySelector('#estad-f-entity').addEventListener('change', (e) => {
      state.pendingEnt = e.target.value; persist(); renderPendienteBody();
    });

    await renderPendienteBody();

    async function renderPendienteBody() {
      const body = el.querySelector('#estad-pendiente-body');
      body.innerHTML = `<div class="estad-loading">Cargando…</div>`;

      const need = state.pendingEnt;
      const tasks = [];
      if (need === 'all' || need === 'booking') tasks.push(fetchPendingBookings().then(arr => ({ key: 'booking', arr })));
      if (need === 'all' || need === 'rental')  tasks.push(fetchPendingRentals().then(arr  => ({ key: 'rental',  arr })));
      if (need === 'all' || need === 'order')   tasks.push(fetchPendingOrders().then(arr   => ({ key: 'order',   arr })));
      if (need === 'all' || need === 'bono')    tasks.push(fetchPendingBonos().then(arr    => ({ key: 'bono',    arr })));
      if (need === 'all' || need === 'enrollment') tasks.push(fetchPendingEnrollments().then(arr => ({ key: 'enrollment', arr })));

      const results = await Promise.all(tasks);
      const sections = results.filter(r => r.arr.length > 0);

      if (!sections.length) {
        body.innerHTML = `<div class="estad-empty-card"><p>Sin pendientes de cobro</p></div>`;
        return;
      }

      const grandTotal = sections.reduce((s, sec) => s + sec.arr.reduce((acc, x) => acc + (x.pending || 0), 0), 0);

      body.innerHTML = `
        <div class="estad-total-card">
          <span class="estad-total-label">Total pendiente</span>
          <span class="estad-total-value">${formatCurrency(grandTotal)}</span>
        </div>

        ${sections.map(sec => `
          <div class="estad-pending-section">
            <h4 class="estad-pending-title">${esc(ENTITY_LABELS[sec.key] || sec.key)} <span class="estad-pending-count">${sec.arr.length}</span></h4>
            <div class="estad-table-wrap">
              <table class="estad-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    ${sec.key === 'rental' || sec.key === 'bono' || sec.key === 'booking' ? '<th>Concepto</th>' : ''}
                    <th>Fecha</th>
                    <th class="estad-num">Total</th>
                    <th class="estad-num">Pagado</th>
                    <th class="estad-num estad-pending-col">Pendiente</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${sec.arr.map(r => `
                    <tr data-rid="${esc(r.id)}" data-entity="${esc(sec.key)}">
                      <td>${esc(r.client)}</td>
                      <td>
                        ${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}
                        ${r.phone ? `<small style="display:block;color:var(--color-muted)">${esc(r.phone)}</small>` : ''}
                      </td>
                      ${sec.key === 'rental' || sec.key === 'bono' || sec.key === 'booking' ? `<td>${esc(r.meta || '')}</td>` : ''}
                      <td>${esc(fmtDate(r.created_at))}</td>
                      <td class="estad-num">${formatCurrency(r.total)}</td>
                      <td class="estad-num">${formatCurrency(r.paid)}</td>
                      <td class="estad-num estad-pending-col"><strong>${formatCurrency(r.pending)}</strong></td>
                      <td>${esc(r.status)}</td>
                      <td>
                        <button class="estad-icon-btn estad-icon-danger" data-del-reservation="${esc(r.id)}" data-entity="${esc(sec.key)}" title="Eliminar reserva">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      `;

      body.querySelectorAll('[data-del-reservation]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.delReservation;
          const entity = btn.dataset.entity;
          const labelByEntity = { booking: 'reserva de surf camp', rental: 'alquiler', order: 'pedido', bono: 'bono', enrollment: 'inscripción de clase' };
          if (!confirm(`¿Eliminar ${labelByEntity[entity] || 'reserva'} y todos sus pagos asociados? No se puede deshacer.`)) return;
          try {
            await deleteReservationFully(entity, id);
            showToast('Eliminado correctamente', 'success');
            await renderPendienteBody();
          } catch (err) {
            showToast('Error: ' + err.message, 'error');
          }
        });
      });
    }
  }

  // ============================================================
  // Helpers
  // ============================================================
  function renderPaymentsTable(payments) {
    return `
      <div class="estad-table-wrap">
        <table class="estad-table">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Cliente</th>
              <th>Canal</th>
              <th>Método</th>
              <th>Tipo</th>
              <th class="estad-num">Importe</th>
              <th>Concepto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${esc(fmtDateTime(p.payment_date))}</td>
                <td>
                  ${esc(p.client_name || '—')}
                  ${p.client_email ? `<small style="display:block;color:var(--color-muted)"><a href="mailto:${esc(p.client_email)}">${esc(p.client_email)}</a></small>` : ''}
                </td>
                <td><span class="estad-chip estad-chip-${p.channel || 'in_person'}">${esc(CHANNEL_LABELS[p.channel] || p.channel || '—')}</span></td>
                <td>${esc(METHOD_LABELS[p.payment_method] || p.payment_method || '—')}</td>
                <td>${esc(TYPE_LABELS[p.reservation_type] || p.reservation_type || '—')}</td>
                <td class="estad-num"><strong>${formatCurrency(p.amount)}</strong></td>
                <td><small>${esc(p.concept || '')}</small></td>
                <td style="white-space:nowrap">
                  <button class="estad-icon-btn" data-edit-payment="${esc(p.id)}" title="Editar pago">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="estad-icon-btn estad-icon-danger" data-del-payment="${esc(p.id)}" title="Eliminar pago">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function bindPaymentRowActions(scope, onChange) {
    scope.querySelectorAll('[data-del-payment]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.delPayment;
        if (!confirm('¿Eliminar este pago? La acción no se puede deshacer.')) return;
        try {
          await deletePayment(id);
          showToast('Pago eliminado', 'success');
          if (onChange) await onChange();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });
    });
    scope.querySelectorAll('[data-edit-payment]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.editPayment;
        // Buscar el payment enriquecido en cachedEnriched para pasárselo al modal
        const p = (cachedEnriched || []).find(x => x.id === id);
        if (!p) { showToast('Pago no encontrado', 'error'); return; }
        openPaymentEditModal(p, { onSaved: async () => { invalidateCache(); if (onChange) await onChange(); } });
      });
    });
  }

  function filterSelect(id, label, value, options) {
    return `
      <label class="estad-filter">
        <span>${esc(label)}</span>
        <select id="${id}">
          ${options.map(o => `<option value="${esc(o.v)}" ${o.v === value ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
        </select>
      </label>
    `;
  }

  function renderBreakdown(payments, field, labels) {
    const total = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    if (!total) return '<p class="estad-empty">Sin datos</p>';
    const agg = {};
    payments.forEach(p => {
      const k = p[field] || 'otros';
      agg[k] = (agg[k] || 0) + Number(p.amount || 0);
    });
    return `
      <div class="estad-bar-list">
        ${Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const pct = Math.round((v / total) * 100);
          return `
            <div class="estad-bar-item" data-drill="${esc(field)}:${esc(k)}" role="button" tabindex="0">
              <div class="estad-bar-label">
                <span>${esc(labels[k] || k)}</span>
                <span>${formatCurrency(v)} <small>(${pct}%)</small></span>
              </div>
              <div class="estad-bar-track"><div class="estad-bar-fill" style="width:${pct}%"></div></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function presetDates(preset) {
    const n = new Date();
    const y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
    switch (preset) {
      case 'hoy': return { from: fmtYMD(n), to: fmtYMD(n) };
      case 'semana': {
        const day = n.getDay();
        const mon = new Date(n); mon.setDate(d - (day === 0 ? 6 : day - 1));
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmtYMD(mon), to: fmtYMD(sun) };
      }
      case 'mes': {
        const last = new Date(y, m + 1, 0);
        return { from: `${y}-${pad(m + 1)}-01`, to: fmtYMD(last) };
      }
      case 'trimestre': {
        const qs = new Date(y, Math.floor(m / 3) * 3, 1);
        const qe = new Date(y, Math.floor(m / 3) * 3 + 3, 0);
        return { from: fmtYMD(qs), to: fmtYMD(qe) };
      }
      case 'año': case 'ano': return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    return defaultDates();
  }

  await renderShell();
}
