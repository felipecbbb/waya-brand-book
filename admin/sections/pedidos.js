/* ============================================================
   Pedidos Section — Product order management (tienda only)
   ============================================================ */
import { fetchOrders, fetchOrderItems, updateOrderStatus } from '../modules/api.js';
import { renderTable, statusBadge, formatDate, formatCurrency, openModal, closeModal, showToast } from '../modules/ui.js';
import { supabase } from '/lib/supabase.js';

const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

let _statusFilter = '';
let _searchFilter = '';

export async function renderPedidos(container) {

  async function render() {
    const allOrders = await fetchOrders();

    // Filter out orders that are purely bono/camp — only show product orders
    let bonoOrderIds = new Set();
    if (allOrders.length) {
      const { data: bonos } = await supabase
        .from('bonos')
        .select('order_id')
        .not('order_id', 'is', null);
      if (bonos) bonos.forEach(b => bonoOrderIds.add(b.order_id));
    }
    // A product order must have order_items AND not be a bono order
    // Orders with no items and no bonos are camp shell orders — skip them
    let orders = allOrders.filter(o =>
      !bonoOrderIds.has(o.id) && (o.order_items || []).length > 0
    );

    // Apply status filter
    if (_statusFilter) orders = orders.filter(o => o.status === _statusFilter);

    // Apply search filter (client name)
    if (_searchFilter) {
      const q = _searchFilter.toLowerCase();
      orders = orders.filter(o => (o.profiles?.full_name || '').toLowerCase().includes(q));
    }

    const statusOptions = STATUSES.map(s =>
      `<option value="${s}" ${_statusFilter === s ? 'selected' : ''}>${statusLabel(s)}</option>`
    ).join('');

    const toolbarHTML = `
      <div class="admin-toolbar" style="margin-bottom:20px">
        <select class="admin-filter" id="ped-status-filter">
          <option value="">Todos los estados</option>
          ${statusOptions}
        </select>
        <input type="text" class="admin-filter" id="ped-search" placeholder="Buscar cliente…" value="${_searchFilter}" style="min-width:180px" />
      </div>`;

    const table = renderTable(
      [
        { label: 'Cliente', render: r => r.profiles?.full_name || '—' },
        { label: 'Total', render: r => formatCurrency(r.total) },
        { label: 'Estado', render: r => statusBadge(r.status) },
        { label: 'Dirección', render: r => r.shipping_address ? r.shipping_address.substring(0, 40) + (r.shipping_address.length > 40 ? '…' : '') : '—' },
        { label: 'Fecha', render: r => formatDate(r.created_at) }
      ],
      orders,
      (row) => `
        <button class="admin-action-btn" data-id="${row.id}" data-action="detail">Detalle</button>
        <button class="admin-action-btn" data-id="${row.id}" data-action="status">Estado</button>
      `
    );

    container.innerHTML = toolbarHTML + table;

    // Toolbar listeners
    document.getElementById('ped-status-filter').addEventListener('change', (e) => {
      _statusFilter = e.target.value;
      render();
    });

    let _searchTimeout;
    document.getElementById('ped-search').addEventListener('input', (e) => {
      clearTimeout(_searchTimeout);
      _searchTimeout = setTimeout(() => {
        _searchFilter = e.target.value;
        render();
      }, 300);
    });

    // Detail modal
    container.querySelectorAll('[data-action="detail"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const order = orders.find(o => o.id === btn.dataset.id);
        await openDetailModal(order);
      });
    });

    // Status modal
    container.querySelectorAll('[data-action="status"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const order = orders.find(o => o.id === btn.dataset.id);
        openStatusModal(order);
      });
    });
  }

  async function openDetailModal(order) {
    const items = await fetchOrderItems(order.id);

    const itemsHTML = items.length
      ? `<table style="width:100%;border-collapse:collapse;margin-top:12px">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #eee9da;font-family:'Space Grotesk',sans-serif;font-size:.72rem;text-transform:uppercase">Producto</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #eee9da;font-family:'Space Grotesk',sans-serif;font-size:.72rem;text-transform:uppercase">Cant.</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #eee9da;font-family:'Space Grotesk',sans-serif;font-size:.72rem;text-transform:uppercase">Precio</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #eee9da;font-family:'Space Grotesk',sans-serif;font-size:.72rem;text-transform:uppercase">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td style="padding:8px;border-bottom:1px solid #f3f1e8">${i.products?.name || '—'}${i.variant ? `<br><span style="font-size:.78rem;color:var(--color-muted)">${i.variant}</span>` : ''}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f1e8">${i.quantity}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f1e8">${formatCurrency(i.unit_price)}</td>
                <td style="padding:8px;border-bottom:1px solid #f3f1e8">${formatCurrency(i.quantity * i.unit_price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p style="color:var(--color-muted);margin-top:12px">No hay items en este pedido</p>';

    const email = order.profiles?.email || order.guest_email || '—';
    const phone = order.profiles?.phone || order.guest_phone || '—';
    const customerNotes = (order.notes || '').split('|')[0].trim();

    const invoiceHTML = order.wants_invoice
      ? `<div class="ped-invoice-box">
          <span class="ped-invoice-tag">🧾 Factura solicitada</span>
          <div class="ped-invoice-row"><strong>Nombre / Razón social:</strong> ${order.invoice_name || '—'}</div>
          <div class="ped-invoice-row"><strong>NIF / CIF:</strong> ${order.invoice_tax_id || '—'}</div>
          <div class="ped-invoice-row"><strong>Dirección fiscal:</strong> ${order.invoice_address || order.shipping_address || '—'}</div>
        </div>`
      : '<p style="color:var(--color-muted);font-size:.85rem;margin:4px 0 0">El cliente no ha pedido factura.</p>';

    openModal('Detalle del Pedido', `
      <div class="trip-form">
        <label>Cliente</label>
        <input type="text" value="${order.profiles?.full_name || order.guest_name || '—'}" disabled />

        <div class="row-2" style="display:flex;gap:10px">
          <div style="flex:1"><label>Email</label><input type="text" value="${email}" disabled /></div>
          <div style="flex:1"><label>Teléfono</label><input type="text" value="${phone}" disabled /></div>
        </div>

        <label>Estado</label>
        <div style="margin-bottom:8px">${statusBadge(order.status)}</div>

        <label>Total</label>
        <input type="text" value="${formatCurrency(order.total)}" disabled />

        <label>Dirección de envío</label>
        <input type="text" value="${order.shipping_address || '—'}" disabled />

        <label>Factura</label>
        ${invoiceHTML}

        ${customerNotes ? `<label style="margin-top:12px">Notas del cliente</label><textarea disabled>${customerNotes}</textarea>` : ''}
      </div>

      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:1.15rem;color:var(--color-navy);margin-top:20px">Items del pedido</h3>
      ${itemsHTML}
    `);
  }

  function openStatusModal(order) {
    const options = STATUSES.map(s =>
      `<option value="${s}" ${order.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`
    ).join('');

    openModal('Cambiar Estado del Pedido', `
      <div class="trip-form">
        <label>Cliente</label>
        <input type="text" value="${order.profiles?.full_name || '—'}" disabled />

        <label>Total</label>
        <input type="text" value="${formatCurrency(order.total)}" disabled />

        <label>Nuevo Estado</label>
        <select id="modal-order-status">${options}</select>

        <button class="btn red" id="modal-order-save" style="margin-top:12px">Guardar</button>
      </div>
    `);

    document.getElementById('modal-order-save').addEventListener('click', async () => {
      const newStatus = document.getElementById('modal-order-status').value;
      try {
        await updateOrderStatus(order.id, newStatus);
        // Notificación al cliente por email según el nuevo estado
        const EMAIL_TYPE = { cancelled: 'order_cancelled', shipped: 'order_shipped', delivered: 'order_delivered' };
        const emailType = EMAIL_TYPE[newStatus];
        const emailTo = order.profiles?.email || order.guest_email;
        if (emailType && emailTo) {
          try {
            supabase.functions.invoke('send-email', {
              body: {
                to: emailTo,
                type: emailType,
                data: {
                  customerName: order.profiles?.full_name || order.guest_name,
                  orderId: order.id,
                  total: order.total,
                },
              },
            });
          } catch {}
        }
        closeModal();
        showToast(emailType ? 'Estado actualizado · cliente avisado por email' : 'Estado actualizado', 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  await render();
}

function statusLabel(s) {
  const map = {
    pending: 'Pendiente', paid: 'Pagado', shipped: 'Enviado',
    delivered: 'Entregado', cancelled: 'Cancelado'
  };
  return map[s] || s;
}
