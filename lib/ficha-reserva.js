/* ============================================================
   Formulario de reserva + contrato DESPUÉS del pago.

   La escuela prefiere que reservar sea rápido (sin preguntas antes de
   pagar): el calendario guarda aquí qué se reserva y, al volver de la
   pasarela, pago-ok.html muestra el formulario (lib/booking-form.js) con
   el contrato (lib/contrato.js) para rellenar y firmar.
   Si el cliente lo deja a medias, Mi cuenta le avisa hasta que lo envíe.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { CONTRACT_VERSION, contractHtml, contractText, representativeHtml } from '/lib/contrato.js';
import { bookingFormHtml, wireBookingForm, readBookingForm, missingRequired, answersList, formText } from '/lib/booking-form.js';

const KEY = 'waya_ficha_pendiente';
const CADUCA_MS = 30 * 24 * 3600 * 1000;

const UI = {
  es: { title: 'Último paso: tu ficha de reserva', sub: 'Rellena tus datos y firma el contrato. Es obligatorio para hacer la clase.',
        send: 'Enviar y firmar', sending: 'Enviando…', accept: 'Marca la casilla para aceptar el contrato',
        sign: 'Firma escribiendo en «Firmado por»: nombre completo - DNI - fecha', fail: 'No se pudo enviar: ',
        doneTitle: '¡Todo listo!', doneText: 'Hemos recibido tu ficha y el contrato firmado. Te llega una copia por email. ¡Nos vemos en el agua! 🤙',
        banner: 'Te falta rellenar la ficha de tu reserva y firmar el contrato.', bannerCta: 'Rellenar ahora' },
  en: { title: 'Last step: your booking form', sub: 'Fill in your details and sign the contract. It is required to take the lesson.',
        send: 'Send and sign', sending: 'Sending…', accept: 'Tick the box to accept the contract',
        sign: 'Sign by typing in “Signed by”: full name - ID - date', fail: 'Could not send: ',
        doneTitle: 'All set!', doneText: 'We have received your form and signed contract. A copy is on its way to your email. See you in the water! 🤙',
        banner: 'You still need to fill in your booking form and sign the contract.', bannerCta: 'Fill it in now' },
  de: { title: 'Letzter Schritt: dein Buchungsformular', sub: 'Fülle deine Daten aus und unterschreibe den Vertrag. Das ist Pflicht für den Kurs.',
        send: 'Senden und unterschreiben', sending: 'Wird gesendet…', accept: 'Hake das Kästchen an, um den Vertrag zu akzeptieren',
        sign: 'Unterschreibe im Feld „Unterzeichnet von“: Name - Ausweis - Datum', fail: 'Konnte nicht gesendet werden: ',
        doneTitle: 'Alles erledigt!', doneText: 'Wir haben dein Formular und den unterschriebenen Vertrag erhalten. Eine Kopie kommt per E-Mail. Wir sehen uns im Wasser! 🤙',
        banner: 'Du musst noch dein Buchungsformular ausfüllen und den Vertrag unterschreiben.', bannerCta: 'Jetzt ausfüllen' },
};
export function lang() {
  try { const l = (localStorage.getItem('siteLanguage') || 'es').slice(0, 2); return UI[l] ? l : 'es'; } catch { return 'es'; }
}
const u = (k) => UI[lang()][k];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Reserva pendiente de ficha (localStorage) ---------- */
export function guardarFichaPendiente(ctx) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...ctx, creada: Date.now(), pagada: false })); } catch {}
}
export function leerFichaPendiente() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!c || Date.now() - c.creada > CADUCA_MS) return null;
    return c;
  } catch { return null; }
}
/** El cobro se confirmó: a partir de aquí la ficha es obligatoria. */
export function marcarFichaPagada() {
  const c = leerFichaPendiente();
  if (c) try { localStorage.setItem(KEY, JSON.stringify({ ...c, pagada: true })); } catch {}
}
export function borrarFichaPendiente() { try { localStorage.removeItem(KEY); } catch {} }

/* ---------- Valores que ya se saben ---------- */
function fichaInicial(ctx) {
  const ord = [...(ctx.bookings || [])].sort((a, b) => (a.date + a.time_start).localeCompare(b.date + b.time_start));
  const loc = { es: 'es-ES', en: 'en-GB', de: 'de-DE' }[lang()];
  const tipo = { privada: 'private', semiprivada: 'semiprivate', grupal: 'group', residente: 'group', kids: 'group' }[ctx.classType] || '';
  return {
    lesson_date: ord[0]?.date || '',
    lessons_dates: ord.length > 1 ? ord.map(b => new Date(b.date + 'T12:00:00').toLocaleDateString(loc, { day: 'numeric', month: 'long' })).join(', ') : '',
    lesson_time: ord[0]?.time_start?.slice(0, 5) || '',
    lesson_type: tipo,
    found: [],
  };
}

