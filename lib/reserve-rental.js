/* ============================================================
   Reserve Rental (Waya) — bindea los botones "Reservar" de las
   tarjetas estáticas de alquiler (alquileres.html) al modal completo
   de rental-page.js (talla + fechas + calendario de disponibilidad →
   carrito), conservando el diseño de la página.
   Cada botón lleva: data-rental-slug, data-rental-duration,
   data-rental-price, data-rental-label.

   Los alquileres se pueden cerrar al público desde el panel
   (site_settings · alquileres_activos). Cuando están cerrados la página
   sigue en pie — material, precios, todo — y solo el botón cambia a
   "Próximamente". El cobro también lo rechaza el servidor: esto es la
   cara visible, no la cerradura.
   ============================================================ */
import { openRentalModal, loadRentalEquipment } from '/lib/rental-page.js';
import { supabase } from '/lib/supabase.js';

const TEXTO_PROXIMAMENTE = { es: 'Próximamente', en: 'Coming soon', de: 'Demnächst' };

function idioma() {
  return (localStorage.getItem('siteLanguage') || document.documentElement.lang || 'es').slice(0, 2);
}

function marcarProximamente(btn) {
  btn.classList.add('is-soon');
  btn.setAttribute('aria-disabled', 'true');
  btn.removeAttribute('href');          // deja de ser un enlace navegable
  // El data-i18n original reescribiría el texto al cambiar de idioma.
  btn.removeAttribute('data-i18n');
  btn.textContent = TEXTO_PROXIMAMENTE[idioma()] || TEXTO_PROXIMAMENTE.es;
}

async function alquileresAbiertos() {
  // Si la consulta falla se deja abierto: un fallo de red no debería cerrar
  // la tienda por su cuenta, y el servidor rechaza el cobro igualmente.
  try {
    const { data } = await supabase
      .from('site_settings').select('value').eq('key', 'alquileres_activos').maybeSingle();
    return data?.value?.activo !== false;
  } catch {
    return true;
  }
}

(async () => {
  const buttons = document.querySelectorAll('[data-rental-slug]');
  if (!buttons.length) return;

  if (!await alquileresAbiertos()) {
    buttons.forEach(marcarProximamente);
    document.addEventListener('wayaLanguageChange', () => buttons.forEach(marcarProximamente));
    return;
  }

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
