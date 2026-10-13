/* ============================================================
   Pago directo — sin pasar por el carrito.

   El carrito obligaba a: elegir → añadir → ir al carrito → finalizar compra.
   Cuatro pasos para comprar una cosa, y el botón "Reservar" del modal no daba
   ninguna señal de haber hecho algo (solo añadía en silencio), así que parecía
   roto y era fácil pulsarlo dos veces y duplicar la reserva.

   Ahora: eliges → pagas. El carrito sigue existiendo para compras múltiples,
   pero ya no es el camino obligatorio.
   ============================================================ */
import { supabase } from '/lib/supabase.js';

// Textos en el idioma de la web (lo guarda i18n.js en siteLanguage).
const TXT = {
  es: { check: 'Comprobando…', login: 'Inicia sesión para completar la reserva', prep: 'Preparando el pago…', redir: 'Redirigiendo…', fail: 'No se pudo iniciar el pago: ' },
  en: { check: 'Checking…', login: 'Log in to complete your booking', prep: 'Preparing payment…', redir: 'Redirecting…', fail: 'Could not start the payment: ' },
  de: { check: 'Wird geprüft…', login: 'Melde dich an, um die Buchung abzuschließen', prep: 'Zahlung wird vorbereitet…', redir: 'Weiterleitung…', fail: 'Die Zahlung konnte nicht gestartet werden: ' },
};
function tx(k) {
  let l = 'es';
  try { l = (localStorage.getItem('siteLanguage') || 'es').slice(0, 2); } catch {}
  return (TXT[l] || TXT.es)[k];
}

/** Aviso flotante, reutilizando el estilo de toast que ya usa el sitio. */
export function aviso(msg, tipo = 'info') {
  let t = document.querySelector('.cart-toast');
  if (!t) { t = document.createElement('div'); t.className = 'cart-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.dataset.tipo = tipo;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/**
 * Lleva directo a la pasarela con UN artículo.
 *
 * @param {object} item      mismo formato que usaba el carrito ({type, name, metadata…})
 * @param {object} opciones  { boton } para bloquearlo mientras se prepara el cobro
 */
export async function pagarAhora(item, { boton } = {}) {
  const textoOriginal = boton?.textContent;
  const bloquear = (txt) => { if (boton) { boton.disabled = true; boton.textContent = txt; } };
  const soltar = () => { if (boton) { boton.disabled = false; boton.textContent = textoOriginal; } };

  try {
    bloquear(tx('check'));

    // Hace falta cuenta: la reserva se vincula al cliente y así puede verla
    // luego en su área. Se guarda a dónde volver tras iniciar sesión.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      try { sessionStorage.setItem('waya_volver_a', location.pathname + location.search); } catch {}
      aviso(tx('login'), 'info');
      setTimeout(() => { window.location.href = '/mi-cuenta/?volver=' + encodeURIComponent(location.pathname); }, 900);
      return;
    }

    bloquear(tx('prep'));

    // El importe lo calcula el servidor a partir de los ids: nunca se envía
    // el precio desde aquí, que es editable desde el navegador.
    const { data, error } = await supabase.rpc('crear_checkout_sumup', {
      p_items: [item],
      p_return_url: `${location.origin}/pago-ok.html`,
    });
    if (error) throw new Error(error.message || 'No se pudo iniciar el pago');
    if (!data?.url) throw new Error('La pasarela no devolvió una URL de pago');

    bloquear(tx('redir'));
    window.location.href = data.url;
  } catch (err) {
    soltar();
    aviso(tx('fail') + err.message, 'error');
    console.warn('pagarAhora:', err);
  }
}
