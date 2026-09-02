/* ============================================================
   Página de retorno tras pagar en SumUp.

   SumUp no ofrece webhooks en esta cuenta, así que la confirmación se pide
   desde aquí al volver de la pasarela. Un cron la repesca si el cliente cerró
   el navegador antes de volver, para que ninguna compra se quede sin reserva.

   Como el webhook puede tardar un par de segundos, se reintenta la consulta
   unas cuantas veces antes de dar nada por fallido.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { clearCart, updateCartPill } from '/lib/cart.js';

const card = document.getElementById('pago-card');
const ref = new URLSearchParams(location.search).get('ref');

const money = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`;

function pintar({ icono, titulo, texto, acciones = '', clase = '' }) {
  card.className = `pago-card ${clase}`;
  card.innerHTML = `
    <div class="pago-icon ${clase}" aria-hidden="true">${icono}</div>
    <h1 class="pago-title">${titulo}</h1>
    <p class="pago-text">${texto}</p>
    ${acciones ? `<div class="pago-actions">${acciones}</div>` : ''}`;
}

const ICONO_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
  stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
const ICONO_ESPERA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const ICONO_ERROR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
  stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const BTN_CUENTA = '<a class="btn btn-primary" href="/mi-cuenta/#reservas">Ver mis reservas</a>';
const BTN_INICIO = '<a class="btn line" href="/">Volver al inicio</a>';
const BTN_CARRITO = '<a class="btn btn-primary" href="/carrito/">Volver al carrito</a>';

async function consultar() {
  const { data, error } = await supabase
    .from('pending_checkouts')
    .select('status, amount, paid_at')
    .eq('id', ref)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Dispara la confirmación del cobro.
 *
 * SumUp no ofrece webhooks en esta cuenta, así que nadie nos avisa del pago:
 * lo pedimos nosotros al volver. El servidor consulta a SumUp el estado real
 * antes de crear nada, y es idempotente, así que no pasa nada si el cron lo
 * hace también.
 */
async function confirmar() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await fetch('/confirmar-pago.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ref }),
  }).catch(() => {});   // si falla, el cron lo recogerá igual
}

(async function init() {
  if (!card) return;

  if (!ref) {
    pintar({
      icono: ICONO_ESPERA,
      titulo: 'No encontramos el pago',
      texto: 'Nos falta la referencia de la operación. Si has pagado, revisa tu correo o mira tus reservas: si el cobro se completó, ya estará ahí.',
      acciones: BTN_CUENTA + BTN_INICIO,
      clase: 'is-warn',
    });
    return;
  }

  // Primero se pide la confirmación (nadie nos avisa: no hay webhook), y
  // luego se sondea hasta verla reflejada.
  await confirmar();

  const INTENTOS = 8;
  for (let i = 0; i < INTENTOS; i++) {
    let fila;
    try {
      fila = await consultar();
    } catch {
      break;   // sin sesión o sin permiso: se sale al mensaje neutro
    }

    if (fila?.status === 'paid') {
      clearCart();
      updateCartPill();
      pintar({
        icono: ICONO_OK,
        titulo: '¡Pago completado!',
        texto: `Hemos recibido ${money(fila.amount)}. Tu reserva ya está confirmada y te llega un correo con los detalles. ¡Nos vemos en el agua!`,
        acciones: BTN_CUENTA + BTN_INICIO,
        clase: 'is-ok',
      });
      return;
    }

    if (fila?.status === 'failed') {
      pintar({
        icono: ICONO_ERROR,
        titulo: 'El pago no se completó',
        texto: 'No se ha cobrado nada. Tu carrito sigue intacto, puedes intentarlo de nuevo o escribirnos por WhatsApp si prefieres reservar a mano.',
        acciones: BTN_CARRITO + BTN_INICIO,
        clase: 'is-error',
      });
      return;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Ni pagado ni fallido tras la espera. No se afirma que haya fallado,
  // porque el dinero puede estar cobrado y el cron confirmarlo en breve.
  pintar({
    icono: ICONO_ESPERA,
    titulo: 'Estamos confirmando tu pago',
    texto: 'Está tardando un poco más de lo normal. Si el cobro se completó, tu reserva aparecerá en tu cuenta en unos minutos y recibirás el correo de confirmación. Si en un rato no la ves, escríbenos y lo miramos.',
    acciones: BTN_CUENTA + '<a class="btn line" href="https://wa.me/34636562448" target="_blank" rel="noopener noreferrer">Escríbenos</a>',
    clase: 'is-warn',
  });
})();
