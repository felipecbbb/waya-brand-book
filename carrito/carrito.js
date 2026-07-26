/* ============================================================
   Página de carrito — /carrito/
   Renderiza la tabla completa del carrito desde el estado de
   localStorage (lib/cart.js). Solo display + edición de cantidad
   y quitar; el pago real ocurre en /finalizar-compra/ (pasarela
   SumUp, F4).
   ============================================================ */
import {
  getCart,
  removeItem,
  updateQuantity,
  getCartTotal,
  clearCart,
  updateCartPill,
} from '/lib/cart.js';
import { esc, formatPrice, TYPE_LABELS } from '/lib/utils.js';

const container = document.getElementById('cart-content');

/* Re-aplica las traducciones a los nodos data-i18n recién inyectados.
   i18n.js expone updateTranslations(lang) como global (script clásico).
   Las claves carrito.* que aún no existan en translations.js conservan
   su texto por defecto en español (fallback seguro). */
function reapplyI18n() {
  try {
    const lang = document.documentElement.lang || localStorage.getItem('language') || 'es';
    if (typeof window.updateTranslations === 'function') window.updateTranslations(lang);
  } catch { /* i18n opcional */ }
}

/* --- Rutas Waya --- */
const ROUTE_KEEP_SHOPPING = '/reservar.html';
const ROUTE_CHECKOUT = '/finalizar-compra/';

/* --- Badge de tipo de item de carrito ---
   item.type ∈ product | class_reservation | rental | camp.
   Nota: TYPE_LABELS (lib/utils.js) mapea los SUBtipos de clase
   (grupal, privada, kids…), que viajan en metadata.classType de
   un class_reservation. Aquí lo usamos para afinar la etiqueta. */
const CART_TYPE_LABELS = {
  product: 'Producto',
  class_reservation: 'Clase',
  rental: 'Alquiler',
  camp: 'Surfcamp',
};

function badgeClass(type) {
  if (type === 'class_reservation') return 'class_reservation';
  if (type === 'rental') return 'rental';
  if (type === 'camp') return 'camp';
  return 'product';
}

function badgeLabel(item) {
  if (item.type === 'class_reservation') {
    const sub = item.metadata && item.metadata.classType;
    if (sub && TYPE_LABELS[sub]) return TYPE_LABELS[sub];
    return 'Clase';
  }
  return CART_TYPE_LABELS[item.type] || 'Producto';
}

/* --- Nota secundaria bajo el nombre (contexto de la reserva) --- */
function itemNote(item) {
  const m = item.metadata || {};
  if (item.type === 'class_reservation' && m.sessions) {
    return `Pack de ${esc(m.sessions)} ${m.sessions == 1 ? 'clase' : 'clases'}`;
  }
  if (item.type === 'rental') {
    const parts = [];
    if (m.duration) parts.push(esc(m.duration));
    if (m.dateStart) parts.push(esc(m.dateStart));
    if (m.size) parts.push(`Talla ${esc(m.size)}`);
    return parts.join(' · ');
  }
  if (item.type === 'camp' && m.edition) {
    return esc(m.edition);
  }
  if (item.type === 'product') {
    const parts = [];
    if (m.color) parts.push(esc(m.color));
    if (m.size) parts.push(`Talla ${esc(m.size)}`);
    return parts.join(' · ');
  }
  return '';
}

/* Solo los productos permiten editar cantidad; las reservas van a qty=1
   (contrato de lib/cart.js: class_reservation/rental/camp no se acumulan). */
function isQtyEditable(type) {
  return type === 'product';
}

export function renderCart() {
  const cart = getCart();

  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-empty">
        <h2 data-i18n="carrito.vacio_titulo">Tu carrito está vacío</h2>
        <p data-i18n="carrito.vacio_texto">Añade clases, alquiler de material o un surfcamp para empezar.</p>
        <a class="btn btn-primary" href="${ROUTE_KEEP_SHOPPING}" data-i18n="carrito.vacio_cta">Reservar ahora</a>
      </div>`;
    reapplyI18n();
    return;
  }

  const rows = cart.map((item) => {
    const note = itemNote(item);
    const qtyCell = isQtyEditable(item.type)
      ? `<div class="qty-controls">
           <button class="qty-btn" data-id="${esc(item.id)}" data-delta="-1" aria-label="Quitar uno">−</button>
           <span class="qty-val">${esc(item.quantity)}</span>
           <button class="qty-btn" data-id="${esc(item.id)}" data-delta="1" aria-label="Añadir uno">+</button>
         </div>`
      : `<span class="qty-val">${esc(item.quantity)}</span>`;

    return `
      <tr>
        <td>
          <span class="cart-item-name">${esc(item.name)}</span>
          ${note ? `<span class="cart-item-note">${note}</span>` : ''}
          <br>
          <span class="type-badge ${badgeClass(item.type)}">${esc(badgeLabel(item))}</span>
        </td>
        <td>${formatPrice(item.price)}</td>
        <td>${qtyCell}</td>
        <td class="cart-line-total">${formatPrice(item.price * item.quantity)}</td>
        <td><button class="cart-remove" data-remove="${esc(item.id)}" data-i18n="carrito.quitar">Quitar</button></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="cart-table-wrap">
      <table class="cart-table">
        <thead>
          <tr>
            <th data-i18n="carrito.col_producto">Producto</th>
            <th data-i18n="carrito.col_precio">Precio</th>
            <th data-i18n="carrito.col_cantidad">Cantidad</th>
            <th data-i18n="carrito.col_subtotal">Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="cart-summary">
      <span class="cart-total"><span data-i18n="carrito.total">Total:</span> ${formatPrice(getCartTotal())}</span>
      <a class="btn btn-secondary" href="${ROUTE_KEEP_SHOPPING}" data-i18n="carrito.seguir">Seguir comprando</a>
      <a class="btn btn-primary" href="${ROUTE_CHECKOUT}" data-i18n="carrito.finalizar">Finalizar compra</a>
    </div>`;

  container.querySelectorAll('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const delta = Number(btn.dataset.delta);
      const current = getCart().find((i) => i.id === id);
      if (current) {
        updateQuantity(id, current.quantity + delta);
        renderCart();
      }
    });
  });

  container.querySelectorAll('.cart-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeItem(btn.dataset.remove);
      renderCart();
    });
  });

  reapplyI18n();
}

/* --- Pantalla de éxito ---
   Al volver de la pasarela SumUp (F4) con ?success=1 (o ?pago=ok),
   el pedido ya está creado server-side: vaciamos el carrito local y
   mostramos confirmación. El vaciado ocurre en el cliente al volver. */
function renderSuccess() {
  clearCart();
  updateCartPill();
  container.innerHTML = `
    <div class="cart-success">
      <div class="cart-success-icon">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </div>
      <h2 data-i18n="carrito.exito_titulo">¡Gracias por tu compra!</h2>
      <p data-i18n="carrito.exito_texto">Hemos recibido tu pago. Te enviaremos la confirmación por email. Si tienes cualquier duda, escríbenos a info@wayasurf.com o por WhatsApp.</p>
      <a class="btn btn-primary" href="${ROUTE_KEEP_SHOPPING}" data-i18n="carrito.exito_cta">Seguir explorando</a>
    </div>`;
  reapplyI18n();
}

/* --- Bootstrap --- */
const params = new URLSearchParams(window.location.search);
if (params.get('success') === '1' || params.get('pago') === 'ok') {
  renderSuccess();
} else {
  renderCart();
}
