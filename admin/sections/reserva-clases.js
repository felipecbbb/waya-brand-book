/* ============================================================
   Reserva Clases — Bonos y reservas de clases (pagos web + admin)
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { formatDate, formatCurrency, showToast } from '../modules/ui.js';
import { TYPE_LABELS, TYPE_COLORS } from '../modules/constants.js';
import { bonoExpected } from '/lib/domain/pricing.js';
import { openBonoFicha as openBonoFichaUnica } from '../components/bono-ficha.js';

const BONO_STATUSES = {
  active: 'Activo',
  expired: 'Expirado',
  exhausted: 'Agotado',
  cancelled: 'Cancelado',
};

const BONO_STATUS_COLORS = {
  active: '#22c55e',
  expired: '#ef4444',
  exhausted: '#6b7280',
  cancelled: '#f59e0b',
};

const METHOD_LABELS = {
  efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia',
  voucher: 'Voucher', saldo: 'Saldo', online: 'Online', credit_balance: 'Saldo cuenta', otros: 'Otros',
};

async function fetchBonos(statusFilter) {
  let query = supabase
    .from('bonos')
    .select('*, profiles:user_id(id, full_name, phone, email)')
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) { console.warn('fetchBonos:', error.message); return []; }
  return data || [];
}

async function fetchClassPayments() {
  // Pagos de clases: anticipos de bono (online, type='bono') + inscripciones (presencial, type='enrollment')
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .in('reservation_type', ['bono', 'enrollment'])
    .order('payment_date', { ascending: false });
  if (error) { console.warn('fetchClassPayments:', error.message); return []; }
  return data || [];
}


// El precio esperado del bono vive en /lib/domain/pricing.js (bonoExpected).

export async function renderReservaClases(container) {
  let activeTab = 'bonos';
  let bonoFilter = '';

  async function render() {
    const [bonos, payments] = await Promise.all([
      fetchBonos(bonoFilter || undefined),
      fetchClassPayments(),
    ]);

    // Resolve client names for payments. La tabla payments no tiene user_id:
    // se resuelve por reference_id → bono (type 'bono') o enrollment (type 'enrollment').
    const refName = {};
    const bonoRefs = [...new Set(payments.filter(p => p.reservation_type === 'bono').map(p => p.reference_id).filter(Boolean))];
    const enrollRefs = [...new Set(payments.filter(p => p.reservation_type === 'enrollment').map(p => p.reference_id).filter(Boolean))];
    if (bonoRefs.length) {
      const { data } = await supabase.from('bonos').select('id, profiles:user_id(full_name)').in('id', bonoRefs);
      (data || []).forEach(b => { refName[b.id] = b.profiles?.full_name || '—'; });
    }
    if (enrollRefs.length) {
      const { data } = await supabase.from('class_enrollments').select('id, profiles:user_id(full_name), family_members:family_member_id(full_name)').in('id', enrollRefs);
      (data || []).forEach(e => { refName[e.id] = e.family_members?.full_name || e.profiles?.full_name || '—'; });
    }

    // KPIs disjuntos desde la tabla payments (única verdad): los ingresos de
    // bono (tipo 'bono') y los pagos de clase sueltos (tipo 'enrollment') no
    // se solapan, así el mismo cobro no cuenta en dos tarjetas.
    const bonoPayments = payments.filter(p => p.reservation_type === 'bono');
    const enrollmentPayments = payments.filter(p => p.reservation_type === 'enrollment');
    const totalBonoRevenue = bonoPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const activeBonos = bonos.filter(b => b.status === 'active' || b.status === 'exhausted').length;
    const totalCredits = bonos.reduce((s, b) => s + (b.total_credits || 0), 0);
    const usedCredits = bonos.reduce((s, b) => s + (b.used_credits || 0), 0);
    const classPaymentTotal = enrollmentPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

    const bonoFilterOptions = Object.entries(BONO_STATUSES).map(([val, label]) =>
      `<option value="${val}" ${bonoFilter === val ? 'selected' : ''}>${label}</option>`
    ).join('');

    container.innerHTML = `
      <!-- KPIs -->
      <div class="admin-stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px">
        <div class="admin-stat-card">
          <p class="admin-stat-label">Bonos vendidos</p>
          <p class="admin-stat-value">${bonos.length}</p>
          <p class="admin-stat-sub">${activeBonos} activos</p>
        </div>
        <div class="admin-stat-card">
          <p class="admin-stat-label">Ingresos bonos</p>
          <p class="admin-stat-value">${formatCurrency(totalBonoRevenue)}</p>
        </div>
        <div class="admin-stat-card">
          <p class="admin-stat-label">Créditos</p>
          <p class="admin-stat-value">${usedCredits} / ${totalCredits}</p>
          <p class="admin-stat-sub">${totalCredits > 0 ? Math.round(usedCredits / totalCredits * 100) : 0}% utilizados</p>
        </div>
        <div class="admin-stat-card">
          <p class="admin-stat-label">Pagos clases</p>
          <p class="admin-stat-value">${formatCurrency(classPaymentTotal)}</p>
          <p class="admin-stat-sub">${enrollmentPayments.length} pagos</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="admin-toolbar" style="gap:0; margin-bottom:0; border-bottom: 1px solid var(--color-line)">
        <button class="rc-tab ${activeTab === 'bonos' ? 'active' : ''}" data-tab="bonos">Bonos / Packs</button>
        <button class="rc-tab ${activeTab === 'pagos' ? 'active' : ''}" data-tab="pagos">Pagos de Clases</button>
      </div>

      <!-- Bonos tab -->
      <div class="rc-panel" id="rc-bonos" style="${activeTab === 'bonos' ? '' : 'display:none'}">
        <div class="admin-toolbar" style="margin-top:16px">
          <select class="admin-filter" id="rc-bono-filter">
            <option value="">Todos los estados</option>
            ${bonoFilterOptions}
          </select>
        </div>
        <div class="table-wrap" style="margin-top:8px">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Créditos</th>
                <th>Pagado</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${bonos.length ? bonos.map(b => {
                const name = b.profiles?.full_name || '—';
                const type = TYPE_LABELS[b.class_type] || b.class_type || '—';
                const color = TYPE_COLORS[b.class_type] || '#64748b';
                const status = BONO_STATUSES[b.status] || b.status;
                const statusColor = BONO_STATUS_COLORS[b.status] || '#6b7280';
                const expected = bonoExpected(b);
                const paid = Number(b.total_paid || 0);
                const pending = Math.max(0, Math.round((expected - paid) * 100) / 100);
                const pendingHtml = pending > 0 ? `<span style="color:#ef4444;font-size:.72rem;margin-left:4px">(debe ${formatCurrency(pending)})</span>` : '';
                return `<tr style="cursor:pointer" data-bono-id="${b.id}">
                  <td><strong>${name}</strong></td>
                  <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>${type}</span></td>
                  <td>${b.used_credits || 0} / ${b.total_credits || 0}</td>
                  <td>${formatCurrency(paid)}${pendingHtml}</td>
                  <td><span class="admin-badge" style="--badge-bg:${statusColor}18;--badge-color:${statusColor}">${status}</span></td>
                  <td>${formatDate(b.created_at)}</td>
                  <td><button class="admin-action-btn rc-view-btn" data-bono-id="${b.id}">Ver ficha</button></td>
                </tr>`;
              }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--color-muted);padding:32px">No hay bonos registrados</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payments tab -->
      <div class="rc-panel" id="rc-pagos" style="${activeTab === 'pagos' ? '' : 'display:none'}">
        <div class="table-wrap" style="margin-top:16px">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Importe</th>
                <th>Método</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              ${payments.length ? payments.map(p => {
                const typeLabel = p.reservation_type === 'bono' ? 'Bono' : 'Clase';
                const method = METHOD_LABELS[p.payment_method] || p.payment_method || '—';
                const clientName = refName[p.reference_id] || '—';
                return `<tr>
                  <td>${clientName}</td>
                  <td><span class="admin-badge" data-status="${p.reservation_type === 'bono' ? 'active' : 'confirmed'}">${typeLabel}</span></td>
                  <td>${formatCurrency(p.amount)}</td>
                  <td>${method}</td>
                  <td>${formatDate(p.payment_date)}</td>
                </tr>`;
              }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--color-muted);padding:32px">No hay pagos de clases registrados</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Tab switching
    container.querySelectorAll('.rc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        render();
      });
    });

    // Bono filter
    container.querySelector('#rc-bono-filter')?.addEventListener('change', (e) => {
      bonoFilter = e.target.value;
      render();
    });

    // Click on bono row or "Ver ficha" button → open ficha
    container.querySelectorAll('[data-bono-id]').forEach(el => {
      const handler = async (e) => {
        // Don't trigger on filter select
        if (e.target.closest('.admin-filter')) return;
        const bonoId = el.dataset.bonoId;
        if (bonoId) await openBonoFichaUnica(bonoId, { onChange: render });
      };
      if (el.tagName === 'TR') {
        el.addEventListener('click', handler);
      } else {
        el.addEventListener('click', (e) => { e.stopPropagation(); handler(e); });
      }
    });
  }


  await render();
}
