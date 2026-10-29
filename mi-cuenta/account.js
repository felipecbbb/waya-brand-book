/* ============================================================
   Panel de cliente — Waya Surf School
   Núcleo ESM: gate de auth, onboarding, shell de dashboard,
   navegación de tabs y lazy-load de los tabs externos.

   Adaptado del panel de Entreolas. Imports absolutos desde raíz web.
   Los 6 tipos de clase Waya viven en TYPE_LABELS (/lib/utils.js).
   ============================================================ */

import { getSession, getProfile, signIn, signUp, signOut, updateProfile, changePassword } from '/lib/auth-client.js';
import { supabase } from '/lib/supabase.js';
import { esc, formatDate, formatPrice } from '/lib/utils.js';
import {
  levelOptionsHtml,
  wetsuitOptionsHtml,
  phonePrefixSelectHtml,
} from '/lib/shared-constants.js';
import { loadPricing } from '/lib/domain/pricing.js';
import { bannerFichaPendienteHtml } from '/lib/ficha-reserva.js';

const mainEl = document.getElementById('account-root');

/* ---------------- Idioma de la pantalla de acceso ----------------
   Quien reserva un surfcamp en /de/ y no tiene sesión acaba aquí: la
   pantalla de entrar / crear cuenta tiene que salir en su idioma. El
   idioma lo guarda i18n.js (siteLanguage) al visitar cualquier página. */
