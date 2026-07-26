/* ============================================================
   Modal de edición de pago — reutilizable
   ============================================================ */
import { updatePayment as updatePaymentBase } from './api.js';
import { showToast } from './ui.js';
import { supabase } from '/lib/supabase.js';

// Wrapper local: permite también editar el channel.
// La versión de api.js solo deja método/fecha/concepto por seguridad,
// pero desde este modal necesitamos también channel (ej: transferencia
// desde casa = channel 'web' aunque no haya pasado por Stripe).
async function updatePayment(id, patch) {
  const allowed = {};
  ['payment_method', 'payment_date', 'concept', 'channel'].forEach(k => {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  });
  if (!Object.keys(allowed).length) return;
  const { error } = await supabase.from('payments').update(allowed).eq('id', id);
  if (error) throw error;
}

const esc = (s) => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const METHODS_BY_CHANNEL = {
  in_person: [
    { v: 'efectivo',      l: 'Efectivo' },
    { v: 'tarjeta',       l: 'Tarjeta (TPV en playa)' },
    { v: 'transferencia', l: 'Transferencia' },
    { v: 'voucher',       l: 'Voucher' },
    { v: 'saldo',         l: 'Saldo a favor' },
  ],
  web: [
    { v: 'online',        l: 'Online (Stripe)' },
    { v: 'transferencia', l: 'Transferencia' },
  ],
};

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const CHANNEL_OPTIONS = [
  { v: 'in_person', l: 'Manual / presencial (caja, transferencia, etc.)' },
  { v: 'web',       l: 'Web (Stripe automático)' },
];

function methodsForChannel(channel) {
  return [...(METHODS_BY_CHANNEL[channel] || METHODS_BY_CHANNEL.in_person)];
}

export function openPaymentEditModal(payment, { onSaved } = {}) {
  let currentChannel = payment.channel || 'in_person';
  let currentMethod  = payment.payment_method;

  const modal = document.createElement('div');
  modal.id = 'payment-edit-modal';
  modal.innerHTML = `
    <style>
      #payment-edit-modal {
        position:fixed;inset:0;z-index:10010;background:rgba(15,47,57,.55);
        display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);
      }
      .pe-dialog {
        background:#fffdf7;width:min(440px,calc(100% - 32px));max-height:90vh;overflow-y:auto;
        border-radius:14px;box-shadow:0 24px 64px rgba(15,47,57,.25);
        animation:peIn .2s cubic-bezier(.22,1,.36,1);
      }
      @keyframes peIn { from { transform:scale(.96);opacity:0 } to { transform:scale(1);opacity:1 } }
      .pe-head {
        display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e5e7eb;
      }
      .pe-head h3 { margin:0;font-family:'Space Grotesk',sans-serif;color:#0f2f39;font-size:1.05rem; }
      .pe-close {
        width:30px;height:30px;border-radius:50%;border:0;background:#f3f4f6;cursor:pointer;
        font-size:1.1rem;color:#6b7280;display:flex;align-items:center;justify-content:center;
      }
      .pe-body { padding:18px 22px 22px;display:flex;flex-direction:column;gap:12px; }
      .pe-body label { font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280; }
      .pe-body input, .pe-body select, .pe-body textarea {
        background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:9px 12px;
        font-family:'Space Grotesk',sans-serif;font-size:.92rem;color:#0f2f39;width:100%;
      }
      .pe-body input:disabled { background:#f9fafb;color:#6b7280; }
      .pe-row { display:flex;flex-direction:column;gap:4px; }
      .pe-save {
        margin-top:6px;background:#0f2f39;color:#fff;border:0;border-radius:999px;
        padding:12px 22px;font-family:'Space Grotesk',sans-serif;font-weight:700;
        font-size:.92rem;cursor:pointer;width:100%;
      }
      .pe-save:hover { background:#0a1f25; }
      .pe-save:disabled { opacity:.6;cursor:not-allowed; }
      .pe-info { font-size:.78rem;color:#6b7280;background:#f9fafb;padding:9px 11px;border-radius:8px;border:1px solid #e5e7eb; }
      .pe-info strong { color:#0f2f39; }
      .pe-hint { font-size:.72rem;color:#6b7280;margin-top:-2px; }
    </style>
    <div class="pe-dialog">
      <div class="pe-head">
        <h3>Editar pago · ${formatAmount(payment.amount)}</h3>
        <button type="button" class="pe-close" aria-label="Cerrar">&times;</button>
      </div>
      <form class="pe-body">
        <div class="pe-info">
          <strong>Importe:</strong> ${formatAmount(payment.amount)} <em style="color:#6b7280">(no editable; bórralo y crea otro si necesitas cambiarlo)</em>
        </div>

        <div class="pe-row">
          <label>Canal</label>
          <select id="pe-channel">
            ${CHANNEL_OPTIONS.map(c => `<option value="${esc(c.v)}" ${c.v === currentChannel ? 'selected' : ''}>${esc(c.l)}</option>`).join('')}
          </select>
          <span class="pe-hint">Usa "Manual" si lo cobraste tú (en playa, transferencia desde casa, voucher, etc.). "Web" solo para pagos automáticos por Stripe.</span>
        </div>

        <div class="pe-row">
          <label>Método de pago</label>
          <select id="pe-method"></select>
        </div>

        <div class="pe-row">
          <label>Fecha y hora</label>
          <input type="datetime-local" id="pe-date" value="${toDatetimeLocalValue(payment.payment_date)}" />
        </div>

        <div class="pe-row">
          <label>Concepto (opcional)</label>
          <input type="text" id="pe-concept" value="${esc(payment.concept || '')}" placeholder="Ej: Resto surf camp pagado por transferencia" />
        </div>

        <button type="submit" class="pe-save">Guardar cambios</button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.pe-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const channelSel = modal.querySelector('#pe-channel');
  const methodSel = modal.querySelector('#pe-method');

  function refreshMethods() {
    const methods = methodsForChannel(currentChannel);
    if (!methods.find(m => m.v === currentMethod)) {
      methods.unshift({ v: currentMethod, l: currentMethod });
    }
    methodSel.innerHTML = methods.map(m => `<option value="${esc(m.v)}" ${m.v === currentMethod ? 'selected' : ''}>${esc(m.l)}</option>`).join('');
  }
  refreshMethods();

  channelSel.addEventListener('change', (e) => {
    currentChannel = e.target.value;
    // Si el método actual no encaja con el canal nuevo, intenta uno por defecto
    const fits = methodsForChannel(currentChannel).find(m => m.v === currentMethod);
    if (!fits) currentMethod = methodsForChannel(currentChannel)[0]?.v || currentMethod;
    refreshMethods();
  });
  methodSel.addEventListener('change', (e) => { currentMethod = e.target.value; });

  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = modal.querySelector('.pe-save');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const dateLocal = modal.querySelector('#pe-date').value;
      const concept = modal.querySelector('#pe-concept').value.trim();
      const payment_date = dateLocal ? new Date(dateLocal).toISOString() : undefined;

      await updatePayment(payment.id, {
        channel: currentChannel,
        payment_method: currentMethod,
        payment_date,
        concept: concept || null,
      });
      showToast('Pago actualizado', 'success');
      close();
      if (onSaved) await onSaved();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    }
  });
}

function formatAmount(amount) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(amount || 0));
}
