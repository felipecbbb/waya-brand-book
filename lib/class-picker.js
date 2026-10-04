/* ============================================================
   Class Picker — reserva de clases EN EL MOMENTO (sin carrito).
   Flujo: Reservar → elegir cuándo/quién → (login inline) → pago con tarjeta.
   Vale para todos los tipos de clase (grupal, individual, yoga,
   paddle, surfskate). El carrito NO interviene en clases.
   - Cada plaza elegida aparta un "hold" de 10 min (RPC create_hold).
   - Asistentes: yo / familiares (si hay sesión) / acompañante nuevo.
   - "Decidir más tarde" deja créditos libres en el bono.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { pagarAhora } from '/lib/pagar.js';
import { getSession, signIn, signUp } from '/lib/auth-client.js';
import { fetchFamilyMembers } from '/lib/family.js';
import { TYPE_LABELS, showToast } from '/lib/utils.js';
import { wetsuitOptionsHtml, levelOptionsHtml } from '/lib/shared-constants.js';

/* ---------- Idioma ----------
   El modal se pinta por JS, así que no lo cubre el sistema data-i18n.
   Aquí van sus textos en ES/EN/DE; el idioma activo lo guarda i18n.js. */
export function lang() {
  try { const l = (localStorage.getItem('siteLanguage') || document.documentElement.lang || 'es').slice(0, 2); return ['es', 'en', 'de'].includes(l) ? l : 'es'; } catch { return 'es'; }
}
const LOCALES = { es: 'es-ES', en: 'en-GB', de: 'de-DE' };
const loc = () => LOCALES[lang()];
const UI = {
  es: {
    loadingCal: 'Cargando calendario…', loading: 'Cargando…', close: 'Cerrar', cancel: 'Cancelar', back: 'Volver',
    cont: 'Continuar', retry: 'Reintentar', oneMoment: 'Un momento…',
    errTitle: 'No se pudo cargar el calendario',
    errBody: 'No hemos podido conectar para consultar las clases disponibles. Comprueba tu conexión e inténtalo de nuevo. Si sigue igual, escríbenos por WhatsApp al <strong>636 56 24 48</strong> y te reservamos la plaza a mano.',
    timeUp: 'Se agotó el tiempo para mantener las plazas. Vuelve a elegir.',
    allAssigned: 'Ya has asignado todas tus clases', holdFail: 'No se pudo apartar la plaza: ', noSpots: 'sin plazas',
    whoAttends: '¿Quién asiste a esta clase?', spotsFree: n => `${n} plaza${n !== 1 ? 's' : ''} libre${n !== 1 ? 's' : ''}`,
    attHint: (m, l) => `Marca a quién metes. Puedes añadir <strong class="cp-att-remaining">${m}</strong> aquí (te quedan ${l} clase${l !== 1 ? 's' : ''} del bono). El resto queda como crédito en tu cuenta.`,
    myself: 'Yo mismo', alreadyIn: ' · ya en esta clase', addGuest: '+ Añadir acompañante nuevo', add: 'Añadir', adding: 'Añadiendo…',
    name: 'Nombre*', lastName: 'Apellidos', birth: 'Fecha nacimiento', level: 'Nivel', wetsuit: 'Talla neopreno',
    canSwim: '¿Sabe nadar?', yes: 'Sí', no: 'No', injury: '¿Lesión?', injuryPh: 'Describe (opcional)', remove: 'Quitar',
    me: 'Yo', relative: 'Familiar', guestName: 'Pon el nombre de cada acompañante nuevo', pickOne: 'Elige al menos una persona',
    noSpotsCredits: 'No quedan plazas o créditos', onlyN: n => `Solo puedes añadir ${n} aquí (plazas/créditos)`,
    phoneTitle: 'Tu teléfono de contacto', phoneSub: 'Lo necesitamos para avisarte de tu reserva.', phone: 'Teléfono',
    phonePh: 'Ej: 612 345 678', phoneBad: 'Escribe un teléfono válido.',
    loginTitle: 'Inicia sesión para reservar', loginSub: 'Tus clases se vinculan a tu cuenta.', keepSpots: 'Mantenemos tus plazas mientras tanto.',
    haveAccount: 'Ya tengo cuenta', createAccount: 'Crear cuenta', fname: 'Nombre', password: 'Contraseña',
    loginBtn: 'Entrar y continuar', registerBtn: 'Crear cuenta y continuar',
    needEmail: 'Escribe tu email.', needPass: 'Escribe tu contraseña.', passShort: 'La contraseña debe tener al menos 6 caracteres.',
    needName: 'Escribe tu nombre.', needPhone: 'Escribe un teléfono de contacto válido.',
    confirmEmail: 'Revisa tu email para confirmar la cuenta antes de continuar.', loginFail: 'No se pudo iniciar sesión.',
    prevMonth: 'Mes anterior', nextMonth: 'Mes siguiente',
    pickWhen: 'Elige cuándo usar tus clases', chosen: 'clases elegidas',
    held: 'Plazas reservadas por <strong class="cp-timer-clock">10:00</strong> — completa tu reserva antes',
    yourSel: 'Tu selección', noMonth: m => `No hay clases publicadas en ${m}.`,
    noMonthHint: 'Prueba con otro mes, o escríbenos y te decimos las próximas fechas.', askWa: 'Preguntar por WhatsApp',
    waDates: t => `¡Hola! Quería saber las próximas fechas de ${t}`,
    pickAtLeast: 'Elige al menos una clase para continuar.',
    decideLater: l => `Puedes <strong>decidir más tarde</strong> dónde gastar las ${l} clase${l !== 1 ? 's' : ''} restante${l !== 1 ? 's' : ''} desde tu cuenta.`,
    allDone: 'Has asignado todas tus clases.', pickBefore: 'Elige al menos una clase antes de continuar',
    pickDay: 'Elige un día con clases (marcados en el calendario).', noDate: 'No hay clases publicadas para esta fecha.',
    full: 'Completa', noCredits: 'Sin clases libres', chosenHere: n => `${n} elegida${n !== 1 ? 's' : ''}`, levelLbl: 'Nivel',
    summary: 'Resumen de tu reserva', chosenOf: (u, s) => `Clases elegidas · ${u} de ${s}`,
    noDatesYet: 'No has elegido fechas todavía — podrás decidir cuándo usarlas desde tu cuenta.',
    laterN: l => `${l} clase${l !== 1 ? 's' : ''} para decidir más tarde.`, total: 'Total del bono',
    payNote: 'Pago seguro con tarjeta. Al confirmar te llevamos a la pasarela y recibirás la confirmación por email.',
    confirm: 'Confirmar reserva', processing: 'Procesando…',
    packName: n => `${n} ${n === 1 ? 'clase' : 'clases'}`,
    types: { grupal: 'Grupal', privada: 'Privada', semiprivada: 'Semiprivada', familiar: 'Familiar', residente: 'Bono Residente', kids: 'Waya Kids' },
    // Selector previo: WhatsApp o web
    howBook: '¿Cómo quieres reservar?', howBookSub: 'Elige la opción que te resulte más cómoda.',
    viaWa: 'Reservar por WhatsApp', viaWaSub: 'Te respondemos y te cuadramos el día a mano.',
    viaWeb: 'Reservar en la web', viaWebSub: 'Elige día y hora en el calendario y paga online.',
    waMsg: (p, pr) => `¡Hola! Quiero reservar: ${p}${pr ? ` (${pr}€)` : ''}. ¿Qué días tenéis disponibles?`,
  },
  en: {
    loadingCal: 'Loading calendar…', loading: 'Loading…', close: 'Close', cancel: 'Cancel', back: 'Back',
    cont: 'Continue', retry: 'Try again', oneMoment: 'One moment…',
    errTitle: 'Could not load the calendar',
    errBody: 'We could not connect to check the available classes. Check your connection and try again. If it keeps failing, message us on WhatsApp at <strong>+34 636 56 24 48</strong> and we will book your spot manually.',
    timeUp: 'Time ran out to hold your spots. Please choose again.',
    allAssigned: 'You have already assigned all your classes', holdFail: 'Could not hold the spot: ', noSpots: 'no spots left',
    whoAttends: 'Who is attending this class?', spotsFree: n => `${n} spot${n !== 1 ? 's' : ''} left`,
    attHint: (m, l) => `Tick who you are adding. You can add <strong class="cp-att-remaining">${m}</strong> here (${l} class${l !== 1 ? 'es' : ''} left in your pack). The rest stays as credit in your account.`,
    myself: 'Myself', alreadyIn: ' · already in this class', addGuest: '+ Add a new companion', add: 'Add', adding: 'Adding…',
    name: 'First name*', lastName: 'Last name', birth: 'Date of birth', level: 'Level', wetsuit: 'Wetsuit size',
    canSwim: 'Can swim?', yes: 'Yes', no: 'No', injury: 'Injury?', injuryPh: 'Describe (optional)', remove: 'Remove',
    me: 'Me', relative: 'Family member', guestName: 'Enter the name of each new companion', pickOne: 'Choose at least one person',
    noSpotsCredits: 'No spots or credits left', onlyN: n => `You can only add ${n} here (spots/credits)`,
    phoneTitle: 'Your contact phone', phoneSub: 'We need it to keep you updated about your booking.', phone: 'Phone',
    phonePh: 'e.g. +44 7700 900123', phoneBad: 'Enter a valid phone number.',
    loginTitle: 'Log in to book', loginSub: 'Your classes are linked to your account.', keepSpots: 'We hold your spots in the meantime.',
    haveAccount: 'I have an account', createAccount: 'Create account', fname: 'First name', password: 'Password',
    loginBtn: 'Log in and continue', registerBtn: 'Create account and continue',
    needEmail: 'Enter your email.', needPass: 'Enter your password.', passShort: 'Password must be at least 6 characters.',
    needName: 'Enter your name.', needPhone: 'Enter a valid contact phone.',
    confirmEmail: 'Check your email to confirm your account before continuing.', loginFail: 'Could not log in.',
    prevMonth: 'Previous month', nextMonth: 'Next month',
    pickWhen: 'Choose when to use your classes', chosen: 'classes chosen',
    held: 'Spots held for <strong class="cp-timer-clock">10:00</strong> — complete your booking before then',
    yourSel: 'Your selection', noMonth: m => `No classes published in ${m}.`,
    noMonthHint: 'Try another month, or message us and we will tell you the next dates.', askWa: 'Ask on WhatsApp',
    waDates: t => `Hi! I'd like to know the next dates for ${t}`,
    pickAtLeast: 'Choose at least one class to continue.',
    decideLater: l => `You can <strong>decide later</strong> when to use your remaining ${l} class${l !== 1 ? 'es' : ''} from your account.`,
    allDone: 'You have assigned all your classes.', pickBefore: 'Choose at least one class before continuing',
    pickDay: 'Choose a day with classes (highlighted in the calendar).', noDate: 'No classes published for this date.',
    full: 'Full', noCredits: 'No classes left', chosenHere: n => `${n} chosen`, levelLbl: 'Level',
    summary: 'Booking summary', chosenOf: (u, s) => `Classes chosen · ${u} of ${s}`,
    noDatesYet: "You haven't chosen dates yet — you can decide when to use them from your account.",
    laterN: l => `${l} class${l !== 1 ? 'es' : ''} to decide later.`, total: 'Pack total',
    payNote: 'Secure card payment. On confirming we take you to the payment page and you will get a confirmation email.',
    confirm: 'Confirm booking', processing: 'Processing…',
    packName: n => `${n} ${n === 1 ? 'class' : 'classes'}`,
    types: { grupal: 'Group', privada: 'Private', semiprivada: 'Semi-private', familiar: 'Family', residente: 'Residents pack', kids: 'Waya Kids' },
    howBook: 'How would you like to book?', howBookSub: 'Pick whichever is easier for you.',
    viaWa: 'Book via WhatsApp', viaWaSub: 'We reply and set up the day with you.',
    viaWeb: 'Book on the website', viaWebSub: 'Pick day and time in the calendar and pay online.',
    waMsg: (p, pr) => `Hi! I'd like to book: ${p}${pr ? ` (${pr}€)` : ''}. Which days do you have available?`,
  },
  de: {
    loadingCal: 'Kalender wird geladen…', loading: 'Wird geladen…', close: 'Schließen', cancel: 'Abbrechen', back: 'Zurück',
    cont: 'Weiter', retry: 'Erneut versuchen', oneMoment: 'Einen Moment…',
    errTitle: 'Der Kalender konnte nicht geladen werden',
    errBody: 'Wir konnten die verfügbaren Kurse nicht abrufen. Prüfe deine Verbindung und versuche es erneut. Wenn es weiterhin nicht klappt, schreib uns per WhatsApp an <strong>+34 636 56 24 48</strong> und wir reservieren deinen Platz manuell.',
    timeUp: 'Die Zeit zum Halten deiner Plätze ist abgelaufen. Bitte wähle erneut.',
    allAssigned: 'Du hast bereits alle Kurse zugewiesen', holdFail: 'Platz konnte nicht reserviert werden: ', noSpots: 'keine Plätze frei',
    whoAttends: 'Wer nimmt an diesem Kurs teil?', spotsFree: n => `${n} ${n !== 1 ? 'Plätze' : 'Platz'} frei`,
    attHint: (m, l) => `Markiere, wen du hinzufügst. Du kannst hier <strong class="cp-att-remaining">${m}</strong> hinzufügen (noch ${l} ${l !== 1 ? 'Kurse' : 'Kurs'} im Paket). Der Rest bleibt als Guthaben in deinem Konto.`,
    myself: 'Ich selbst', alreadyIn: ' · schon in diesem Kurs', addGuest: '+ Neue Begleitperson hinzufügen', add: 'Hinzufügen', adding: 'Wird hinzugefügt…',
    name: 'Vorname*', lastName: 'Nachname', birth: 'Geburtsdatum', level: 'Niveau', wetsuit: 'Neoprengröße',
    canSwim: 'Kann schwimmen?', yes: 'Ja', no: 'Nein', injury: 'Verletzung?', injuryPh: 'Beschreiben (optional)', remove: 'Entfernen',
    me: 'Ich', relative: 'Familienmitglied', guestName: 'Gib den Namen jeder neuen Begleitperson an', pickOne: 'Wähle mindestens eine Person',
    noSpotsCredits: 'Keine Plätze oder Guthaben mehr', onlyN: n => `Du kannst hier nur ${n} hinzufügen (Plätze/Guthaben)`,
    phoneTitle: 'Deine Telefonnummer', phoneSub: 'Wir brauchen sie, um dich über deine Buchung zu informieren.', phone: 'Telefon',
    phonePh: 'z. B. +49 151 23456789', phoneBad: 'Gib eine gültige Telefonnummer ein.',
    loginTitle: 'Zum Buchen anmelden', loginSub: 'Deine Kurse werden mit deinem Konto verknüpft.', keepSpots: 'Wir halten deine Plätze solange frei.',
    haveAccount: 'Ich habe ein Konto', createAccount: 'Konto erstellen', fname: 'Vorname', password: 'Passwort',
    loginBtn: 'Anmelden und weiter', registerBtn: 'Konto erstellen und weiter',
    needEmail: 'Gib deine E-Mail ein.', needPass: 'Gib dein Passwort ein.', passShort: 'Das Passwort muss mindestens 6 Zeichen haben.',
    needName: 'Gib deinen Namen ein.', needPhone: 'Gib eine gültige Telefonnummer ein.',
    confirmEmail: 'Bitte bestätige dein Konto per E-Mail, bevor du fortfährst.', loginFail: 'Anmeldung fehlgeschlagen.',
    prevMonth: 'Vorheriger Monat', nextMonth: 'Nächster Monat',
    pickWhen: 'Wähle, wann du deine Kurse nutzt', chosen: 'Kurse gewählt',
    held: 'Plätze reserviert für <strong class="cp-timer-clock">10:00</strong> — schließe deine Buchung vorher ab',
    yourSel: 'Deine Auswahl', noMonth: m => `Im ${m} sind keine Kurse veröffentlicht.`,
    noMonthHint: 'Versuche einen anderen Monat oder schreib uns, wir nennen dir die nächsten Termine.', askWa: 'Per WhatsApp fragen',
    waDates: t => `Hallo! Ich würde gern die nächsten Termine für ${t} wissen`,
    pickAtLeast: 'Wähle mindestens einen Kurs, um fortzufahren.',
    decideLater: l => `Du kannst <strong>später entscheiden</strong>, wann du ${l === 1 ? 'den restlichen Kurs' : `die restlichen ${l} Kurse`} nutzt – in deinem Konto.`,
    allDone: 'Du hast alle Kurse zugewiesen.', pickBefore: 'Wähle mindestens einen Kurs, bevor du fortfährst',
    pickDay: 'Wähle einen Tag mit Kursen (im Kalender markiert).', noDate: 'Für dieses Datum sind keine Kurse veröffentlicht.',
    full: 'Ausgebucht', noCredits: 'Keine Kurse mehr frei', chosenHere: n => `${n} gewählt`, levelLbl: 'Niveau',
    summary: 'Zusammenfassung deiner Buchung', chosenOf: (u, s) => `Gewählte Kurse · ${u} von ${s}`,
    noDatesYet: 'Du hast noch keine Termine gewählt — du kannst sie später in deinem Konto festlegen.',
    laterN: l => `${l} ${l !== 1 ? 'Kurse' : 'Kurs'} später festlegen.`, total: 'Paketpreis',
    payNote: 'Sichere Kartenzahlung. Nach der Bestätigung leiten wir dich zur Zahlungsseite weiter und du erhältst eine Bestätigung per E-Mail.',
    confirm: 'Buchung bestätigen', processing: 'Wird verarbeitet…',
    packName: n => `${n} ${n === 1 ? 'Kurs' : 'Kurse'}`,
    types: { grupal: 'Gruppe', privada: 'Privat', semiprivada: 'Semi-privat', familiar: 'Familie', residente: 'Residenten-Paket', kids: 'Waya Kids' },
    howBook: 'Wie möchtest du buchen?', howBookSub: 'Wähle, was für dich bequemer ist.',
    viaWa: 'Per WhatsApp buchen', viaWaSub: 'Wir antworten und stimmen den Tag mit dir ab.',
    viaWeb: 'Auf der Website buchen', viaWebSub: 'Wähle Tag und Uhrzeit im Kalender und zahle online.',
    waMsg: (p, pr) => `Hallo! Ich möchte buchen: ${p}${pr ? ` (${pr}€)` : ''}. Welche Tage habt ihr frei?`,
  },
};
export function t(k, ...a) {
  const v = (UI[lang()] || UI.es)[k] ?? UI.es[k];
  return typeof v === 'function' ? v(...a) : v;
}
export const typeLabel = (type) => t('types')[type] || TYPE_LABELS[type] || type;
// Título de la clase: el de la BD está en español; en EN/DE se usa el genérico del tipo.
const CLASS_TITLES = {
  en: { grupal: 'Group class', privada: 'Private class', semiprivada: 'Semi-private class', familiar: 'Family class', residente: 'Residents class', kids: 'Waya Kids' },
  de: { grupal: 'Gruppenkurs', privada: 'Privatkurs', semiprivada: 'Semi-Privatkurs', familiar: 'Familienkurs', residente: 'Residentenkurs', kids: 'Waya Kids' },
};
const classTitle = (cls, type) => (lang() !== 'es' && CLASS_TITLES[lang()]?.[type]) || cls?.title || typeLabel(type);