function lang() {
  try { const l = (localStorage.getItem('siteLanguage') || 'es').slice(0, 2); return ['es', 'en', 'de'].includes(l) ? l : 'es'; } catch { return 'es'; }
}
const AUTH = {
  es: {
    back: 'Volver al inicio', welcome: 'Bienvenido de nuevo', welcomeSub: 'Accede a tu cuenta para gestionar tus reservas y clases',
    password: 'Contraseña', passPh: 'Tu contraseña', login: 'Iniciar sesión', loggingIn: 'Entrando…',
    noAccount: '¿No tienes cuenta?', createAccount: 'Crear cuenta', createSub: 'Regístrate para reservar clases y gestionar tu perfil',
    name: 'Nombre *', namePh: 'Tu nombre', lastName: 'Apellidos', lastNamePh: 'Tus apellidos', phone: 'Teléfono *', phonePrefix: 'Prefijo de país',
    pass6: 'Mínimo 6 caracteres', repeatPass: 'Repetir contraseña *', repeatPassPh: 'Repite tu contraseña',
    passwordReq: 'Contraseña *', creating: 'Creando cuenta…', haveAccount: '¿Ya tienes cuenta?',
    tagline: 'Surf · Clases · Surfcamps', brandTitle: 'Tu escuela de surf en Gran Canaria', brandDesc: 'Reserva clases, gestiona tus bonos y consulta tu historial desde tu cuenta personal.',
    errTerms: 'Debes aceptar las Condiciones y la Política de privacidad.', errPhone: 'Escribe un teléfono de contacto válido.', errEmail: 'Escribe tu email.', errPass6: 'La contraseña debe tener al menos 6 caracteres.',
    errMatch: 'Las contraseñas no coinciden.', cpCreate: 'Crea tu contraseña', cpChange: 'Cambia tu contraseña', cpCreateSub: 'Elige una contraseña para entrar en tu cuenta de Waya cuando quieras.',
    cpChangeSub: 'Por seguridad, elige una contraseña nueva para tu primer acceso.', newPass: 'Nueva contraseña', repeatNew: 'Repite la contraseña',
    saveEnter: 'Guardar y entrar', saving: 'Guardando…', errPass8: 'La contraseña debe tener al menos 8 caracteres.', cpFail: 'No se pudo cambiar la contraseña.',
    expTitle: 'El enlace ha caducado', expText: 'Este enlace ya se usó o ha caducado. Escríbenos por WhatsApp al', expText2: 'y te mandamos uno nuevo.', goLogin: 'Ir a iniciar sesión',
    acceptLegal: 'Acepto las <a href="/condiciones.html" target="_blank" rel="noopener">Condiciones de contratación</a> y la <a href="/politica-privacidad.html" target="_blank" rel="noopener">Política de privacidad</a> *',
    checkEmail: 'Cuenta creada. Te hemos enviado un email: pulsa el enlace para activarla y entrar.',
  },
  en: {
    back: 'Back to home', welcome: 'Welcome back', welcomeSub: 'Log in to manage your bookings and classes',
    password: 'Password', passPh: 'Your password', login: 'Log in', loggingIn: 'Logging in…',
    noAccount: "Don't have an account?", createAccount: 'Create account', createSub: 'Sign up to book classes and manage your profile',
    name: 'First name *', namePh: 'Your first name', lastName: 'Last name', lastNamePh: 'Your last name', phone: 'Phone *', phonePrefix: 'Country code',
    pass6: 'At least 6 characters', repeatPass: 'Repeat password *', repeatPassPh: 'Repeat your password',
    passwordReq: 'Password *', creating: 'Creating account…', haveAccount: 'Already have an account?',
    tagline: 'Surf · Lessons · Surf camps', brandTitle: 'Your surf school in Gran Canaria', brandDesc: 'Book classes, manage your passes and see your history from your personal account.',
    errTerms: 'You must accept the Terms and the Privacy policy.', errPhone: 'Enter a valid contact phone number.', errEmail: 'Enter your email.', errPass6: 'Password must be at least 6 characters.',
    errMatch: "Passwords don't match.", cpCreate: 'Create your password', cpChange: 'Change your password', cpCreateSub: 'Choose a password to log in to your Waya account whenever you like.',
    cpChangeSub: 'For security, choose a new password for your first login.', newPass: 'New password', repeatNew: 'Repeat the password',
    saveEnter: 'Save and continue', saving: 'Saving…', errPass8: 'Password must be at least 8 characters.', cpFail: 'Could not change the password.',
    expTitle: 'This link has expired', expText: 'This link has already been used or has expired. Message us on WhatsApp at', expText2: 'and we will send you a new one.', goLogin: 'Go to log in',
    acceptLegal: 'I accept the <a href="/condiciones.html" target="_blank" rel="noopener">Terms of booking</a> and the <a href="/politica-privacidad.html" target="_blank" rel="noopener">Privacy policy</a> *',
    checkEmail: "Account created. We've sent you an email: click the link to activate it and log in.",
  },
  de: {
    back: 'Zur Startseite', welcome: 'Willkommen zurück', welcomeSub: 'Melde dich an, um deine Buchungen und Kurse zu verwalten',
    password: 'Passwort', passPh: 'Dein Passwort', login: 'Anmelden', loggingIn: 'Anmeldung…',
    noAccount: 'Noch kein Konto?', createAccount: 'Konto erstellen', createSub: 'Registriere dich, um Kurse zu buchen und dein Profil zu verwalten',
    name: 'Vorname *', namePh: 'Dein Vorname', lastName: 'Nachname', lastNamePh: 'Dein Nachname', phone: 'Telefon *', phonePrefix: 'Ländervorwahl',
    pass6: 'Mindestens 6 Zeichen', repeatPass: 'Passwort wiederholen *', repeatPassPh: 'Passwort wiederholen',
    passwordReq: 'Passwort *', creating: 'Konto wird erstellt…', haveAccount: 'Schon ein Konto?',
    tagline: 'Surf · Kurse · Surfcamps', brandTitle: 'Deine Surfschule auf Gran Canaria', brandDesc: 'Buche Kurse, verwalte deine Pakete und sieh deine Historie in deinem persönlichen Konto.',
    errTerms: 'Du musst die Bedingungen und die Datenschutzerklärung akzeptieren.', errPhone: 'Gib eine gültige Telefonnummer ein.', errEmail: 'Gib deine E-Mail ein.', errPass6: 'Das Passwort muss mindestens 6 Zeichen haben.',
    errMatch: 'Die Passwörter stimmen nicht überein.', cpCreate: 'Erstelle dein Passwort', cpChange: 'Ändere dein Passwort', cpCreateSub: 'Wähle ein Passwort, um dich jederzeit in dein Waya-Konto einzuloggen.',
    cpChangeSub: 'Wähle aus Sicherheitsgründen ein neues Passwort für deine erste Anmeldung.', newPass: 'Neues Passwort', repeatNew: 'Passwort wiederholen',
    saveEnter: 'Speichern und weiter', saving: 'Wird gespeichert…', errPass8: 'Das Passwort muss mindestens 8 Zeichen haben.', cpFail: 'Das Passwort konnte nicht geändert werden.',
    expTitle: 'Der Link ist abgelaufen', expText: 'Dieser Link wurde bereits verwendet oder ist abgelaufen. Schreib uns per WhatsApp an', expText2: 'und wir schicken dir einen neuen.', goLogin: 'Zur Anmeldung',
    acceptLegal: 'Ich akzeptiere die <a href="/condiciones.html" target="_blank" rel="noopener">Buchungsbedingungen</a> und die <a href="/politica-privacidad.html" target="_blank" rel="noopener">Datenschutzerklärung</a> *',
    checkEmail: 'Konto erstellt. Wir haben dir eine E-Mail geschickt: Klicke auf den Link, um es zu aktivieren.',
  },
};
const A = (k) => (AUTH[lang()] || AUTH.es)[k] ?? AUTH.es[k];

