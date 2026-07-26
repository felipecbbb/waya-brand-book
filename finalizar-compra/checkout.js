/* ============================================================
   Checkout — Waya Surf School  (/finalizar-compra/)
   Portado de Entreolas y adaptado al contrato Waya.

   Flujo:
     1. Lee el carrito de /lib/cart.js (localStorage 'waya_cart_v1').
     2. Si hay packs de clases (type 'class_reservation') exige LOGIN
        (los bonos se vinculan a user_id) → panel de auth inline.
     3. Valida el cupón vía RPC 'get_coupon' (SECURITY DEFINER; solo
        devuelve el cupón si conoces el código exacto y está activo).
     4. Al enviar invoca la edge function 'create-checkout' con
        items + customer + couponCode + successUrl → redirige a la
        pasarela SumUp (F4). El precio real lo revalida el servidor.
     5. Al volver con ?success=1 (o ?pago=ok): limpia el carrito
        (clearCart) y muestra la confirmación con enlace a /mi-cuenta/.

   Tipos de item (contrato /lib/cart.js):
     product | class_reservation | rental | camp
   ============================================================ */

import { getCart, getCartTotal, clearCart, updateCartPill } from '/lib/cart.js';
import { getSession, getProfile, signIn, signUp } from '/lib/auth-client.js';
import { supabase } from '/lib/supabase.js';
import { phonePrefixSelectHtml, wirePhonePrefix } from '/lib/shared-constants.js';
import { esc, formatPrice, showToast, TYPE_LABELS } from '/lib/utils.js';

// --- Referencias a las tres vistas del shell ---
const viewMain = document.getElementById('co-main');
const viewEmpty = document.getElementById('co-empty');
const viewSuccess = document.getElementById('co-success');
const formWrap = document.getElementById('co-form-wrap');
const authSlot = document.getElementById('co-auth-slot');
const summaryWrap = document.getElementById('co-summary');

function show(view) {
  [viewMain, viewEmpty, viewSuccess].forEach(v => { if (v) v.hidden = (v !== view); });
}

/* Re-aplica traducciones a los nodos data-i18n inyectados dinámicamente.
   i18n.js expone updateTranslations(lang) como global (script clásico).
   Las claves checkout.* que aún no existan conservan su texto por defecto
   en español (fallback seguro). */
function reapplyI18n() {
  try {
    const lang = document.documentElement.lang || localStorage.getItem('language') || 'es';
    if (typeof window.updateTranslations === 'function') window.updateTranslations(lang);
  } catch { /* i18n opcional */ }
}

// Etiqueta legible del item para el resumen.
function itemLabel(i) {
  const name = esc(i.name || TYPE_LABELS[i.metadata?.classType] || 'Artículo');
  if (i.type === 'class_reservation') return `${name} <small>(anticipo)</small>`;
  if (i.type === 'camp') return `${name} <small>(señal)</small>`;
  if (i.type === 'rental') return `${name} <small>(alquiler)</small>`;
  return `${name} × ${i.quantity}`;
}

