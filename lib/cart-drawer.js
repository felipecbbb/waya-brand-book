/* ============================================================
   Cart Drawer — panel lateral del carrito (Waya Surf School).
   Se auto-inyecta en document.body por JS para funcionar en todas
   las páginas sin tocar el header duplicado de cada HTML. Singleton.
   Depende de /lib/cart.js (estado) y /lib/utils.js (formato/escape).
   ============================================================ */
import { getCart, getCartTotal, removeItem, updateQuantity, updateCartPill } from '/lib/cart.js';
import { esc, formatPrice as fmt } from '/lib/utils.js';

// Notas de negocio por tipo de línea del carrito.
const TYPE_NOTE = {
  class_reservation: 'Anticipo de reserva',
  camp_reservation: 'Señal de reserva',
  rental: 'Alquiler de material',
};

let overlay = null;

function ensureDrawer() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'cart-drawer-overlay';
  overlay.innerHTML = `
    <aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="Tu carrito">
      <header class="cart-drawer-head">
        <h3>Tu carrito</h3>
        <button class="cart-drawer-close" aria-label="Cerrar">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div class="cart-drawer-body"></div>
      <footer class="cart-drawer-foot"></footer>
    </aside>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCartDrawer(); });
  overlay.querySelector('.cart-drawer-close').addEventListener('click', closeCartDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCartDrawer(); });
  return overlay;
}

function render() {
  const cart = getCart();
  const body = overlay.querySelector('.cart-drawer-body');
  const foot = overlay.querySelector('.cart-drawer-foot');

  if (!cart.length) {
    body.innerHTML = `
      <div class="cart-drawer-empty">
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
        <p>Tu carrito está vacío</p>
        <a class="btn btn-primary" href="/reservar">Reservar una clase</a>
      </div>`;
    foot.innerHTML = '';
    return;
  }

  body.innerHTML = cart.map(i => {
    const isProduct = i.type === 'product';
    const line = i.price * i.quantity;
    const note = TYPE_NOTE[i.type];
    return `
      <div class="cart-drawer-item" data-id="${esc(i.id)}">
        <div class="cart-drawer-item-main">
          <strong>${esc(i.name)}</strong>
          ${note ? `<span class="cart-drawer-note">${note}</span>` : ''}
          <span class="cart-drawer-price">${fmt(i.price)}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</span>
        </div>
        <div class="cart-drawer-item-side">
          ${isProduct ? `
            <div class="cart-drawer-qty">
              <button data-act="dec" data-id="${esc(i.id)}" aria-label="Quitar uno">−</button>
              <span>${i.quantity}</span>
              <button data-act="inc" data-id="${esc(i.id)}" aria-label="Añadir uno">+</button>
            </div>` : `<span class="cart-drawer-line">${fmt(line)}</span>`}
          <button class="cart-drawer-remove" data-act="remove" data-id="${esc(i.id)}" aria-label="Eliminar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  foot.innerHTML = `
    <div class="cart-drawer-total"><span>Total</span><strong>${fmt(getCartTotal())}</strong></div>
    <a class="btn btn-primary cart-drawer-checkout" href="/finalizar-compra">Finalizar compra</a>
    <button class="cart-drawer-continue" type="button">Seguir reservando</button>`;

  // Eventos
  body.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const item = getCart().find(x => x.id === id);
      if (btn.dataset.act === 'remove') removeItem(id);
      else if (btn.dataset.act === 'inc') updateQuantity(id, (item?.quantity || 1) + 1);
      else if (btn.dataset.act === 'dec') updateQuantity(id, (item?.quantity || 1) - 1);
      updateCartPill();
      render();
    });
  });
  foot.querySelector('.cart-drawer-continue')?.addEventListener('click', closeCartDrawer);
}

export function openCartDrawer() {
  ensureDrawer();
  render();
  requestAnimationFrame(() => overlay.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

export function closeCartDrawer() {
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
