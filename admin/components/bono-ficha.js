/* ============================================================
   Ficha de Bono ÚNICA (reserva de clases) — pantalla completa
   ============================================================
   La MISMA ficha se abra desde donde se abra (reserva-clases, clientes, calendario).
   Lee/escribe TODO vía la capa de dominio (/lib/domain) para que números y acciones
   sean idénticos en todos los paneles.

   Panel a pantalla completa (ns-overlay/ns-panel, el mismo lenguaje visual que el
   resto del admin) con: participantes del bono, editar precio, añadir pagos, ampliar
   bono y crear bonos nuevos de OTRO tipo de clase para el mismo cliente.

   Uso:  await openBonoFicha(bonoId, { onChange })
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { showToast, formatDate, formatCurrency, statusBadge } from '../modules/ui.js';
import { TYPE_LABELS } from '../modules/constants.js';
import { createPayment, deletePayment, fetchPayments, moveToTrash } from '../modules/api.js';
import { openPaymentEditModal } from '../modules/payment-edit.js';
import { bonoExpected, getPackPrice, round2 } from '/lib/domain/pricing.js';
import { recalcBonoPaid } from '/lib/domain/payments.js';
import { createBono, extendBono, bonoAvailable, defaultBonoExpiry, updateBonoFields } from '/lib/domain/bonos.js';
import { searchProfiles } from '../modules/api.js';

const METHODS = ['efectivo', 'tarjeta', 'transferencia', 'voucher', 'saldo'];

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadBono(bonoId) {
  const { data: bono } = await supabase
    .from('bonos').select('*, profiles:user_id(id, full_name, last_name, phone, email)')
    .eq('id', bonoId).single();
  if (!bono) return null;
  const { data: enr } = await supabase
    .from('class_enrollments')
    .select('*, surf_classes:class_id(id, type, title, date, time_start, time_end), family_members:family_member_id(full_name, last_name)')
    .eq('bono_id', bonoId)
    .order('created_at', { ascending: false });
  const payments = await fetchPayments('bono', bonoId);
  return { bono, enrollments: enr || [], payments: (payments || []).slice().sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date)) };
}

function memberName(e) {
  const fm = e.family_members;
  if (fm) return (fm.full_name || '') + (fm.last_name ? ' ' + fm.last_name : '');
  return 'Titular';
}

// nº de crédito (1..n) de cada inscripción dentro del bono, ordenado por fecha de clase.
function creditOrdinals(enrollments) {
  const map = {};
  const live = enrollments.filter(e => e.status !== 'cancelled').slice().sort((a, b) => {
    const ka = `${a.surf_classes?.date || ''} ${a.surf_classes?.time_start || ''}`;
    const kb = `${b.surf_classes?.date || ''} ${b.surf_classes?.time_start || ''}`;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  live.forEach((e, i) => { map[e.id] = i + 1; });
  return map;
}

export async function openBonoFicha(bonoId, { onChange } = {}) {
  const data = await loadBono(bonoId);
  if (!data) { showToast('Bono no encontrado', 'error'); return; }
  const { bono, enrollments, payments } = data;

  const typeLbl = TYPE_LABELS[bono.class_type] || bono.class_type;
  const expected = bonoExpected(bono);
  // Pagado = SUM(payments) o total_paid (el mayor), igual que los paneles de pendientes.
  const paidSum = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const paid = Math.max(paidSum, round2(Number(bono.total_paid || 0)));
  const pending = Math.max(0, round2(expected - paid));
  // Saldo a favor: si se pagó más que el total actual del bono (p.ej. tras quitar una
  // clase del bono, que recalcula el precio a la baja). No se toca el dinero: solo se muestra.
  const overpaid = Math.max(0, round2(paid - expected));
  const fullyPaid = pending <= 0;
  const remaining = bonoAvailable(bono);
  const pct = bono.total_credits > 0 ? Math.round((bono.used_credits / bono.total_credits) * 100) : 0;
  const cli = bono.profiles || {};
  const cliName = (cli.full_name || 'Cliente') + (cli.last_name ? ' ' + cli.last_name : '');
  const canPay = !fullyPaid && (bono.status === 'active' || bono.status === 'exhausted');
  const ord = creditOrdinals(enrollments);
  // Histórico = clases USADAS (no canceladas), en orden cronológico (igual que los
  // créditos 1→N). Las canceladas liberan el crédito y figuran como "pendiente de
  // asignar" (KPI), no como una clase del histórico. loadBono carga DESC por
  // created_at; sin reordenar, la tabla salía al revés (4/4 arriba, 1/4 abajo).
  const enrollSorted = enrollments.filter(e => e.status !== 'cancelled').slice().sort((a, b) => {
    const ka = `${a.surf_classes?.date || ''} ${a.surf_classes?.time_start || ''}`;
    const kb = `${b.surf_classes?.date || ''} ${b.surf_classes?.time_start || ''}`;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  // Desglose de reserva conjunta (qué persona usó cuántas clases)
  const byMember = new Map();
  for (const e of enrollments.filter(e => e.status !== 'cancelled')) {
    const k = e.family_member_id || 'titular';
    const cur = byMember.get(k) || { name: memberName(e), n: 0 };
    cur.n++; byMember.set(k, cur);
  }
  const breakdown = [...byMember.values()];
  const hasFamily = breakdown.some(m => m.name !== 'Titular');

  const enrollHtml = enrollSorted.length ? enrollSorted.map(e => {
    const c = e.surf_classes || {};
    const estado = e.status === 'cancelled' ? statusBadge('cancelled')
      : e.attendance === true ? '<span style="color:#16a34a;font-weight:600">Asistió</span>'
      : e.attendance === false ? '<span style="color:#6b7280">No asistió</span>'
      : statusBadge(e.status || 'confirmed');
    const credCell = e.status === 'cancelled' ? '—' : `<span class="bf-cred-pill">${ord[e.id] || '?'}/${bono.total_credits}</span>`;
    return `<tr>
      <td>${formatDate(c.date)}</td>
      <td>${c.time_start ? c.time_start.slice(0, 5) : '—'}</td>
      <td>${esc(memberName(e))}</td>
      <td>${esc(c.title || TYPE_LABELS[c.type] || '')}</td>
      <td style="text-align:center">${credCell}</td>
      <td>${estado}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" style="color:var(--color-muted);padding:10px">Aún no se han usado créditos</td></tr>';

  const payHtml = payments.length ? payments.map(p => `<tr>
      <td>${formatDate(p.payment_date)}</td>
      <td>+${formatCurrency(p.amount)}</td>
      <td>${esc(p.payment_method || '')}</td>
      <td><span class="status-badge ${p.channel === 'web' ? 'active' : ''}">${p.channel === 'web' ? 'Web' : 'Manual'}</span></td>
      <td style="text-align:right;white-space:nowrap">${p.channel === 'web' ? '' : `
        <button class="bf-pay-edit" data-id="${p.id}" title="Editar" style="background:none;border:none;cursor:pointer;color:#1a1a1a">✎</button>
        <button class="bf-pay-del" data-id="${p.id}" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#dc2626">🗑</button>`}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="color:var(--color-muted);padding:10px">Sin pagos registrados</td></tr>';

  const methodOpts = METHODS.map(m => `<option value="${m}">${m.charAt(0).toUpperCase() + m.slice(1)}</option>`).join('');
  const typeOpts = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  // Datos para ASIGNAR una clase pendiente (solo si quedan créditos sin asignar):
  // familiares del responsable + clases futuras del mismo tipo con su disponibilidad.
  const canAssign = remaining > 0 && !!bono.user_id;
  let familyMembers = [], assignClasses = [];
  if (canAssign) {
    const t = new Date();
    const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const [fmRes, clsRes] = await Promise.all([
      supabase.from('family_members').select('id, full_name, last_name').eq('user_id', bono.user_id),
      supabase.from('surf_classes').select('id, date, time_start, max_students, enrolled_count')
        .eq('type', bono.class_type).neq('status', 'cancelled').gte('date', todayStr)
        .order('date', { ascending: true }).order('time_start', { ascending: true }),
    ]);
    familyMembers = fmRes.data || [];
    assignClasses = clsRes.data || [];
  }
  const assignWhoOpts = `<option value="">Titular · ${esc(cliName)}</option>` +
    familyMembers.map(f => `<option value="${f.id}">${esc((f.full_name || '') + (f.last_name ? ' ' + f.last_name : ''))}</option>`).join('');
  const assignClassOpts = assignClasses.length
    ? assignClasses.map(c => {
        const full = Number(c.enrolled_count || 0) >= Number(c.max_students || 0);
        const hhmm = c.time_start ? c.time_start.slice(0, 5) : '';
        return `<option value="${c.id}">${formatDate(c.date)} ${hhmm} (${c.enrolled_count || 0}/${c.max_students || 0})${full ? ' · COMPLETA' : ''}</option>`;
      }).join('')
    : '<option value="">No hay clases futuras de este tipo</option>';

  // ---- Overlay a pantalla completa (ns-overlay/ns-panel) ----
  document.getElementById('bf-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'bf-overlay';
  overlay.className = 'ns-overlay';
  overlay.innerHTML = `
    <style>
      #bf-overlay .ns-panel { max-width: 1500px; }
      #bf-overlay .bf-cols { display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:start; margin-top:22px; }
      @media (max-width: 980px){ #bf-overlay .bf-cols { grid-template-columns:1fr; } }
      #bf-overlay .bf-card { background:#fff; border:1px solid var(--color-line,#e5e7eb); border-radius:12px; padding:20px 24px; }
      #bf-overlay .bf-kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px,1fr)); gap:12px; margin:16px 0 4px; }
      #bf-overlay .bf-kpi { background:#f8fafc; border:1px solid var(--color-line,#e5e7eb); border-radius:10px; padding:12px 14px; }
      #bf-overlay .bf-kpi.pending { background:#fffbeb; border-color:#fde68a; }
      #bf-overlay .bf-kpi .l { font-size:.66rem; text-transform:uppercase; letter-spacing:.05em; color:var(--color-muted); font-weight:700; }
      #bf-overlay .bf-kpi .v { font-size:1.25rem; font-weight:800; color:var(--color-navy,#0f2f39); margin-top:2px; }
      #bf-overlay .bf-kpi.pending .v { color:#b45309; }
      #bf-overlay .bf-actions { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 4px; }
      #bf-overlay .bf-act { padding:9px 16px; font-size:.84rem; font-weight:700; border-radius:8px; border:1px solid var(--color-line,#e5e7eb); background:#fff; cursor:pointer; }
      #bf-overlay .bf-act:hover { background:#f1f5f9; }
      #bf-overlay .bf-act.primary { background:#22c55e; color:#fff; border-color:#22c55e; }
      #bf-overlay .bf-act.primary:hover { background:#16a34a; }
      #bf-overlay .bf-act.assign { background:#f59e0b; color:#fff; border-color:#f59e0b; }
      #bf-overlay .bf-act.assign:hover { background:#d97706; }
      #bf-overlay .bf-form { background:#f8fafc; border:1px solid var(--color-line,#e5e7eb); border-radius:10px; padding:14px 16px; margin-top:10px; display:grid; gap:10px; }
      #bf-overlay .bf-form[hidden] { display:none; }
      #bf-overlay .bf-form .row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
      #bf-overlay .bf-form .f { display:flex; flex-direction:column; gap:4px; }
      #bf-overlay .bf-form label { font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--color-muted); }
      #bf-overlay .bf-form input, #bf-overlay .bf-form select { padding:8px 10px; border:1px solid var(--color-line,#e5e7eb); border-radius:8px; font-size:.9rem; background:#fff; }
      #bf-overlay .bf-form .save { background:#22c55e; color:#fff; border:none; border-radius:8px; padding:9px 18px; font-weight:700; cursor:pointer; font-size:.86rem; }
      /* display en CSS (no inline) para que el atributo [hidden] sí oculte el toggle */
      #bf-overlay .bf-total-show { display:inline-flex; align-items:center; gap:6px; }
      #bf-overlay .bf-total-show[hidden] { display:none; }
      #bf-overlay .bf-total-edit-box { display:inline-flex; align-items:center; gap:4px; margin-top:4px; }
      #bf-overlay .bf-total-edit-box[hidden] { display:none; }
      #bf-overlay .bf-section-title { font-size:.74rem; text-transform:uppercase; letter-spacing:.05em; color:var(--color-muted); font-weight:700; margin:0 0 8px; }
      #bf-overlay .bf-cred-pill { font-size:.7rem; font-weight:700; padding:2px 8px; border-radius:99px; background:#e0f2fe; color:#075985; }
      #bf-overlay .bf-bar { height:8px; background:#eef0f2; border-radius:99px; overflow:hidden; margin:8px 0 4px; }
      #bf-overlay .bf-chip { font-size:.74rem; padding:4px 11px; border-radius:99px; background:#e0f2fe; color:#075985; font-weight:700; }
      #bf-overlay table { width:100%; }
    </style>
    <div class="ns-panel">
      <header class="ns-header">
        <div>
          <h2>Reserva de ${esc(typeLbl)}</h2>
          <p>${esc(cliName)}${cli.phone ? ' · ' + esc(cli.phone) : ''}${cli.email ? ' · ' + esc(cli.email) : ''}</p>
        </div>
        ${cli.id ? `<button id="bf-open-client" title="Ver ficha del cliente" style="margin-left:auto;margin-right:8px;font-size:.78rem;font-weight:600;padding:7px 14px;color:#1a1a1a;background:#fff;border:1px solid #bae6fd;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap">Ver ficha del cliente<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>` : ''}
        <button class="ns-close" id="bf-close" title="Cerrar"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </header>
      <div class="ns-body" style="padding:24px 32px">
        <!-- Resumen (ancho completo) -->
        <div class="bf-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div style="font-weight:800;font-size:1.15rem;color:var(--color-navy,#0f2f39)">${esc(cliName)}</div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              ${statusBadge(bono.status)}
              ${fullyPaid ? '<span style="font-size:.7rem;font-weight:800;padding:3px 9px;border-radius:5px;background:#dcfce7;color:#166534">PAGADO</span>'
                : `<span style="font-size:.7rem;font-weight:800;padding:3px 9px;border-radius:5px;background:#fef3c7;color:#92400e">DEBE ${formatCurrency(pending)}</span>`}
              ${bono.order_id != null ? '<span style="font-size:.66rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:2px 6px">comprado online</span>' : ''}
            </div>
          </div>

          <div class="bf-kpis">
            <div class="bf-kpi"><div class="l">Clases usadas</div><div class="v">${bono.used_credits}/${bono.total_credits}</div></div>
            <div class="bf-kpi ${remaining > 0 ? 'pending' : ''}"><div class="l">Pendientes de asignar</div><div class="v">${remaining}</div></div>
            <div class="bf-kpi"><div class="l">Pagado</div><div class="v">${formatCurrency(paid)}</div></div>
            ${overpaid > 0 ? `<div class="bf-kpi" style="background:#ecfdf5;border-color:#a7f3d0"><div class="l" style="color:#065f46">Saldo a favor</div><div class="v" style="color:#059669">${formatCurrency(overpaid)}</div></div>` : ''}
            <div class="bf-kpi"><div class="l">Total del bono</div>
              <div class="v bf-total-show">${formatCurrency(expected)}
                <button class="bf-total-edit" title="Editar total" style="background:none;border:none;color:#1a1a1a;cursor:pointer;font-size:.95rem">✎</button>
              </div>
              <span class="bf-total-edit-box" hidden>
                <input type="number" step="0.01" min="0" class="bf-total-input" value="${expected.toFixed(2)}" style="width:90px;padding:4px 6px;border:1px solid #1a1a1a;border-radius:6px" />
                <button class="bf-total-save" style="background:none;border:none;color:#16a34a;cursor:pointer;font-weight:700;font-size:1.05rem">✓</button>
                <button class="bf-total-cancel" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:1.05rem">✕</button>
              </span>
            </div>
            <div class="bf-kpi"><div class="l">Caduca</div><div class="v" style="font-size:1rem">${formatDate(bono.expires_at)}</div></div>
          </div>
          <div class="bf-bar"><div style="height:100%;width:${pct}%;background:${fullyPaid ? '#22c55e' : '#f59e0b'}"></div></div>

          <div class="bf-actions">
            ${canAssign ? `<button class="bf-act assign" data-form="assign">Asignar clase pendiente (${remaining})</button>` : ''}
            ${canPay ? `<button class="bf-act primary" data-form="pay">Añadir pago</button>` : ''}
            <button class="bf-act" id="bf-extend-assign">Ampliar y asignar ahora</button>
            <button class="bf-act" data-form="extend">Solo sumar créditos</button>
            <button class="bf-act" data-form="newbono">+ Bono de otro tipo</button>
            <button class="bf-act" data-form="edit">Editar / corregir</button>
            <button class="bf-act" id="bf-delete" style="margin-left:auto;color:#b91c1c;border-color:#fecaca">Eliminar bono</button>
          </div>

          ${canAssign ? `
          <!-- Form: asignar una clase pendiente (gasta un crédito ya pagado) -->
          <div class="bf-form" id="bf-form-assign" hidden>
            <div class="row">
              <div class="f"><label>Participante</label><select id="bf-as-who">${assignWhoOpts}</select></div>
              <div class="f" style="flex:1;min-width:220px"><label>Clase</label><select id="bf-as-class">${assignClassOpts}</select></div>
              <button class="save" id="bf-as-save">Asignar clase</button>
            </div>
            <p style="font-size:.74rem;color:var(--color-muted);margin:0">Gasta uno de los ${remaining} crédito(s) pendiente(s) en la clase elegida. No genera cobro (ya está pagado en el bono).</p>
          </div>` : ''}

          ${canPay ? `
          <!-- Form: añadir pago (solo si el bono admite cobro) -->
          <div class="bf-form" id="bf-form-pay" hidden>
            <div class="row">
              <div class="f"><label>Importe (€)</label><input type="number" id="bf-pay-amount" step="0.01" min="0.01" value="${pending > 0 ? pending.toFixed(2) : ''}" style="width:120px" /></div>
              <div class="f"><label>Método</label><select id="bf-pay-method">${methodOpts}</select></div>
              <button class="save" id="bf-pay-save">Registrar pago</button>
            </div>
          </div>` : ''}

          <!-- Form: ampliar (solo créditos) -->
          <div class="bf-form" id="bf-form-extend" hidden>
            <div class="row">
              <div class="f"><label>Añadir clases</label><input type="number" id="bf-ext-credits" min="1" value="1" style="width:90px" /></div>
              <div class="f"><label>Cobrar ahora (€)</label><input type="number" id="bf-ext-charge" step="0.01" min="0" style="width:120px" /></div>
              <div class="f"><label>Método</label><select id="bf-ext-method">${methodOpts}</select></div>
              <button class="save" id="bf-ext-save">Ampliar</button>
            </div>
            <p style="font-size:.74rem;color:var(--color-muted);margin:0">El valor del bono sube por el precio de las clases añadidas. <a href="#" id="bf-ext-pending" style="color:#d97706;font-weight:600;text-decoration:underline">Dejar pendiente</a> si no cobras ahora (pone Cobrar = 0 y aparece como deuda del cliente).</p>
          </div>

          <!-- Form: nuevo bono de otro tipo -->
          <div class="bf-form" id="bf-form-newbono" hidden>
            <div class="row">
              <div class="f"><label>Tipo de clase</label><select id="bf-nb-type">${typeOpts}</select></div>
              <div class="f"><label>Nº clases</label><input type="number" id="bf-nb-credits" min="1" value="4" style="width:90px" /></div>
              <div class="f"><label>Total (€)</label><input type="number" id="bf-nb-total" step="0.01" min="0" style="width:120px" /></div>
            </div>
            <div class="row">
              <div class="f"><label>Cobrar ahora (€)</label><input type="number" id="bf-nb-paid" step="0.01" min="0" value="0" style="width:120px" /></div>
              <div class="f"><label>Método</label><select id="bf-nb-method">${methodOpts}</select></div>
              <button class="save" id="bf-nb-save">Crear bono</button>
            </div>
            <p style="font-size:.74rem;color:var(--color-muted);margin:0">Crea un bono nuevo del tipo elegido para <strong>${esc(cliName)}</strong> y abre su ficha.</p>
          </div>

          <!-- Form: editar / corregir el bono -->
          <div class="bf-form" id="bf-form-edit" hidden>
            <div class="row">
              <div class="f"><label>Tipo de clase</label><select id="bf-ed-type">${Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${v === bono.class_type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="f"><label>Nº clases (mín. ${bono.used_credits || 0})</label><input type="number" id="bf-ed-credits" min="${bono.used_credits || 0}" value="${bono.total_credits || 0}" style="width:90px" /></div>
              <div class="f"><label>Caduca</label><input type="date" id="bf-ed-expiry" value="${(bono.expires_at || '').slice(0, 10)}" /></div>
              <div class="f"><label>Total (€)</label><input type="number" id="bf-ed-total" step="0.01" min="0" value="${bono.custom_total != null ? Number(bono.custom_total).toFixed(2) : ''}" placeholder="auto" style="width:110px" /></div>
            </div>
            <div class="row" style="position:relative">
              <div class="f" style="flex:1;min-width:240px"><label>Cambiar titular <span style="font-weight:400;color:var(--color-muted)">(opcional)</span></label>
                <input type="text" id="bf-ed-titular" placeholder="Buscar cliente por nombre/email…" autocomplete="off" />
                <div id="bf-ed-titular-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:20;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,47,57,.12);max-height:200px;overflow:auto"></div>
                <div id="bf-ed-titular-chip" style="display:none;margin-top:6px;font-size:.82rem;color:#065f46"></div>
              </div>
              <button class="save" id="bf-ed-save">Guardar cambios</button>
            </div>
            <p style="font-size:.74rem;color:var(--color-muted);margin:0">No puedes bajar de las clases ya usadas (${bono.used_credits || 0}). Cambiar el tipo o el titular pedirá confirmación si el bono ya tiene clases asignadas.</p>
          </div>

          ${hasFamily ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-line,#e5e7eb)">
            <div class="bf-section-title">Participantes · Responsable: ${esc(cliName)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${breakdown.map(m => `<span class="bf-chip">${esc(m.name)}: ${m.n} clase${m.n === 1 ? '' : 's'}</span>`).join('')}
            </div>
          </div>` : ''}
        </div>

        <!-- Histórico + Pagos (2 columnas) -->
        <div class="bf-cols">
          <div>
            <div class="bf-section-title">Histórico de clases (${enrollSorted.length})</div>
            <div class="table-wrap"><table><thead><tr><th>Día</th><th>Hora</th><th>Asistente</th><th>Clase</th><th style="text-align:center">Crédito</th><th>Estado</th></tr></thead><tbody>${enrollHtml}</tbody></table></div>
          </div>
          <div>
            <div class="bf-section-title">Pagos (${payments.length})</div>
            <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Importe</th><th>Método</th><th>Origen</th><th></th></tr></thead><tbody>${payHtml}</tbody></table></div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const reload = async () => { close(); if (onChange) await onChange(); await openBonoFicha(bonoId, { onChange }); };
  overlay.querySelector('#bf-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Ver ficha del cliente (titular del bono) → abre la sección Clientes
  overlay.querySelector('#bf-open-client')?.addEventListener('click', () => {
    if (!cli.id) { showToast('Este bono no tiene cliente con cuenta', 'error'); return; }
    window.__openClientId = cli.id;
    overlay.remove();
    // La ficha de bono puede abrirse ESTANDO ya en #clientes; ahí el hash no
    // cambia y no se re-renderiza, así que forzamos el evento.
    if (location.hash === '#clientes') window.dispatchEvent(new Event('hashchange'));
    else location.hash = '#clientes';
  });

  // Toggle de formularios de acción (uno visible a la vez)
  overlay.querySelectorAll('.bf-act[data-form]').forEach(btn => btn.addEventListener('click', () => {
    const target = btn.dataset.form;
    ['pay', 'extend', 'newbono', 'assign', 'edit'].forEach(k => {
      const el = overlay.querySelector(`#bf-form-${k}`);
      if (el) el.hidden = (k !== target) ? true : !el.hidden;
    });
  }));

  // Asignar una clase pendiente: crea la inscripción con este bono (gasta un crédito
  // ya pagado). El trigger update_bono_credits descuenta el crédito y ocupa la plaza.
  overlay.querySelector('#bf-as-save')?.addEventListener('click', async () => {
    const classId = overlay.querySelector('#bf-as-class')?.value;
    if (!classId) { showToast('Elige una clase', 'error'); return; }
    const whoId = overlay.querySelector('#bf-as-who')?.value || '';
    const cls = assignClasses.find(c => c.id === classId);
    if (cls && Number(cls.enrolled_count || 0) >= Number(cls.max_students || 0)) {
      if (!confirm('Esa clase está completa. ¿Asignar igualmente (sobrecupo)?')) return;
    }
    const enrollData = { class_id: classId, bono_id: bonoId, status: 'confirmed', user_id: bono.user_id, created_at: new Date().toISOString() };
    if (whoId) {
      const fm = familyMembers.find(f => f.id === whoId);
      enrollData.family_member_id = whoId;
      enrollData.guest_name = fm ? ((fm.full_name || '') + (fm.last_name ? ' ' + fm.last_name : '')).trim() : null;
    }
    try {
      const { error } = await supabase.from('class_enrollments').insert(enrollData);
      if (error) throw error;
      // Aviso de confirmación al cliente (fire-and-forget; no bloquea la asignación)
      (async () => {
        try {
          let email = null;
          if (bono.user_id) { const { data } = await supabase.rpc('get_user_email', { p_user_id: bono.user_id }); email = data || null; }
          if (email && cls) {
            const fmtD = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return d || ''; } };
            await supabase.functions.invoke('send-email', { body: { to: email, type: 'class_booked', data: { customerName: cliName || '', className: cls.title || cls.type || 'Clase', classDate: fmtD(cls.date), classTime: (cls.time_start || '').slice(0, 5), instructor: cls.instructor || '' } } });
          }
        } catch {}
      })();
      showToast('Clase asignada · crédito gastado', 'success');
      await reload();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // "Ampliar y asignar ahora": abre el asistente de reserva pre-rellenado con el titular y
  // fijado al tipo del bono. Reusa TODO el flujo del panel (déficit → extendBono → inscripciones
  // → triggers). El panel vive en la sección Calendario; se expone vía window.__openBonoExtendAssist.
  overlay.querySelector('#bf-extend-assign')?.addEventListener('click', async () => {
    if (typeof window.__openBonoExtendAssist !== 'function') {
      showToast('Abre la sección Calendario una vez y reintenta', 'error'); return;
    }
    const prof = bono.profiles || {};
    const prefill = {
      nombre: prof.full_name || '', apellidos: prof.last_name || '',
      profileId: bono.user_id || null, profileName: cliName || prof.full_name || null,
      familyMemberId: null, email: prof.email || '',
    };
    close();
    await window.__openBonoExtendAssist(bono, prefill);
  });

  // Editar total in-place
  overlay.querySelector('.bf-total-edit')?.addEventListener('click', () => {
    overlay.querySelector('.bf-total-show').hidden = true;
    overlay.querySelector('.bf-total-edit-box').hidden = false;
    overlay.querySelector('.bf-total-input')?.focus();
  });
  overlay.querySelector('.bf-total-cancel')?.addEventListener('click', () => {
    overlay.querySelector('.bf-total-edit-box').hidden = true;
    overlay.querySelector('.bf-total-show').hidden = false;
  });
  overlay.querySelector('.bf-total-save')?.addEventListener('click', async () => {
    const v = parseFloat(overlay.querySelector('.bf-total-input').value);
    if (isNaN(v) || v < 0) { showToast('Total inválido', 'error'); return; }
    try { await extendBono(bonoId, { newCustomTotal: v }); showToast('Total actualizado', 'success'); await reload(); }
    catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Añadir pago
  overlay.querySelector('#bf-pay-save')?.addEventListener('click', async () => {
    const amount = parseFloat(overlay.querySelector('#bf-pay-amount').value);
    if (!amount || amount <= 0) { showToast('Importe inválido', 'error'); return; }
    const method = overlay.querySelector('#bf-pay-method').value;
    try {
      await createPayment({ reservation_type: 'bono', reference_id: bonoId, amount, payment_method: method, concept: `Pago bono ${typeLbl}` });
      await recalcBonoPaid(bonoId);
      showToast('Pago registrado', 'success');
      await reload();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Ampliar: sugiere el cobro al cambiar el nº de clases
  const extCredits = overlay.querySelector('#bf-ext-credits');
  const extCharge = overlay.querySelector('#bf-ext-charge');
  function suggestExtCharge() {
    const extra = parseInt(extCredits.value, 10) || 0;
    const newTotal = (bono.total_credits || 0) + extra;
    // Precio MARGINAL: incremento del pack (clases extra al extra_class_price configurado),
    // no un pack pequeño. base = créditos actuales del bono.
    extCharge.value = Math.max(0, round2(getPackPrice(bono.class_type, newTotal) - getPackPrice(bono.class_type, bono.total_credits || 0))).toFixed(2);
  }
  extCredits?.addEventListener('input', suggestExtCharge);
  if (extCredits) suggestExtCharge();
  // "Dejar pendiente": cobra 0 ahora (el valor del bono sube igual; queda como deuda).
  overlay.querySelector('#bf-ext-pending')?.addEventListener('click', (e) => { e.preventDefault(); if (extCharge) extCharge.value = '0'; });
  overlay.querySelector('#bf-ext-save')?.addEventListener('click', async () => {
    const extra = parseInt(overlay.querySelector('#bf-ext-credits').value, 10);
    if (!extra || extra <= 0) { showToast('Indica cuántas clases añadir', 'error'); return; }
    const charge = parseFloat(overlay.querySelector('#bf-ext-charge').value);
    if (isNaN(charge) || charge < 0) { showToast('Importe inválido', 'error'); return; }
    const method = overlay.querySelector('#bf-ext-method').value;
    const newTotal = (bono.total_credits || 0) + extra;
    try {
      // El valor del bono sube por el PRECIO del pack de las clases añadidas, NO por lo
      // que se cobre ahora. Cobrar es independiente (0 = dejar pendiente → queda como deuda).
      // Valor añadido = precio marginal del catálogo (clases extra al extra_class_price),
      // preservando cualquier descuento sobre las clases originales.
      const valueAdded = Math.max(0, round2(getPackPrice(bono.class_type, newTotal) - getPackPrice(bono.class_type, bono.total_credits || 0)));
      const newCustomTotal = bono.custom_total != null ? round2(Number(bono.custom_total) + valueAdded) : null;
      await extendBono(bonoId, { newTotalCredits: newTotal, newCustomTotal, status: 'active', expires_at: defaultBonoExpiry() });
      if (charge > 0) {
        await createPayment({ reservation_type: 'bono', reference_id: bonoId, amount: charge, payment_method: method, concept: `Ampliación bono ${typeLbl} (+${extra})` });
      }
      await recalcBonoPaid(bonoId);
      showToast(`Bono ampliado +${extra} clases`, 'success');
      await reload();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Nuevo bono de otro tipo: sugiere total al cambiar tipo/clases
  const nbType = overlay.querySelector('#bf-nb-type');
  const nbCredits = overlay.querySelector('#bf-nb-credits');
  const nbTotal = overlay.querySelector('#bf-nb-total');
  function suggestNbTotal() {
    const t = nbType.value;
    const n = parseInt(nbCredits.value, 10) || 0;
    nbTotal.value = round2(getPackPrice(t, n)).toFixed(2);
  }
  nbType?.addEventListener('change', suggestNbTotal);
  nbCredits?.addEventListener('input', suggestNbTotal);
  if (nbType) suggestNbTotal();
  overlay.querySelector('#bf-nb-save')?.addEventListener('click', async () => {
    const classType = nbType.value;
    const credits = parseInt(nbCredits.value, 10);
    if (!credits || credits <= 0) { showToast('Nº de clases inválido', 'error'); return; }
    const total = parseFloat(nbTotal.value);
    if (isNaN(total) || total < 0) { showToast('Total inválido', 'error'); return; }
    const amount = parseFloat(overlay.querySelector('#bf-nb-paid').value) || 0;
    const method = overlay.querySelector('#bf-nb-method').value;
    if (!bono.user_id) { showToast('Este bono no tiene cliente asociado', 'error'); return; }
    try {
      const newId = await createBono({
        user_id: bono.user_id, class_type: classType, total_credits: credits,
        custom_total: total, total_paid: 0, expires_at: defaultBonoExpiry(),
      });
      if (amount > 0 && newId) {
        await createPayment({ reservation_type: 'bono', reference_id: newId, amount, payment_method: method, concept: `Nuevo bono ${TYPE_LABELS[classType] || classType} (${credits} clases)` });
        await recalcBonoPaid(newId);
      }
      showToast(`Bono de ${TYPE_LABELS[classType] || classType} creado`, 'success');
      close();
      if (onChange) await onChange();
      if (newId) await openBonoFicha(newId, { onChange });
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Editar / corregir el bono. Buscador de titular (vincula a cliente existente, no duplica).
  let edNewTitular = null; // { id, name }
  {
    const search = overlay.querySelector('#bf-ed-titular');
    const results = overlay.querySelector('#bf-ed-titular-results');
    const chip = overlay.querySelector('#bf-ed-titular-chip');
    let timer = null;
    search?.addEventListener('input', () => {
      clearTimeout(timer);
      const term = search.value.trim();
      if (term.length < 2) { results.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        const res = await searchProfiles(term);
        results.innerHTML = res.length
          ? res.map(p => `<div class="bf-ed-opt" data-id="${p.id}" data-name="${esc(p.full_name || '')}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:.86rem">${esc(p.full_name || 'Sin nombre')}${p.phone ? ` · <span style="color:#64748b">${esc(p.phone)}</span>` : ''}</div>`).join('')
          : '<div style="padding:9px;color:#94a3b8;font-size:.84rem">Sin resultados</div>';
        results.style.display = '';
      }, 250);
    });
    results?.addEventListener('click', (e) => {
      const opt = e.target.closest('.bf-ed-opt');
      if (!opt) return;
      edNewTitular = { id: opt.dataset.id, name: opt.dataset.name };
      results.style.display = 'none';
      search.value = '';
      chip.innerHTML = `✓ Nuevo titular: <strong>${esc(edNewTitular.name)}</strong> <button type="button" id="bf-ed-titular-clear" style="background:none;border:none;color:#b91c1c;text-decoration:underline;cursor:pointer;font-size:.8rem">quitar</button>`;
      chip.style.display = '';
    });
    chip?.addEventListener('click', (e) => {
      if (e.target.id !== 'bf-ed-titular-clear') return;
      edNewTitular = null; chip.style.display = 'none';
    });
  }
  overlay.querySelector('#bf-ed-save')?.addEventListener('click', async () => {
    const used = bono.used_credits || 0;
    const credits = parseInt(overlay.querySelector('#bf-ed-credits').value, 10);
    if (!credits || credits < 1) { showToast('Nº de clases inválido', 'error'); return; }
    if (credits < used) { showToast(`No puedes bajar de las ${used} clase(s) ya usadas`, 'error'); return; }
    const newType = overlay.querySelector('#bf-ed-type').value;
    const expiryVal = overlay.querySelector('#bf-ed-expiry').value;
    const totalVal = overlay.querySelector('#bf-ed-total').value;
    const hasEnrolls = (enrollSorted?.length || used) > 0;
    if (newType !== bono.class_type && hasEnrolls) {
      if (!confirm('Este bono ya tiene clases asignadas de su tipo actual. Cambiar el tipo NO cambia las clases ya asignadas. ¿Continuar?')) return;
    }
    if (edNewTitular && hasEnrolls) {
      if (!confirm(`Reasignar este bono a ${edNewTitular.name}. Las clases ya asignadas seguirán bajo el bono. ¿Continuar?`)) return;
    }
    const fields = {
      class_type: newType,
      total_credits: credits,
      custom_total: totalVal === '' ? null : (parseFloat(totalVal) || 0),
      status: bono.status === 'cancelled' || bono.status === 'expired' ? bono.status : (used >= credits ? 'exhausted' : 'active'),
    };
    if (expiryVal) fields.expires_at = new Date(expiryVal + 'T00:00:00').toISOString();
    if (edNewTitular) fields.user_id = edNewTitular.id;
    try {
      await updateBonoFields(bonoId, fields);
      showToast('Bono actualizado', 'success');
      await reload();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Eliminar bono completo: borra el bono, sus pagos y (por FK on delete cascade) sus
  // inscripciones; los triggers recalculan el aforo de cada clase afectada.
  overlay.querySelector('#bf-delete')?.addEventListener('click', async () => {
    const used = bono.used_credits || 0;
    const warn = used > 0
      ? `Este bono tiene ${used} clase(s) ya asignada(s); se cancelarán al borrarlo. `
      : '';
    if (!confirm(`¿Enviar a la papelera el bono de ${typeLbl}? ${warn}Podrás restaurarlo desde Papelera.`)) return;
    try {
      await moveToTrash('bono', bonoId, `Bono ${typeLbl} · ${cliName}`);
      showToast('Bono enviado a la papelera', 'success');
      close();
      if (onChange) await onChange();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  });

  // Editar / borrar pagos (manuales)
  overlay.querySelectorAll('.bf-pay-edit').forEach(b => b.addEventListener('click', () => {
    const p = payments.find(x => x.id === b.dataset.id);
    if (p) openPaymentEditModal(p, { onSaved: async () => { await recalcBonoPaid(bonoId); await reload(); } });
  }));
  overlay.querySelectorAll('.bf-pay-del').forEach(b => b.addEventListener('click', async () => {
    const p = payments.find(x => x.id === b.dataset.id);
    if (!p || !confirm(`¿Eliminar el pago de ${formatCurrency(p.amount)}?`)) return;
    try { await deletePayment(p.id); await recalcBonoPaid(bonoId); showToast('Pago eliminado', 'success'); await reload(); }
    catch (err) { showToast('Error: ' + err.message, 'error'); }
  }));
}
