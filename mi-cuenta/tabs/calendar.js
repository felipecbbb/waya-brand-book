// mi-cuenta/tabs/calendar.js — Tab "Reservar Clases" (Waya)
// Contrato de montaje del shell:  export async function renderCalendar(container, switchTab)
// - container: <div class="tab-panel"> ya en el DOM y vacío. Re-render idempotente.
// - switchTab: función(tabKey) para navegar (no se usa aquí; se acepta por contrato).
//
// Flujo: filtros (6 tipos Waya + nivel) → calendario mensual con días marcados →
// clases publicadas del día (vía RPC fetch_class_availability, plazas ya descontando
// holds) → modal de reserva multi-persona (yo + familiares) con selección de bono →
// book_class por persona. Toast en éxito. Los emails los dispara booking.js
// (notifyClass) de forma fire-and-forget; NO se duplican aquí.

import { bookClass, cancelEnrollment } from '/lib/booking.js';
import { fetchActiveBonos, fetchUserBonos } from '/lib/bonos.js';
import { fetchFamilyMembers } from '/lib/family.js';
import { supabase } from '/lib/supabase.js';
import { TYPE_LABELS, TYPE_COLORS, showToast, esc } from '/lib/utils.js';
import { LEVEL_OPTIONS, AUDIENCE_OPTIONS } from '/lib/shared-constants.js';

const AUDIENCE_LABELS = Object.fromEntries(AUDIENCE_OPTIONS.map(a => [a.value, a.label]));

// type_key (6 tipos Waya) → página pública de compra del pack
const BUY_PAGES = {
  grupal: '/clases-grupales.html',
  privada: '/clases-privadas.html',
  semiprivada: '/clases-semiprivadas.html',
  familiar: '/clases-familiares.html',
  residente: '/bono-residente.html',
  kids: '/waya-kids.html',
};

function formatTime(t) { return t?.slice(0, 5) || ''; }

// El amarillo de marca (grupal) es ilegible con texto blanco (badge de fondo de color)
// o en amarillo sobre blanco (etiqueta): usa texto oscuro para ese tipo. El resto de
// tipos (colores medios) conservan texto blanco en badge / su color como etiqueta.
function typeBadgeText(type) { return type === 'grupal' ? 'var(--color-dark)' : '#fff'; }
function typeTextColor(type, color) { return type === 'grupal' ? 'var(--color-dark)' : color; }

const CAL_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CAL_WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const cpad = n => String(n).padStart(2, '0');

// Días del mes con clases publicadas (para marcar el calendario). Sólo depende del tipo.
async function fetchClassDaysForMonth(type, y, m) {
  const start = `${y}-${cpad(m + 1)}-01`;
  const end = `${y}-${cpad(m + 1)}-${cpad(new Date(y, m + 1, 0).getDate())}`;
  let q = supabase.from('surf_classes').select('date')
    .eq('published', true).eq('status', 'scheduled')
    .gte('date', start).lte('date', end);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) { console.error('fetchClassDaysForMonth:', error); return new Set(); }
  return new Set((data || []).map(r => r.date));
}

// Clases disponibles de una fecha: RPC de availability → spots_left ya descuenta holds.
async function fetchClassesForDate(date, level) {
  const { data, error } = await supabase.rpc('fetch_class_availability', {
    p_date: date,
    p_type: null,
    p_level: level || null,
  });
  if (error) {
    console.error('fetch_class_availability:', error);
    return [];
  }
  return data || [];
}

