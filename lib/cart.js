/* ============================================================
   Cart Module — estado del carrito en localStorage + helpers
   Sin dependencias internas (no toca BD). Solo DOM/localStorage.
   ============================================================ */

// v1: primera versión del carrito Waya. Si en el futuro cambia el shape
// del item (metadata de variantes/reservas), subir a 'waya_cart_v2' para
// descartar carritos antiguos incompatibles.
const STORAGE_KEY = 'waya_cart_v1';

// Tipos de item que representan una reserva única (no se acumulan por qty):
// una clase, un alquiler o un surfcamp se añaden una sola vez.
// Enum Waya canónico: product | class_reservation | rental | camp.
const RESERVATION_TYPES = ['class_reservation', 'rental', 'camp'];

// Tipos que además fuerzan quantity = 1 (señal/anticipo fijo de reserva).
const SINGLE_QTY_TYPES = ['camp'];

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function write(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  updateCartPill();
}

/** @returns {{ id:string, type:'product'|'class_reservation'|'rental'|'camp', name:string, price:number, quantity:number, metadata?:object }[]} */
export function getCart() {
  return read();
}

/**
 * Añade un item al carrito.
 * - Reservas (class_reservation / rental / camp): NO se duplican.
 *   Los surfcamps además se fuerzan a qty=1 (señal de reserva fija).
 * - Productos: si ya está, incrementa la cantidad.
 */
export function addItem(item) {
  const cart = read();
  const existing = cart.find(i => i.id === item.id);

  if (existing) {
    if (RESERVATION_TYPES.includes(item.type)) {
      // Ya está en el carrito — no duplicar reservas.
      write(cart);
      return cart;
    }
    existing.quantity += (item.quantity || 1);
  } else {
    cart.push({
      id: item.id,
      type: item.type || 'product',
      name: item.name,
      price: Number(item.price),
      quantity: SINGLE_QTY_TYPES.includes(item.type) ? 1 : (item.quantity || 1),
      metadata: item.metadata || null,
    });
  }

  write(cart);
  return cart;
}

export function removeItem(id) {
  const cart = read().filter(i => i.id !== id);
  write(cart);
  return cart;
}

export function updateQuantity(id, qty) {
  const cart = read();
  const item = cart.find(i => i.id === id);
  if (!item) return cart;
  if (qty <= 0) return removeItem(id);
  item.quantity = qty;
  write(cart);
  return cart;
}

export function clearCart() {
  localStorage.removeItem(STORAGE_KEY);
  updateCartPill();
}

export function getCartCount() {
  return read().reduce((sum, i) => sum + i.quantity, 0);
}

export function getCartTotal() {
  return read().reduce((sum, i) => sum + i.price * i.quantity, 0);
}

/** Actualiza todos los elementos .cart-pill del DOM con el número de items */
export function updateCartPill() {
  const count = getCartCount();
  document.querySelectorAll('.cart-pill').forEach(el => {
    el.textContent = String(count);
  });
}

/* --- Alias de conveniencia (nombres cortos usados en algunas páginas) --- */
export const updateQty = updateQuantity;
export const cartCount = getCartCount;
export const cartTotal = getCartTotal;