async function init() {
  // ---- 1. Retorno de la pasarela: éxito ----
  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === '1' || params.get('pago') === 'ok') {
    clearCart();          // el webhook es la fuente de verdad; aquí solo vaciamos el local
    updateCartPill();
    show(viewSuccess);
    reapplyI18n();
    return;
  }

  // ---- 2. Carrito vacío ----
  const cart = getCart();
  if (!cart.length) {
    show(viewEmpty);
    reapplyI18n();
    return;
  }

  show(viewMain);

  const session = await getSession();
  const hasClassPacks = cart.some(i => i.type === 'class_reservation');
  const hasProducts = cart.some(i => i.type === 'product');

  // Bloque de envío solo si hay productos físicos.
  const shipping = document.getElementById('co-shipping');
  if (shipping && hasProducts) {
    shipping.hidden = false;
    shipping.querySelectorAll('input').forEach(inp => {
      if (['direccion', 'ciudad', 'cp'].includes(inp.name)) inp.required = true;
    });
  }

  // ---- Auth: packs de clases exigen login; login-obligatorio general ----
  if (!session) renderAuthPanel(hasClassPacks);

  let profile = null;
  if (session) profile = await getProfile();

  // ---- 3. Resumen + cupón ----
  const cartTotal = getCartTotal();
  let appliedCoupon = null;
  let discount = 0;

  function renderSummary() {
    const rows = cart.map(i =>
      `<div class="co-sum-item"><span class="name">${itemLabel(i)}</span><span class="amt">${formatPrice(i.price * i.quantity)}</span></div>`
    ).join('');

    const finalTotal = Math.max(cartTotal - discount, 0);

    summaryWrap.innerHTML = `
      <h3 data-i18n="checkout.summary">Resumen del pedido</h3>
      ${rows}
      <div class="co-sum-total"><span data-i18n="checkout.subtotal">Subtotal</span><span>${formatPrice(cartTotal)}</span></div>
      ${appliedCoupon ? `
        <div class="co-sum-item" style="color:#166534;font-weight:600">
          <span>Cupón ${esc(appliedCoupon.code)}</span>
          <span>-${formatPrice(discount)}</span>
        </div>` : ''}
      <div class="co-sum-total co-sum-final"><span data-i18n="checkout.total">Total a pagar</span><span>${formatPrice(finalTotal)}</span></div>

      <div class="co-coupon">
        <label data-i18n="checkout.coupon">Código de descuento</label>
        <div class="co-coupon-row">
          <input type="text" id="co-coupon-input" placeholder="CÓDIGO" value="${appliedCoupon ? esc(appliedCoupon.code) : ''}" ${appliedCoupon ? 'disabled' : ''}>
          ${appliedCoupon
            ? '<button type="button" id="co-coupon-remove" class="btn line" data-i18n="checkout.remove">Quitar</button>'
            : '<button type="button" id="co-coupon-apply" class="btn line" data-i18n="checkout.apply">Aplicar</button>'}
        </div>
        <div id="co-coupon-msg" class="co-coupon-msg"></div>
      </div>`;

    document.getElementById('co-coupon-apply')?.addEventListener('click', applyCoupon);
    document.getElementById('co-coupon-remove')?.addEventListener('click', () => {
      appliedCoupon = null; discount = 0; renderSummary();
    });
    reapplyI18n();
  }

  async function applyCoupon() {
    const input = document.getElementById('co-coupon-input');
    const msg = document.getElementById('co-coupon-msg');
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) return;

    const setErr = (t) => { msg.textContent = t; msg.style.color = '#b91c1c'; };

    // Validación server-side: get_coupon solo devuelve el cupón si el código
    // es exacto y está activo (la tabla coupons no es de lectura pública).
    const { data: rows, error } = await supabase.rpc('get_coupon', { p_code: code });
    const data = Array.isArray(rows) ? rows[0] : rows;
    if (error || !data) return setErr('Cupón no válido');

    const now = new Date();
    if (data.starts_at && new Date(data.starts_at) > now) return setErr('Este cupón aún no está activo');
    if (data.expires_at && new Date(data.expires_at) < now) return setErr('Este cupón ha expirado');
    if (data.max_uses && data.used_count >= data.max_uses) return setErr('Este cupón se ha agotado');
    if (data.min_amount && cartTotal < Number(data.min_amount)) {
      return setErr(`Importe mínimo: ${formatPrice(Number(data.min_amount))}`);
    }

    // ¿Aplica a algún item del carrito? (enum Waya: camp, no camp_reservation)
    const applies = cart.some(i => {
      switch (data.applies_to) {
        case 'all': return true;
        case 'camps': return i.type === 'camp';
        case 'products': return i.type === 'product';
        case 'rentals': return i.type === 'rental';
        case 'classes':
          if (i.type !== 'class_reservation') return false;
          return data.activity_type ? i.metadata?.classType === data.activity_type : true;
        default: return false;
      }
    });
    if (!applies) return setErr('Este cupón no aplica a los productos de tu carrito');

    appliedCoupon = data;
    discount = data.discount_type === 'percentage'
      ? cartTotal * (Number(data.discount_value) / 100)
      : Number(data.discount_value);
    discount = Math.min(discount, cartTotal);
    renderSummary();
  }

  renderSummary();

  // ---- Factura: mostrar/exigir datos fiscales al marcar ----
  const invoiceCheck = document.getElementById('co-invoice-check');
  const invoiceFields = document.getElementById('co-invoice-fields');
  invoiceCheck?.addEventListener('change', () => {
    const on = invoiceCheck.checked;
    invoiceFields.hidden = !on;
    const n = invoiceFields.querySelector('[name="factura_nombre"]');
    const nif = invoiceFields.querySelector('[name="factura_nif"]');
    if (n) n.required = on;
    if (nif) nif.required = on;
  });

  // ---- Pre-rellenado desde el perfil ----
  const f = document.getElementById('co-form');
  if (profile && f) {
    if (profile.full_name) f.nombre.value = profile.full_name;
    if (session?.user?.email) f.email.value = session.user.email;
    if (profile.phone) f.telefono.value = profile.phone;
    if (profile.address && f.direccion) f.direccion.value = profile.address;
    if (profile.city && f.ciudad) f.ciudad.value = profile.city;
    if (profile.postal_code && f.cp) f.cp.value = profile.postal_code;
  }

  // ---- Selector de prefijo de país junto al teléfono ----
  (() => {
    const tel = f?.telefono;
    if (!tel || document.getElementById('co-prefix')) return;
    const cur = (String(tel.value || '').match(/^\s*(\+\d{1,4})/) || [])[1] || '+34';
    const wrap = document.createElement('div');
    wrap.className = 'co-tel-wrap';
    tel.parentNode.insertBefore(wrap, tel);
    wrap.insertAdjacentHTML('afterbegin', phonePrefixSelectHtml('co-prefix', cur, 'aria-label="Prefijo de país"'));
    wrap.appendChild(tel);
    wirePhonePrefix(document.getElementById('co-prefix'), tel);
  })();

  // ---- 4. Submit → create-checkout (SumUp F4) ----
  f?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = f.querySelector('button[type="submit"]');

    // Login obligatorio (los packs de clases lo son de forma dura; el resto
    // sigue el patrón de Entreolas: login-obligatorio general).
    if (!session) {
      showToast(hasClassPacks
        ? 'Inicia sesión para comprar packs de clases.'
        : 'Inicia sesión para completar la compra.', 'error');
      renderAuthPanel(hasClassPacks);
      authSlot?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!f.checkValidity()) { f.reportValidity(); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Reservando…';

    try {
      // Guardar el teléfono en el perfil (para que la escuela pueda avisar).
      const phone = (f.telefono?.value || '').trim();
      if (phone) { try { await supabase.from('profiles').update({ phone }).eq('id', session.user.id); } catch {} }

      // SIN PASARELA: crea las reservas de alquiler PENDIENTES de pago (se abona
      // en la escuela). Cuando esté SumUp, aquí se llamará a 'create-checkout'.
      const { error } = await supabase.rpc('reservar_alquiler_offline', { p_items: cart });
      if (error) throw new Error(error.message || 'No se pudo completar la reserva');

      clearCart();
      updateCartPill();
      try { supabase.functions.invoke('send-email', { body: { to: session.user.email, type: 'rental_booked', data: {} } }); } catch {}
      show(viewSuccess);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reservar';
      showToast('Error: ' + err.message, 'error');
    }
  });

  reapplyI18n();
}