async function rellenarDesdePerfil(form) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;
  let p = null;
  try { ({ data: p } = await supabase.from('profiles').select('full_name,last_name,phone,birth_date').eq('id', user.id).maybeSingle()); } catch {}
  const poner = (k, v) => { const el = form.querySelector(`[name="bf-${k}"]`); if (el && !el.value && v) el.value = v; };
  poner('name', p?.full_name);
  poner('surname', p?.last_name);
  poner('phone', p?.phone);
  poner('email', user.email);
  if (p?.birth_date) {
    const b = new Date(p.birth_date), n = new Date();
    let edad = n.getFullYear() - b.getFullYear();
    if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) edad--;
    if (edad > 0) poner('age', String(edad));
  }
}

/* ---------- Pintar y enviar ---------- */
export function renderFichaReserva(container, ctx, { aviso = (m) => alert(m) } = {}) {
  const L = lang();
  const ft = formText(L);
  container.innerHTML = `
    <div class="fr">
      <h2 class="fr-title">${u('title')}</h2>
      <p class="fr-sub">${u('sub')}</p>
      ${bookingFormHtml(L, fichaInicial(ctx), `
        <section class="bf-sec">
          <div class="cp-contract-text" tabindex="0">${contractHtml(L)}</div>
          <div class="bf-q" data-q="accept">
            <label class="bf-label">${ft.signAccept} <span class="bf-req">*</span></label>
            <label class="cp-contract-accept"><input type="checkbox" id="fr-accept"><span>${contractText(L).accept}</span></label>
          </div>
          <div class="bf-q" data-q="signed">
            <label class="bf-label">${ft.signBy} <span class="bf-req">*</span></label>
            <input class="bf-input" type="text" id="fr-signed">
          </div>
        </section>
        <section class="bf-sec">${representativeHtml(L)}</section>`)}
      <button class="btn btn-primary fr-send" id="fr-send">${u('send')}</button>
    </div>`;

  const form = container.querySelector('.fr');
  wireBookingForm(form);
  rellenarDesdePerfil(form);

  const marcar = (key) => {
    const q = form.querySelector(`[data-q="${key}"]`);
    if (!q) return;
    q.classList.add('bf-q--error');
    q.scrollIntoView({ behavior: 'smooth', block: 'center' });
    q.querySelector('input, textarea')?.focus({ preventScroll: true });
    setTimeout(() => q.classList.remove('bf-q--error'), 2500);
  };

  form.querySelector('#fr-send').onclick = async (e) => {
    const ficha = readBookingForm(form);
    const acepta = form.querySelector('#fr-accept').checked;
    const firmado = form.querySelector('#fr-signed').value.trim();
    const falta = missingRequired(L, ficha);
    if (falta) { aviso(ft.requiredField + falta.label); marcar(falta.key); return; }
    if (!acepta) { aviso(u('accept')); marcar('accept'); return; }
    if (firmado.length < 5) { aviso(u('sign')); marcar('signed'); return; }

    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = u('sending');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/firmar-contrato.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({
          acepta, firmado,
          nombre: `${ficha.name} ${ficha.surname}`.trim(), documento: ficha.id_passport,
          respuestas: answersList(L, ficha), ficha,
          version: CONTRACT_VERSION, idioma: L, contrato_html: contractHtml(L),
          reserva: {
            tipo: ctx.classType, clases: ctx.sessions, total: ctx.fullPrice,
            fechas: (ctx.bookings || []).map(b => ({ fecha: b.date, hora: b.time_start?.slice(0, 5), asistente: b.attendee })),
          },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
    } catch (err) {
      aviso(u('fail') + err.message);
      btn.disabled = false; btn.textContent = u('send');
      return;
    }
    borrarFichaPendiente();
    container.innerHTML = `<div class="fr fr-done"><h2 class="fr-title">${u('doneTitle')}</h2><p class="fr-sub">${u('doneText')}</p>
      <a class="btn btn-primary" href="/mi-cuenta/#reservas">${esc({ es: 'Ver mis reservas', en: 'See my bookings', de: 'Meine Buchungen' }[L])}</a></div>`;
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/** Aviso para Mi cuenta si hay una reserva pagada sin ficha. */
export function bannerFichaPendienteHtml() {
  const c = leerFichaPendiente();
  if (!c?.pagada) return '';
  return `<div class="fr-banner"><span>⚠️ ${u('banner')}</span><a class="btn btn-primary" href="/pago-ok.html?ficha=1">${u('bannerCta')}</a></div>`;
}
