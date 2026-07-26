/* ============================================================
   Reserve Camp — adds camp deposit to cart + redirects
   ============================================================ */
import { addItem, updateCartPill } from '/lib/cart.js';

document.querySelectorAll('[data-reserve-camp]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const id = btn.dataset.reserveCamp;
    const name = btn.dataset.campName;
    const edition = btn.dataset.campEdition || name;

    addItem({
      id: `camp-${id}`,
      type: 'camp_reservation',
      name: `Reserva: ${name}`,
      price: 180,
      quantity: 1,
      metadata: { campId: id, edition, totalAmount: 480 },
    });

    updateCartPill();
    window.location.href = '/carrito/';
  });
});
