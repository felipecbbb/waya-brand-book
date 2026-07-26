/* ============================================================
   UI Helpers — Admin Panel
   ============================================================ */

// ---- Table renderer ----
export function renderTable(columns, rows, actions) {
  if (!rows.length) {
    return `<div class="admin-empty"><p>No hay datos para mostrar</p></div>`;
  }

  const ths = columns.map(c => `<th>${c.label}</th>`).join('');
  const actionTh = actions ? '<th>Acciones</th>' : '';

  const trs = rows.map(row => {
    const tds = columns.map(c => `<td>${c.render ? c.render(row) : (row[c.key] ?? '—')}</td>`).join('');
    const actionTd = actions ? `<td class="admin-actions">${actions(row)}</td>` : '';
    return `<tr>${tds}${actionTd}</tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${ths}${actionTh}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
}

// ---- Status badge ----
export function statusBadge(status) {
  const labels = {
    open: 'Abierto', full: 'Completo', closed: 'Cerrado', coming_soon: 'Próximamente',
    pending: 'Pendiente', deposit_paid: 'Señal pagada', fully_paid: 'Pagado', cancelled: 'Cancelado', refunded: 'Reembolsado',
    scheduled: 'Programada', completed: 'Completada',
    active: 'Activo', draft: 'Borrador', out_of_stock: 'Sin stock',
    confirmed: 'Confirmado', returned: 'Devuelto',
    paid: 'Pagado', shipped: 'Enviado', delivered: 'Entregado',
    exhausted: 'Agotado', partial: 'Parcial', expired: 'Expirado', no_show: 'No asistió',
    admin: 'Admin', client: 'Cliente'
  };
  const label = labels[status] || status;
  return `<span class="admin-badge" data-status="${status}">${label}</span>`;
}

// ---- Modal ----
export function openModal(title, bodyHTML) {
  const modal = document.getElementById('admin-modal');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  modal.classList.add('open');
}

export function closeModal() {
  document.getElementById('admin-modal').classList.remove('open');
}

// Init modal close handlers
export function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('admin-modal').addEventListener('click', e => {
    if (e.target.id === 'admin-modal') closeModal();
  });
}

// ---- Toast ----
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `admin-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3500);
}

// ---- Formatters ----
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function formatCurrency(amount) {
  if (amount == null) return '—';
  return Number(amount).toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR'
  });
}

export function truncateId(id) {
  if (!id) return '—';
  return id.substring(0, 8) + '…';
}
