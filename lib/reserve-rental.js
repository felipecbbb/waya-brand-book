/* ============================================================
   Reserve Rental (Waya) — bindea los botones "Reservar" de las
   tarjetas estáticas de alquiler (alquileres.html) al modal completo
   de rental-page.js (talla + fechas + calendario de disponibilidad →
   carrito), conservando el diseño de la página.
   Cada botón lleva: data-rental-slug, data-rental-duration,
   data-rental-price, data-rental-label.
   ============================================================ */
import { openRentalModal, loadRentalEquipment } from '/lib/rental-page.js';

(async () => {
  const buttons = document.querySelectorAll('[data-rental-slug]');
  if (!buttons.length) return;

  const equipment = await loadRentalEquipment();
  const bySlug = {};
  equipment.forEach(e => { bySlug[e.slug] = e; });

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const item = bySlug[btn.dataset.rentalSlug];
      if (!item) { console.warn('rental: equipo no encontrado ·', btn.dataset.rentalSlug); return; }
      const durKey = btn.dataset.rentalDuration || '1d';
      const durPrice = Number(btn.dataset.rentalPrice) || Number(item.pricing?.[durKey]) || 0;
      const durLabel = btn.dataset.rentalLabel || '1 día';
      openRentalModal(item, durKey, durPrice, durLabel);
    });
  });
})();
