/* ============================================================
   Reserve Rental (Waya) — bindea los botones "Reservar" de las
   tarjetas estáticas de alquiler (alquileres.html) al modal completo
   de rental-page.js (talla + fechas + calendario de disponibilidad →
   carrito), conservando el diseño de la página.
   Cada botón lleva: data-rental-slug, data-rental-duration,
   data-rental-price, data-rental-label.

   Los alquileres se pueden cerrar al público desde el panel
   (site_settings · alquileres_activos). Cuando están cerrados la página
   sigue en pie — material, precios, todo — y el botón pasa a
   "Alquilar por WhatsApp": sin calendario, se cierra a mano por chat.
   El cobro online también lo rechaza el servidor: esto es la cara
   visible, no la cerradura.
   ============================================================ */
import { openRentalModal, loadRentalEquipment } from '/lib/rental-page.js';
import { supabase } from '/lib/supabase.js';

const WA_NUMBER = '34636562448';
const TEXTOS = {
  es: { btn: 'Alquilar por WhatsApp', msg: n => `¡Hola! Quiero alquilar: ${n}. ¿Qué disponibilidad tenéis?` },
  en: { btn: 'Rent via WhatsApp', msg: n => `Hi! I'd like to rent: ${n}. What availability do you have?` },
  de: { btn: 'Per WhatsApp mieten', msg: n => `Hallo! Ich möchte mieten: ${n}. Wann ist es verfügbar?` },
};

function idioma() {
  let l = 'es';
  try { l = (localStorage.getItem('siteLanguage') || document.documentElement.lang || 'es').slice(0, 2); } catch {}
  return TEXTOS[l] ? l : 'es';
}

function marcarWhatsApp(btn) {
  const tx = TEXTOS[idioma()];
  // Nombre del material tal y como se ve en la tarjeta (ya traducido).
  const nombre = btn.closest('.rent-gear-card, article, .card')?.querySelector('.rent-gear-name')?.textContent.trim()
    || btn.dataset.rentalSlug;
  btn.classList.add('is-whatsapp');
  // El data-i18n original reescribiría el texto al cambiar de idioma.
  btn.removeAttribute('data-i18n');
  btn.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(tx.msg(nombre))}`;
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  btn.textContent = tx.btn;
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
    buttons.forEach(marcarWhatsApp);
    // Tras el cambio de idioma: i18n.js ya ha retraducido el nombre del material.
    document.addEventListener('wayaLanguageChange', () => buttons.forEach(marcarWhatsApp));
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
