/* ============================================================
   Reservas Section — Camp bookings grouped by camp
   ============================================================ */
import { fetchBookings, fetchCamps, updateBookingStatus, createPayment, fetchPayments, deletePayment, deleteReservationFully, createBooking, sendBookingConfirmationEmail, searchProfiles, moveToTrash } from '../modules/api.js';
import { statusBadge, formatDate, formatCurrency, openModal, closeModal, showToast } from '../modules/ui.js';
import { openPaymentEditModal } from '../modules/payment-edit.js';
import { recalcPaidState } from '/lib/domain/payments.js';
import { supabase } from '/lib/supabase.js';
import { attachClientSuggest } from '../modules/client-suggest.js';

const STATUSES = ['pending', 'deposit_paid', 'fully_paid', 'cancelled', 'refunded'];
const STATUS_LABELS = {
  pending: 'Pendiente', deposit_paid: 'Señal pagada', fully_paid: 'Pagado',
  cancelled: 'Cancelado', refunded: 'Reembolsado'
};

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

export async function renderReservas(container) {
  let campFilter = '';
  let statusFilter = '';

  async function render() {
    const [bookings, camps] = await Promise.all([fetchBookings(), fetchCamps()]);

    // Apply filters
    let filtered = bookings;
    if (campFilter) filtered = filtered.filter(b => b.camp_id === campFilter);
    if (statusFilter) filtered = filtered.filter(b => b.status === statusFilter);

    // Camp options for dropdown
    const campOptions = camps.map(c =>
      `<option value="${c.id}" ${campFilter === c.id ? 'selected' : ''}>${esc(c.title)}</option>`
    ).join('');

    const statusOptions = STATUSES.map(s =>
      `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`
    ).join('');

    // Group by camp
    const byCamp = {};
    filtered.forEach(b => {
      const cid = b.camp_id || 'unknown';
      if (!byCamp[cid]) byCamp[cid] = { camp: b.surf_camps || { title: 'Desconocido' }, bookings: [] };
      byCamp[cid].bookings.push(b);
    });

    // Stats — ingreso REAL cobrado (total si pagado entero, señal si solo señal),
    // igual que el dashboard (fetchStats), para no inflar con total_amount.
    const collected = b => Number((b.status === 'fully_paid' ? b.total_amount : b.deposit_amount) || 0);
    const totalRevenue = filtered.filter(b => ['deposit_paid', 'fully_paid'].includes(b.status))
      .reduce((s, b) => s + collected(b), 0);
    const totalDeposits = filtered.filter(b => ['deposit_paid', 'fully_paid'].includes(b.status))
      .reduce((s, b) => s + Number(b.deposit_amount || 0), 0);

    container.innerHTML = `
      <div class="rv-toolbar">
        <div class="rv-toolbar-filters">
          <select class="admin-filter" id="rv-camp-filter">
            <option value="">Todos los camps</option>
            ${campOptions}
          </select>
          <select class="admin-filter" id="rv-status-filter">
            <option value="">Todos los estados</option>
            ${statusOptions}
          </select>
        </div>
        <div class="rv-toolbar-summary">
          <span class="rv-toolbar-count">${filtered.length} reserva${filtered.length !== 1 ? 's' : ''}</span>
          <span class="rv-toolbar-total">${formatCurrency(totalRevenue)}</span>
          <button class="btn" id="rv-new-booking" style="background:#22c55e;color:#fff;border:0;padding:9px 18px;font-size:.85rem;font-weight:600;margin-left:12px">+ Nueva reserva</button>
        </div>
      </div>

      ${Object.keys(byCamp).length === 0 ? `
        <div class="sc-empty">
          <p>No hay reservas${campFilter || statusFilter ? ' con estos filtros' : ''}</p>
        </div>
      ` : ''}

      ${Object.values(byCamp).map(group => {
        const c = group.camp;
        const paidCount = group.bookings.filter(b => ['deposit_paid', 'fully_paid'].includes(b.status)).length;
        const groupRevenue = group.bookings.filter(b => ['deposit_paid', 'fully_paid'].includes(b.status))
          .reduce((s, b) => s + collected(b), 0);

        return `
          <div class="rv-camp-group">
            <div class="rv-camp-header">
              <div class="rv-camp-info">
                <h3 class="rv-camp-title">${esc(c.title || 'Camp desconocido')}</h3>
                <span class="rv-camp-meta">${c.date_start ? formatDate(c.date_start) + ' — ' + formatDate(c.date_end) : ''}</span>
              </div>
              <div class="rv-camp-stats">
                <div class="rv-stat">
                  <span class="rv-stat-value">${paidCount}</span>
                  <span class="rv-stat-label">Confirmadas</span>
                </div>
                <div class="rv-stat">
                  <span class="rv-stat-value">${c.spots_taken || 0}/${c.max_spots || '?'}</span>
                  <span class="rv-stat-label">Plazas</span>
                </div>
                <div class="rv-stat">
                  <span class="rv-stat-value">${formatCurrency(groupRevenue)}</span>
                  <span class="rv-stat-label">Ingresos</span>
                </div>
              </div>
            </div>

            <div class="rv-bookings-list">
              ${group.bookings.map(b => `
                <div class="rv-booking-row rv-booking-clickable" data-id="${b.id}" style="cursor:pointer">
                  <div class="rv-booking-client">
                    <strong>${esc(b.profiles?.full_name || b.guest_name || 'Sin nombre')}</strong>
                    <span class="rv-booking-phone">${esc(b.profiles?.phone || b.guest_phone || '')}</span>
                  </div>
                  <div class="rv-booking-amounts">
                    <span class="rv-booking-deposit">Señal: ${formatCurrency(b.deposit_amount)}</span>
                    <span class="rv-booking-total">Total: ${formatCurrency(b.total_amount)}</span>
                  </div>
                  <div>${statusBadge(b.status)}</div>
                  <div class="rv-booking-date">${formatDate(b.created_at)}</div>
                  <div class="rv-booking-actions">
                    <button class="admin-action-btn rv-status-btn" data-id="${b.id}">Estado</button>
                    <button class="rv-icon-btn rv-icon-danger rv-delete-btn" data-id="${b.id}" data-name="${esc(b.profiles?.full_name || b.guest_name || 'esta reserva')}" title="Eliminar reserva">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>`;
      }).join('')}
    `;

    // Event handlers
    container.querySelector('#rv-camp-filter')?.addEventListener('change', e => { campFilter = e.target.value; render(); });
    container.querySelector('#rv-status-filter')?.addEventListener('change', e => { statusFilter = e.target.value; render(); });
    container.querySelector('#rv-new-booking')?.addEventListener('click', () => openNewBookingModal(camps));

    container.querySelectorAll('.rv-status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const booking = filtered.find(b => b.id === btn.dataset.id);
        if (booking) openStatusModal(booking);
      });
    });

    container.querySelectorAll('.rv-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        if (!confirm(`¿Enviar a la papelera la reserva de ${name}? Podrás restaurarla desde Papelera.`)) return;
        try {
          await moveToTrash('booking', btn.dataset.id, `Reserva camp · ${name}`);
          showToast('Reserva enviada a la papelera', 'success');
          render();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.rv-booking-clickable').forEach(row => {
      row.addEventListener('click', () => {
        const booking = filtered.find(b => b.id === row.dataset.id);
        if (booking) openBookingFicha(booking);
      });
    });
  }

  function calcAge(birthDate) {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function closeFicha() {
    document.getElementById('rv-ficha-overlay')?.remove();
  }

  async function openBookingFicha(booking) {
    const p = booking.profiles || {};
    const camp = booking.surf_camps || {};

    // Name & surname separated (con fallback a los datos de invitado de la reserva manual)
    const firstName = esc(p.full_name || booking.guest_name || 'Sin nombre');
    const lastName = esc(p.last_name || '');
    const clientPhone = esc(p.phone || booking.guest_phone || '—');
    const clientAddress = [p.address, p.city, p.postal_code].filter(Boolean).join(', ');

    // Birth date & age
    const birthStr = p.birth_date ? formatDate(p.birth_date) : '';
    const age = calcAge(p.birth_date);

    // Email: de la cuenta (RPC) si está enlazada; si es invitado, el guest_email
    let email = booking.guest_email || '—';
    if (booking.user_id) {
      try {
        const { data } = await supabase.rpc('get_user_email', { p_user_id: booking.user_id });
        if (data) email = data;
      } catch {}
    }
    const safeEmail = esc(email);

    const statusColor = {
      pending: '#f59e0b', deposit_paid: '#1a1a1a', fully_paid: '#22c55e',
      cancelled: '#ef4444', refunded: '#6b7280',
    }[booking.status] || '#6b7280';

    // Pagado REAL = SUM(payments del booking) = única verdad. booking.deposit_amount
    // es un denormalizado que puede driftar (p.ej. backfills que no lo resincronizan);
    // calcular el pendiente con él mostraría "Cobrar resto" en reservas ya pagadas.
    const totalAmount = Number(booking.total_amount || 0);
    let depositPaid = Number(booking.deposit_amount || 0);
    try {
      const pays = await fetchPayments('booking', booking.id);
      depositPaid = (pays || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    } catch {}
    const pendingAmount = Math.max(0, Math.round((totalAmount - depositPaid) * 100) / 100);
    const isFullyPaid = booking.status === 'fully_paid' || pendingAmount <= 0;

    // Health info
    const healthItems = [];
    if (p.can_swim === true) healthItems.push('✓ Sabe nadar');
    if (p.can_swim === false) healthItems.push('<span style="color:#ef4444;font-weight:600">✗ No sabe nadar</span>');
    if (p.has_injury) healthItems.push(`<span style="color:#f59e0b;font-weight:600">⚠ Lesión: ${esc(p.injury_detail || 'Sí')}</span>`);
    if (p.wetsuit_size) healthItems.push(`Neopreno: <strong>${esc(p.wetsuit_size)}</strong>`);

    const waLink = clientPhone !== '—' ? `https://wa.me/${clientPhone.replace(/[^0-9+]/g, '')}` : null;

    const waSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.553 4.12 1.521 5.855L0 24l6.335-1.652A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-1.875 0-3.633-.506-5.15-1.387l-.37-.218-3.83.999 1.02-3.72-.24-.38A9.7 9.7 0 012.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75z"/></svg>`;

    // Label helper
    const lbl = (text) => `<div style="font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:var(--color-muted);font-weight:600;margin-bottom:4px;font-family:'Space Grotesk',sans-serif">${text}</div>`;

    // Remove previous overlay if exists
    closeFicha();

    const overlay = document.createElement('div');
    overlay.id = 'rv-ficha-overlay';
    overlay.innerHTML = `
      <style>
        #rv-ficha-overlay {
          position:fixed;inset:0;z-index:9999;background:rgba(15,47,57,.55);
          display:flex;justify-content:flex-end;align-items:stretch;
          overscroll-behavior:contain;backdrop-filter:blur(2px);
        }
        .rv-ficha {
          background:#fffdf7;width:100%;max-width:600px;overflow-y:auto;-webkit-overflow-scrolling:touch;
          padding:0;display:flex;flex-direction:column;
          animation:rvSlideIn .3s cubic-bezier(.22,1,.36,1);
          box-shadow:-8px 0 40px rgba(15,47,57,.15);
        }
        @keyframes rvSlideIn { from{transform:translateX(100%)} to{transform:translateX(0)} }
        .rv-ficha-topbar {
          display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;
          background:#0f2f39;padding:20px 28px;z-index:1;flex-shrink:0;
        }
        .rv-ficha-topbar-title { font-family:'Bebas Neue',sans-serif;font-size:1.4rem;color:#fff;line-height:1.1; }
        .rv-ficha-topbar-sub { font-size:.78rem;color:rgba(255,255,255,.5);margin-top:2px; }
        .rv-ficha-close {
          width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,.1);cursor:pointer;font-size:1.2rem;
          display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);flex-shrink:0;transition:background .15s;
        }
        .rv-ficha-close:hover { background:rgba(255,255,255,.2);color:#fff; }
        .rv-ficha-body { padding:24px 28px 32px;display:flex;flex-direction:column;gap:24px; }
        .rv-field { display:flex;flex-direction:column;gap:3px; }
        .rv-field-label { font-size:.64rem;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted);font-weight:600;font-family:'Space Grotesk',sans-serif; }
        .rv-field-value { font-size:.88rem;color:var(--color-navy); }
        .rv-grid { display:grid;grid-template-columns:1fr 1fr;gap:16px; }
        .rv-grid-3 { display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px; }
        .rv-card { background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px; }
        .rv-section { padding-top:20px;border-top:1px solid #f0ece3; }
        .rv-tag { font-size:.82rem;padding:6px 14px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;display:inline-flex;align-items:center;gap:6px; }
        .rv-actions { display:flex;gap:10px;flex-wrap:wrap; }

        @media (max-width:640px) {
          .rv-ficha { max-width:100%; }
          .rv-ficha-body { padding:20px 16px 28px; }
          .rv-ficha-topbar { padding:16px; }
          .rv-grid, .rv-grid-3 { grid-template-columns:1fr; }
          .rv-actions { flex-direction:column; }
          .rv-actions .btn { width:100%;justify-content:center;text-align:center; }
        }
      </style>
      <div class="rv-ficha">
        <!-- Top bar -->
        <div class="rv-ficha-topbar">
          <div>
            <div class="rv-ficha-topbar-title">Ficha de Reserva</div>
            <div class="rv-ficha-topbar-sub">${esc(camp.title || 'Surf Camp')}</div>
          </div>
          <button class="rv-ficha-close" id="rv-ficha-close-btn">&times;</button>
        </div>

        <div class="rv-ficha-body">
          <!-- Client card -->
          <div class="rv-card" style="display:flex;gap:16px;align-items:flex-start">
            <div style="width:52px;height:52px;border-radius:50%;background:#0f2f39;display:flex;align-items:center;justify-content:center;color:#FFCC01;font-weight:700;font-size:1.2rem;flex-shrink:0">
              ${firstName.charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:1.1rem;color:var(--color-navy)">${firstName}</div>
              ${lastName ? `<div style="font-size:1rem;color:var(--color-navy);margin-top:1px">${lastName}</div>` : ''}
              <div style="font-size:.82rem;color:var(--color-muted);margin-top:6px">${safeEmail}</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-top:6px">
                <span style="font-size:.82rem;color:var(--color-muted)">${clientPhone}</span>
                ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;font-size:.78rem;color:#25D366;text-decoration:none;font-weight:600">${waSvg} WhatsApp</a>` : ''}
              </div>
              ${clientAddress ? `<div style="font-size:.78rem;color:var(--color-muted);margin-top:4px">${esc(clientAddress)}</div>` : ''}
              ${p.id ? `<a href="#clientes" class="rv-goto-client" data-client-id="${p.id}" style="font-size:.75rem;color:#1a1a1a;text-decoration:none;cursor:pointer;margin-top:8px;display:inline-block">Ver ficha completa →</a>` : ''}
            </div>
          </div>

          <!-- Personal data -->
          <div class="rv-card">
            <div class="rv-grid-3">
              <div class="rv-field">
                <span class="rv-field-label">Fecha de nacimiento</span>
                <span class="rv-field-value">${birthStr || '—'}${age !== null ? ` <span style="color:var(--color-muted);font-size:.8rem">(${age} años)</span>` : ''}</span>
              </div>
              <div class="rv-field">
                <span class="rv-field-label">Teléfono</span>
                <span class="rv-field-value">${clientPhone}</span>
              </div>
              <div class="rv-field">
                <span class="rv-field-label">Email</span>
                <span class="rv-field-value" style="word-break:break-all">${safeEmail}</span>
              </div>
            </div>
          </div>

          <!-- Camp + status -->
          <div class="rv-card">
            <div class="rv-grid">
              <div class="rv-field">
                <span class="rv-field-label">Surf Camp</span>
                <div style="font-weight:700;font-size:.95rem;color:var(--color-navy)">${esc(camp.title || '—')}</div>
                <div style="font-size:.78rem;color:var(--color-muted);margin-top:2px">${camp.date_start ? formatDate(camp.date_start) + ' — ' + formatDate(camp.date_end) : '—'}</div>
              </div>
              <div class="rv-field">
                <span class="rv-field-label">Estado</span>
                <span class="admin-badge" style="--badge-bg:${statusColor}18;--badge-color:${statusColor};align-self:flex-start;margin-top:4px">${STATUS_LABELS[booking.status] || booking.status}</span>
              </div>
            </div>
          </div>

          <!-- Payment -->
          <div style="padding:18px 20px;border-radius:12px;background:${isFullyPaid ? '#f0fdf4' : '#fef2f2'};border:1px solid ${isFullyPaid ? '#bbf7d0' : '#fecaca'}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
              <div>
                <div style="font-weight:700;color:${isFullyPaid ? '#166534' : '#b91c1c'};font-size:.92rem">
                  ${isFullyPaid ? 'Pagado completamente' : 'Pendiente de pago'}
                </div>
                <div style="font-size:.82rem;color:${isFullyPaid ? '#15803d' : '#dc2626'};margin-top:4px">
                  Señal: <strong>${formatCurrency(depositPaid)}</strong> · Total: <strong>${formatCurrency(totalAmount)}</strong>
                </div>
              </div>
              ${!isFullyPaid && pendingAmount > 0 ? `<div style="font-family:'Bebas Neue',sans-serif;font-size:1.7rem;color:#b91c1c">${formatCurrency(pendingAmount)}</div>` : ''}
            </div>
          </div>

          <!-- Health & equipment -->
          ${healthItems.length ? `
          <div>
            <span class="rv-field-label" style="display:block;margin-bottom:10px">Salud y equipamiento</span>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${healthItems.map(h => `<span class="rv-tag">${h}</span>`).join('')}
            </div>
          </div>` : ''}

          <!-- Notes -->
          ${booking.notes ? `
          <div>
            <span class="rv-field-label" style="display:block;margin-bottom:6px">Notas</span>
            <div class="rv-card" style="font-size:.85rem;color:var(--color-navy)">${esc(booking.notes)}</div>
          </div>` : ''}

          <!-- Pagos registrados (se rellena async) -->
          <div id="rv-payments-block"></div>

          <!-- Actions -->
          <div class="rv-section rv-actions">
            ${!isFullyPaid && pendingAmount > 0 ? `
              <button class="btn rv-collect-rest-btn" data-id="${booking.id}" style="font-size:.85rem;padding:11px 24px;background:#22c55e;color:#fff;border:0">
                Cobrar resto · ${formatCurrency(pendingAmount)}
              </button>
            ` : ''}
            <button class="btn red rv-ficha-status-btn" data-id="${booking.id}" style="font-size:.85rem;padding:11px 24px">Cambiar estado</button>
            ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="btn line" style="font-size:.85rem;padding:11px 24px;display:inline-flex;align-items:center;gap:8px">
              ${waSvg} Contactar por WhatsApp
            </a>` : ''}
            <button class="btn rv-ficha-delete-btn" data-id="${booking.id}" style="font-size:.85rem;padding:11px 24px;background:transparent;color:#b91c1c;border:1px solid #fecaca;margin-left:auto">
              Eliminar reserva
            </button>
          </div>

          <!-- Meta -->
          <div style="font-size:.72rem;color:#b0b8c1;padding-top:12px;border-top:1px solid #f0ece3">
            ID: ${booking.id.slice(0, 8)} · Reservado: ${formatDate(booking.created_at)}${booking.updated_at ? ` · Actualizado: ${formatDate(booking.updated_at)}` : ''}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    overlay.querySelector('#rv-ficha-close-btn').addEventListener('click', closeFicha);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFicha(); });

    // Link to client ficha
    overlay.querySelector('.rv-goto-client')?.addEventListener('click', (e) => {
      e.preventDefault();
      const clientId = e.currentTarget.dataset.clientId;
      closeFicha();
      if (clientId) {
        // mismo deep-link robusto que usa el calendario (sin setTimeout frágil)
        window.__openClientId = clientId;
        if (location.hash === '#clientes') window.dispatchEvent(new Event('hashchange'));
        else location.hash = '#clientes';
      }
    });

    // Status change from ficha
    overlay.querySelector('.rv-ficha-status-btn')?.addEventListener('click', () => {
      closeFicha();
      openStatusModal(booking);
    });

    // Collect rest from ficha
    overlay.querySelector('.rv-collect-rest-btn')?.addEventListener('click', () => {
      openCollectRestModal(booking, pendingAmount);
    });

    // Delete reserva desde la ficha
    overlay.querySelector('.rv-ficha-delete-btn')?.addEventListener('click', async () => {
      const name = booking.profiles?.full_name || 'esta reserva';
      if (!confirm(`¿Enviar a la papelera la reserva de ${name}? Podrás restaurarla desde Papelera.`)) return;
      try {
        await moveToTrash('booking', booking.id, `Reserva camp · ${name}`);
        closeFicha();
        showToast('Reserva enviada a la papelera', 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    // Cargar pagos asociados al booking y renderizar
    renderBookingPayments(overlay, booking);
  }

  async function renderBookingPayments(overlay, booking) {
    const block = overlay.querySelector('#rv-payments-block');
    if (!block) return;
    block.innerHTML = '<div class="rv-payments-loading">Cargando pagos…</div>';

    const payments = await fetchPayments('booking', booking.id);

    if (!payments.length) {
      block.innerHTML = `
        <div>
          <span class="rv-field-label" style="display:block;margin-bottom:6px">Pagos registrados</span>
          <div class="rv-card" style="font-size:.85rem;color:var(--color-muted)">Aún no hay pagos registrados para esta reserva.</div>
        </div>
      `;
      return;
    }

    const METHOD_LBL = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', voucher:'Voucher', saldo:'Saldo', online:'Online (Stripe)' };
    const CH_LBL = { web:'Web', in_person:'Presencial' };

    block.innerHTML = `
      <div>
        <span class="rv-field-label" style="display:block;margin-bottom:8px">Pagos registrados (${payments.length})</span>
        <div class="rv-pay-list">
          ${payments.map(p => `
            <div class="rv-pay-row" data-pid="${esc(p.id)}">
              <div class="rv-pay-main">
                <div class="rv-pay-top">
                  <span class="rv-pay-amount">${formatCurrency(p.amount)}</span>
                  <span class="rv-pay-chip rv-pay-chip-${p.channel || 'in_person'}">${esc(CH_LBL[p.channel] || p.channel || '—')}</span>
                  <span class="rv-pay-method">${esc(METHOD_LBL[p.payment_method] || p.payment_method || '—')}</span>
                </div>
                <div class="rv-pay-meta">
                  ${formatDate(p.payment_date)}${p.concept ? ` · ${esc(p.concept)}` : ''}
                </div>
              </div>
              <div class="rv-pay-actions">
                <button class="rv-pay-action" data-action="edit" data-pid="${esc(p.id)}" title="Editar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="rv-pay-action rv-pay-action-danger" data-action="delete" data-pid="${esc(p.id)}" title="Eliminar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    block.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pid;
        const p = payments.find(x => x.id === id);
        if (!p) return;
        openPaymentEditModal(p, { onSaved: async () => {
          await renderBookingPayments(overlay, booking);
        }});
      });
    });

    block.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.pid;
        if (!confirm('¿Eliminar este pago? El estado de la reserva se recalculará según los pagos restantes.')) return;
        try {
          await deletePayment(id);
          // Estado/importe derivados de la suma real de pagos (dominio = única verdad)
          await recalcPaidState('booking', booking.id);
          const { data: bk } = await supabase.from('bookings')
            .select('deposit_amount, status').eq('id', booking.id).single();
          if (bk) { booking.deposit_amount = bk.deposit_amount; booking.status = bk.status; }
          showToast('Pago eliminado · estado recalculado', 'success');
          await renderBookingPayments(overlay, booking);
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });
    });
  }

  function openCollectRestModal(booking, pending) {
    const METHODS = [
      { v: 'efectivo', l: 'Efectivo' },
      { v: 'tarjeta', l: 'Tarjeta (TPV en playa)' },
      { v: 'transferencia', l: 'Transferencia' },
    ];

    // Modal inline con z-index encima de la ficha (10001 > 9999)
    const modal = document.createElement('div');
    modal.id = 'rv-collect-modal';
    modal.innerHTML = `
      <style>
        #rv-collect-modal {
          position:fixed;inset:0;z-index:10001;background:rgba(15,47,57,.55);
          display:flex;align-items:center;justify-content:center;
          backdrop-filter:blur(2px);overscroll-behavior:contain;
        }
        .rv-collect-dialog {
          background:#fffdf7;width:min(420px,calc(100% - 32px));max-height:90vh;overflow-y:auto;
          border-radius:14px;box-shadow:0 24px 64px rgba(15,47,57,.25);
          animation:rvCollectIn .2s cubic-bezier(.22,1,.36,1);
        }
        @keyframes rvCollectIn { from { transform:scale(.96);opacity:0 } to { transform:scale(1);opacity:1 } }
        .rv-collect-head {
          display:flex;align-items:center;justify-content:space-between;
          padding:18px 22px;border-bottom:1px solid #e5e7eb;
        }
        .rv-collect-head h3 { margin:0;font-family:'Space Grotesk',sans-serif;color:#0f2f39;font-size:1.05rem; }
        .rv-collect-close {
          width:30px;height:30px;border-radius:50%;border:0;background:#f3f4f6;cursor:pointer;
          font-size:1.1rem;color:#6b7280;display:flex;align-items:center;justify-content:center;
        }
        .rv-collect-body { padding:18px 22px 22px;display:flex;flex-direction:column;gap:12px; }
        .rv-collect-body label { font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280; }
        .rv-collect-body input, .rv-collect-body select {
          background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:9px 12px;
          font-family:'Space Grotesk',sans-serif;font-size:.92rem;color:#0f2f39;width:100%;
        }
        .rv-collect-body input:disabled { background:#f9fafb;color:#6b7280; }
        .rv-collect-row { display:flex;flex-direction:column;gap:4px; }
        .rv-collect-save {
          margin-top:6px;background:#22c55e;color:#fff;border:0;border-radius:999px;
          padding:12px 22px;font-family:'Space Grotesk',sans-serif;font-weight:700;
          font-size:.92rem;cursor:pointer;width:100%;
        }
        .rv-collect-save:hover { background:#16a34a; }
        .rv-collect-save:disabled { opacity:.6;cursor:not-allowed; }
      </style>
      <div class="rv-collect-dialog">
        <div class="rv-collect-head">
          <h3>Cobrar resto · ${formatCurrency(pending)}</h3>
          <button class="rv-collect-close" type="button">&times;</button>
        </div>
        <form class="rv-collect-body">
          <div class="rv-collect-row">
            <label>Cliente</label>
            <input type="text" value="${esc(booking.profiles?.full_name || '—')}" disabled />
          </div>
          <div class="rv-collect-row">
            <label>Camp</label>
            <input type="text" value="${esc(booking.surf_camps?.title || '—')}" disabled />
          </div>
          <div class="rv-collect-row">
            <label>Importe a cobrar</label>
            <input type="number" id="cr-amount" value="${pending}" step="0.01" min="0.01" />
          </div>
          <div class="rv-collect-row">
            <label>Método de pago</label>
            <select id="cr-method">
              ${METHODS.map(m => `<option value="${m.v}">${m.l}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="rv-collect-save">Registrar cobro</button>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('.rv-collect-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.rv-collect-save');
      const amount = parseFloat(modal.querySelector('#cr-amount').value) || 0;
      const method = modal.querySelector('#cr-method').value;
      if (amount <= 0) { showToast('Importe inválido', 'error'); return; }

      btn.disabled = true; btn.textContent = 'Procesando…';
      try {
        await createPayment({
          amount,
          payment_method: method,
          channel: 'in_person',
          reservation_type: 'booking',
          reference_id: booking.id,
          concept: `Resto surf camp ${booking.surf_camps?.title || ''}`.trim(),
        });

        // Estado/importe derivados de la suma real de pagos (dominio = única verdad)
        await recalcPaidState('booking', booking.id);

        close();
        closeFicha();
        showToast(`Cobro de ${formatCurrency(amount)} registrado`, 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Registrar cobro';
      }
    });
  }

  function openStatusModal(booking) {
    const totalAmount = Number(booking.total_amount || 0);
    const depositPaid = Number(booking.deposit_amount || 0);
    const stillOwes   = totalAmount - depositPaid > 0;

    // Si todavía debe dinero, no se puede marcar fully_paid manualmente:
    // hay que pasar por "Cobrar resto" para registrar el método de pago.
    const visibleStatuses = STATUSES.filter(s => !(s === 'fully_paid' && stillOwes));
    const options = visibleStatuses.map(s =>
      `<option value="${s}" ${booking.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`
    ).join('');

    openModal('Cambiar Estado', `
      <div class="trip-form">
        <label>Cliente</label>
        <input type="text" value="${esc(booking.profiles?.full_name || '—')}" disabled />
        <label>Camp</label>
        <input type="text" value="${esc(booking.surf_camps?.title || '—')}" disabled />
        <label>Monto</label>
        <input type="text" value="${formatCurrency(booking.total_amount)}" disabled />
        <label>Nuevo Estado</label>
        <select id="modal-status">${options}</select>
        ${stillOwes ? '<p style="font-size:.78rem;color:#92400e;margin:4px 0 0;background:#fef3c7;padding:8px 10px;border-radius:6px">Para marcar como pagado completamente, usa el botón verde <strong>Cobrar resto</strong> en la ficha y registra cómo se cobró.</p>' : ''}
        <button class="btn red" id="modal-save" style="margin-top:12px">Guardar</button>
      </div>
    `);

    document.getElementById('modal-save').addEventListener('click', async () => {
      const newStatus = document.getElementById('modal-status').value;
      try {
        await updateBookingStatus(booking.id, newStatus);
        // Fire-and-forget email notification
        if (newStatus === 'cancelled') {
          try {
            let emailData = booking.guest_email || null;
            if (booking.user_id) {
              const { data } = await supabase.rpc('get_user_email', { p_user_id: booking.user_id });
              if (data) emailData = data;
            }
            if (emailData) {
              supabase.functions.invoke('send-email', {
                body: {
                  to: emailData,
                  type: 'camp_cancelled',
                  data: {
                    customerName: booking.profiles?.full_name || booking.guest_name,
                    orderId: booking.id,
                  },
                },
              });
            }
          } catch {}
        }
        closeModal();
        showToast('Estado actualizado', 'success');
        render();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  // ---- Alta manual de una reserva de camp (+ email de confirmación) ----
  function openNewBookingModal(camps) {
    const campOpts = camps.map(c => `<option value="${c.id}" data-deposit="${c.deposit || 0}" data-price="${c.price || 0}">${esc(c.title)}</option>`).join('');
    const statusOpts = STATUSES.map(s => `<option value="${s}" ${s === 'deposit_paid' ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('');
    openModal('Nueva reserva de camp', `
      <div class="trip-form" id="nb-form">
        <label>Camp</label>
        <select id="nb-camp">${campOpts}</select>

        <label style="margin-top:10px">Buscar cliente existente <span style="font-weight:400;color:#94a3b8">(opcional)</span></label>
        <div style="position:relative">
          <input type="text" id="nb-client-search" placeholder="Nombre, teléfono o email…" autocomplete="off" />
          <input type="hidden" id="nb-user-id" />
          <div id="nb-client-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,47,57,.12);max-height:200px;overflow:auto"></div>
        </div>
        <div id="nb-client-chip" style="display:none;margin:8px 0;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:.85rem;color:#065f46"></div>

        <div style="display:flex;gap:10px">
          <div style="flex:1"><label>Nombre</label><input type="text" id="nb-name" placeholder="Nombre" /></div>
          <div style="flex:1"><label>Apellidos</label><input type="text" id="nb-lastname" placeholder="Apellidos" /></div>
        </div>
        <div style="display:flex;gap:10px">
          <div style="flex:1"><label>Email</label><input type="email" id="nb-email" placeholder="email@ejemplo.com" /></div>
          <div style="flex:1"><label>Teléfono</label><input type="tel" id="nb-phone" placeholder="+34 600 000 000" /></div>
        </div>

        <div style="display:flex;gap:10px">
          <div style="flex:1"><label>Señal (€)</label><input type="number" id="nb-deposit" min="0" step="0.01" value="0" /></div>
          <div style="flex:1"><label>Total (€)</label><input type="number" id="nb-total" min="0" step="0.01" value="0" /></div>
        </div>
        <label style="margin-top:8px">Estado</label>
        <select id="nb-status">${statusOpts}</select>
        <label style="margin-top:8px">Notas <span style="font-weight:400;color:#94a3b8">(opcional)</span></label>
        <textarea id="nb-notes" rows="2" placeholder="Observaciones internas"></textarea>

        <label class="ns-checkbox" style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.9rem">
          <input type="checkbox" id="nb-send-email" checked /> Enviar email de confirmación al cliente
        </label>
        <button class="btn" id="nb-save" style="margin-top:12px;background:#22c55e;color:#fff;border:0">Crear reserva</button>
      </div>
    `);

    const $ = id => document.getElementById(id);
    const setVal = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };

    // Prerrellena importes con los del camp seleccionado
    function syncAmounts() {
      const opt = $('nb-camp')?.selectedOptions[0];
      if (!opt) return;
      setVal('nb-deposit', Number(opt.dataset.deposit) || 0);
      setVal('nb-total', Number(opt.dataset.price) || 0);
    }
    $('nb-camp')?.addEventListener('change', syncAmounts);
    syncAmounts();

    // Buscador de cliente existente → enlaza user_id y rellena los campos
    let ctimer = null;
    $('nb-client-search')?.addEventListener('input', () => {
      clearTimeout(ctimer);
      const term = $('nb-client-search').value.trim();
      const box = $('nb-client-results');
      if (term.length < 2) { box.style.display = 'none'; return; }
      ctimer = setTimeout(async () => {
        const res = await searchProfiles(term);
        box.innerHTML = res.length
          ? res.map(p => `<div class="nb-opt" data-id="${p.id}" data-name="${esc(p.full_name || '')}" data-lastname="${esc(p.last_name || '')}" data-phone="${esc(p.phone || '')}" data-email="${esc(p.email || '')}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:.88rem">${esc(p.full_name || 'Sin nombre')}${p.phone ? ` · <span style="color:#64748b">${esc(p.phone)}</span>` : ''}</div>`).join('')
          : '<div style="padding:10px;color:#94a3b8;font-size:.85rem">Sin resultados</div>';
        box.style.display = '';
      }, 250);
    });
    $('nb-client-results')?.addEventListener('click', (e) => {
      const opt = e.target.closest('.nb-opt');
      if (!opt) return;
      setVal('nb-user-id', opt.dataset.id);
      setVal('nb-name', opt.dataset.name);
      setVal('nb-lastname', opt.dataset.lastname);
      setVal('nb-phone', opt.dataset.phone);
      setVal('nb-email', opt.dataset.email);
      $('nb-client-results').style.display = 'none';
      $('nb-client-search').value = '';
      const chip = $('nb-client-chip');
      chip.innerHTML = `✓ Enlazado a <strong>${esc(opt.dataset.name)}</strong> — saldrá en su ficha. <button type="button" id="nb-client-clear" style="background:none;border:none;color:#065f46;text-decoration:underline;cursor:pointer;font-size:.85rem;padding:0;margin-left:6px">quitar</button>`;
      chip.style.display = '';
    });
    $('nb-client-chip')?.addEventListener('click', (e) => {
      if (e.target.id !== 'nb-client-clear') return;
      setVal('nb-user-id', '');
      $('nb-client-chip').style.display = 'none';
      ['nb-name', 'nb-lastname', 'nb-phone', 'nb-email'].forEach(id => setVal(id, ''));
    });
    // Autocompletado de fichas en los campos de nombre/email (vincula y no duplica)
    const nbLink = (it) => {
      setVal('nb-user-id', it.id);
      setVal('nb-name', it.full_name);
      setVal('nb-lastname', it.last_name);
      setVal('nb-phone', it.phone);
      setVal('nb-email', it.email);
      const chip = $('nb-client-chip');
      chip.innerHTML = `✓ Enlazado a <strong>${esc(it.label || it.full_name)}</strong> — saldrá en su ficha. <button type="button" id="nb-client-clear" style="background:none;border:none;color:#065f46;text-decoration:underline;cursor:pointer;font-size:.85rem;padding:0;margin-left:6px">quitar</button>`;
      chip.style.display = '';
    };
    attachClientSuggest($('nb-name'), { onPick: nbLink });
    attachClientSuggest($('nb-email'), { onPick: nbLink, includeFamily: false });

    $('nb-save')?.addEventListener('click', async () => {
      const campId = $('nb-camp')?.value;
      if (!campId) { showToast('Selecciona un camp', 'error'); return; }
      const fullName = [$('nb-name').value.trim(), $('nb-lastname').value.trim()].filter(Boolean).join(' ');
      if (!fullName) { showToast('Indica el nombre del cliente', 'error'); return; }
      const email = $('nb-email').value.trim();
      const wantsEmail = $('nb-send-email').checked;
      if (wantsEmail && !email) { showToast('Para enviar la confirmación necesitas el email del cliente', 'error'); return; }

      const btn = $('nb-save');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const booking = await createBooking({
          camp_id: campId,
          user_id: $('nb-user-id').value || null,
          guest_name: fullName,
          guest_email: email || null,
          guest_phone: $('nb-phone').value.trim() || null,
          deposit_amount: Number($('nb-deposit').value) || 0,
          total_amount: Number($('nb-total').value) || 0,
          status: $('nb-status').value,
          notes: $('nb-notes').value.trim() || null,
        });
        if (wantsEmail && email) {
          try {
            await sendBookingConfirmationEmail({ to: email, customerName: fullName, booking });
            showToast('Reserva creada y email enviado', 'success');
          } catch (mailErr) {
            showToast('Reserva creada, pero el email falló: ' + mailErr.message, 'error');
          }
        } else {
          showToast('Reserva creada', 'success');
        }
        closeModal();
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Crear reserva';
      }
    });
  }

  await render();
}