/* ---------------- Tabs externos (lazy-load dinámico) ----------------
   CONTRATO: cada módulo exporta una función `render<Nombre>(container, switchTab)`.
   - container: el <div class="tab-panel"> destino (ya vacío en el DOM).
   - switchTab(tabKey): navega a otra pestaña (p.ej. "bonos" → "calendario").
   Los 5 módulos los generan otros agentes siguiendo esta firma. */
// Cada `load` es un import() con ruta LITERAL: así Vite empaqueta el tab en
// el build. Con la ruta en una variable no lo incluía y en producción daba 404
// ("No se pudo cargar esta sección").
const TAB_MODULES = {
  familia:    { load: () => import('/mi-cuenta/tabs/family.js'),      fn: 'renderFamily' },
  bonos:      { load: () => import('/mi-cuenta/tabs/bonos.js'),       fn: 'renderBonos' },
  calendario: { load: () => import('/mi-cuenta/tabs/calendar.js'),    fn: 'renderCalendar' },
  clases:     { load: () => import('/mi-cuenta/tabs/enrollments.js'), fn: 'renderEnrollments' },
  pagos:      { load: () => import('/mi-cuenta/tabs/payments.js'),    fn: 'renderPayments' },
};

// ---------------- Helpers ----------------
function statusBadge(status) {
  const labels = {
    pending: 'Pendiente', paid: 'Pagado', shipped: 'Enviado',
    delivered: 'Entregado', cancelled: 'Cancelado',
  };
  return `<span class="status-badge ${status || 'pending'}">${labels[status] || 'Pendiente'}</span>`;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Staff (admin/encargado) → panel de reservas (/admin/), NO el blog (/admin.html).
function redirectIfStaff(profile) {
  if (profile?.role === 'admin' || profile?.role === 'encargado') {
    window.location.href = '/admin/';
    return true;
  }
  return false;
}

// ============================================================
//  VISTA: Auth (login + registro multi-step)
// ============================================================
function renderAuth() {
  mainEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-page-left">
        <div class="auth-page-form">
          <a href="/" class="account-back" style="margin-bottom:20px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            ${A('back')}
          </a>

          <div id="auth-view-login" class="auth-view active">
            <h1 class="auth-title">${A('welcome')}</h1>
            <p class="auth-subtitle">${A('welcomeSub')}</p>
            <form id="login-form" class="auth-form">
              <div class="auth-field">
                <label for="login-email">Email</label>
                <input type="email" id="login-email" name="email" placeholder="tu@email.com" required autocomplete="email">
              </div>
              <div class="auth-field">
                <label for="login-pass">${A('password')}</label>
                <input type="password" id="login-pass" name="password" placeholder="${A('passPh')}" required autocomplete="current-password">
              </div>
              <p class="auth-error" id="login-error"></p>
              <button type="submit" class="auth-submit-btn">${A('login')}</button>
            </form>
            <p class="auth-switch">${A('noAccount')} <a href="#" id="switch-to-register">${A('createAccount')}</a></p>
          </div>

          <div id="auth-view-register" class="auth-view">
            <h1 class="auth-title">${A('createAccount')}</h1>
            <p class="auth-subtitle">${A('createSub')}</p>

            <!-- Un solo paso: lo justo para crear la cuenta. Nivel, salud y
                 contrato los recoge el formulario de Víctor después del pago. -->
            <form id="register-form" class="auth-form">
              <div class="auth-field">
                <label for="reg-name">${A('name')}</label>
                <input type="text" id="reg-name" name="fullname" placeholder="${A('namePh')}" required autocomplete="given-name">
              </div>
              <div class="auth-field">
                <label for="reg-lastname">${A('lastName')}</label>
                <input type="text" id="reg-lastname" name="last_name" placeholder="${A('lastNamePh')}" autocomplete="family-name">
              </div>
              <div class="auth-field">
                <label for="reg-phone">${A('phone')}</label>
                <div style="display:flex;gap:8px;align-items:center">
                  ${phonePrefixSelectHtml('reg-phone-prefix', '+34', `aria-label="${A('phonePrefix')}"`)}
                  <input type="tel" id="reg-phone" name="phone" placeholder="600 000 000" required style="flex:1" autocomplete="tel-national" inputmode="tel">
                </div>
              </div>
              <div class="auth-field">
                <label for="reg-email">Email *</label>
                <input type="email" id="reg-email" name="email" placeholder="tu@email.com" required autocomplete="email">
              </div>
              <div class="auth-field">
                <label for="reg-pass">${A('passwordReq')}</label>
                <input type="password" id="reg-pass" name="password" placeholder="${A('pass6')}" required minlength="6" autocomplete="new-password">
              </div>
              <div class="auth-field">
                <label for="reg-pass2">${A('repeatPass')}</label>
                <input type="password" id="reg-pass2" name="password2" placeholder="${A('repeatPassPh')}" required minlength="6" autocomplete="new-password">
              </div>
              <div class="auth-field">
                <label class="auth-checkbox-label">
                  <input type="checkbox" id="reg-terms" required>
                  <span>${A('acceptLegal')}</span>
                </label>
              </div>
              <p class="auth-error" id="register-error"></p>
              <button type="submit" class="auth-submit-btn">${A('createAccount')}</button>
            </form>

            <p class="auth-switch">${A('haveAccount')} <a href="#" id="switch-to-login">${A('login')}</a></p>
          </div>
        </div>
      </div>

      <div class="auth-page-right">
        <div class="auth-brand-card">
          <div class="auth-brand-content">
            <p class="auth-brand-tagline">${A('tagline')}</p>
            <h2 class="auth-brand-heading">${A('brandTitle')}</h2>
            <p class="auth-brand-desc">${A('brandDesc')}</p>
          </div>
        </div>
      </div>
    </div>`;

  // Toggle login/registro
  document.getElementById('switch-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-view-login').classList.remove('active');
    document.getElementById('auth-view-register').classList.add('active');
  });
  document.getElementById('switch-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-view-register').classList.remove('active');
    document.getElementById('auth-view-login').classList.add('active');
  });

  // Login
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    const btn = e.target.querySelector('button[type="submit"]');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = A('loggingIn');
    try {
      await signIn(e.target.email.value, e.target.password.value);
      const profile = await getProfile();
      if (redirectIfStaff(profile)) return;
      route(profile);
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = A('login');
    }
  });

  // ---- Registro ----
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const errEl = document.getElementById('register-error');
    const btn = f.querySelector('button[type="submit"]');
    errEl.style.color = '';
    errEl.textContent = '';

    if (!document.getElementById('reg-terms').checked) { errEl.textContent = A('errTerms'); return; }

    // Combina prefijo de país + número. Teléfono obligatorio.
    const regPrefix = document.getElementById('reg-phone-prefix')?.value || '';
    const regNum = f.phone.value.trim();
    if (regNum.replace(/\D/g, '').length < 6) { errEl.textContent = A('errPhone'); return; }
    const regPhone = regNum.startsWith('+') ? regNum : (regPrefix ? `${regPrefix} ${regNum}`.trim() : regNum);

    const email = f.email.value.trim();
    const pass = f.password.value;
    if (!email) { errEl.textContent = A('errEmail'); return; }
    if (!pass || pass.length < 6) { errEl.textContent = A('errPass6'); return; }
    if (pass !== f.password2.value) { errEl.textContent = A('errMatch'); return; }

    btn.disabled = true; btn.textContent = A('creating');
    try {
      // Los datos viajan en el metadata → el trigger handle_new_user los
      // persiste en el perfil. OJO: el trigger lee `terms_accepted` ('true'),
      // no `terms_accepted_at`; sin él la cuenta nacía sin términos aceptados.
      const result = await signUp(email, pass, f.fullname.value.trim(), {
        last_name: f.last_name?.value?.trim() || null,
        phone: regPhone,
        terms_accepted: true,
      });
      if (result?.session) {
        const profile = await getProfile();
        if (redirectIfStaff(profile)) return;
        route(profile);
      } else {
        // Confirmación por email activada en Supabase: hay que pinchar el enlace.
        errEl.style.color = '#166534';
        errEl.textContent = A('checkEmail');
        btn.disabled = false; btn.textContent = A('createAccount');
      }
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = A('createAccount');
    }
  });
}

// ============================================================
//  VISTA: Cambio de contraseña obligatorio (must_change_password)
// ============================================================
function renderChangePassword(profile, { primerAcceso = false } = {}) {
  mainEl.innerHTML = `
    <div class="auth-page auth-page-single">
      <div class="auth-page-left">
        <div class="auth-page-form">
          <h1 class="auth-title">${primerAcceso ? A('cpCreate') : A('cpChange')}</h1>
          <p class="auth-subtitle">${primerAcceso ? A('cpCreateSub') : A('cpChangeSub')}</p>
          <form id="change-pass-form" class="auth-form">
            <div class="auth-field">
              <label for="cp-pass">${A('newPass')}</label>
              <input type="password" id="cp-pass" name="password" minlength="8" required autocomplete="new-password">
            </div>
            <div class="auth-field">
              <label for="cp-pass2">${A('repeatNew')}</label>
              <input type="password" id="cp-pass2" name="password2" minlength="8" required autocomplete="new-password">
            </div>
            <p class="auth-error" id="cp-error"></p>
            <button type="submit" class="auth-submit-btn">${A('saveEnter')}</button>
          </form>
        </div>
      </div>
    </div>`;

  const form = document.getElementById('change-pass-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cp-error');
    const btn = form.querySelector('button[type="submit"]');
    errEl.textContent = '';
    const p1 = form.password.value, p2 = form.password2.value;
    if (p1.length < 8) { errEl.textContent = A('errPass8'); return; }
    if (p1 !== p2) { errEl.textContent = A('errMatch'); return; }
    btn.disabled = true; btn.textContent = A('saving');
    try {
      await changePassword(p1);
    } catch (err) {
      errEl.textContent = err.message || A('cpFail');
      btn.disabled = false; btn.textContent = A('saveEnter');
      return;
    }
    // Baja el flag (best-effort; si falla no bloqueamos el acceso).
    try { await updateProfile({ must_change_password: false }); } catch (_) {}
    const fresh = await getProfile();
    route(fresh, { skipPasswordCheck: true });
  });
}

// ============================================================
//  SVG icons + metadatos de tabs
// ============================================================
const ICONS = {
  datos:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  familia:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
  bonos:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  calendario: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  clases:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  pagos:      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  pedidos:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>',
  logout:     '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
};

const TAB_TITLES = {
  datos:      { title: 'Mis datos',       desc: 'Gestiona tu información personal' },
  familia:    { title: 'Mi Familia',      desc: 'Añade familiares y acompañantes' },
  bonos:      { title: 'Mis Bonos',       desc: 'Gestiona tus packs de clases' },
  calendario: { title: 'Reservar Clases', desc: 'Consulta el calendario y reserva' },
  clases:     { title: 'Mis Clases',      desc: 'Consulta tus reservas de clases' },
  pagos:      { title: 'Mis Pagos',       desc: 'Historial de pagos de servicios, bonos y compras' },
  pedidos:    { title: 'Mis Pedidos',     desc: 'Pedidos de productos de la tienda online' },
};

const TABS = [
  { key: 'datos',      label: 'Mis datos' },
  { key: 'familia',    label: 'Mi Familia' },
  { key: 'bonos',      label: 'Mis Bonos' },
  { key: 'calendario', label: 'Reservar Clases' },
  { key: 'clases',     label: 'Mis Clases' },
  { key: 'pagos',      label: 'Mis Pagos' },
  { key: 'pedidos',    label: 'Mis Pedidos' },
];

// ============================================================
//  VISTA: Dashboard (shell + tabs)
// ============================================================
async function renderDashboard() {
  const session = await getSession();
  if (!session) return renderAuth();
  await loadPricing(); // tarifas de BD → precios del cliente == admin
  const profile = await getProfile();
  const name = profile?.full_name || session.user.email;
  const email = session.user.email;

  mainEl.innerHTML = `
    <div class="account-app">
      <aside class="account-sidebar">
        <a href="/" class="account-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Volver al inicio
        </a>
        <div class="account-avatar">
          <div class="account-avatar-circle">${getInitials(name)}</div>
          <div class="account-avatar-info">
            <div class="account-avatar-name">${esc(name)}</div>
            <div class="account-avatar-email">${esc(email)}</div>
          </div>
          <button class="account-menu-btn" id="account-menu-btn" aria-label="Abrir menú" aria-expanded="false">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
        </div>
        <nav class="account-nav">
          ${TABS.map((t, i) => `
            <button class="account-nav-item ${i === 0 ? 'active' : ''}" data-tab="${t.key}">
              ${ICONS[t.key] || ''} ${t.label}
            </button>`).join('')}
          <div class="account-nav-divider"></div>
          <button class="account-nav-item danger" data-tab="logout">
            ${ICONS.logout} Cerrar sesión
          </button>
        </nav>
      </aside>

      <div class="account-content">
        ${bannerFichaPendienteHtml()}
        <div class="account-content-header" id="account-header">
          <h2>${TAB_TITLES.datos.title}</h2>
          <p>${TAB_TITLES.datos.desc}</p>
        </div>
        <div id="tab-datos" class="tab-panel active"></div>
        <div id="tab-familia" class="tab-panel"></div>
        <div id="tab-bonos" class="tab-panel"></div>
        <div id="tab-calendario" class="tab-panel"></div>
        <div id="tab-clases" class="tab-panel"></div>
        <div id="tab-pagos" class="tab-panel"></div>
        <div id="tab-pedidos" class="tab-panel"></div>
      </div>
    </div>`;

  // Navegación entre pestañas. Es closure: captura session/profile.
  function switchTab(tabKey) {
    mainEl.querySelectorAll('.account-nav-item').forEach(t => t.classList.remove('active'));
    mainEl.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const navBtn = mainEl.querySelector(`.account-nav-item[data-tab="${tabKey}"]`);
    if (navBtn) navBtn.classList.add('active');
    const tabPanel = document.getElementById('tab-' + tabKey);
    if (tabPanel) tabPanel.classList.add('active');
    const header = document.getElementById('account-header');
    if (header && TAB_TITLES[tabKey]) {
      header.innerHTML = `<h2>${TAB_TITLES[tabKey].title}</h2><p>${TAB_TITLES[tabKey].desc}</p>`;
    }
    loadTab(tabKey);
  }

  // Re-render en cada entrada a la pestaña → datos frescos (créditos, estados, pagos).
  async function loadTab(key) {
    if (key === 'datos')   return renderDatos(session, profile);
    if (key === 'pedidos') return renderPedidos(session);
    // Resto: módulos externos por lazy-load dinámico.
    return loadExternalTab(key, document.getElementById('tab-' + key), switchTab);
  }

  // Menú hamburguesa (móvil)
  const sidebar = mainEl.querySelector('.account-sidebar');
  const menuBtn = mainEl.querySelector('#account-menu-btn');
  menuBtn?.addEventListener('click', () => {
    const open = sidebar.classList.toggle('menu-open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  mainEl.querySelectorAll('.account-nav-item').forEach(nav => {
    nav.addEventListener('click', async () => {
      sidebar?.classList.remove('menu-open');
      if (nav.dataset.tab === 'logout') {
        await signOut();
        renderAuth();
        return;
      }
      switchTab(nav.dataset.tab);
    });
  });

  // Pestaña inicial según el hash (p.ej. /mi-cuenta/#clases desde el header)
  const VALID_TABS = ['datos', 'familia', 'bonos', 'calendario', 'clases', 'pagos', 'pedidos'];
  const startTab = VALID_TABS.includes((location.hash || '').slice(1)) ? location.hash.slice(1) : 'datos';
  if (startTab === 'datos') {
    await loadTab('datos');
  } else {
    switchTab(startTab);
  }
  // Cambiar de pestaña si el hash cambia estando ya en la página
  window.addEventListener('hashchange', () => {
    const t = (location.hash || '').slice(1);
    if (VALID_TABS.includes(t)) switchTab(t);
  });
}

// Lazy-load de un tab externo (import dinámico + guardas de error).
async function loadExternalTab(key, panel, switchTab) {
  const mod = TAB_MODULES[key];
  if (!mod || !panel) return;
  panel.innerHTML = '<div class="tab-loading">Cargando…</div>';
  try {
    const m = await mod.load();
    const fn = m[mod.fn] || m.default;
    if (typeof fn !== 'function') throw new Error(`Export ${mod.fn} no encontrado en el tab ${key}`);
    await fn(panel, switchTab);
  } catch (err) {
    console.error('Error cargando la pestaña', key, err);
    panel.innerHTML = `<div class="account-form-card"><p style="color:var(--color-muted);margin:0">No se pudo cargar esta sección. Inténtalo de nuevo más tarde.</p></div>`;
  }
}

// ============================================================
//  TAB INLINE: Mis datos
// ============================================================
function renderDatos(session, profile) {
  const panel = document.getElementById('tab-datos');
  panel.innerHTML = `
    <form id="profile-form">
      <div class="account-form-card">
        <h3>Información personal</h3>
        <div class="account-form-grid">
          <div class="account-field">
            <label for="pf-name">Nombre</label>
            <input type="text" id="pf-name" name="full_name" value="${esc(profile?.full_name)}">
          </div>
          <div class="account-field">
            <label for="pf-lastname">Apellidos</label>
            <input type="text" id="pf-lastname" name="last_name" value="${esc(profile?.last_name || '')}">
          </div>
          <div class="account-field">
            <label>Email</label>
            <input type="email" value="${esc(session.user.email)}" disabled>
            <span class="field-hint">El email no se puede cambiar</span>
          </div>
          <div class="account-field">
            <label for="pf-phone">Teléfono</label>
            <input type="tel" id="pf-phone" name="phone" value="${esc(profile?.phone)}" placeholder="+34 600 000 000">
          </div>
          <div class="account-field">
            <label for="pf-address">Dirección</label>
            <input type="text" id="pf-address" name="address" value="${esc(profile?.address || '')}" placeholder="Calle, número">
          </div>
          <div class="account-field">
            <label for="pf-city">Ciudad</label>
            <input type="text" id="pf-city" name="city" value="${esc(profile?.city || '')}" placeholder="Telde">
          </div>
          <div class="account-field">
            <label for="pf-postal">Código postal</label>
            <input type="text" id="pf-postal" name="postal_code" value="${esc(profile?.postal_code || '')}" placeholder="35218">
          </div>
          <div class="account-field">
            <label for="pf-birthdate">Fecha de nacimiento</label>
            <input type="date" id="pf-birthdate" name="birth_date" value="${esc(profile?.birth_date || '')}">
          </div>
        </div>
      </div>

      <div class="account-form-card">
        <h3>Salud y equipamiento</h3>
        <div class="account-form-grid">
          <div class="account-field">
            <label for="pf-level">Nivel de surf</label>
            <select id="pf-level" name="level">
              ${levelOptionsHtml(profile?.level || '', true)}
            </select>
          </div>
          <div class="account-field">
            <label for="pf-swim">¿Sabes nadar?</label>
            <select id="pf-swim" name="can_swim">
              <option value="" ${profile?.can_swim == null ? 'selected' : ''}>Sin definir</option>
              <option value="true" ${profile?.can_swim === true ? 'selected' : ''}>Sí</option>
              <option value="false" ${profile?.can_swim === false ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="account-field">
            <label for="pf-injury">¿Tienes alguna lesión?</label>
            <select id="pf-injury" name="has_injury">
              <option value="false" ${!profile?.has_injury ? 'selected' : ''}>No</option>
              <option value="true" ${profile?.has_injury ? 'selected' : ''}>Sí</option>
            </select>
          </div>
          <div class="account-field" id="pf-injury-wrap" style="${profile?.has_injury ? '' : 'display:none'}">
            <label for="pf-injury-detail">Describe tu lesión</label>
            <input type="text" id="pf-injury-detail" name="injury_detail" value="${esc(profile?.injury_detail)}" placeholder="Ej: rodilla derecha">
          </div>
          <div class="account-field">
            <label for="pf-wetsuit">Talla de neopreno</label>
            <select id="pf-wetsuit" name="wetsuit_size">
              ${wetsuitOptionsHtml(profile?.wetsuit_size || '')}
            </select>
          </div>
        </div>
      </div>

      <p class="account-msg" id="profile-msg"></p>
      <button type="submit" class="btn btn-primary">Guardar cambios</button>
    </form>`;

  document.getElementById('pf-injury')?.addEventListener('change', (e) => {
    document.getElementById('pf-injury-wrap').style.display = e.target.value === 'true' ? '' : 'none';
  });

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('profile-msg');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const updated = await updateProfile({
        full_name: e.target.full_name.value,
        last_name: e.target.last_name.value,
        phone: e.target.phone.value,
        address: e.target.address?.value || null,
        city: e.target.city?.value || null,
        postal_code: e.target.postal_code?.value || null,
        birth_date: e.target.birth_date?.value || null,
        level: e.target.level?.value || null,
        can_swim: e.target.can_swim.value === 'true' ? true : e.target.can_swim.value === 'false' ? false : null,
        has_injury: e.target.has_injury.value === 'true',
        injury_detail: e.target.injury_detail?.value || null,
        wetsuit_size: e.target.wetsuit_size?.value || null,
      });
      // Mantiene el objeto profile capturado al día para el resto de la sesión.
      if (updated) Object.assign(profile, updated);
      msg.style.color = '#166534';
      msg.textContent = 'Datos actualizados correctamente.';
    } catch (err) {
      msg.style.color = '#c0392b';
      msg.textContent = err.message;
    }
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  });
}

// ============================================================
//  TAB INLINE: Mis pedidos (productos de la tienda)
// ============================================================
async function renderPedidos(session) {
  const panel = document.getElementById('tab-pedidos');
  const [ordersRes, bonosRes] = await Promise.all([
    supabase.from('orders').select('*, order_items(id)').eq('user_id', session.user.id).order('created_at', { ascending: false }),
    supabase.from('bonos').select('order_id').eq('user_id', session.user.id).not('order_id', 'is', null),
  ]);
  const allOrders = ordersRes.data || [];
  const bonoOrderIds = new Set((bonosRes.data || []).map(b => b.order_id));

  // Solo pedidos de producto: con líneas, no asociados a un bono, no pendientes.
  const orders = allOrders.filter(o =>
    o.status !== 'pending' && !bonoOrderIds.has(o.id) && (o.order_items || []).length > 0
  );

  if (!orders.length) {
    panel.innerHTML = '<div class="account-form-card"><p style="color:var(--color-muted);margin:0">No tienes pedidos de productos todavía.</p></div>';
    return;
  }

  panel.innerHTML = orders.map(o => `
    <div class="order-card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h4>Pedido #${esc(String(o.id).slice(0, 8))}</h4>
        ${statusBadge(o.status)}
      </div>
      <p class="meta">${formatDate(o.created_at)} · ${formatPrice(o.total)}</p>
      ${o.shipping_address ? `<p style="font-size:.82rem;color:var(--color-muted)">Envío: ${esc(o.shipping_address)}</p>` : ''}
    </div>`).join('');
}

// ============================================================
//  Router de arranque
// ============================================================
// Vuelta a donde estaba al pedirle iniciar sesión (lib/pagar.js guarda la
// página en sessionStorage y la pasa en ?volver=). Sin esto, quien reservaba
// un surfcamp acababa en su panel y tenía que volver a buscar el camp.
function volverSiToca() {
  let destino = null;
  try { destino = sessionStorage.getItem('waya_volver_a'); } catch {}
  if (!destino) destino = new URLSearchParams(location.search).get('volver');
  // Solo rutas internas ("/…"), nunca otro dominio ("//…").
  if (!destino || !destino.startsWith('/') || destino.startsWith('//') || destino.startsWith('/mi-cuenta')) return false;
  try { sessionStorage.removeItem('waya_volver_a'); } catch {}
  window.location.href = destino;
  return true;
}

function route(profile, opts = {}) {
  if (!profile) { renderDashboard(); return; }
  if (!opts.skipPasswordCheck && profile.must_change_password) { renderChangePassword(profile); return; }
  if (volverSiToca()) return;
  renderDashboard();
}

// Selector de idioma del header: la pantalla de acceso se repinta en el idioma nuevo.
document.addEventListener('wayaLanguageChange', () => {
  if (document.getElementById('auth-view-login')) renderAuth();
});

// Enlace del email "Tu cuenta en Waya" (enviar-acceso.php): trae un token de
// recuperación que se canjea aquí por una sesión, y se pide la contraseña.
function renderEnlaceCaducado() {
  mainEl.innerHTML = `
    <div class="auth-page auth-page-single">
      <div class="auth-page-left">
        <div class="auth-page-form">
          <h1 class="auth-title">${A('expTitle')}</h1>
          <p class="auth-subtitle">${A('expText')}
            <a href="https://wa.me/34636562448" target="_blank" rel="noopener">+34 636 56 24 48</a>
            ${A('expText2')}</p>
          <a href="/mi-cuenta/" class="auth-submit-btn" style="display:inline-block;text-align:center;text-decoration:none">${A('goLogin')}</a>
        </div>
      </div>
    </div>`;
}

async function canjearEnlaceAcceso() {
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get('token_hash');
  if (!tokenHash || params.get('type') !== 'recovery') return false;
  // Se quita de la URL ya: el token es de un solo uso y no debe quedar en el historial.
  history.replaceState(null, '', location.pathname);
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) { renderEnlaceCaducado(); return true; }
  const profile = await getProfile();
  renderChangePassword(profile, { primerAcceso: true });
  return true;
}

async function init() {
  try {
    if (await canjearEnlaceAcceso()) return;
    const session = await getSession();
    if (!session) { renderAuth(); return; }
    const profile = await getProfile();
    if (redirectIfStaff(profile)) return;
    route(profile);
  } catch (err) {
    console.error('Init error:', err);
    renderAuth();
  }
}

init();
