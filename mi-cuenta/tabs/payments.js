/* ============================================================
   Tab "Mis Pagos" — Panel de cliente Waya Surf School
   ============================================================
   SOLO LECTURA. Muestra:
     (a) Cards de resumen (Servicios / Surf Camps / Tienda / Saldo a favor).
     (b) Saldos PENDIENTES de bonos y alquileres (informativo, sin cobro online).
     (c) Timeline unificado de pagos (tabla) desde la RPC get_user_payments.

   Fuente única del dinero = tabla `payments` (contrato SQL §2.14). La RPC
   `get_user_payments(p_user_id)` devuelve TODOS los pagos de las entidades del
   usuario (enrollment/rental/booking/bono/order) + los 'custom' (saldo a favor).
   No re-agregamos desde orders/bookings/equipment: payments ya es polimórfica y
   canónica en Waya (a diferencia de Entreolas). Ver docs/reservas/SQL_CONTRACT.md.

   Contrato de montaje: export async function renderPayments(container, switchTab).
   Idempotente: re-render completo en cada entrada (datos frescos).
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { esc, formatDate, formatPrice, TYPE_LABELS, METHOD_LABELS } from '/lib/utils.js';
import { loadPricing, bonoExpected, bonoPaid, bonoPending } from '/lib/domain/pricing.js';

// Config visual por reservation_type (los 6 valores del contrato §1).
const DOMAIN_CONFIG = {
  enrollment: { label: 'Clase',     color: '#166534', bg: '#f0fdf4' },
  bono:       { label: 'Bono',      color: '#166534', bg: '#f0fdf4' },
  rental:     { label: 'Alquiler',  color: '#6d28d9', bg: '#f5f3ff' },
  booking:    { label: 'Surf Camp', color: '#0369a1', bg: '#f0f9ff' },
  order:      { label: 'Tienda',    color: '#92400e', bg: '#fffbeb' },
  custom:     { label: 'Saldo',     color: '#92400e', bg: '#fffbeb' },
};

function domainBadge(type) {
  const cfg = DOMAIN_CONFIG[type];
  if (!cfg) return `<span class="pay-domain-badge" style="background:#f1f5f9;color:#64748b">${esc(type)}</span>`;
  return `<span class="pay-domain-badge" style="background:${cfg.bg};color:${cfg.color}">${cfg.label}</span>`;
}

// Concepto por defecto cuando el pago no trae `concept`.
function defaultConcept(type) {
  switch (type) {
    case 'enrollment': return 'Pago de clase';
    case 'bono':       return 'Pago de bono';
    case 'rental':     return 'Pago de alquiler';
    case 'booking':    return 'Reserva Surf Camp';
    case 'order':      return 'Pedido de tienda';
    case 'custom':     return 'Saldo a favor';
    default:           return 'Pago';
  }
}

export async function renderPayments(container) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    container.innerHTML = '<div class="account-form-card"><p style="color:var(--color-muted);margin:0">Inicia sesión para ver tus pagos.</p></div>';
    return;
  }

  container.innerHTML = '<div class="tab-loading">Cargando pagos…</div>';

  // Precios de catálogo (para calcular el esperado de cada bono) + datos en paralelo.
  const [, paymentsRes, bonosRes, profileRes, rentalsRes] = await Promise.all([
    loadPricing(),
    supabase.rpc('get_user_payments', { p_user_id: user.id }),
    supabase.from('bonos')
      .select('id, class_type, status, total_credits, used_credits, total_paid, custom_total, expires_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('credit_balance').eq('id', user.id).single(),
    supabase.from('equipment_reservations')
      .select('id, size, total_amount, deposit_paid, status, date_start, date_end, rental_equipment:equipment_id(name)')
      .eq('user_id', user.id).not('status', 'in', '(cancelled,returned)')
      .order('date_start', { ascending: false }),
  ]);

  const payments = paymentsRes.data || [];
  const bonos = bonosRes.data || [];
  const creditBalance = Number(profileRes.data?.credit_balance || 0);

  // Bonos vivos con saldo pendiente (informativo). 'active'/'exhausted' = bono vivo.
  const pendingBonos = bonos
    .filter(b => b.status === 'active' || b.status === 'exhausted')
    .map(b => ({ ...b, pending: bonoPending(b) }))
    .filter(b => b.pending > 0.01);

  // Alquileres con saldo pendiente (total - señal ya pagada).
  const pendingRentals = (rentalsRes.data || [])
    .map(r => ({ ...r, pending: Number(r.total_amount || 0) - Number(r.deposit_paid || 0) }))
    .filter(r => r.pending > 0.01);

  // ---- Timeline: directamente desde las filas de payments (fuente canónica) ----
  const timeline = payments
    .map(p => ({
      date: p.payment_date || p.created_at,
      type: p.reservation_type || 'custom',
      concept: p.concept || defaultConcept(p.reservation_type),
      amount: Number(p.amount || 0),
      method: p.payment_method || 'efectivo',
      channel: p.channel || 'in_person',
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // ---- Totales por categoría ----
  const sumBy = (types) => timeline.filter(t => types.includes(t.type)).reduce((s, t) => s + t.amount, 0);
  const serviciosTotal = sumBy(['enrollment', 'bono', 'rental']);
  const campTotal = sumBy(['booking']);
  const tiendaTotal = sumBy(['order']);
  const campCount = timeline.filter(t => t.type === 'booking').length;

  let html = `
    <div class="pay-summary-grid">
      <div class="pay-summary-card pay-summary-green">
        <div class="pay-summary-label">Servicios</div>
        <div class="pay-summary-value">${formatPrice(serviciosTotal)}</div>
        <div class="pay-summary-hint">Clases, bonos y alquiler</div>
      </div>
      ${campTotal > 0 ? `
      <div class="pay-summary-card" style="border-color:#bae6fd;background:#f0f9ff">
        <div class="pay-summary-label" style="color:#0369a1">Surf Camps</div>
        <div class="pay-summary-value" style="color:#0369a1">${formatPrice(campTotal)}</div>
        <div class="pay-summary-hint" style="color:#0369a1">${campCount} pago${campCount !== 1 ? 's' : ''}</div>
      </div>` : ''}
      ${tiendaTotal > 0 ? `
      <div class="pay-summary-card pay-summary-yellow">
        <div class="pay-summary-label">Tienda</div>
        <div class="pay-summary-value">${formatPrice(tiendaTotal)}</div>
        <div class="pay-summary-hint">Pedidos de productos</div>
      </div>` : ''}
      <div class="pay-summary-card ${creditBalance > 0 ? 'pay-summary-yellow' : 'pay-summary-neutral'}">
        <div class="pay-summary-label">Saldo a favor</div>
        <div class="pay-summary-value">${formatPrice(creditBalance)}</div>
        ${creditBalance > 0 ? '<div class="pay-summary-hint">Puedes usar este saldo en tus próximas reservas</div>' : ''}
      </div>
    </div>`;

  // ---- Saldos pendientes (informativo, sin pago online) ----
  if (pendingBonos.length || pendingRentals.length) {
    html += `
      <div class="account-form-card" style="border:1px solid #fde68a;background:#fffbeb">
        <h3 style="margin:0 0 4px;font-size:1rem;color:#92400e">Saldos pendientes</h3>
        <p style="margin:0 0 14px;font-size:.85rem;color:#a16207">Puedes abonar el resto en la escuela. ¿Dudas? Escríbenos a info@wayasurf.com o por WhatsApp al +34 636 562 448.</p>`;

    pendingBonos.forEach(b => {
      const label = TYPE_LABELS[b.class_type] || b.class_type;
      html += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #fef3c7">
          <div>
            <strong style="font-size:.92rem">Bono ${esc(label)} · ${b.total_credits} clase${b.total_credits !== 1 ? 's' : ''}</strong>
            <div style="font-size:.8rem;color:var(--color-muted)">Pagado ${formatPrice(bonoPaid(b))} de ${formatPrice(bonoExpected(b))}${b.expires_at ? ` · Caduca ${formatDate(b.expires_at)}` : ''}</div>
          </div>
          <span style="white-space:nowrap;font-weight:700;font-size:.85rem;color:#92400e">Pendiente ${formatPrice(b.pending)}</span>
        </div>`;
    });

    pendingRentals.forEach(r => {
      const name = r.rental_equipment?.name || 'Alquiler';
      html += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid #fef3c7">
          <div>
            <strong style="font-size:.92rem">${esc(name)}${r.size ? ` · Talla ${esc(r.size)}` : ''}</strong>
            <div style="font-size:.8rem;color:var(--color-muted)">${formatDate(r.date_start)} → ${formatDate(r.date_end)} · Pagado ${formatPrice(r.deposit_paid)} de ${formatPrice(r.total_amount)}</div>
          </div>
          <span style="white-space:nowrap;font-weight:700;font-size:.85rem;color:#92400e">Pendiente ${formatPrice(r.pending)}</span>
        </div>`;
    });

    html += `</div>`;
  }

  // ---- Timeline de pagos ----
  if (!timeline.length) {
    html += `<div class="account-form-card"><p style="color:var(--color-muted);margin:0">No tienes pagos registrados todavía.</p></div>`;
  } else {
    html += `
      <div class="account-form-card" style="padding:0;overflow:hidden">
        <div class="pay-table-wrap">
          <table class="pay-table">
            <thead>
              <tr>
                <th data-i18n="account.pay.date">Fecha</th>
                <th data-i18n="account.pay.type">Tipo</th>
                <th data-i18n="account.pay.concept">Concepto</th>
                <th data-i18n="account.pay.amount">Importe</th>
                <th data-i18n="account.pay.method">Método</th>
                <th data-i18n="account.pay.origin">Origen</th>
              </tr>
            </thead>
            <tbody>
              ${timeline.map(t => `
                <tr>
                  <td data-label="Fecha">${formatDate(t.date)}</td>
                  <td data-label="Tipo">${domainBadge(t.type)}</td>
                  <td data-label="Concepto">${esc(t.concept)}</td>
                  <td data-label="Importe" class="pay-amount">${formatPrice(t.amount)}</td>
                  <td data-label="Método">${METHOD_LABELS[t.method] || esc(t.method)}</td>
                  <td data-label="Origen"><span class="pay-source-badge ${t.channel === 'web' ? 'pay-source-web' : ''}">${t.channel === 'web' ? 'Web' : 'Escuela'}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}