const TYPE_COLORS = {
  grupal: '#1a1a1a', privada: '#0369a1', semiprivada: '#0ea5e9', familiar: '#f97316', residente: '#10b981', kids: '#ec4899',
};
const HOLD_TOKEN_KEY = 'waya_class_hold_token';

function fmtTime(t) { return t?.slice(0, 5) || ''; }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function getDateRange(offset = 0, days = 10) {
  const dates = [];
  const today = new Date();
  today.setDate(today.getDate() + offset);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.toLocaleDateString(loc(), { weekday: 'short' });
  return `<span class="date-strip-weekday">${day}</span><span class="date-strip-num">${d.getDate()}</span>`;
}

async function fetchAvailability(date, type) {
  const { data, error } = await supabase.rpc('fetch_class_availability', {
    p_date: date, p_type: type, p_level: null,
  });
  if (error) { console.error('fetch_class_availability:', error); return []; }
  return data || [];
}

const WEEKDAYS = { es: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], de: ['M', 'D', 'M', 'D', 'F', 'S', 'S'] };
// Nombre del mes en el idioma activo, con mayúscula inicial.
function monthName(m) {
  const s = new Date(2000, m, 1).toLocaleDateString(loc(), { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const pad2 = n => String(n).padStart(2, '0');
function todayStr() { return new Date().toISOString().slice(0, 10); }

// Días del mes (tipo dado) con clases publicadas → para marcar el calendario.
// Cacheado por tipo+mes: qué DÍAS tienen clase no cambia al pulsar un día ni
// al añadir plazas, así que sin caché se repetía la misma query en cada clic.
const _monthDaysCache = new Map();
function invalidateMonthCache() { _monthDaysCache.clear(); }

async function fetchClassDaysForMonth(type, y, m) {
  const key = `${type}|${y}|${m}`;
  const hit = _monthDaysCache.get(key);
  if (hit) return hit;

  const start = `${y}-${pad2(m + 1)}-01`;
  const end = `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
  const { data, error } = await supabase.from('surf_classes')
    .select('date').eq('type', type).eq('published', true).eq('status', 'scheduled')
    .gte('date', start).lte('date', end);
  if (error) return new Set();

  const set = new Set((data || []).map(r => r.date));
  _monthDaysCache.set(key, set);
  return set;
}

function longDayLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Abre el modal del picker para un pack: elige clases y pasa a la pasarela.
 * El bono se crea al confirmarse el cobro, no antes.
 * @param {{classType:string, sessions:number, packName:string, deposit:number, fullPrice:number}} opts
 */
export async function openClassPicker(opts) {
  const { classType, sessions, deposit, fullPrice } = opts;
  const packName = t('packName', sessions);
  const rest = Math.max(fullPrice - deposit, 0);

  // Estado
  let view = 'select';        // 'select' | 'summary' | 'auth'
  let selectedDate = todayStr();
  const _now = new Date();
  let calY = _now.getFullYear();
  let calM = _now.getMonth();
  let markedDays = new Set();
  let bookings = [];          // [{ classId, class, attendee:{kind, family_member_id?, guest_data?, label} }]
  let holdsDeadline = null;
  let timerId = null;
  let refreshId = null;       // auto-refresco de disponibilidad

  const color = TYPE_COLORS[classType] || '#0ea5e9';

  // El modal se pinta ANTES de tocar la red: al pulsar "Reservar" hay
  // respuesta visual inmediata en vez de 2 llamadas de espera en blanco.
  const overlay = document.createElement('div');
  overlay.className = 'cp-overlay';
  overlay.innerHTML = `<div class="cp-modal" role="dialog" aria-modal="true"><div class="cp-loading">${t('loadingCal')}</div></div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const modal = overlay.querySelector('.cp-modal');

  const cartToken = (crypto?.randomUUID?.() || ('t-' + Date.now() + '-' + Math.round(performance.now()))).slice(0, 64);
  const prevToken = (() => { try { return localStorage.getItem(HOLD_TOKEN_KEY); } catch { return null; } })();
  try { localStorage.setItem(HOLD_TOKEN_KEY, cartToken); } catch {}

  // Sesión + familiares
  let user = null, family = [];
  async function refreshAuth() {
    try {
      const session = await getSession();
      user = session?.user || null;
      if (user) { try { family = await fetchFamilyMembers(); } catch { family = []; } }
    } catch { user = null; }
  }

  // Pantalla de fallo cuando no se puede contactar con el backend.
  // Reutiliza las clases del modal, así que no necesita CSS nuevo.
  function renderErrorCarga() {
    modal.innerHTML = `
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>${t('errTitle')}</h3>
        <p class="cp-sub">${esc(packName)}</p>
      </div>
      <p class="cp-empty">${t('errBody')}</p>
      <div class="cp-footer">
        <div class="cp-footer-btns">
          <button class="btn line" id="cp-err-close">${t('close')}</button>
          <button class="btn red" id="cp-err-retry">${t('retry')}</button>
        </div>
      </div>`;
    modal.querySelector('.cp-close').onclick = close;
    modal.querySelector('#cp-err-close').onclick = close;
    modal.querySelector('#cp-err-retry').onclick = () => { close(); openClassPicker(opts); };
  }

  function close() {
    if (timerId) clearInterval(timerId);
    if (refreshId) clearInterval(refreshId);
    document.body.style.overflow = '';
    overlay.remove();
  }
  async function releaseAll() {
    try { await supabase.rpc('release_holds', { p_cart_token: cartToken }); } catch {}
    try { localStorage.removeItem(HOLD_TOKEN_KEY); } catch {}
    bookings = [];
    holdsDeadline = null;
  }
  function creditsLeft() { return sessions - bookings.length; }

  // ---- Contador regresivo ----
  function startTimer() {
    if (timerId) clearInterval(timerId);
    timerId = setInterval(updateTimerUI, 1000);
    updateTimerUI();
  }
  function updateTimerUI() {
    const el = modal.querySelector('#cp-timer');
    if (!holdsDeadline || !bookings.length) { if (el) el.style.display = 'none'; return; }
    const ms = holdsDeadline - Date.now();
    if (ms <= 0) {
      clearInterval(timerId); timerId = null;
      releaseAll().then(() => { if (view === 'select') render(); });
      showToast(t('timeUp'), 'error');
      return;
    }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    if (el) { el.style.display = ''; el.querySelector('.cp-timer-clock').textContent = `${m}:${String(s).padStart(2, '0')}`; }
  }

  // ---- Añadir/quitar plaza ----
  async function addBooking(cls, attendee) {
    if (creditsLeft() <= 0) { showToast(t('allAssigned'), 'error'); return false; }
    try {
      const res = await supabase.rpc('create_hold', { p_class_id: cls.id, p_cart_token: cartToken, p_qty: 1 });
      if (res.error) throw res.error;
      holdsDeadline = new Date(res.data).getTime();
    } catch (err) {
      showToast(t('holdFail') + (err.message || t('noSpots')), 'error');
      return false;
    }
    bookings.push({ classId: cls.id, class: cls, attendee });
    startTimer();
    return true;
  }
  async function removeBooking(idx) {
    const b = bookings[idx];
    if (!b) return;
    try { await supabase.rpc('release_class_holds', { p_class_id: b.classId, p_cart_token: cartToken, p_qty: 1 }); } catch {}
    bookings.splice(idx, 1);
    if (!bookings.length) { holdsDeadline = null; if (timerId) { clearInterval(timerId); timerId = null; } }
    render();
  }

  // ---- Selector de asistentes (múltiple) ----
  function openAttendeePicker(cls) {
    const panel = document.createElement('div');
    panel.className = 'cp-attendee-overlay';
    const maxAdd = Math.min(creditsLeft(), cls.spots_left || 0);
    // Asistentes ya metidos en ESTA clase (no se pueden repetir)
    const selfBooked = bookings.some(b => b.classId === cls.id && b.attendee.kind === 'self');
    const bookedFam = new Set(bookings.filter(b => b.classId === cls.id && b.attendee.family_member_id).map(b => b.attendee.family_member_id));
    const familyOpts = family.map(m => {
      const dis = bookedFam.has(m.id);
      return `
      <label class="cp-att-opt${dis ? ' cp-att-disabled' : ''}">
        <input type="checkbox" class="cp-att-cb" value="fam:${m.id}" ${dis ? 'disabled data-locked="1"' : ''}>
        <span>${esc(m.full_name)}${m.last_name ? ' ' + esc(m.last_name) : ''}${m.level ? ` · ${esc(m.level)}` : ''}${dis ? t('alreadyIn') : ''}</span>
      </label>`;
    }).join('');
    panel.innerHTML = `
      <div class="cp-attendee-box">
        <h4>${t('whoAttends')}</h4>
        <p class="cp-att-sub">${esc(classTitle(cls, classType))} · ${fmtTime(cls.time_start)} · ${t('spotsFree', cls.spots_left)}</p>
        <p class="cp-att-hint">${t('attHint', maxAdd, creditsLeft())}</p>
        <div class="cp-att-opts">
          <label class="cp-att-opt${selfBooked ? ' cp-att-disabled' : ''}"><input type="checkbox" class="cp-att-cb" value="self" ${selfBooked ? 'disabled data-locked="1"' : ''}><span>${t('myself')}${selfBooked ? t('alreadyIn') : ''}</span></label>
          ${familyOpts}
        </div>
        <div class="cp-guest-list"></div>
        <button type="button" class="cp-add-guest" id="cp-add-guest">${t('addGuest')}</button>
        <div class="cp-att-actions">
          <button class="btn red" id="cp-att-confirm">${t('add')}</button>
          <button class="btn line" id="cp-att-cancel">${t('cancel')}</button>
        </div>
      </div>`;
    overlay.appendChild(panel);

    // Límite en vivo: nº seleccionado = checkboxes marcados + bloques de acompañante.
    // Al llegar al tope (créditos/plazas de esta clase) se desactiva añadir más, sin error.
    function selectedCount() {
      return panel.querySelectorAll('.cp-att-cb:checked').length + panel.querySelectorAll('.cp-guest-block').length;
    }
    function applyCap() {
      const n = selectedCount();
      const atLimit = n >= maxAdd;
      panel.querySelectorAll('.cp-att-cb').forEach(cb => {
        if (cb.dataset.locked) return;                 // ya inscrito en esta clase
        cb.disabled = atLimit && !cb.checked;
      });
      const addBtn = panel.querySelector('#cp-add-guest');
      if (addBtn) { addBtn.disabled = atLimit; addBtn.style.opacity = atLimit ? '.5' : ''; }
      const rem = panel.querySelector('.cp-att-remaining');
      if (rem) rem.textContent = String(Math.max(maxAdd - n, 0));
    }

    const guestList = panel.querySelector('.cp-guest-list');
    function guestBlockHtml() {
      return `
        <div class="cp-guest-block">
          <button type="button" class="cp-guest-remove" aria-label="${t('remove')}">&times;</button>
          <div class="cp-guest-grid">
            <label>${t('name')}<input type="text" class="g_full_name"></label>
            <label>${t('lastName')}<input type="text" class="g_last_name"></label>
            <label>${t('birth')}<input type="date" class="g_birth_date"></label>
            <label>${t('level')}<select class="g_level">${levelOptionsHtml()}</select></label>
            <label>${t('wetsuit')}<select class="g_wetsuit_size">${wetsuitOptionsHtml()}</select></label>
            <label>${t('canSwim')}<select class="g_can_swim"><option value="">-</option><option value="true">${t('yes')}</option><option value="false">${t('no')}</option></select></label>
          </div>
          <label class="cp-guest-injury">${t('injury')} <input type="text" class="g_injury_detail" placeholder="${t('injuryPh')}"></label>
        </div>`;
    }
    panel.querySelectorAll('.cp-att-cb').forEach(cb => cb.addEventListener('change', applyCap));
    panel.querySelector('#cp-add-guest').onclick = () => {
      if (selectedCount() >= maxAdd) return;
      guestList.insertAdjacentHTML('beforeend', guestBlockHtml());
      const block = guestList.lastElementChild;
      block.querySelector('.cp-guest-remove').onclick = () => { block.remove(); applyCap(); };
      block.querySelector('.g_full_name').focus();
      applyCap();
    };
    panel.querySelector('#cp-att-cancel').onclick = () => panel.remove();
    applyCap();

    panel.querySelector('#cp-att-confirm').onclick = async () => {
      const attendees = [];
      panel.querySelectorAll('.cp-att-cb:checked').forEach(cb => {
        if (cb.value === 'self') attendees.push({ kind: 'self', label: t('me') });
        else if (cb.value.startsWith('fam:')) {
          const id = cb.value.slice(4);
          const m = family.find(x => x.id === id);
          attendees.push({ kind: 'family', family_member_id: id, label: m ? m.full_name : t('relative') });
        }
      });
      let missingName = false;
      panel.querySelectorAll('.cp-guest-block').forEach(blk => {
        const fullName = blk.querySelector('.g_full_name').value.trim();
        if (!fullName) { missingName = true; return; }
        const guest_data = {
          full_name: fullName,
          last_name: blk.querySelector('.g_last_name').value.trim() || '',
          birth_date: blk.querySelector('.g_birth_date').value || null,
          level: blk.querySelector('.g_level').value || null,
          wetsuit_size: blk.querySelector('.g_wetsuit_size').value || null,
          can_swim: (v => v === '' ? null : v === 'true')(blk.querySelector('.g_can_swim').value),
          injury_detail: blk.querySelector('.g_injury_detail').value.trim() || null,
        };
        guest_data.has_injury = !!guest_data.injury_detail;
        attendees.push({ kind: 'guest', guest_data, label: fullName });
      });
      if (missingName) { showToast(t('guestName'), 'error'); return; }

      if (!attendees.length) { showToast(t('pickOne'), 'error'); return; }
      if (attendees.length > maxAdd) {
        showToast(maxAdd <= 0 ? t('noSpotsCredits') : t('onlyN', maxAdd), 'error');
        return;
      }

      const btn = panel.querySelector('#cp-att-confirm');
      btn.disabled = true; btn.textContent = t('adding');
      let added = 0;
      for (const att of attendees) {
        const ok = await addBooking(cls, att);
        if (!ok) break;
        added++;
      }
      panel.remove();
      if (added) render();
    };
  }

  // ---- (Legacy, sin uso: item para la pasarela; se reactivará con SumUp) ----
  function buildItem() {
    return {
      id: `class-${classType}-${sessions}`,
      type: 'class_reservation',
      name: packName,
      price: deposit,
      quantity: 1,
      metadata: {
        classType, sessions, fullPrice, deposit, cartToken,
        bookings: bookings.map(b => ({
          classId: b.classId,
          date: b.class.date,
          time: fmtTime(b.class.time_start),
          title: classTitle(b.class, classType),
          attendee: b.attendee,
        })),
      },
    };
  }

  // Pide el teléfono si el perfil no lo tiene. Devuelve el teléfono o null (cancelado).
  function capturePhone() {
    return new Promise((resolve) => {
      if (timerId) clearInterval(timerId);
      modal.innerHTML = `
        <button class="cp-close" aria-label="${t('close')}">&times;</button>
        <div class="cp-header" style="border-top:4px solid ${color}">
          <h3>${t('phoneTitle')}</h3>
          <p class="cp-sub">${t('phoneSub')}</p>
        </div>
        <div class="cp-auth">
          <form id="cp-phone-form">
            <label class="cp-auth-field">${t('phone')}
              <input type="tel" name="phone" required autocomplete="tel" inputmode="tel" placeholder="${t('phonePh')}">
            </label>
            <p class="cp-auth-error" style="display:none"></p>
            <div class="cp-att-actions">
              <button type="submit" class="btn red" id="cp-phone-submit">${t('cont')}</button>
              <button type="button" class="btn line" id="cp-phone-back">${t('back')}</button>
            </div>
          </form>
        </div>`;
      const form = modal.querySelector('#cp-phone-form');
      const errEl = modal.querySelector('.cp-auth-error');
      modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); resolve(null); };
      modal.querySelector('#cp-phone-back').onclick = () => { view = 'select'; render(); resolve(null); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const phone = form.phone.value.trim();
        if (phone.replace(/\D/g, '').length < 6) { errEl.textContent = t('phoneBad'); errEl.style.display = ''; return; }
        const btn = modal.querySelector('#cp-phone-submit'); btn.disabled = true; btn.textContent = t('oneMoment');
        try { await supabase.from('profiles').update({ phone }).eq('id', user.id); } catch {}
        resolve(phone);
      };
    });
  }

  // Manda a la pasarela: el bono y las inscripciones se crean al confirmarse el cobro.
  // vía RPC. El pago se completa en la escuela (o online cuando esté SumUp).
  async function goToPayment() {
    if (!user) { view = 'auth'; render(); return; }
    // Teléfono OBLIGATORIO: si el perfil no lo tiene, pedirlo antes de reservar.
    let phone = '';
    try { const { data } = await supabase.from('profiles').select('phone').eq('id', user.id).maybeSingle(); phone = (data?.phone || '').trim(); } catch {}
    if (phone.replace(/\D/g, '').length < 6) {
      phone = await capturePhone();
      if (!phone) return false;
    }
    // A la pasarela. El bono y las inscripciones se crean cuando el cobro está
    // confirmado (confirmar_pago_sumup), no antes: así no quedan bonos a medias
    // sin pagar, que es lo que pasaba con el flujo anterior.
    await pagarAhora({
      id: `pack-${classType}-${sessions}`,
      type: 'pack',
      name: `${typeLabel(classType)} · ${t('packName', sessions)}`,
      price: fullPrice,
      quantity: 1,
      metadata: {
        classType,
        sessions,
        bookings: bookings.map(b => ({ classId: b.classId, attendee: b.attendee })),
      },
    });
    // El hold se suelta solo al expirar si el pago no llega a completarse.
    if (timerId) clearInterval(timerId);
    return true;
  }

  // Pantalla de confirmación (sin uso desde que el cobro es online: la
  // confirmación la da /pago-ok.html tras volver de la pasarela)
  function renderSuccess(res) {
    view = 'done';
    if (refreshId) clearInterval(refreshId);
    const n = (res && res.enrolled) || 0;
    modal.innerHTML = `
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>¡Reserva confirmada! 🤙</h3>
        <p class="cp-sub">Tu bono de ${sessions} clase${sessions !== 1 ? 's' : ''} · ${TYPE_LABELS[classType] || classType}</p>
      </div>
      <div class="cp-summary">
        ${n > 0 ? `<p>Has reservado <strong>${n} clase${n !== 1 ? 's' : ''}</strong>.</p>` : ''}
        <p style="margin-top:.6rem">Las clases sin asignar quedan como créditos en tu bono para reservar cuando quieras desde <strong>Mi cuenta</strong>.</p>
        <p style="margin-top:1rem;padding:.9rem 1rem;background:#fff8d6;border-radius:12px"><strong>Pago:</strong> pásate por la escuela o te contactamos para completarlo. Te enviamos la confirmación por email.</p>
      </div>
      <div class="cp-footer">
        <a href="/mi-cuenta/" class="btn red" style="text-decoration:none;text-align:center">Ver mis reservas</a>
        <button type="button" class="btn line" id="cp-done-close">Cerrar</button>
      </div>`;
    modal.querySelector('.cp-close').onclick = () => close();
    modal.querySelector('#cp-done-close').onclick = () => close();
  }

  // ---- Vista de autenticación inline ----
  function renderAuth() {
    if (timerId) clearInterval(timerId);
    modal.innerHTML = `
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>${t('loginTitle')}</h3>
        <p class="cp-sub">${t('loginSub')} ${holdsDeadline ? t('keepSpots') : ''}</p>
      </div>
      <div class="cp-auth">
        <div class="cp-auth-tabs">
          <button class="cp-auth-tab active" data-tab="login">${t('haveAccount')}</button>
          <button class="cp-auth-tab" data-tab="register">${t('createAccount')}</button>
        </div>
        <form id="cp-auth-form">
          <label class="cp-auth-field cp-reg-only" style="display:none">${t('fname')}
            <input type="text" name="fullname" autocomplete="given-name">
          </label>
          <label class="cp-auth-field cp-reg-only" style="display:none">${t('lastName')}
            <input type="text" name="lastname" autocomplete="family-name">
          </label>
          <label class="cp-auth-field cp-reg-only" style="display:none">${t('phone')}
            <input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="${t('phonePh')}">
          </label>
          <label class="cp-auth-field">Email
            <input type="email" name="email" required autocomplete="email">
          </label>
          <label class="cp-auth-field">${t('password')}
            <input type="password" name="password" required autocomplete="current-password" minlength="6">
          </label>
          <p class="cp-auth-error" style="display:none"></p>
          <div class="cp-att-actions">
            <button type="submit" class="btn red" id="cp-auth-submit">${t('loginBtn')}</button>
            <button type="button" class="btn line" id="cp-auth-back">${t('back')}</button>
          </div>
        </form>
      </div>`;

    let tab = 'login';
    const form = modal.querySelector('#cp-auth-form');
    // TODOS los campos de registro (nombre, apellidos, teléfono). Con querySelector
    // solo se mostraba el primero y el teléfono —obligatorio— quedaba oculto.
    const regOnly = modal.querySelectorAll('.cp-reg-only');
    const errEl = modal.querySelector('.cp-auth-error');
    const submit = modal.querySelector('#cp-auth-submit');

    modal.querySelectorAll('.cp-auth-tab').forEach(b => b.onclick = () => {
      tab = b.dataset.tab;
      modal.querySelectorAll('.cp-auth-tab').forEach(x => x.classList.toggle('active', x === b));
      regOnly.forEach(el => { el.style.display = tab === 'register' ? '' : 'none'; });
      submit.textContent = tab === 'register' ? t('registerBtn') : t('loginBtn');
    });
    modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-auth-back').onclick = () => { view = 'select'; render(); };

    form.onsubmit = async (e) => {
      e.preventDefault();
      errEl.style.display = 'none';
      const email = form.email.value.trim();
      const pass = form.password.value;
      const fullname = form.fullname?.value.trim() || '';
      const lastname = form.lastname?.value.trim() || '';
      const phone = form.phone?.value.trim() || '';
      // Email y contraseña OBLIGATORIOS (login y registro).
      if (!email) { errEl.textContent = t('needEmail'); errEl.style.display = ''; return; }
      if (!pass) { errEl.textContent = t('needPass'); errEl.style.display = ''; return; }
      if (tab === 'register' && pass.length < 6) { errEl.textContent = t('passShort'); errEl.style.display = ''; return; }
      if (tab === 'register' && !fullname) { errEl.textContent = t('needName'); errEl.style.display = ''; return; }
      // Teléfono OBLIGATORIO al crear cuenta (lo necesitamos para contactar por la reserva).
      if (tab === 'register' && phone.replace(/\D/g, '').length < 6) {
        errEl.textContent = t('needPhone'); errEl.style.display = ''; return;
      }
      submit.disabled = true; submit.textContent = t('oneMoment');
      try {
        if (tab === 'register') await signUp(email, pass, fullname, { phone, last_name: lastname });
        else await signIn(email, pass);
        await refreshAuth();
        if (!user) throw new Error(t('confirmEmail'));
        await goToPayment();
      } catch (err) {
        errEl.textContent = err.message || t('loginFail');
        errEl.style.display = '';
        submit.disabled = false;
        submit.textContent = tab === 'register' ? t('registerBtn') : t('loginBtn');
      }
    };
  }

  // ---- Calendario mensual ----
  function monthCalendarHtml() {
    const firstWd = (new Date(calY, calM, 1).getDay() + 6) % 7; // Lunes = 0
    const daysInMonth = new Date(calY, calM + 1, 0).getDate();
    const tStr = todayStr();
    let cells = '';
    for (let i = 0; i < firstWd; i++) cells += '<span class="cp-cal-empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calY}-${pad2(calM + 1)}-${pad2(d)}`;
      const has = markedDays.has(ds);
      const past = ds < tStr;
      const selectable = has && !past;
      const mine = bookings.filter(b => b.class.date === ds).length;
      const cl = ['cp-cal-day'];
      if (ds === selectedDate && selectable) cl.push('active');
      if (selectable) cl.push('has-class'); else cl.push('cp-cal-off');
      cells += `<button class="${cl.join(' ')}" data-date="${ds}" ${selectable ? '' : 'disabled'}>${d}${mine ? '<span class="cp-cal-dot"></span>' : ''}</button>`;
    }
    return `
      <div class="cp-cal">
        <div class="cp-cal-head">
          <button class="cp-cal-nav" id="cp-cal-prev" aria-label="${t('prevMonth')}">&lsaquo;</button>
          <span class="cp-cal-title">${monthName(calM)} ${calY}</span>
          <button class="cp-cal-nav" id="cp-cal-next" aria-label="${t('nextMonth')}">&rsaquo;</button>
        </div>
        <div class="cp-cal-grid cp-cal-weekdays">${WEEKDAYS[lang()].map(w => `<span>${w}</span>`).join('')}</div>
        <div class="cp-cal-grid cp-cal-days">${cells}</div>
      </div>`;
  }

  // ---- Render principal ----
  async function render() {
    if (view === 'auth') { renderAuth(); return; }
    if (view === 'summary') { renderSummary(); return; }

    try { markedDays = await fetchClassDaysForMonth(classType, calY, calM); } catch { markedDays = new Set(); }
    const used = bookings.length;
    const left = creditsLeft();

    let html = `
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>${t('pickWhen')}</h3>
        <p class="cp-sub">${esc(packName)} — ${typeLabel(classType)}</p>
        <div class="cp-credits">
          <span class="cp-credits-count">${used} / ${sessions}</span>
          <span class="cp-credits-label">${t('chosen')}</span>
        </div>
      </div>
      <div id="cp-timer" class="cp-timer" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>
        ${t('held')}
      </div>`;

    if (bookings.length) {
      html += `<div class="cp-selection"><strong>${t('yourSel')}</strong>
        ${bookings.map((b, i) => `
          <div class="cp-sel-row">
            <span>${new Date(b.class.date + 'T12:00:00').toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(b.class.time_start)}</span>
            <span class="cp-sel-att">${esc(b.attendee.label)}</span>
            <button class="cp-sel-remove" data-rm="${i}" aria-label="${t('remove')}">&times;</button>
          </div>`).join('')}
      </div>`;
    }

    // Si el mes no tiene NINGÚN día con clase, decirlo claramente en vez de
    // dejar un calendario todo gris que parece roto.
    if (!markedDays.size) {
      html += `
        <div class="cp-empty cp-empty--nomonth">
          <strong>${t('noMonth', monthName(calM))}</strong><br>
          ${t('noMonthHint')}
          <div style="margin-top:14px">
            <a class="btn line" href="https://wa.me/34636562448?text=${encodeURIComponent(t('waDates', typeLabel(classType)))}"
               target="_blank" rel="noopener noreferrer">${t('askWa')}</a>
          </div>
        </div>`;
    }

    html += monthCalendarHtml();
    html += `<div class="cp-slots" id="cp-slots"><div class="cp-loading">Cargando…</div></div>`;

    html += `<div class="cp-footer">
        <span class="cp-footer-note">${!bookings.length
          ? t('pickAtLeast')
          : left > 0
            ? t('decideLater', left)
            : t('allDone')}</span>
        <div class="cp-footer-btns">
          <button class="btn line" id="cp-cancel">${t('cancel')}</button>
          <button class="btn red" id="cp-confirm" ${bookings.length ? '' : 'disabled'}
                  title="${bookings.length ? '' : t('pickAtLeast')}">${t('cont')}</button>
        </div>
      </div>`;

    modal.innerHTML = html;

    modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-cancel').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-confirm').onclick = () => {
      // Doble red: sin clases elegidas se crearía un bono vacío (0/N créditos
      // y ninguna inscripción), que es justo lo que pasaba antes.
      if (!bookings.length) {
        showToast(t('pickBefore'), 'error');
        return;
      }
      view = 'summary';
      render();
    };
    modal.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeBooking(Number(b.dataset.rm)));
    modal.querySelector('#cp-cal-prev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } render(); };
    modal.querySelector('#cp-cal-next').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } render(); };
    modal.querySelectorAll('.cp-cal-day:not([disabled])').forEach(b => b.onclick = () => { selectedDate = b.dataset.date; render(); });

    startTimer();

    const slotsEl = modal.querySelector('#cp-slots');
    if (!markedDays.has(selectedDate)) {
      slotsEl.innerHTML = `<p class="cp-empty">${t('pickDay')}</p>`;
      return;
    }
    const classes = await fetchAvailability(selectedDate, classType);
    if (!classes.length) { slotsEl.innerHTML = `<p class="cp-empty">${t('noDate')}</p>`; return; }
    slotsEl.innerHTML = classes.map(c => {
      const mineHere = bookings.filter(b => b.classId === c.id).length;
      const full = c.spots_left <= 0;
      let action;
      if (full) action = `<span class="cp-full">${t('full')}</span>`;
      else if (left <= 0) action = `<span class="cp-full">${t('noCredits')}</span>`;
      else action = `<button class="btn red cp-add" data-cls="${c.id}" style="font-size:.8rem;padding:6px 14px">${t('add')}</button>`;
      return `
        <div class="class-slot-card ${full ? 'class-slot-full' : ''}" style="border-left:4px solid ${color}">
          <div class="class-slot-header">
            <span class="class-slot-time">${fmtTime(c.time_start)} — ${fmtTime(c.time_end)}</span>
            ${mineHere ? `<span class="cp-mine-badge">${t('chosenHere', mineHere)}</span>` : ''}
          </div>
          <div class="class-slot-body">
            <strong>${esc(classTitle(c, classType))}</strong>
            ${c.instructor ? `<span class="meta">${esc(c.instructor)}</span>` : ''}
            ${c.level && c.level !== 'todos' ? `<span class="meta">${t('levelLbl')}: ${esc(c.level)}</span>` : ''}
            ${c.location ? `<span class="meta">${esc(c.location)}</span>` : ''}
          </div>
          <div class="class-slot-footer">
            <span class="spots-badge ${full ? 'spots-full' : ''}">${t('spotsFree', c.spots_left)}</span>
            ${action}
          </div>
        </div>`;
    }).join('');
    slotsEl.querySelectorAll('.cp-add').forEach(btn => {
      const cls = classes.find(c => c.id === btn.dataset.cls);
      btn.onclick = () => openAttendeePicker(cls);
    });
  }

  // ---- Resumen / precompra ----
  function renderSummary() {
    const used = bookings.length;
    const left = creditsLeft();
    const sorted = [...bookings].sort((a, b) =>
      (a.class.date + a.class.time_start).localeCompare(b.class.date + b.class.time_start));

    modal.innerHTML = `
      <button class="cp-close" aria-label="${t('close')}">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>${t('summary')}</h3>
        <p class="cp-sub">${esc(packName)} — ${typeLabel(classType)}</p>
      </div>
      <div id="cp-timer" class="cp-timer" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>
        ${t('held')}
      </div>
      <div class="cp-summary">
        <div class="cp-sum-block">
          <h4>${t('chosenOf', used, sessions)}</h4>
          ${used ? sorted.map(b => `
            <div class="cp-sum-row">
              <div class="cp-sum-when">
                <strong>${longDayLabel(b.class.date)}</strong>
                <span>${fmtTime(b.class.time_start)} – ${fmtTime(b.class.time_end)}</span>
              </div>
              <span class="cp-sum-att">${esc(b.attendee.label)}</span>
            </div>`).join('') : `<p class="cp-sum-empty">${t('noDatesYet')}</p>`}
          ${left > 0 && used ? `<p class="cp-sum-later">${t('laterN', left)}</p>` : ''}
        </div>
        <div class="cp-sum-pay">
          <div class="cp-sum-pay-total"><span>${t('total')}</span><strong>${fullPrice}€</strong></div>
          <p class="cp-sum-muted" style="margin-top:.6rem;font-size:.9rem">${t('payNote')}</p>
        </div>
      </div>
      <div class="cp-footer">
        <div class="cp-footer-btns">
          <button class="btn line" id="cp-back">${t('back')}</button>
          <button class="btn red" id="cp-pay">${t('confirm')}</button>
        </div>
      </div>`;

    modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-back').onclick = () => { view = 'select'; render(); };
    modal.querySelector('#cp-pay').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = t('processing');
      const ok = await goToPayment();
      if (ok === false) { btn.disabled = false; btn.textContent = t('confirm'); }
    };
    startTimer();
  }

  // Arranque: las 3 llamadas son independientes entre sí, así que van en
  // paralelo en vez de encadenadas (antes eran 3 round-trips en serie).
  //
  // Con tope de tiempo: si el backend no responde (caído, sin DNS, sin red),
  // supabase-js reintenta el refresh del token con backoff y tarda muchísimo
  // en rendirse. Sin este tope el modal se quedaba en "Cargando calendario…"
  // para siempre, sin decirle nada al usuario.
  const arranque = Promise.all([
    // Libera holds huérfanos de una sesión anterior (evita auto-bloqueo)
    prevToken
      ? supabase.rpc('release_holds', { p_cart_token: prevToken }).then(() => {}, () => {})
      : Promise.resolve(),
    refreshAuth(),
    // Primer mes con clases (para que el calendario no salga vacío)
    supabase.from('surf_classes')
      .select('date').eq('type', classType).eq('published', true).eq('status', 'scheduled')
      .gte('date', todayStr()).order('date', { ascending: true }).limit(1)
      .then(r => r, () => ({ data: null })),
  ]);

  const CADUCA = Symbol('timeout');
  const resultado = await Promise.race([
    arranque,
    new Promise(r => setTimeout(() => r(CADUCA), 10000)),
  ]);

  if (resultado === CADUCA) {
    renderErrorCarga();
    return;
  }

  const firstClsRes = resultado[2];
  const firstCls = firstClsRes?.data;
  if (firstCls?.[0]?.date) {
    const d = new Date(firstCls[0].date + 'T12:00:00');
    calY = d.getFullYear(); calM = d.getMonth(); selectedDate = firstCls[0].date;
  }

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) { await releaseAll(); close(); }
  });

  // Auto-refresco de disponibilidad cada 30s (las plazas liberadas aparecen solas).
  // Invalida el caché de meses para recoger clases publicadas mientras tanto.
  refreshId = setInterval(() => {
    if (view === 'select' && !overlay.querySelector('.cp-attendee-overlay')) {
      invalidateMonthCache();
      render();
    }
  }, 30000);

  await render();
}