// Estilos del tab (viven en styles.css de Entreolas; aquí se inyectan re-tokenizados
// a las variables de Waya, una sola vez). No inventa tokens: usa los puente de account.css.
function ensureStyles() {
  if (document.getElementById('cal-tab-styles')) return;
  const s = document.createElement('style');
  s.id = 'cal-tab-styles';
  s.textContent = `
    .credits-summary { background: var(--color-sand); border: 1px solid var(--color-line); border-radius: var(--radius-md); padding: 16px 18px; margin-bottom: 18px; }
    .credits-title { font-family: var(--font-heading,'Outfit',sans-serif); font-weight: 700; font-size: .95rem; color: var(--color-navy); margin: 0 0 12px; }
    .credits-grid { display: flex; flex-wrap: wrap; gap: 10px; }
    .credit-card { display: flex; flex-direction: column; gap: 2px; background: #fff; border: 1px solid var(--color-line); border-radius: var(--radius-sm); padding: 10px 14px; min-width: 130px; }
    .credit-type { font-size: .82rem; font-weight: 700; }
    .credit-count { font-size: .8rem; color: var(--color-muted); }
    .no-bonos-prompt { text-align: center; background: var(--color-sand); border: 1px solid var(--color-line); border-radius: var(--radius-md); padding: 26px 20px; margin-bottom: 18px; }
    .no-bonos-icon { margin-bottom: 8px; }
    .no-bonos-prompt h3 { font-family: var(--font-heading,'Outfit',sans-serif); color: var(--color-navy); margin: 0 0 6px; font-size: 1.05rem; }
    .no-bonos-prompt p { color: var(--color-muted); font-size: .88rem; margin: 0 0 14px; }
    .no-bonos-links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
    .no-bonos-links .btn { font-size: .78rem; padding: 8px 16px; text-transform: none; letter-spacing: normal; }
    .cal-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .cal-filter-types { display: flex; flex-wrap: wrap; gap: 6px; }
    .cal-type-btn { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--color-line); background: #fff; font-size: .8rem; font-weight: 600; color: var(--color-navy); cursor: pointer; transition: all .2s; }
    .cal-type-btn:hover { border-color: var(--type-color, var(--color-navy)); }
    .cal-type-btn.active { background: var(--type-color, var(--color-navy)); border-color: var(--type-color, var(--color-navy)); color: #fff; }
    .cal-level-select { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--color-line); font-size: .84rem; background: #fff; cursor: pointer; color: var(--color-navy); }
    .class-slots { display: flex; flex-direction: column; gap: 12px; margin-top: 6px; }
    .class-slot-card { background: #fff; border: 1px solid var(--color-line); border-radius: var(--radius-md); padding: 14px 16px; }
    .class-slot-card.class-slot-full { opacity: .72; }
    .class-slot-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .class-slot-time { font-family: var(--font-heading,'Outfit',sans-serif); font-weight: 700; color: var(--color-navy); font-size: .95rem; }
    .bono-type-badge { font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
    .class-slot-body { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
    .class-slot-body strong { color: var(--color-navy); font-size: .92rem; }
    .class-slot-body .meta { font-size: .8rem; color: var(--color-muted); }
    .class-slot-footer { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .spots-badge { font-size: .76rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--color-sand); color: var(--color-navy); }
    .spots-badge.spots-full { background: #fde2e2; color: #b91c1c; }
    .class-slot-footer .btn { text-transform: none; letter-spacing: normal; }
    .booking-person-check { transition: border-color .2s; }
    .booking-person-check:hover { border-color: var(--color-yellow); }
  `;
  document.head.appendChild(s);
}

