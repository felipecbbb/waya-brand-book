/* ============================================================
   Class Picker — reserva de clases EN EL MOMENTO (sin carrito).
   Flujo: Reservar → elegir cuándo/quién → (login inline) → pago.
   Vale para todos los tipos de clase (grupal, individual, yoga,
   paddle, surfskate). El carrito NO interviene en clases.
   - Cada plaza elegida aparta un "hold" de 10 min (RPC create_hold).
   - Asistentes: yo / familiares (si hay sesión) / acompañante nuevo.
   - "Decidir más tarde" deja créditos libres en el bono.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { getSession, signIn, signUp } from '/lib/auth-client.js';
import { fetchFamilyMembers } from '/lib/family.js';
import { TYPE_LABELS, showToast } from '/lib/utils.js';
import { wetsuitOptionsHtml, levelOptionsHtml } from '/lib/shared-constants.js';

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
  const day = d.toLocaleDateString('es-ES', { weekday: 'short' });
  return `<span class="date-strip-weekday">${day}</span><span class="date-strip-num">${d.getDate()}</span>`;
}

async function fetchAvailability(date, type) {
  const { data, error } = await supabase.rpc('fetch_class_availability', {
    p_date: date, p_type: type, p_level: null,
  });
  if (error) { console.error('fetch_class_availability:', error); return []; }
  return data || [];
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const pad2 = n => String(n).padStart(2, '0');
function todayStr() { return new Date().toISOString().slice(0, 10); }

// Días del mes (tipo dado) con clases publicadas → para marcar el calendario
async function fetchClassDaysForMonth(type, y, m) {
  const start = `${y}-${pad2(m + 1)}-01`;
  const end = `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
  const { data } = await supabase.from('surf_classes')
    .select('date').eq('type', type).eq('published', true).eq('status', 'scheduled')
    .gte('date', start).lte('date', end);
  return new Set((data || []).map(r => r.date));
}

function longDayLabel(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Abre el modal del picker para un pack: elige clases + crea el bono (sin pasarela; pago en la escuela).
 * @param {{classType:string, sessions:number, packName:string, deposit:number, fullPrice:number}} opts
 */