/* ------------------------------------------------------------
   Panel de auth inline (login / registro) con /lib/auth-client.js.
   `hard` = hay packs de clases → mensaje de requisito obligatorio.
   Al autenticarse con éxito, recarga la página (checkout con sesión viva).
------------------------------------------------------------ */
function renderAuthPanel(hard) {
  if (!authSlot) return;
  authSlot.innerHTML = `
    <div class="co-notice ${hard ? 'hard' : ''}">
      <p class="tt">${hard ? 'Necesitas una cuenta para comprar packs de clases' : 'Inicia sesión para completar tu compra'}</p>
      <p>${hard
        ? 'Los bonos se vinculan a tu cuenta. Inicia sesión o crea una cuenta para continuar.'
        : 'Accede con tu cuenta o crea una nueva; así podrás gestionar tus reservas desde tu área de cliente.'}</p>
    </div>
    <div class="co-auth">
      <div class="co-auth-tabs">
        <button type="button" class="co-auth-tab active" data-mode="login">Iniciar sesión</button>
        <button type="button" class="co-auth-tab" data-mode="signup">Crear cuenta</button>
      </div>
      <form id="co-auth-form">
        <input type="text" name="fullName" placeholder="Nombre completo" autocomplete="name" hidden>
        <input type="email" name="email" placeholder="Email" autocomplete="email" required>
        <input type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required minlength="6">
        <div id="co-auth-msg" class="co-auth-msg"></div>
        <button type="submit" class="btn red">Entrar</button>
      </form>
    </div>`;

  let mode = 'login';
  const form = authSlot.querySelector('#co-auth-form');
  const nameInput = form.querySelector('[name="fullName"]');
  const msg = authSlot.querySelector('#co-auth-msg');
  const submitBtn = form.querySelector('button[type="submit"]');

  authSlot.querySelectorAll('.co-auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      authSlot.querySelectorAll('.co-auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      nameInput.hidden = mode !== 'signup';
      nameInput.required = mode === 'signup';
      form.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
      submitBtn.textContent = mode === 'signup' ? 'Crear cuenta' : 'Entrar';
      msg.textContent = '';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.style.color = '#b91c1c';
    submitBtn.disabled = true;
    const prev = submitBtn.textContent;
    submitBtn.textContent = 'Procesando…';
    try {
      if (mode === 'signup') {
        await signUp(form.email.value.trim(), form.password.value, form.fullName.value.trim());
      } else {
        await signIn(form.email.value.trim(), form.password.value);
      }
      showToast('Sesión iniciada', 'success');
      // Recarga limpia: el checkout se re-monta con la sesión viva (pre-rellena
      // datos, desbloquea submit) SIN duplicar los listeners del <form> estático
      // (submit/factura), que persisten entre re-inicializaciones.
      window.location.reload();
    } catch (err) {
      msg.textContent = err.message || 'No se pudo completar la autenticación';
      submitBtn.disabled = false;
      submitBtn.textContent = prev;
    }
  });
}

init();