export async function renderCalendar(container, switchTab) {
  ensureStyles();
  const panel = container;

  const _t = new Date();
  let calY = _t.getFullYear();
  let calM = _t.getMonth();
  let markedDays = new Set();
  let selectedDate = null;
  let filterLevel = '';   // '' = todos los niveles
  let filterType = '';    // '' = todas las modalidades
  let allBonos = [];
  let allClasses = [];    // clases del día seleccionado (para el modal)

  async function render() {
    try {
      allBonos = await fetchUserBonos();
    } catch (err) {
      console.error('Error fetching bonos:', err);
      allBonos = [];
    }
    const activeBonos = allBonos.filter(b =>
      b.status === 'active' &&
      b.used_credits < b.total_credits &&
      (!b.expires_at || new Date(b.expires_at) > new Date())
    );

    try { markedDays = await fetchClassDaysForMonth(filterType, calY, calM); }
    catch { markedDays = new Set(); }

    let html = '';

    // (a) Resumen de créditos disponibles / prompt sin bonos
    if (activeBonos.length) {
      html += `<div class="credits-summary">
        <h3 class="credits-title">Tus créditos disponibles</h3>
        <div class="credits-grid">
          ${activeBonos.map(b => {
            const remaining = b.total_credits - b.used_credits;
            const color = TYPE_COLORS[b.class_type] || 'var(--color-navy)';
            return `<div class="credit-card" style="border-left:4px solid ${color}">
              <span class="credit-type" style="color:${typeTextColor(b.class_type, color)}">${esc(TYPE_LABELS[b.class_type] || b.class_type)}</span>
              <span class="credit-count">${remaining} crédito${remaining !== 1 ? 's' : ''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    } else {
      html += `<div class="no-bonos-prompt">
        <div class="no-bonos-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <h3 data-i18n="account.calendar.noCreditsTitle">No tienes créditos de clases</h3>
        <p data-i18n="account.calendar.noCreditsText">Compra un pack de clases para poder reservar en el calendario.</p>
        <div class="no-bonos-links">
          ${Object.keys(TYPE_LABELS).map(t => `<a href="${BUY_PAGES[t] || '#'}" class="btn btn-primary">${esc(TYPE_LABELS[t])}</a>`).join('')}
        </div>
      </div>`;
    }

    // (b) Filtros: tipo (6 modalidades Waya) + nivel
    const allTypes = Object.keys(TYPE_LABELS);
    html += `<div class="cal-filters">
      <div class="cal-filter-types">
        <button class="cal-type-btn ${!filterType ? 'active' : ''}" data-type="">Todas</button>
        ${allTypes.map(t => `<button class="cal-type-btn ${filterType === t ? 'active' : ''}" data-type="${t}" style="--type-color:${TYPE_COLORS[t]}">${esc(TYPE_LABELS[t])}</button>`).join('')}
      </div>
      <select id="cal-filter-level" class="cal-level-select">
        <option value="" ${filterLevel === '' ? 'selected' : ''}>Todos los niveles</option>
        ${LEVEL_OPTIONS.map(l => `<option value="${l.value}" ${filterLevel === l.value ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
      </select>
    </div>`;

    // (c) Calendario mensual
    const tStr = new Date().toISOString().slice(0, 10);
    const firstWd = (new Date(calY, calM, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(calY, calM + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstWd; i++) cells += '<span class="mc-empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calY}-${cpad(calM + 1)}-${cpad(d)}`;
      const has = markedDays.has(ds);
      const past = ds < tStr;
      const sel = ds === selectedDate;
      const cl = ['mc-day'];
      if (sel) cl.push('active');
      if (has && !past) cl.push('has-class'); else cl.push('mc-off');
      cells += `<button class="${cl.join(' ')}" data-date="${ds}" ${has && !past ? '' : 'disabled'}>${d}</button>`;
    }
    const selLabel = selectedDate ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '';

    html += `
      <div class="cal-main">
        <div class="cal-left">
          <div class="mc-cal">
            <div class="mc-head">
              <button class="mc-nav" id="cal-prev" aria-label="Mes anterior">&lsaquo;</button>
              <span class="mc-title">${CAL_MONTHS[calM]} ${calY}</span>
              <button class="mc-nav" id="cal-next" aria-label="Mes siguiente">&rsaquo;</button>
            </div>
            <div class="mc-grid mc-weekdays">${CAL_WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
            <div class="mc-grid mc-days">${cells}</div>
          </div>
        </div>
        <div class="cal-right">
          ${selectedDate && markedDays.has(selectedDate) ? `<h3 class="cal-day-title">${selLabel}</h3>` : ''}`;

    if (!selectedDate || !markedDays.has(selectedDate)) {
      html += `<div class="cal-pick-hint">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Elige un día con clases (marcados en el calendario).</p>
      </div>`;
    }

    // (d) Clases del día seleccionado (sólo si el día tiene clases)
    allClasses = (selectedDate && markedDays.has(selectedDate)) ? await fetchClassesForDate(selectedDate, filterLevel) : [];
    if (filterType) allClasses = allClasses.filter(c => c.type === filterType);

    // Inscripciones del usuario en estas clases (para mostrar "cancelar")
    let userEnrollments = [];
    if (allClasses.length) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const classIds = allClasses.map(c => c.id);
          const { data } = await supabase
            .from('class_enrollments')
            .select('id, class_id, family_member_id, status, family_members(full_name)')
            .eq('user_id', user.id)
            .in('class_id', classIds)
            .in('status', ['confirmed', 'paid', 'partial']);
          userEnrollments = data || [];
        }
      } catch (err) {
        console.error('Error fetching user enrollments:', err);
      }
    }

    if (allClasses.length) {
      html += `<div class="class-slots">`;
      html += allClasses.map(c => {
        // spots_left viene de la RPC ya descontando holds; fallbacks por si acaso
        const taken = (typeof c.spots_taken === 'number') ? c.spots_taken
          : (typeof c.confirmed_count === 'number') ? c.confirmed_count
          : (c.enrolled_count || 0);
        const spotsLeft = (typeof c.spots_left === 'number') ? c.spots_left : (c.max_students - taken);
        const full = spotsLeft <= 0;
        const color = TYPE_COLORS[c.type] || 'var(--color-navy)';
        const bonoForType = activeBonos.find(b => b.class_type === c.type);
        const credits = bonoForType ? (bonoForType.total_credits - bonoForType.used_credits) : 0;
        const hasBono = credits > 0;

        const myEnrollments = userEnrollments.filter(e => e.class_id === c.id);
        const isEnrolled = myEnrollments.length > 0;

        // Guarda cliente >2h (paridad con enrollments.js): la RPC cancel_enrollment
        // también lo bloquea, pero deshabilitamos el botón para una UX coherente.
        const canCancel = new Date(selectedDate + 'T' + c.time_start) > new Date(Date.now() + 2 * 3600 * 1000);

        let footerAction = '';
        if (isEnrolled) {
          const cancelBtns = myEnrollments.map(e => {
            const label = e.family_member_id ? (e.family_members?.full_name || 'Familiar') : 'Mi reserva';
            return `<button class="btn btn-secondary" data-action="cancel" data-enrollment-id="${e.id}"${canCancel ? '' : ' disabled title="No cancelable (menos de 2h)"'} style="font-size:.76rem;padding:5px 12px;text-transform:none;letter-spacing:normal;color:#b91c1c;border-color:#b91c1c">✕ ${esc(label)}</button>`;
          }).join(' ');
          footerAction = `<span class="spots-badge" style="background:#dcfce7;color:#15803d">Reservado</span> ${cancelBtns}`;
        }
        if (!full && hasBono) {
          footerAction += ` <button class="btn btn-primary" data-action="book" data-class-id="${c.id}" data-class-type="${c.type}" data-spots="${spotsLeft}" style="font-size:.8rem;padding:6px 14px">${isEnrolled ? 'Añadir' : 'Reservar'}</button>`;
        } else if (!isEnrolled && full) {
          footerAction = '<span class="spots-badge spots-full">Completa</span>';
        } else if (!isEnrolled && !hasBono) {
          footerAction = `<a href="${BUY_PAGES[c.type] || '#'}" class="btn btn-secondary" style="font-size:.8rem;padding:6px 14px;text-transform:none;letter-spacing:normal">Comprar bono</a>`;
        }

        return `
          <div class="class-slot-card ${full ? 'class-slot-full' : ''} ${isEnrolled ? 'class-slot-enrolled' : ''}" style="border-left:4px solid ${color}">
            <div class="class-slot-header">
              <span class="class-slot-time">${formatTime(c.time_start)} — ${formatTime(c.time_end)}</span>
              <span class="bono-type-badge" style="background:${color};color:${typeBadgeText(c.type)}">${esc(TYPE_LABELS[c.type] || c.type)}</span>
            </div>
            <div class="class-slot-body">
              <strong>${esc(c.title || TYPE_LABELS[c.type] || '')}</strong>
              ${c.instructor ? `<span class="meta">${esc(c.instructor)}</span>` : ''}
              ${c.level && c.level !== 'todos' ? `<span class="meta">Nivel: ${esc(c.level)}</span>` : ''}
              ${c.audience ? `<span class="meta">${esc(AUDIENCE_LABELS[c.audience] || c.audience)}</span>` : ''}
              ${c.location ? `<span class="meta">${esc(c.location)}</span>` : ''}
            </div>
            <div class="class-slot-footer">
              <span class="spots-badge ${full ? 'spots-full' : ''}">${taken}/${c.max_students} plazas</span>
              ${footerAction}
            </div>
          </div>`;
      }).join('');
      html += `</div>`;
    } else if (selectedDate && markedDays.has(selectedDate)) {
      html += '<p style="color:var(--color-muted);margin-top:8px">No hay clases para este filtro en la fecha seleccionada.</p>';
    }

    html += `</div></div>`; // cierra .cal-right y .cal-main

    // (e) Modal de reserva (oculto)
    html += `<div id="booking-modal" class="booking-modal" style="display:none">
      <div class="booking-modal-content">
        <h3>Reservar clase</h3>
        <div id="booking-modal-body"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-primary" id="confirm-booking">Confirmar reserva</button>
          <button class="btn btn-secondary" id="cancel-booking">Cancelar</button>
        </div>
      </div>
    </div>`;

    panel.innerHTML = html;

    // ---- Eventos ----
    panel.querySelectorAll('.cal-type-btn').forEach(btn => {
      btn.addEventListener('click', () => { filterType = btn.dataset.type; render(); });
    });
    panel.querySelector('#cal-filter-level')?.addEventListener('change', (e) => {
      filterLevel = e.target.value; render();
    });
    panel.querySelector('#cal-prev')?.addEventListener('click', () => {
      calM--; if (calM < 0) { calM = 11; calY--; } render();
    });
    panel.querySelector('#cal-next')?.addEventListener('click', () => {
      calM++; if (calM > 11) { calM = 0; calY++; } render();
    });
    panel.querySelectorAll('.mc-day:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => { selectedDate = btn.dataset.date; render(); });
    });
    panel.querySelectorAll('[data-action="book"]').forEach(btn => {
      btn.addEventListener('click', () => openBookingModal(btn.dataset.classId, btn.dataset.classType, Number(btn.dataset.spots) || 0));
    });
    panel.querySelectorAll('[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!confirm('¿Cancelar esta reserva? El crédito se restablecerá a tu bono.')) return;
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Cancelando…';
        try {
          await cancelEnrollment(btn.dataset.enrollmentId); // notifica por email dentro de booking.js
          showToast('Reserva cancelada. Crédito restablecido.');
          render();
        } catch (err) {
          showToast('Error al cancelar: ' + (err?.message || err), 'error');
          btn.disabled = false;
          btn.textContent = prev;
        }
      });
    });
  }

  async function openBookingModal(classId, classType, spotsLeft = 99) {
    const modal = panel.querySelector('#booking-modal');
    const body = panel.querySelector('#booking-modal-body');
    const confirmBtn = panel.querySelector('#confirm-booking');

    let bonos, members;
    try {
      [bonos, members] = await Promise.all([
        fetchActiveBonos(classType),
        fetchFamilyMembers(),
      ]);
    } catch (err) {
      console.error('Error loading booking data:', err);
      bonos = [];
      members = [];
    }

    // ¿Quién del usuario ya está inscrito en esta clase? (para no duplicar)
    let selfEnrolled = false;
    const enrolledFam = new Set();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: enr } = await supabase.from('class_enrollments')
          .select('family_member_id')
          .eq('class_id', classId).eq('user_id', user.id)
          .in('status', ['confirmed', 'paid', 'partial']);
        (enr || []).forEach(e => { if (e.family_member_id) enrolledFam.add(e.family_member_id); else selfEnrolled = true; });
      }
    } catch {}

    if (!bonos.length) {
      body.innerHTML = `
        <p>No tienes bonos activos para <strong>${esc(TYPE_LABELS[classType] || classType)}</strong>.</p>
        <p style="font-size:.9rem">Compra un pack de clases y vuelve para reservar.</p>
        ${BUY_PAGES[classType] ? `<a href="${BUY_PAGES[classType]}" class="btn btn-primary" style="margin-top:8px;text-transform:none;letter-spacing:normal">Ver packs de ${esc(TYPE_LABELS[classType] || classType)}</a>` : ''}`;
      confirmBtn.style.display = 'none';
    } else {
      body.innerHTML = `
        <p style="font-size:.9rem;color:var(--color-muted);margin-bottom:12px">Selecciona quién asistirá a esta clase:</p>
        <div id="booking-persons" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
          <label class="booking-person-check" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-line);border-radius:var(--radius-sm);cursor:pointer;${selfEnrolled ? 'opacity:.5' : ''}">
            <input type="checkbox" name="person" value="" ${selfEnrolled ? 'disabled' : 'checked'}>
            <div><strong>Yo mismo${selfEnrolled ? ' · ya inscrito' : ''}</strong></div>
          </label>
          ${members.map(m => {
            const dis = enrolledFam.has(m.id);
            return `
            <label class="booking-person-check" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-line);border-radius:var(--radius-sm);cursor:pointer;${dis ? 'opacity:.5' : ''}">
              <input type="checkbox" name="person" value="${m.id}" ${dis ? 'disabled' : ''}>
              <div>
                <strong>${esc(m.full_name)}${dis ? ' · ya inscrito' : ''}</strong>
                <span style="font-size:.8rem;color:var(--color-muted);display:block">${esc(m.level || '')}${m.wetsuit_size ? ' · ' + esc(m.wetsuit_size) : ''}</span>
              </div>
            </label>`;
          }).join('')}
        </div>
        <label style="display:block">
          Usar bono:
          <select id="booking-bono" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--color-line);margin-top:4px">
            ${bonos.map(b => `<option value="${b.id}">${esc(TYPE_LABELS[b.class_type] || b.class_type)} — ${b.total_credits - b.used_credits} créditos restantes</option>`).join('')}
          </select>
        </label>
        <p id="booking-credits-info" style="font-size:.85rem;margin-top:8px;color:var(--color-muted)"></p>`;
      confirmBtn.style.display = '';

      function updateCreditsInfo() {
        const checked = body.querySelectorAll('input[name="person"]:checked').length;
        const bonoSelect = body.querySelector('#booking-bono');
        const selectedBono = bonos.find(b => b.id === bonoSelect?.value);
        const remaining = selectedBono ? (selectedBono.total_credits - selectedBono.used_credits) : 0;
        const infoEl = body.querySelector('#booking-credits-info');
        if (!infoEl) return;
        if (checked > remaining) {
          infoEl.innerHTML = `<span style="color:#b91c1c">No tienes suficientes créditos (${checked} necesarios, ${remaining} disponibles)</span>`;
        } else if (checked > spotsLeft) {
          infoEl.innerHTML = `<span style="color:#b91c1c">Sólo quedan ${spotsLeft} plaza${spotsLeft !== 1 ? 's' : ''} en esta clase</span>`;
        } else {
          infoEl.textContent = `Se usarán ${checked} crédito${checked !== 1 ? 's' : ''} de ${remaining} disponibles`;
        }
      }
      body.querySelectorAll('input[name="person"]').forEach(cb => cb.addEventListener('change', updateCreditsInfo));
      body.querySelector('#booking-bono')?.addEventListener('change', updateCreditsInfo);
      updateCreditsInfo();
    }

    modal.style.display = 'flex';
    panel.querySelector('#cancel-booking').onclick = () => { modal.style.display = 'none'; };

    confirmBtn.onclick = async () => {
      const bonoId = panel.querySelector('#booking-bono')?.value;
      if (!bonoId) return;

      const checkedPersons = [...body.querySelectorAll('input[name="person"]:checked')].map(cb => cb.value);
      if (!checkedPersons.length) { showToast('Selecciona al menos una persona', 'error'); return; }

      const selectedBono = bonos.find(b => b.id === bonoId);
      const remaining = selectedBono ? (selectedBono.total_credits - selectedBono.used_credits) : 0;
      if (checkedPersons.length > remaining) { showToast('No tienes suficientes créditos', 'error'); return; }
      if (checkedPersons.length > spotsLeft) { showToast('No hay tantas plazas libres en esta clase', 'error'); return; }

      confirmBtn.disabled = true;
      const prevTxt = confirmBtn.textContent;
      confirmBtn.textContent = 'Reservando…';

      try {
        for (const personValue of checkedPersons) {
          const familyMemberId = personValue || null; // '' = yo mismo
          await bookClass(classId, bonoId, familyMemberId); // notifica por email dentro de booking.js
        }
        modal.style.display = 'none';
        showToast(`${checkedPersons.length} plaza${checkedPersons.length > 1 ? 's reservadas' : ' reservada'}`);
        render();
      } catch (err) {
        showToast('Error al reservar: ' + (err?.message || err), 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = prevTxt;
      }
    };
  }

  await render();
}