export async function openClassPicker(opts) {
  const { classType, sessions, packName, deposit, fullPrice } = opts;
  const rest = Math.max(fullPrice - deposit, 0);

  // Libera cualquier hold huérfano de una sesión anterior (evita auto-bloqueo)
  try {
    const prev = localStorage.getItem(HOLD_TOKEN_KEY);
    if (prev) await supabase.rpc('release_holds', { p_cart_token: prev });
  } catch {}
  const cartToken = (crypto?.randomUUID?.() || ('t-' + Date.now() + '-' + Math.round(performance.now()))).slice(0, 64);
  localStorage.setItem(HOLD_TOKEN_KEY, cartToken);

  // Sesión + familiares
  let user = null, family = [];
  async function refreshAuth() {
    try {
      const session = await getSession();
      user = session?.user || null;
      if (user) { try { family = await fetchFamilyMembers(); } catch { family = []; } }
    } catch { user = null; }
  }
  await refreshAuth();

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

  const overlay = document.createElement('div');
  overlay.className = 'cp-overlay';
  overlay.innerHTML = `<div class="cp-modal" role="dialog" aria-modal="true"><div class="cp-loading">Cargando calendario…</div></div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const modal = overlay.querySelector('.cp-modal');

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
      showToast('Se agotó el tiempo para mantener las plazas. Vuelve a elegir.', 'error');
      return;
    }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    if (el) { el.style.display = ''; el.querySelector('.cp-timer-clock').textContent = `${m}:${String(s).padStart(2, '0')}`; }
  }

  // ---- Añadir/quitar plaza ----
  async function addBooking(cls, attendee) {
    if (creditsLeft() <= 0) { showToast('Ya has asignado todas tus clases', 'error'); return false; }
    try {
      const res = await supabase.rpc('create_hold', { p_class_id: cls.id, p_cart_token: cartToken, p_qty: 1 });
      if (res.error) throw res.error;
      holdsDeadline = new Date(res.data).getTime();
    } catch (err) {
      showToast('No se pudo apartar la plaza: ' + (err.message || 'sin plazas'), 'error');
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
        <span>${esc(m.full_name)}${m.last_name ? ' ' + esc(m.last_name) : ''}${m.level ? ` · ${esc(m.level)}` : ''}${dis ? ' · ya en esta clase' : ''}</span>
      </label>`;
    }).join('');
    panel.innerHTML = `
      <div class="cp-attendee-box">
        <h4>¿Quién asiste a esta clase?</h4>
        <p class="cp-att-sub">${esc(cls.title || TYPE_LABELS[classType])} · ${fmtTime(cls.time_start)} · ${cls.spots_left} plaza${cls.spots_left !== 1 ? 's' : ''} libre${cls.spots_left !== 1 ? 's' : ''}</p>
        <p class="cp-att-hint">Marca a quién metes. Puedes añadir <strong class="cp-att-remaining">${maxAdd}</strong> aquí (te quedan ${creditsLeft()} clase${creditsLeft() !== 1 ? 's' : ''} del bono). El resto queda como crédito en tu cuenta.</p>
        <div class="cp-att-opts">
          <label class="cp-att-opt${selfBooked ? ' cp-att-disabled' : ''}"><input type="checkbox" class="cp-att-cb" value="self" ${selfBooked ? 'disabled data-locked="1"' : ''}><span>Yo mismo${selfBooked ? ' · ya en esta clase' : ''}</span></label>
          ${familyOpts}
        </div>
        <div class="cp-guest-list"></div>
        <button type="button" class="cp-add-guest" id="cp-add-guest">+ Añadir acompañante nuevo</button>
        <div class="cp-att-actions">
          <button class="btn red" id="cp-att-confirm">Añadir</button>
          <button class="btn line" id="cp-att-cancel">Cancelar</button>
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
          <button type="button" class="cp-guest-remove" aria-label="Quitar">&times;</button>
          <div class="cp-guest-grid">
            <label>Nombre*<input type="text" class="g_full_name"></label>
            <label>Apellidos<input type="text" class="g_last_name"></label>
            <label>Fecha nacimiento<input type="date" class="g_birth_date"></label>
            <label>Nivel<select class="g_level">${levelOptionsHtml()}</select></label>
            <label>Talla neopreno<select class="g_wetsuit_size">${wetsuitOptionsHtml()}</select></label>
            <label>¿Sabe nadar?<select class="g_can_swim"><option value="">-</option><option value="true">Sí</option><option value="false">No</option></select></label>
          </div>
          <label class="cp-guest-injury">¿Lesión? <input type="text" class="g_injury_detail" placeholder="Describe (opcional)"></label>
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
        if (cb.value === 'self') attendees.push({ kind: 'self', label: 'Yo' });
        else if (cb.value.startsWith('fam:')) {
          const id = cb.value.slice(4);
          const m = family.find(x => x.id === id);
          attendees.push({ kind: 'family', family_member_id: id, label: m ? m.full_name : 'Familiar' });
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
      if (missingName) { showToast('Pon el nombre de cada acompañante nuevo', 'error'); return; }

      if (!attendees.length) { showToast('Elige al menos una persona', 'error'); return; }
      if (attendees.length > maxAdd) {
        showToast(maxAdd <= 0 ? 'No quedan plazas o créditos' : `Solo puedes añadir ${maxAdd} aquí (plazas/créditos)`, 'error');
        return;
      }

      const btn = panel.querySelector('#cp-att-confirm');
      btn.disabled = true; btn.textContent = 'Añadiendo…';
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
          title: b.class.title || TYPE_LABELS[classType],
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
        <button class="cp-close" aria-label="Cerrar">&times;</button>
        <div class="cp-header" style="border-top:4px solid ${color}">
          <h3>Tu teléfono de contacto</h3>
          <p class="cp-sub">Lo necesitamos para avisarte de tu reserva.</p>
        </div>
        <div class="cp-auth">
          <form id="cp-phone-form">
            <label class="cp-auth-field">Teléfono
              <input type="tel" name="phone" required autocomplete="tel" inputmode="tel" placeholder="Ej: 612 345 678">
            </label>
            <p class="cp-auth-error" style="display:none"></p>
            <div class="cp-att-actions">
              <button type="submit" class="btn red" id="cp-phone-submit">Continuar</button>
              <button type="button" class="btn line" id="cp-phone-back">Volver</button>
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
        if (phone.replace(/\D/g, '').length < 6) { errEl.textContent = 'Escribe un teléfono válido.'; errEl.style.display = ''; return; }
        const btn = modal.querySelector('#cp-phone-submit'); btn.disabled = true; btn.textContent = 'Un momento…';
        try { await supabase.from('profiles').update({ phone }).eq('id', user.id); } catch {}
        resolve(phone);
      };
    });
  }

  // SIN PASARELA: crea el bono (pendiente de pago) + inscribe a los asistentes
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
    let resp;
    try {
      resp = await supabase.rpc('reservar_pack_offline', {
        p_class_type: classType,
        p_sessions: sessions,
        p_bookings: bookings.map(b => ({ classId: b.classId, attendee: b.attendee })),
        p_cart_token: cartToken,
      });
    } catch (err) {
      showToast('Error al reservar: ' + (err.message || ''), 'error');
      return false;
    }
    if (resp.error) {
      showToast('No se pudo completar la reserva. ' + (resp.error.message || ''), 'error');
      return false;
    }
    if (timerId) clearInterval(timerId);
    try { localStorage.removeItem(HOLD_TOKEN_KEY); } catch {}
    // Aviso por email (fire-and-forget): confirmación al cliente + a la escuela.
    try {
      supabase.functions.invoke('send-email', { body: { to: user.email, type: 'class_booked', data: { customerName: user.email, className: TYPE_LABELS[classType] || classType } } });
    } catch {}
    renderSuccess(resp.data);
    return true;
  }

  // Pantalla de confirmación (reserva sin pasarela)
  function renderSuccess(res) {
    view = 'done';
    if (refreshId) clearInterval(refreshId);
    const n = (res && res.enrolled) || 0;
    modal.innerHTML = `
      <button class="cp-close" aria-label="Cerrar">&times;</button>
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
      <button class="cp-close" aria-label="Cerrar">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>Inicia sesión para reservar</h3>
        <p class="cp-sub">Tus clases se vinculan a tu cuenta. ${holdsDeadline ? 'Mantenemos tus plazas mientras tanto.' : ''}</p>
      </div>
      <div class="cp-auth">
        <div class="cp-auth-tabs">
          <button class="cp-auth-tab active" data-tab="login">Ya tengo cuenta</button>
          <button class="cp-auth-tab" data-tab="register">Crear cuenta</button>
        </div>
        <form id="cp-auth-form">
          <label class="cp-auth-field cp-reg-only" style="display:none">Nombre
            <input type="text" name="fullname" autocomplete="given-name">
          </label>
          <label class="cp-auth-field cp-reg-only" style="display:none">Apellidos
            <input type="text" name="lastname" autocomplete="family-name">
          </label>
          <label class="cp-auth-field cp-reg-only" style="display:none">Teléfono
            <input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="Ej: 612 345 678">
          </label>
          <label class="cp-auth-field">Email
            <input type="email" name="email" required autocomplete="email">
          </label>
          <label class="cp-auth-field">Contraseña
            <input type="password" name="password" required autocomplete="current-password" minlength="6">
          </label>
          <p class="cp-auth-error" style="display:none"></p>
          <div class="cp-att-actions">
            <button type="submit" class="btn red" id="cp-auth-submit">Entrar y continuar</button>
            <button type="button" class="btn line" id="cp-auth-back">Volver</button>
          </div>
        </form>
      </div>`;

    let tab = 'login';
    const form = modal.querySelector('#cp-auth-form');
    const regOnly = modal.querySelector('.cp-reg-only');
    const errEl = modal.querySelector('.cp-auth-error');
    const submit = modal.querySelector('#cp-auth-submit');

    modal.querySelectorAll('.cp-auth-tab').forEach(b => b.onclick = () => {
      tab = b.dataset.tab;
      modal.querySelectorAll('.cp-auth-tab').forEach(x => x.classList.toggle('active', x === b));
      regOnly.style.display = tab === 'register' ? '' : 'none';
      submit.textContent = tab === 'register' ? 'Crear cuenta y continuar' : 'Entrar y continuar';
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
      if (!email) { errEl.textContent = 'Escribe tu email.'; errEl.style.display = ''; return; }
      if (!pass) { errEl.textContent = 'Escribe tu contraseña.'; errEl.style.display = ''; return; }
      if (tab === 'register' && pass.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; errEl.style.display = ''; return; }
      if (tab === 'register' && !fullname) { errEl.textContent = 'Escribe tu nombre.'; errEl.style.display = ''; return; }
      // Teléfono OBLIGATORIO al crear cuenta (lo necesitamos para contactar por la reserva).
      if (tab === 'register' && phone.replace(/\D/g, '').length < 6) {
        errEl.textContent = 'Escribe un teléfono de contacto válido.'; errEl.style.display = ''; return;
      }
      submit.disabled = true; submit.textContent = 'Un momento…';
      try {
        if (tab === 'register') await signUp(email, pass, fullname, { phone, last_name: lastname });
        else await signIn(email, pass);
        await refreshAuth();
        if (!user) throw new Error('Revisa tu email para confirmar la cuenta antes de continuar.');
        await goToPayment();
      } catch (err) {
        errEl.textContent = err.message || 'No se pudo iniciar sesión.';
        errEl.style.display = '';
        submit.disabled = false;
        submit.textContent = tab === 'register' ? 'Crear cuenta y continuar' : 'Entrar y continuar';
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
      if (ds === selectedDate) cl.push('active');
      if (selectable) cl.push('has-class'); else cl.push('cp-cal-off');
      cells += `<button class="${cl.join(' ')}" data-date="${ds}" ${selectable ? '' : 'disabled'}>${d}${mine ? '<span class="cp-cal-dot"></span>' : ''}</button>`;
    }
    return `
      <div class="cp-cal">
        <div class="cp-cal-head">
          <button class="cp-cal-nav" id="cp-cal-prev" aria-label="Mes anterior">&lsaquo;</button>
          <span class="cp-cal-title">${MONTHS[calM]} ${calY}</span>
          <button class="cp-cal-nav" id="cp-cal-next" aria-label="Mes siguiente">&rsaquo;</button>
        </div>
        <div class="cp-cal-grid cp-cal-weekdays">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
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
      <button class="cp-close" aria-label="Cerrar">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>Elige cuándo usar tus clases</h3>
        <p class="cp-sub">${esc(packName)} — ${TYPE_LABELS[classType] || classType}</p>
        <div class="cp-credits">
          <span class="cp-credits-count">${used} / ${sessions}</span>
          <span class="cp-credits-label">clases elegidas</span>
        </div>
      </div>
      <div id="cp-timer" class="cp-timer" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>
        Plazas reservadas por <strong class="cp-timer-clock">10:00</strong> — completa tu reserva antes
      </div>`;

    if (bookings.length) {
      html += `<div class="cp-selection"><strong>Tu selección</strong>
        ${bookings.map((b, i) => `
          <div class="cp-sel-row">
            <span>${new Date(b.class.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(b.class.time_start)}</span>
            <span class="cp-sel-att">${esc(b.attendee.label)}</span>
            <button class="cp-sel-remove" data-rm="${i}" aria-label="Quitar">&times;</button>
          </div>`).join('')}
      </div>`;
    }

    html += monthCalendarHtml();
    html += `<div class="cp-slots" id="cp-slots"><div class="cp-loading">Cargando…</div></div>`;

    html += `<div class="cp-footer">
        <span class="cp-footer-note">${left > 0
          ? `Puedes <strong>decidir más tarde</strong> dónde gastar las ${left} clase${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''} desde tu cuenta.`
          : 'Has asignado todas tus clases.'}</span>
        <div class="cp-footer-btns">
          <button class="btn line" id="cp-cancel">Cancelar</button>
          <button class="btn red" id="cp-confirm">Continuar</button>
        </div>
      </div>`;

    modal.innerHTML = html;

    modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-cancel').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-confirm').onclick = () => { view = 'summary'; render(); };
    modal.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeBooking(Number(b.dataset.rm)));
    modal.querySelector('#cp-cal-prev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } render(); };
    modal.querySelector('#cp-cal-next').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } render(); };
    modal.querySelectorAll('.cp-cal-day:not([disabled])').forEach(b => b.onclick = () => { selectedDate = b.dataset.date; render(); });

    startTimer();

    const slotsEl = modal.querySelector('#cp-slots');
    if (!markedDays.has(selectedDate)) {
      slotsEl.innerHTML = '<p class="cp-empty">Elige un día con clases (marcados en el calendario).</p>';
      return;
    }
    const classes = await fetchAvailability(selectedDate, classType);
    if (!classes.length) { slotsEl.innerHTML = '<p class="cp-empty">No hay clases publicadas para esta fecha.</p>'; return; }
    slotsEl.innerHTML = classes.map(c => {
      const mineHere = bookings.filter(b => b.classId === c.id).length;
      const full = c.spots_left <= 0;
      let action;
      if (full) action = '<span class="cp-full">Completa</span>';
      else if (left <= 0) action = '<span class="cp-full">Sin clases libres</span>';
      else action = `<button class="btn red cp-add" data-cls="${c.id}" style="font-size:.8rem;padding:6px 14px">Añadir</button>`;
      return `
        <div class="class-slot-card ${full ? 'class-slot-full' : ''}" style="border-left:4px solid ${color}">
          <div class="class-slot-header">
            <span class="class-slot-time">${fmtTime(c.time_start)} — ${fmtTime(c.time_end)}</span>
            ${mineHere ? `<span class="cp-mine-badge">${mineHere} elegida${mineHere !== 1 ? 's' : ''}</span>` : ''}
          </div>
          <div class="class-slot-body">
            <strong>${esc(c.title || TYPE_LABELS[classType])}</strong>
            ${c.instructor ? `<span class="meta">${esc(c.instructor)}</span>` : ''}
            ${c.level && c.level !== 'todos' ? `<span class="meta">Nivel: ${esc(c.level)}</span>` : ''}
            ${c.location ? `<span class="meta">${esc(c.location)}</span>` : ''}
          </div>
          <div class="class-slot-footer">
            <span class="spots-badge ${full ? 'spots-full' : ''}">${c.spots_left} plaza${c.spots_left !== 1 ? 's' : ''} libre${c.spots_left !== 1 ? 's' : ''}</span>
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
      <button class="cp-close" aria-label="Cerrar">&times;</button>
      <div class="cp-header" style="border-top:4px solid ${color}">
        <h3>Resumen de tu reserva</h3>
        <p class="cp-sub">${esc(packName)} — ${TYPE_LABELS[classType] || classType}</p>
      </div>
      <div id="cp-timer" class="cp-timer" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>
        Plazas reservadas por <strong class="cp-timer-clock">10:00</strong> — completa tu reserva antes
      </div>
      <div class="cp-summary">
        <div class="cp-sum-block">
          <h4>Clases elegidas · ${used} de ${sessions}</h4>
          ${used ? sorted.map(b => `
            <div class="cp-sum-row">
              <div class="cp-sum-when">
                <strong>${longDayLabel(b.class.date)}</strong>
                <span>${fmtTime(b.class.time_start)} – ${fmtTime(b.class.time_end)}</span>
              </div>
              <span class="cp-sum-att">${esc(b.attendee.label)}</span>
            </div>`).join('') : '<p class="cp-sum-empty">No has elegido fechas todavía — podrás decidir cuándo usarlas desde tu cuenta.</p>'}
          ${left > 0 && used ? `<p class="cp-sum-later">${left} clase${left !== 1 ? 's' : ''} para decidir más tarde.</p>` : ''}
        </div>
        <div class="cp-sum-pay">
          <div class="cp-sum-pay-total"><span>Total del bono</span><strong>${fullPrice}€</strong></div>
          <p class="cp-sum-muted" style="margin-top:.6rem;font-size:.9rem">Sin pago ahora — lo abonas en la escuela. Te enviamos la confirmación por email.</p>
        </div>
      </div>
      <div class="cp-footer">
        <div class="cp-footer-btns">
          <button class="btn line" id="cp-back">Volver</button>
          <button class="btn red" id="cp-pay">Confirmar reserva</button>
        </div>
      </div>`;

    modal.querySelector('.cp-close').onclick = async () => { await releaseAll(); close(); };
    modal.querySelector('#cp-back').onclick = () => { view = 'select'; render(); };
    modal.querySelector('#cp-pay').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Procesando…';
      const ok = await goToPayment();
      if (ok === false) { btn.disabled = false; btn.textContent = 'Confirmar reserva'; }
    };
    startTimer();
  }

  // Arranca en el primer mes con clases (para que el calendario no salga vacío)
  try {
    const { data: firstCls } = await supabase.from('surf_classes')
      .select('date').eq('type', classType).eq('published', true).eq('status', 'scheduled')
      .gte('date', todayStr()).order('date', { ascending: true }).limit(1);
    if (firstCls?.[0]?.date) {
      const d = new Date(firstCls[0].date + 'T12:00:00');
      calY = d.getFullYear(); calM = d.getMonth(); selectedDate = firstCls[0].date;
    }
  } catch {}

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) { await releaseAll(); close(); }
  });

  // Auto-refresco de disponibilidad cada 30s (las plazas liberadas aparecen solas)
  refreshId = setInterval(() => {
    if (view === 'select' && !overlay.querySelector('.cp-attendee-overlay')) render();
  }, 30000);

  await render();
}
