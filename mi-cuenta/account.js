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
  LEVEL_OPTIONS,
  levelOptionsHtml,
  wetsuitOptionsHtml,
  phonePrefixSelectHtml,
} from '/lib/shared-constants.js';
import { loadPricing } from '/lib/domain/pricing.js';
import { TERMS_HTML, WAIVER_HTML, openLegalModal } from '/mi-cuenta/legal-texts.js';

const mainEl = document.getElementById('account-root');

/* ---------------- Tabs externos (lazy-load dinámico) ----------------
   CONTRATO: cada módulo exporta una función `render<Nombre>(container, switchTab)`.
   - container: el <div class="tab-panel"> destino (ya vacío en el DOM).
   - switchTab(tabKey): navega a otra pestaña (p.ej. "bonos" → "calendario").
   Los 5 módulos los generan otros agentes siguiendo esta firma. */
const TAB_MODULES = {
  familia:    { path: '/mi-cuenta/tabs/family.js',      fn: 'renderFamily' },
  bonos:      { path: '/mi-cuenta/tabs/bonos.js',       fn: 'renderBonos' },
  calendario: { path: '/mi-cuenta/tabs/calendar.js',    fn: 'renderCalendar' },
  clases:     { path: '/mi-cuenta/tabs/enrollments.js', fn: 'renderEnrollments' },
  pagos:      { path: '/mi-cuenta/tabs/payments.js',    fn: 'renderPayments' },
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

// ¿El perfil necesita onboarding? (datos de salud sin definir o términos sin aceptar)
function needsOnboarding(profile) {
  if (!profile) return false;
  return profile.can_swim == null || !profile.terms_accepted_at;
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
            Volver al inicio
          </a>

          <div id="auth-view-login" class="auth-view active">
            <h1 class="auth-title">Bienvenido de nuevo</h1>
            <p class="auth-subtitle">Accede a tu cuenta para gestionar tus reservas y clases</p>
            <form id="login-form" class="auth-form">
              <div class="auth-field">
                <label for="login-email">Email</label>
                <input type="email" id="login-email" name="email" placeholder="tu@email.com" required autocomplete="email">
              </div>
              <div class="auth-field">
                <label for="login-pass">Contraseña</label>
                <input type="password" id="login-pass" name="password" placeholder="Tu contraseña" required autocomplete="current-password">
              </div>
              <p class="auth-error" id="login-error"></p>
              <button type="submit" class="auth-submit-btn">Iniciar sesión</button>
            </form>
            <p class="auth-switch">¿No tienes cuenta? <a href="#" id="switch-to-register">Crear cuenta</a></p>
          </div>

          <div id="auth-view-register" class="auth-view">
            <h1 class="auth-title">Crear cuenta</h1>
            <p class="auth-subtitle">Regístrate para reservar clases y gestionar tu perfil</p>

            <!-- Paso 1: datos personales + salud -->
            <form id="register-step1" class="auth-form">
              <div class="auth-field">
                <label for="reg-name">Nombre *</label>
                <input type="text" id="reg-name" name="fullname" placeholder="Tu nombre" required autocomplete="given-name">
              </div>
              <div class="auth-field">
                <label for="reg-lastname">Apellidos</label>
                <input type="text" id="reg-lastname" name="last_name" placeholder="Tus apellidos" autocomplete="family-name">
              </div>
              <div class="auth-field">
                <label for="reg-phone">Teléfono *</label>
                <div style="display:flex;gap:8px;align-items:center">
                  ${phonePrefixSelectHtml('reg-phone-prefix', '+34', 'aria-label="Prefijo de país"')}
                  <input type="tel" id="reg-phone" name="phone" placeholder="600 000 000" required style="flex:1" autocomplete="tel-national">
                </div>
              </div>
              <div class="auth-field">
                <label for="reg-birthdate">Fecha de nacimiento *</label>
                <input type="date" id="reg-birthdate" name="birth_date" required>
              </div>
              <div class="auth-field">
                <label for="reg-address">Dirección</label>
                <input type="text" id="reg-address" name="address" placeholder="Calle, número">
              </div>
              <div class="auth-field">
                <label for="reg-city">Ciudad</label>
                <input type="text" id="reg-city" name="city" placeholder="Telde">
              </div>
              <div class="auth-field">
                <label for="reg-postal">Código postal</label>
                <input type="text" id="reg-postal" name="postal_code" placeholder="35218">
              </div>
              <div class="auth-field">
                <label for="reg-level">Nivel de surf *</label>
                <select id="reg-level" name="level" required>
                  <option value="">Seleccionar nivel</option>
                  ${LEVEL_OPTIONS.map(l => `<option value="${l.value}">${l.label} (${l.desc})</option>`).join('')}
                </select>
              </div>
              <div class="auth-field">
                <label for="reg-wetsuit">Talla de neopreno</label>
                <select id="reg-wetsuit" name="wetsuit_size">
                  ${wetsuitOptionsHtml()}
                </select>
              </div>
              <div class="auth-field">
                <label for="reg-swim">¿Sabes nadar? *</label>
                <select id="reg-swim" name="can_swim" required>
                  <option value="">Seleccionar</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div class="auth-field">
                <label for="reg-injury">¿Tienes alguna lesión?</label>
                <select id="reg-injury" name="has_injury">
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </div>
              <div class="auth-field" id="reg-injury-wrap" style="display:none">
                <label for="reg-injury-detail">Describe tu lesión</label>
                <input type="text" id="reg-injury-detail" name="injury_detail" placeholder="Ej: rodilla derecha">
              </div>
              <div class="auth-field">
                <label class="auth-checkbox-label">
                  <input type="checkbox" id="reg-terms" required>
                  Acepto los <a href="#" id="open-terms-modal">Términos y Condiciones</a> *
                </label>
              </div>
              <div class="auth-field">
                <label class="auth-checkbox-label">
                  <input type="checkbox" id="reg-waiver" required>
                  Acepto la <a href="#" id="open-waiver-modal">Exención de Responsabilidad</a> *
                </label>
              </div>
              <p class="auth-error" id="register-error-step1"></p>
              <button type="submit" class="auth-submit-btn">Siguiente →</button>
            </form>

            <!-- Paso 2: crear cuenta (email + contraseña) -->
            <form id="register-step2" class="auth-form" style="display:none">
              <div class="auth-field">
                <label for="reg2-email">Email *</label>
                <input type="email" id="reg2-email" name="email" placeholder="tu@email.com" required autocomplete="email">
              </div>
              <div class="auth-field">
                <label for="reg2-pass">Contraseña *</label>
                <input type="password" id="reg2-pass" name="password" placeholder="Mínimo 6 caracteres" required minlength="6" autocomplete="new-password">
              </div>
              <div class="auth-field">
                <label for="reg2-pass2">Repetir contraseña *</label>
                <input type="password" id="reg2-pass2" name="password2" placeholder="Repite tu contraseña" required minlength="6" autocomplete="new-password">
              </div>
              <p class="auth-error" id="register-error-step2"></p>
              <div style="display:flex;gap:8px">
                <button type="button" class="auth-submit-btn auth-submit-ghost" id="reg-back-btn">← Atrás</button>
                <button type="submit" class="auth-submit-btn">Crear cuenta</button>
              </div>
            </form>

            <p class="auth-switch">¿Ya tienes cuenta? <a href="#" id="switch-to-login">Iniciar sesión</a></p>
          </div>
        </div>
      </div>

      <div class="auth-page-right">
        <div class="auth-brand-card">
          <div class="auth-brand-content">
            <p class="auth-brand-tagline">Surf · Clases · Surfcamps</p>
            <h2 class="auth-brand-heading">Tu escuela de surf en Gran Canaria</h2>
            <p class="auth-brand-desc">Reserva clases, gestiona tus bonos y consulta tu historial desde tu cuenta personal.</p>
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
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await signIn(e.target.email.value, e.target.password.value);
      const profile = await getProfile();
      if (redirectIfStaff(profile)) return;
      route(profile);
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Iniciar sesión';
    }
  });

  // ---- Registro multi-step ----
  let regStep1Data = {};

  document.getElementById('reg-injury')?.addEventListener('change', (e) => {
    document.getElementById('reg-injury-wrap').style.display = e.target.value === 'true' ? '' : 'none';
  });

  document.getElementById('open-terms-modal')?.addEventListener('click', (e) => {
    e.preventDefault();
    openLegalModal('Términos y Condiciones', TERMS_HTML);
  });
  document.getElementById('open-waiver-modal')?.addEventListener('click', (e) => {
    e.preventDefault();
    openLegalModal('Exención de Responsabilidad', WAIVER_HTML);
  });

  // Paso 1 → Paso 2
  document.getElementById('register-step1').addEventListener('submit', (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error-step1');
    errEl.textContent = '';

    if (!document.getElementById('reg-terms').checked) {
      errEl.textContent = 'Debes aceptar los Términos y Condiciones.';
      return;
    }
    if (!document.getElementById('reg-waiver').checked) {
      errEl.textContent = 'Debes aceptar la Exención de Responsabilidad.';
      return;
    }

    // Combina prefijo de país + número. Teléfono obligatorio.
    const regPrefix = document.getElementById('reg-phone-prefix')?.value || '';
    const regNum = e.target.phone.value.trim();
    if (regNum.replace(/\D/g, '').length < 6) { errEl.textContent = 'Escribe un teléfono de contacto válido.'; return; }
    const regPhone = regNum.startsWith('+') ? regNum : (regPrefix ? `${regPrefix} ${regNum}`.trim() : regNum);

    regStep1Data = {
      fullname: e.target.fullname.value.trim(),
      last_name: e.target.last_name?.value?.trim() || null,
      phone: regPhone,
      birth_date: e.target.birth_date.value || null,
      address: e.target.address?.value?.trim() || null,
      city: e.target.city?.value?.trim() || null,
      postal_code: e.target.postal_code?.value?.trim() || null,
      level: e.target.level.value,
      wetsuit_size: e.target.wetsuit_size.value || null,
      can_swim: e.target.can_swim.value === 'true',
      has_injury: e.target.has_injury.value === 'true',
      injury_detail: e.target.injury_detail?.value?.trim() || null,
    };

    document.getElementById('register-step1').style.display = 'none';
    document.getElementById('register-step2').style.display = '';
  });

  document.getElementById('reg-back-btn')?.addEventListener('click', () => {
    document.getElementById('register-step2').style.display = 'none';
    document.getElementById('register-step1').style.display = '';
  });

  // Paso 2 — crear cuenta
  document.getElementById('register-step2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('register-error-step2');
    const btn = e.target.querySelector('button[type="submit"]');
    errEl.style.color = '';
    errEl.textContent = '';

    const email = e.target.email.value.trim();
    const pass = e.target.password.value;
    const pass2 = e.target.password2.value;
    if (!email) { errEl.textContent = 'Escribe tu email.'; return; }
    if (!pass || pass.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    if (pass !== pass2) { errEl.textContent = 'Las contraseñas no coinciden.'; return; }

    btn.disabled = true; btn.textContent = 'Creando cuenta…';
    try {
      // Todos los datos viajan en el metadata → el trigger handle_new_user los
      // persiste en el perfil al crear la cuenta (contrato §3.3). Las fechas de
      // aceptación de términos/exención se guardan como timestamptz.
      const nowIso = new Date().toISOString();
      const result = await signUp(email, pass, regStep1Data.fullname, {
        last_name: regStep1Data.last_name,
        phone: regStep1Data.phone,
        birth_date: regStep1Data.birth_date,
        address: regStep1Data.address,
        city: regStep1Data.city,
        postal_code: regStep1Data.postal_code,
        level: regStep1Data.level,
        wetsuit_size: regStep1Data.wetsuit_size,
        can_swim: regStep1Data.can_swim,
        has_injury: regStep1Data.has_injury,
        injury_detail: regStep1Data.injury_detail,
        terms_accepted_at: nowIso,
        waiver_accepted_at: nowIso,
      });
      if (result?.session || result?.user) {
        const profile = await getProfile();
        if (redirectIfStaff(profile)) return;
        route(profile);
      } else {
        errEl.style.color = '#166534';
        errEl.textContent = 'Cuenta creada. Inicia sesión para continuar.';
        btn.disabled = false; btn.textContent = 'Crear cuenta';
      }
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Crear cuenta';
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
          <h1 class="auth-title">${primerAcceso ? 'Crea tu contraseña' : 'Cambia tu contraseña'}</h1>
          <p class="auth-subtitle">${primerAcceso
            ? 'Elige una contraseña para entrar en tu cuenta de Waya cuando quieras.'
            : 'Por seguridad, elige una contraseña nueva para tu primer acceso.'}</p>
          <form id="change-pass-form" class="auth-form">
            <div class="auth-field">
              <label for="cp-pass">Nueva contraseña</label>
              <input type="password" id="cp-pass" name="password" minlength="8" required autocomplete="new-password">
            </div>
            <div class="auth-field">
              <label for="cp-pass2">Repite la contraseña</label>
              <input type="password" id="cp-pass2" name="password2" minlength="8" required autocomplete="new-password">
            </div>
            <p class="auth-error" id="cp-error"></p>
            <button type="submit" class="auth-submit-btn">Guardar y entrar</button>
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
    if (p1.length < 8) { errEl.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
    if (p1 !== p2) { errEl.textContent = 'Las contraseñas no coinciden.'; return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await changePassword(p1);
    } catch (err) {
      errEl.textContent = err.message || 'No se pudo cambiar la contraseña.';
      btn.disabled = false; btn.textContent = 'Guardar y entrar';
      return;
    }
    // Baja el flag (best-effort; si falla no bloqueamos el acceso).
    try { await updateProfile({ must_change_password: false }); } catch (_) {}
    const fresh = await getProfile();
    route(fresh, { skipPasswordCheck: true });
  });
}

// ============================================================
//  VISTA: Onboarding (perfil incompleto / aceptar términos)
// ============================================================
function renderOnboarding(profile) {
  const needTerms = !profile?.terms_accepted_at;
  mainEl.innerHTML = `
    <div class="auth-page">
      <div class="auth-page-left">
        <div class="auth-page-form">
          <h1 class="auth-title">Un último paso</h1>
          <p class="auth-subtitle">Necesitamos algunos datos para tu seguridad y comodidad</p>
          <form id="onboarding-form" class="auth-form">
            <div class="auth-field">
              <label for="ob-level">Nivel de surf</label>
              <select id="ob-level" name="level">
                ${levelOptionsHtml(profile?.level || '', true)}
              </select>
            </div>
            <div class="auth-field">
              <label for="ob-swim">¿Sabes nadar?</label>
              <select id="ob-swim" name="can_swim" required>
                <option value="">Seleccionar</option>
                <option value="true" ${profile?.can_swim === true ? 'selected' : ''}>Sí</option>
                <option value="false" ${profile?.can_swim === false ? 'selected' : ''}>No</option>
              </select>
            </div>
            <div class="auth-field">
              <label for="ob-injury">¿Tienes alguna lesión?</label>
              <select id="ob-injury" name="has_injury">
                <option value="false" ${!profile?.has_injury ? 'selected' : ''}>No</option>
                <option value="true" ${profile?.has_injury ? 'selected' : ''}>Sí</option>
              </select>
            </div>
            <div class="auth-field" id="ob-injury-wrap" style="${profile?.has_injury ? '' : 'display:none'}">
              <label for="ob-injury-detail">Describe tu lesión</label>
              <input type="text" id="ob-injury-detail" name="injury_detail" value="${esc(profile?.injury_detail || '')}" placeholder="Ej: rodilla derecha">
            </div>
            <div class="auth-field">
              <label for="ob-wetsuit">Talla de neopreno</label>
              <select id="ob-wetsuit" name="wetsuit_size">
                ${wetsuitOptionsHtml(profile?.wetsuit_size || '')}
              </select>
            </div>
            ${needTerms ? `
            <div class="auth-field">
              <label class="auth-checkbox-label">
                <input type="checkbox" id="ob-terms" required>
                Acepto los <a href="#" id="ob-open-terms">Términos y Condiciones</a> y la <a href="#" id="ob-open-waiver">Exención de Responsabilidad</a> *
              </label>
            </div>` : ''}
            <p class="auth-error" id="onboarding-error"></p>
            <button type="submit" class="auth-submit-btn">Acceder a mi cuenta</button>
          </form>
        </div>
      </div>
      <div class="auth-page-right">
        <div class="auth-brand-card">
          <div class="auth-brand-content">
            <p class="auth-brand-tagline">Casi listo</p>
            <h2 class="auth-brand-heading">Tu seguridad es lo primero</h2>
            <p class="auth-brand-desc">Estos datos nos ayudan a preparar tu material y adaptar las clases a ti.</p>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('ob-injury').addEventListener('change', (e) => {
    document.getElementById('ob-injury-wrap').style.display = e.target.value === 'true' ? '' : 'none';
  });
  document.getElementById('ob-open-terms')?.addEventListener('click', (e) => {
    e.preventDefault(); openLegalModal('Términos y Condiciones', TERMS_HTML);
  });
  document.getElementById('ob-open-waiver')?.addEventListener('click', (e) => {
    e.preventDefault(); openLegalModal('Exención de Responsabilidad', WAIVER_HTML);
  });

  document.getElementById('onboarding-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('onboarding-error');
    const btn = e.target.querySelector('button[type="submit"]');
    errEl.textContent = '';
    if (needTerms && !document.getElementById('ob-terms').checked) {
      errEl.textContent = 'Debes aceptar los Términos y la Exención de Responsabilidad.';
      return;
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const fields = {
        level: e.target.level?.value || null,
        can_swim: e.target.can_swim.value === 'true' ? true : e.target.can_swim.value === 'false' ? false : null,
        has_injury: e.target.has_injury.value === 'true',
        injury_detail: e.target.injury_detail?.value || null,
        wetsuit_size: e.target.wetsuit_size?.value || null,
      };
      if (needTerms) {
        const nowIso = new Date().toISOString();
        fields.terms_accepted_at = nowIso;
        fields.waiver_accepted_at = nowIso;
      }
      await updateProfile(fields);
      renderDashboard();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false; btn.textContent = 'Acceder a mi cuenta';
    }
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
    const m = await import(mod.path);
    const fn = m[mod.fn] || m.default;
    if (typeof fn !== 'function') throw new Error(`Export ${mod.fn} no encontrado en ${mod.path}`);
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
function route(profile, opts = {}) {
  if (!profile) { renderDashboard(); return; }
  if (!opts.skipPasswordCheck && profile.must_change_password) { renderChangePassword(profile); return; }
  if (needsOnboarding(profile)) { renderOnboarding(profile); return; }
  renderDashboard();
}

// Enlace del email "Tu cuenta en Waya" (enviar-acceso.php): trae un token de
// recuperación que se canjea aquí por una sesión, y se pide la contraseña.
function renderEnlaceCaducado() {
  mainEl.innerHTML = `
    <div class="auth-page auth-page-single">
      <div class="auth-page-left">
        <div class="auth-page-form">
          <h1 class="auth-title">El enlace ha caducado</h1>
          <p class="auth-subtitle">Este enlace ya se usó o ha caducado. Escríbenos por WhatsApp al
            <a href="https://wa.me/34636562448" target="_blank" rel="noopener">636 56 24 48</a>
            y te mandamos uno nuevo.</p>
          <a href="/mi-cuenta/" class="auth-submit-btn" style="display:inline-block;text-align:center;text-decoration:none">Ir a iniciar sesión</a>
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
