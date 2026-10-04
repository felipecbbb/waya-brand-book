/* ============================================================
   Calendario Section — Day view of scheduled classes
   ============================================================ */
import {
  fetchClassesInRange, fetchClassEnrollments, publishClasses,
  upsertClass, deleteClass, createEnrollment, deleteEnrollment,
  searchProfiles, moveEnrollment, updateEnrollmentStatus, updateEnrollmentAttendance,
  createClientFromAdmin, fetchEquipment, createEquipmentReservation,
  fetchEquipmentReservationsOverlapping, updateEquipmentReservationStatus,
  updateEquipmentReservation, cancelEquipmentReservation,
  fetchPayments, createPayment, deletePayment,
  enviarAviso,
} from '../modules/api.js';
import { openModal, closeModal, showToast, formatDate } from '../modules/ui.js';
import { openPaymentEditModal } from '../modules/payment-edit.js';
import { TYPE_LABELS, TYPE_COLORS } from '../modules/constants.js';
import { getPackPrice, bonoExpected, bonoFullyPaid, round2 } from '/lib/domain/pricing.js';
import { recalcBonoPaid, recalcPaidState } from '/lib/domain/payments.js';
import { findOwnerBono, bonoAvailable, createBono, extendBono, defaultBonoExpiry } from '/lib/domain/bonos.js';
import { openBonoFicha } from '../components/bono-ficha.js';
import { supabase } from '/lib/supabase.js';
import { WETSUIT_SIZES, wetsuitOptionsHtml, audienceOptionsHtml, dialForCountry, compareSizes } from '/lib/shared-constants.js';
import { attachClientSuggest } from '../modules/client-suggest.js';

// getPackPrice / bonoExpected viven en /lib/domain/pricing.js (fuente única).

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Normaliza una talla para comparar: "8 años" ≡ "8", sin distinguir mayúsculas.
function normSize(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s*años?$/, '');
}

// Normaliza un nombre para comparar y deduplicar: minúsculas, sin tildes, sin espacios
// repetidos. Así "María  Martín" ≡ "maria martin" → no se crean familiares/clientes duplicados.
function normName(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
// Normaliza un teléfono a solo dígitos (para deduplicar por teléfono).
function normPhone(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

// Duración por tipo (min) — la hora de fin se calcula sola desde inicio + duración.
const TYPE_DURATIONS = { grupal: 90, individual: 90, paddle: 90, surfskate: 90, yoga: 60 };
function addMinutesToTime(hhmm, mins) {
  const [h, m] = (hhmm || '0:0').split(':').map(Number);
  const total = (h * 60 + m + (mins || 0)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Instructores = staff (perfiles admin/encargado). El campo guarda el nombre (texto).
async function fetchInstructors() {
  const { data } = await supabase
    .from('profiles').select('full_name')
    .in('role', ['admin', 'encargado'])
    .order('full_name', { ascending: true });
  return [...new Set((data || []).map(p => p.full_name).filter(Boolean))];
}

// Rellena un <select> de instructores; conserva el valor previo aunque no esté en la lista (legacy)
function populateInstructorSelect(selectEl, selected = '') {
  if (!selectEl) return;
  fetchInstructors().then(list => {
    const opts = ['<option value="">Sin asignar</option>'];
    if (selected && !list.includes(selected)) opts.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
    list.forEach(n => opts.push(`<option value="${escapeHtml(n)}" ${n === selected ? 'selected' : ''}>${escapeHtml(n)}</option>`));
    selectEl.innerHTML = opts.join('');
  });
}

// ---- Notificar a inscritos cuando una clase cambia o se cancela ----
// kind: 'cancelled' | 'rescheduled'
// payload: { className, classDate, classTime, instructor?, oldClassDate?, oldClassTime? }
async function notifyEnrolledClients(classId, kind, payload) {
  const result = { sent: 0, withoutEmail: 0, failed: 0 };
  try {
    const { data: enrollments } = await supabase
      .from('class_enrollments')
      .select('user_id, guest_name, status, profiles:user_id(full_name)')
      .eq('class_id', classId)
      .neq('status', 'cancelled');
    if (!enrollments?.length) return result;

    const emailType = kind === 'cancelled' ? 'class_cancelled' : 'class_rescheduled';

    for (const en of enrollments) {
      let email = null;
      let name = en.guest_name || en.profiles?.full_name || null;
      if (en.user_id) {
        try {
          const { data } = await supabase.rpc('get_user_email', { p_user_id: en.user_id });
          if (data) email = data;
        } catch {}
      }
      if (!email) { result.withoutEmail++; continue; }
      try {
        const { error } = await enviarAviso({ to: email, type: emailType, data: { customerName: name, ...payload } });
        if (error) { result.failed++; continue; }
        result.sent++;
      } catch (err) {
        console.warn('notifyEnrolledClients send failed:', err);
        result.failed++;
      }
    }
  } catch (err) {
    console.warn('notifyEnrolledClients error:', err);
  }
  return result;
}

function notifyToastMessage(action, r) {
  const parts = [];
  if (r.sent > 0) parts.push(`${r.sent} ${r.sent === 1 ? 'aviso enviado' : 'avisos enviados'}`);
  if (r.withoutEmail > 0) parts.push(`${r.withoutEmail} sin email`);
  if (r.failed > 0) parts.push(`${r.failed} con error`);
  return parts.length ? `${action} · ${parts.join(' · ')}` : action;
}

const DAY_NAMES_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_NAMES_SHORT = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'];
const MONTH_NAMES = ['Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.', 'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.'];

export async function renderCalendario(container) {
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  let viewMode = 'day';

  function formatDayHeader(date) {
    const d = new Date(date);
    return {
      dayName: DAY_NAMES_SHORT[d.getDay()],
      dayNum: d.getDate(),
      month: MONTH_NAMES[d.getMonth()],
      year: d.getFullYear()
    };
  }

  function getDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getWeekDates(baseDate) {
    const d = new Date(baseDate);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(monday);
      dd.setDate(monday.getDate() + i);
      dates.push(dd);
    }
    return dates;
  }

  function computeTotalHours(classes) {
    let total = 0;
    classes.forEach(c => {
      if (c.time_start && c.time_end) {
        const [sh, sm] = c.time_start.split(':').map(Number);
        const [eh, em] = c.time_end.split(':').map(Number);
        total += (eh * 60 + em - sh * 60 - sm) / 60;
      }
    });
    return total.toFixed(2);
  }

  function shortDateLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return `${DAY_NAMES_SHORT[d.getDay()].toLowerCase()} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].toLowerCase()}`;
  }

  // Enrollments cache: classId → [enrollment, ...]
  let enrollmentsCache = {};
  // Nº de crédito (1..total) de cada inscripción dentro de su bono, ordenado por fecha
  // de clase: enrollmentId → ordinal. El chip muestra "2/4" = esta clase gasta el
  // crédito 2 de 4, en vez del used_credits global (que ya es 4/4 si se reservó todo
  // el bono de golpe). Se recalcula por render desde TODAS las clases del bono.
  let creditOrdinals = {};
  let _openMovePicker = null; // picker de "mover de día", expuesto desde bindEvents para reusar en la ficha

  // Mapa enrollmentId → nº de crédito (1-based) dentro de su bono. Necesita TODAS las
  // inscripciones del bono (no solo las visibles), por eso consulta por bono_id.
  async function buildCreditOrdinals(bonoIds) {
    const map = {};
    const ids = [...new Set((bonoIds || []).filter(Boolean))];
    if (!ids.length) return map;
    const { data } = await supabase
      .from('class_enrollments')
      .select('id, bono_id, created_at, status, surf_classes:class_id(date, time_start)')
      .in('bono_id', ids).neq('status', 'cancelled');
    if (!data) return map;
    const byBono = {};
    data.forEach(e => { (byBono[e.bono_id] = byBono[e.bono_id] || []).push(e); });
    Object.values(byBono).forEach(list => {
      list.sort((a, b) => {
        const ka = `${a.surf_classes?.date || ''} ${a.surf_classes?.time_start || ''}`;
        const kb = `${b.surf_classes?.date || ''} ${b.surf_classes?.time_start || ''}`;
        if (ka !== kb) return ka < kb ? -1 : 1;
        return new Date(a.created_at) - new Date(b.created_at);
      });
      list.forEach((e, i) => { map[e.id] = i + 1; });
    });
    return map;
  }

  // ======== MAIN RENDER ========
  async function render() {
    const dateStr = getDateStr(currentDate);
    let fromDate, toDate;
    if (viewMode === 'day') {
      fromDate = toDate = dateStr;
    } else {
      const weekDates = getWeekDates(currentDate);
      fromDate = getDateStr(weekDates[0]);
      toDate = getDateStr(weekDates[6]);
    }

    const classes = await fetchClassesInRange(fromDate, toDate);

    // Fetch enrollments for day view classes (safe — never blocks render)
    enrollmentsCache = {};
    let rentalReservations = [];
    if (viewMode === 'day') {
      const dayClasses = classes.filter(c => c.date === dateStr);
      try {
        const enrollPromises = dayClasses.map(c =>
          fetchClassEnrollments(c.id)
            .then(e => ({ classId: c.id, enrollments: e }))
            .catch(() => ({ classId: c.id, enrollments: [] }))
        );
        const results = await Promise.all(enrollPromises);
        results.forEach(r => { enrollmentsCache[r.classId] = r.enrollments; });
        // Ordinal de crédito por inscripción (qué nº de clase del bono gasta cada una)
        const visibleBonoIds = Object.values(enrollmentsCache).flat().map(e => e.bono_id);
        try { creditOrdinals = await buildCreditOrdinals(visibleBonoIds); }
        catch { creditOrdinals = {}; }
      } catch (err) {
        console.warn('Could not fetch enrollments:', err);
      }
      // Fetch equipment rental reservations overlapping this day
      try {
        rentalReservations = await fetchEquipmentReservationsOverlapping(dateStr);
      } catch (err) {
        console.warn('Could not fetch rental reservations:', err);
      }
    } else {
      creditOrdinals = {};
    }

    const { dayName, dayNum, month, year } = formatDayHeader(currentDate);
    const totalHours = computeTotalHours(viewMode === 'day' ? classes : classes.filter(c => c.date === dateStr));

    const topNav = `
      <div class="cal-top-bar">
        <div class="cal-top-left">
          <button class="cal-nav-arrow" id="cal-prev" title="Anterior">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="cal-nav-arrow" id="cal-next" title="Siguiente">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
          </button>
          <div class="cal-date-display">
            <span class="cal-date-year">${year}</span>
            <span class="cal-date-main">${dayName}, ${dayNum} ${month}</span>
          </div>
          <button class="cal-today-btn" id="cal-today">Hoy</button>
          <label class="cal-date-pick" title="Ir a una fecha">
            <span class="cal-date-ico" aria-hidden="true">📅</span>
            <input type="date" id="cal-date" value="${getDateStr(currentDate)}">
          </label>
        </div>
        <div class="cal-top-right">
          <span class="cal-hours-total">${totalHours} <small>HORAS</small></span>
          <div class="cal-view-toggle">
            <button class="cal-view-btn ${viewMode === 'day' ? 'active' : ''}" data-view="day">Día</button>
            <button class="cal-view-btn ${viewMode === 'week' ? 'active' : ''}" data-view="week">Semana</button>
          </div>
          <div class="cal-add-wrap" id="cal-add-wrap">
            <button class="cal-action-btn cal-add-btn" id="cal-add-trigger" title="Crear">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <div class="cal-add-menu" id="cal-add-menu" hidden>
              <button class="cal-add-menu-item" id="cal-menu-new-booking" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 14l2 2 4-4"/></svg>
                <div>
                  <strong>Nueva reserva</strong>
                  <small>Inscribir cliente en clase existente</small>
                </div>
              </button>
              <button class="cal-add-menu-item" id="cal-menu-new-session" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <div>
                  <strong>Nueva clase / alquiler</strong>
                  <small>Crear sesión en el horario o material</small>
                </div>
              </button>
              <button class="cal-add-menu-item" id="cal-menu-bulk-edit" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <div>
                  <strong>Editar en bloque</strong>
                  <small>Cambiar hora, instructor… de varias clases</small>
                </div>
              </button>
              <div class="cal-add-menu-divider"></div>
              <button class="cal-add-menu-item danger" id="cal-menu-bulk-delete" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                <div>
                  <strong>Borrar clases</strong>
                  <small>Por rango, manual o todas</small>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>`;

    let content = '';
    if (viewMode === 'day') {
      content = renderDayView(classes, dateStr, rentalReservations);
    } else {
      content = renderWeekView(classes, currentDate);
    }

    container.innerHTML = topNav + content;
    bindEvents(container, classes, rentalReservations);
    if (viewMode === 'day') initDragAndDrop(container, classes);
  }

  // ======== DAY VIEW ========
  function renderDayView(classes, dateStr, rentalReservations = []) {
    const dayClasses = classes.filter(c => c.date === dateStr);
    const hasClasses = dayClasses.length > 0;
    const hasRentals = rentalReservations.length > 0;

    if (!hasClasses && !hasRentals) {
      return `
        <div class="cal-day-content">
          <div class="cal-empty-day">
            <p>No hay sesiones ni alquileres programados para este día</p>
          </div>
        </div>`;
    }

    const classCards = dayClasses.map(c => renderSessionCard(c)).join('');
    const rentalCards = groupRentals(rentalReservations).map(g => renderRentalCard(g)).join('');

    return `
      <div class="cal-day-content">
        ${classCards}
        ${hasRentals ? `
          <div class="cal-rentals-section">
            <div class="cal-rentals-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              <span>Alquileres de material (${rentalReservations.length})</span>
            </div>
            ${rentalCards}
          </div>` : ''}
      </div>`;
  }

  // ======== WEEK VIEW ========
  function renderWeekView(classes, baseDate) {
    const weekDates = getWeekDates(baseDate);
    const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const todayStr = getDateStr(new Date());

    let html = '<div class="cal-week-grid">';
    weekDates.forEach((d, i) => {
      const ds = getDateStr(d);
      const dayClasses = classes.filter(c => c.date === ds);
      const isToday = ds === todayStr;

      html += `
        <div class="cal-week-day ${isToday ? 'is-today' : ''}" data-date="${ds}">
          <div class="cal-week-day-header">
            <span class="cal-week-day-name">${dayNames[i]}</span>
            <span class="cal-week-day-num">${d.getDate()}</span>
          </div>
          <div class="cal-week-day-body">
            ${dayClasses.map(c => `
              <div class="cal-week-slot" data-id="${c.id}" style="border-left-color: ${TYPE_COLORS[c.type] || '#0f2f39'}">
                <span class="cal-week-slot-time">${c.time_start?.slice(0, 5)}</span>
                <span class="cal-week-slot-title">${TYPE_LABELS[c.type] || c.title}</span>
                <span class="cal-week-slot-cap">${c.enrolled_count || 0}/${c.max_students}</span>
              </div>
            `).join('')}
          </div>
        </div>`;
    });
    html += '</div>';
    return html;
  }

  // ======== SESSION CARD ========
  function renderSessionCard(c) {
    const color = TYPE_COLORS[c.type] || '#0f2f39';
    const label = TYPE_LABELS[c.type] || c.title;
    const timeStart = c.time_start?.slice(0, 5) || '--:--';
    const timeEnd = c.time_end?.slice(0, 5) || '--:--';
    const allEnrollments = enrollmentsCache[c.id] || [];
    // Las inscripciones canceladas no se muestran ni cuentan en el calendario
    const enrollments = allEnrollments.filter(e => e.status !== 'cancelled');
    const hasCachedEnrollments = c.id in enrollmentsCache;
    const enrolled = hasCachedEnrollments ? enrollments.length : (c.enrolled_count || 0);
    const max = c.max_students || 0;

    // Build enrolled clients list
    const buildRowHtml = (e) => {
      const name = e.guest_name || e.family_members?.full_name || e.profiles?.full_name || 'Sin nombre';
      const birthDate = e.family_members?.birth_date || e.profiles?.birth_date || null;
      let ageLabel = '';
      if (birthDate) {
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        ageLabel = ` (${age})`;
      }
      let bonoLabel = '';
      if (e.bono && (e.bono.status === 'active' || e.bono.status === 'exhausted')) {
        // nº de crédito que gasta ESTA clase (ordinal por fecha), no el used global
        const credNo = creditOrdinals[e.id] || e.bono.used_credits;
        bonoLabel = `${credNo}/${e.bono.total_credits}`;
      }
      // Pago: si la inscripción va con bono, el color sale del estado de pago
      // del BONO (todas sus clases comparten el mismo pago). Si es suelta, del
      // status de la inscripción.
      let isPaid, isPartial;
      if (e.bono) {
        // Estado de pago del bono desde el dominio (misma regla que el resto de paneles)
        const fullyPaid = bonoFullyPaid(e.bono);
        isPaid = fullyPaid;
        isPartial = !fullyPaid && Number(e.bono.total_paid || 0) > 0;
      } else {
        isPaid = e.status === 'paid';
        isPartial = e.status === 'partial';
      }
      const isAttended = e.attendance === true;
      const isNoShow = e.attendance === false;
      const payClass = isPaid ? 'paid' : isPartial ? 'partial' : 'unpaid';
      const attendClass = isAttended ? 'attended' : isNoShow ? 'noshow' : '';
      const statusClass = `${payClass} ${attendClass}`.trim();

      return `
        <div class="cal-client-row ${statusClass}" draggable="true" data-enrollment-id="${e.id}" data-class-id="${c.id}" data-client-name="${name}" data-item-type="enrollment" data-move-mode="single">
          <div class="cal-client-drag">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
          </div>
          <label class="cal-client-attendance" title="${isAttended ? 'Asistió' : isNoShow ? 'No se presentó' : 'Marcar asistencia'}">
            <input type="checkbox" class="cal-attendance-check" data-eid="${e.id}" data-type="enrollment" ${isAttended ? 'checked' : ''} />
            <span class="cal-attendance-icon"></span>
          </label>
          <span class="cal-client-name">${name}${ageLabel}</span>
          ${e.wetsuit_size ? `<span class="cal-client-talla" style="background:#eef2ff;color:#4338ca;font-size:.6rem;font-weight:700;padding:1px 6px;border-radius:999px;white-space:nowrap" title="Talla de neopreno">${escapeHtml(String(e.wetsuit_size))}</span>` : ''}
          ${bonoLabel ? `<span class="cal-client-bono" style="color:#1a1a1a;font-size:.65rem;font-weight:600;white-space:nowrap">${bonoLabel}</span>` : ''}
          <span class="cal-client-pay-icon" title="${isPaid ? 'Pagado' : isPartial ? 'Anticipo pagado' : 'Pendiente de pago'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isPaid ? '#16a34a' : isPartial ? '#d97706' : '#dc2626'}" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          </span>
          ${e.bono ? `<button class="cal-pending-btn" data-eid="${e.id}" data-client-name="${name}" data-attended="${isAttended}" title="Dejar pendiente · libera el crédito del bono para usarlo otro día">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a16207" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </button>` : ''}
          ${e.bono ? `<button class="cal-remove-bono-btn" data-eid="${e.id}" data-bono-id="${e.bono_id || ''}" data-client-name="${name}" title="Quitar esta clase del bono (baja el total y recalcula el precio)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
          <span class="cal-client-move-btns">
            <button class="cal-move-btn" data-eid="${e.id}" data-class-id="${c.id}" title="Mover a otro día">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg>
            </button>
          </span>
        </div>`;
    };

    // Agrupar inscripciones por titular (user_id): los miembros de una misma familia
    // van juntos en un subgrupo. Se mantiene el orden de aparición. Titular solo = fila normal.
    const famGroups = new Map();
    enrollments.forEach(e => {
      const key = e.user_id || `solo:${e.id}`;
      if (!famGroups.has(key)) famGroups.set(key, []);
      famGroups.get(key).push(e);
    });
    const famGripSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>';
    let clientsHtml = '';
    for (const [, list] of famGroups) {
      if (list.length <= 1) { clientsHtml += buildRowHtml(list[0]); continue; }
      const titular = list[0].profiles?.full_name || list[0].guest_name || 'Familia';
      clientsHtml += `
        <div class="cal-family-group" data-user-id="${list[0].user_id}">
          <div class="cal-family-header" draggable="true" data-move-mode="group" data-user-id="${list[0].user_id}" data-class-id="${c.id}" data-client-name="${titular}" data-item-type="enrollment" title="Arrastra para mover a toda la familia">
            <span class="cal-family-drag">${famGripSvg}</span>
            <span class="cal-family-title">${titular} · ${list.length}</span>
          </div>
          <div class="cal-family-rows">${list.map(buildRowHtml).join('')}</div>
        </div>`;
    }

    return `
      <div class="cal-session-card" data-id="${c.id}" data-type="${c.type}">
        <div class="cal-session-header" style="background: ${color}">
          <div class="cal-session-header-left">
            <span class="cal-session-time">${timeStart} - ${timeEnd}</span>
            <span class="cal-session-title">${label}</span>
          </div>
          <div class="cal-session-header-right">
            <span class="cal-session-cap-label">Capacidad</span>
            <span class="cal-session-cap">${enrolled} / ${max}
              <button class="cal-session-visibility" data-id="${c.id}" title="${c.published ? 'Publicada' : 'No publicada'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${c.published
                    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
                    : '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
                  }
                </svg>
              </button>
            </span>
          </div>
        </div>
        <div class="cal-session-notes-row${c.notes ? ' has-note' : ''}" data-id="${c.id}" title="${c.notes ? 'Editar nota' : 'Añadir nota'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/></svg>
          <span class="cal-session-notes-text">${c.notes ? escapeHtml(c.notes) : 'Añadir notas de sesión'}</span>
        </div>
        <div class="cal-clients-list" data-class-id="${c.id}">
          ${clientsHtml}
        </div>
        <div class="cal-card-footer">
          <button class="cal-add-client-btn book-session-btn" data-id="${c.id}" title="Añadir cliente">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <div class="cal-card-footer-actions">
            <button class="cal-session-action-btn edit-session-btn" data-id="${c.id}" title="Editar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="cal-session-action-btn delete-session-btn danger" data-id="${c.id}" title="Eliminar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  // ======== RENTAL CARD ========
  const RENTAL_STATUS_LABELS = { pending: 'Pendiente', confirmed: 'Confirmada', active: 'Activa', returned: 'Devuelto', cancelled: 'Cancelada' };
  const RENTAL_STATUS_COLORS = { pending: '#f59e0b', confirmed: '#1a1a1a', active: '#22c55e', returned: '#64748b', cancelled: '#ef4444' };
  const DURATION_KEY_LABELS = { '1h': '1 hora', '2h': '2 horas', '4h': '4 horas', '1d': '1 día', '1w': '1 semana', '2w': '2 semanas', '1m': '1 mes' };

  // Agrupa las reservas de material por group_id (alquiler multi-material de un cliente).
  // Las que no tienen group_id quedan como grupos de 1 → se renderizan igual que siempre.
  function groupRentals(list) {
    const groups = [];
    const byGid = {};
    for (const r of list) {
      if (r.group_id) {
        if (!byGid[r.group_id]) { byGid[r.group_id] = []; groups.push(byGid[r.group_id]); }
        byGid[r.group_id].push(r);
      } else {
        groups.push([r]);
      }
    }
    return groups;
  }

  function renderRentalCard(group) {
    const rentals = Array.isArray(group) ? group : [group];
    return rentals.length > 1 ? renderGroupedRentalCard(rentals) : renderSingleRentalCard(rentals[0]);
  }

  // Estado de pago/devolución de una reserva de material (compartido por tarjeta y fila).
  function rentalRowState(r) {
    const isAttended = (r.status || 'pending') === 'returned';
    const amount = Number(r.total_amount || 0);
    const depositPaid = Number(r.deposit_paid || 0);
    const isPaid = amount > 0 ? depositPaid >= amount : depositPaid > 0;
    const isPartial = !isPaid && depositPaid > 0;
    const statusClass = `${isPaid ? 'paid' : isPartial ? 'partial' : 'unpaid'} ${isAttended ? 'attended' : ''}`.trim();
    return { isAttended, amount, isPaid, isPartial, statusClass };
  }

  // Fila de UN material (drag + devuelto + nombre + talla + precio + pago). La usan tanto
  // la tarjeta de un material (nombre = cliente) como la agrupada (nombre = material).
  // `nameHtml` ya viene escapado/compuesto por el llamador.
  function renderRentalRow(r, nameHtml) {
    const { isAttended, amount, isPaid, isPartial, statusClass } = rentalRowState(r);
    return `
      <div class="cal-client-row ${statusClass}" draggable="true" data-rental-id="${r.id}" data-client-name="${escapeHtml(r.guest_name || r.profiles?.full_name || 'Sin nombre')}" data-item-type="rental" data-total-amount="${amount}">
        <div class="cal-client-drag">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
        </div>
        <label class="cal-client-attendance" title="${isAttended ? 'Devuelto' : 'Marcar devuelto'}">
          <input type="checkbox" class="cal-attendance-check" data-rid="${r.id}" data-type="rental" ${isAttended ? 'checked' : ''} />
          <span class="cal-attendance-icon"></span>
        </label>
        <span class="cal-client-name">${nameHtml}</span>
        ${r.size ? `<span class="cal-client-badge blue">Talla: ${escapeHtml(String(r.size))}</span>` : ''}
        <span class="cal-client-price">${amount.toFixed(2)}€</span>
        <span class="cal-client-pay-icon" title="${isPaid ? 'Pagado' : isPartial ? 'Anticipo pagado' : 'Pendiente de pago'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </span>
      </div>`;
  }

  // Envoltura común de la tarjeta de alquiler: cabecera azul (izq/der libres) + filas.
  function rentalCardShell(anchorId, headerLeftHtml, headerRightHtml, rowsHtml) {
    return `
      <div class="cal-session-card cal-rental-card" data-rental-id="${anchorId}">
        <div class="cal-session-header" style="background:#1a1a1a;cursor:pointer">
          <div class="cal-session-header-left">${headerLeftHtml}</div>
          <div class="cal-session-header-right">${headerRightHtml}</div>
        </div>
        <div class="cal-clients-list">${rowsHtml}</div>
      </div>`;
  }

  // Tarjeta de un alquiler con VARIOS materiales (mismo cliente): cabecera = cliente,
  // una fila por material. Cada fila abre/arrastra su propia reserva (data-rental-id).
  function renderGroupedRentalCard(rentals) {
    const first = rentals[0];
    const clientName = first.guest_name || first.profiles?.full_name || 'Sin nombre';
    const total = rentals.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const dates = `${first.time_start ? first.time_start.slice(0, 5) + ' · ' : ''}${first.date_start} → ${first.date_end}`;
    const rows = rentals.map(r => {
      const durLbl = DURATION_KEY_LABELS[r.duration_key] || r.duration_key || '';
      const nameHtml = `${escapeHtml(r.rental_equipment?.name || 'Material')}${durLbl ? ` <span style="color:#94a3b8;font-weight:400">· ${durLbl}</span>` : ''}`;
      return renderRentalRow(r, nameHtml);
    }).join('');
    const left = `<span class="cal-session-time">${dates}</span><span class="cal-session-title">${escapeHtml(clientName)}</span>`;
    const right = `<span class="cal-session-cap-label">${rentals.length} materiales</span><span class="cal-session-cap"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;background:#1a1a1a;color:#fff">${total.toFixed(2)}€</span></span>`;
    return rentalCardShell(first.id, left, right, rows);
  }

  function renderSingleRentalCard(r) {
    const equipName = r.rental_equipment?.name || 'Material';
    const status = r.status || 'pending';
    const statusLabel = RENTAL_STATUS_LABELS[status] || status;
    const statusColor = RENTAL_STATUS_COLORS[status] || '#64748b';
    const durationLabel = DURATION_KEY_LABELS[r.duration_key] || r.duration_key || '';
    const left = `<span class="cal-session-time">${r.time_start ? r.time_start.slice(0, 5) + ' · ' : ''}${r.date_start} → ${r.date_end}</span><span class="cal-session-title">${escapeHtml(equipName)}</span>`;
    const right = `<span class="cal-session-cap-label">${durationLabel}</span><span class="cal-session-cap"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;background:${statusColor};color:#fff">${statusLabel}</span></span>`;
    return rentalCardShell(r.id, left, right, renderRentalRow(r, escapeHtml(r.guest_name || r.profiles?.full_name || 'Sin nombre')));
  }

  // ======== DRAG AND DROP ========
  // Modal para mover una reserva conjunta: todos de golpe o seleccionar individualmente
  function openMoveGroupModal(group, draggedId, doMove) {
    document.getElementById('move-group-overlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'move-group-overlay';
    ov.className = 'bk-overlay';
    ov.style.zIndex = '10001';
    ov.innerHTML = `
      <div style="max-width:420px;width:92%;background:#fff;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <h3 style="margin:0 0 6px;font-size:1.1rem">Reserva conjunta</h3>
        <p style="margin:0 0 14px;font-size:.9rem;color:#64748b">Esta reserva tiene varias personas de la misma cuenta. ¿A quién quieres mover?</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px">
          ${group.map(en => `
            <label style="display:flex;align-items:center;gap:10px;font-size:.92rem;cursor:pointer">
              <input type="checkbox" class="mg-cb" value="${en.id}" ${en.id === draggedId ? 'checked' : ''}>
              <span>${escapeHtml(en.guest_name || en.profiles?.full_name || 'Sin nombre')}</span>
            </label>`).join('')}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn line" id="mg-cancel">Cancelar</button>
          <button class="btn line" id="mg-selected">Mover seleccionados</button>
          <button class="btn red" id="mg-all">Mover todos (${group.length})</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#mg-cancel').addEventListener('click', close);
    ov.querySelector('#mg-all').addEventListener('click', () => { close(); doMove(group.map(en => en.id)); });
    ov.querySelector('#mg-selected').addEventListener('click', () => {
      const ids = [...ov.querySelectorAll('.mg-cb:checked')].map(cb => cb.value);
      if (!ids.length) { showToast('Selecciona al menos una persona', 'error'); return; }
      close(); doMove(ids);
    });
  }

  // Mueve una inscripción detectando si es reserva conjunta (misma cuenta en la
  // misma clase). Si lo es, pregunta mover todos o seleccionar. Usado por el
  // arrastre, el icono de la tarjeta y la ficha de reserva.
  async function moveEnrollmentWithGroup({ fromClassId, srcEid, srcName, toClassId, toEnrolled, toMax, onDone }) {
    let srcList = enrollmentsCache[fromClassId];
    if (!srcList) { try { srcList = await fetchClassEnrollments(fromClassId); } catch { srcList = []; } }
    const dragged = (srcList || []).find(en => en.id === srcEid);
    const group = (dragged && dragged.user_id)
      ? srcList.filter(en => en.user_id === dragged.user_id)
      : (dragged ? [dragged] : []);

    const doMove = async (ids) => {
      const free = (Number(toMax) || 0) - (Number(toEnrolled) || 0);
      if (Number(toMax) && ids.length > Math.max(0, free)) {
        showToast(`La sesión destino solo tiene ${Math.max(0, free)} hueco(s)`, 'error');
        return;
      }
      try {
        for (const id of ids) await moveEnrollment(id, toClassId);
        showToast(ids.length > 1 ? `${ids.length} personas movidas` : `${srcName || 'Alumno'} movido correctamente`, 'success');
        onDone && onDone();
      } catch (err) {
        showToast('Error al mover: ' + err.message, 'error');
      }
    };

    if (group.length > 1) openMoveGroupModal(group, srcEid, doMove);
    else doMove([srcEid]);
  }

  // Mueve un conjunto concreto de inscripciones a otra clase, SIN modal. Lo usa el drag:
  // arrastrar una fila = [esa]; arrastrar la cabecera de familia = todas las del titular.
  async function moveEnrollmentsDirect({ fromClassId, eids, toClassId, toEnrolled, toMax, label, onDone }) {
    const free = (Number(toMax) || 0) - (Number(toEnrolled) || 0);
    if (Number(toMax) && eids.length > Math.max(0, free)) {
      showToast(`La sesión destino solo tiene ${Math.max(0, free)} hueco(s)`, 'error');
      return;
    }
    try {
      for (const id of eids) await moveEnrollment(id, toClassId);
      showToast(eids.length > 1 ? `${eids.length} personas movidas` : `${label || 'Alumno'} movido`, 'success');
      onDone && onDone();
    } catch (err) {
      showToast('Error al mover: ' + err.message, 'error');
    }
  }

  // Crear bono para un cliente desde el calendario (mismo flujo que el CRM:
  // precio total editable + "cobrar ahora" con 0 = todo pendiente).
  function openCreateBonoModalCal(userId, defaultType, onDone) {
    const TYPES = Object.keys(TYPE_LABELS);
    const type0 = TYPES.includes(defaultType) ? defaultType : 'grupal';
    const credits0 = 4;
    const price0 = getPackPrice(type0, credits0, 0);
    const exp = new Date(); exp.setMonth(exp.getMonth() + 12);
    const closeSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const modal = document.createElement('div');
    modal.className = 'bk-overlay'; modal.style.zIndex = '10001';
    modal.innerHTML = `
      <div class="bk-panel" style="max-width:460px;margin:auto;border-radius:16px;overflow:hidden">
        <div class="bk-panel-header" style="background:var(--color-navy,#0f2f39);padding:16px 22px">
          <div class="bk-header-left" style="display:flex;align-items:center;gap:12px">
            <button class="bk-close-btn cb-close">${closeSvg}</button>
            <span class="bk-header-title" style="font-size:1.1rem">Crear bono</span>
          </div>
        </div>
        <div style="padding:24px">
          <form class="cb-form trip-form" style="gap:12px">
            <label>Tipo de clase</label>
            <select class="cb-type act-form-input" required>${TYPES.map(t => `<option value="${t}" ${t === type0 ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}</select>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label>Nº de clases</label><input type="number" class="cb-credits act-form-input" min="1" step="1" value="${credits0}" required></div>
              <div><label>Caduca</label><input type="date" class="cb-expires act-form-input" value="${exp.toISOString().slice(0, 10)}" required></div>
            </div>
            <label>Precio total del bono (€)</label>
            <input type="number" class="cb-total act-form-input" step="0.01" min="0" value="${price0.toFixed(2)}" required>
            <small style="color:#94a3b8">Sugerido por catálogo; bájalo para aplicar descuento.</small>
            <label>Cobrar ahora (€)</label>
            <input type="number" class="cb-amount act-form-input" step="0.01" min="0" value="${price0.toFixed(2)}">
            <small style="color:#94a3b8"><strong>0 = dejar todo pendiente</strong> · menos que el total = anticipo.</small>
            <label>Método de pago</label>
            <select class="cb-method act-form-input">
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
              <option value="voucher">Voucher</option>
              <option value="saldo">Saldo a favor</option>
            </select>
            <button type="submit" class="bk-final-confirm-btn cb-submit" style="margin-top:6px">Crear bono</button>
          </form>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.cb-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    const typeSel = modal.querySelector('.cb-type'), credEl = modal.querySelector('.cb-credits');
    const totalEl = modal.querySelector('.cb-total'), amtEl = modal.querySelector('.cb-amount');
    let tTouched = false, aTouched = false;
    totalEl.addEventListener('input', () => { tTouched = true; });
    amtEl.addEventListener('input', () => { aTouched = true; });
    const recalc = () => {
      const c = parseInt(credEl.value) || 0;
      if (c > 0) { const s = getPackPrice(typeSel.value, c, 0).toFixed(2); if (!tTouched) totalEl.value = s; if (!aTouched) amtEl.value = s; }
    };
    typeSel.addEventListener('change', recalc);
    credEl.addEventListener('input', recalc);

    modal.querySelector('.cb-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const classType = typeSel.value;
      const credits = parseInt(credEl.value) || 0;
      const total = parseFloat(totalEl.value) || 0;
      const amount = Math.min(Math.max(0, parseFloat(amtEl.value) || 0), total);
      const method = modal.querySelector('.cb-method').value;
      const expiresAtStr = modal.querySelector('.cb-expires').value;
      if (credits <= 0) { showToast('El bono debe tener al menos 1 clase', 'error'); return; }
      if (!expiresAtStr) { showToast('Indica la caducidad', 'error'); return; }
      if (amount > 0 && !method) { showToast('Elige un método de pago', 'error'); return; }
      const btn = modal.querySelector('.cb-submit'); btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const bonoId = await createBono({
          user_id: userId, class_type: classType, total_credits: credits,
          custom_total: total, total_paid: 0,
          expires_at: new Date(expiresAtStr + 'T23:59:59').toISOString(),
        });
        if (amount > 0 && bonoId) {
          await createPayment({ reservation_type: 'bono', reference_id: bonoId, amount, payment_method: method, concept: `Nuevo bono ${TYPE_LABELS[classType] || classType} (${credits} clases)` });
          await recalcBonoPaid(bonoId);
        }
        const pend = Math.max(0, Math.round((total - amount) * 100) / 100);
        close();
        showToast(`Bono creado · cobrado ${amount.toFixed(2)}€${pend > 0 ? ` · pendiente ${pend.toFixed(2)}€` : ' · pagado'}`, 'success');
        onDone && onDone();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Crear bono';
        showToast('Error: ' + (err.message || err), 'error');
      }
    });
  }

  function initDragAndDrop(container, classes) {
    const clientRows = container.querySelectorAll('.cal-client-row[draggable], .cal-family-header[draggable]');
    const dropZones = container.querySelectorAll('.cal-clients-list');

    clientRows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const dragData = {
          itemType: row.dataset.itemType, // 'enrollment' or 'rental'
          enrollmentId: row.dataset.enrollmentId || null,
          rentalId: row.dataset.rentalId || null,
          fromClassId: row.dataset.classId || null,
          clientName: row.dataset.clientName,
          moveMode: row.dataset.moveMode || 'single', // 'single' (una fila) | 'group' (familia)
          userId: row.dataset.userId || null,
        };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        row.classList.add('dragging');
        // Highlight valid drop zones (class lists only, not same source)
        dropZones.forEach(zone => {
          if (zone.dataset.classId && zone.dataset.classId !== row.dataset.classId) {
            zone.classList.add('drop-target');
          }
        });
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        dropZones.forEach(zone => zone.classList.remove('drop-target', 'drop-hover'));
        container.querySelector('.cal-day-content')?.classList.remove('drop-outside-active');
      });
    });

    dropZones.forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drop-hover');
      });

      zone.addEventListener('dragleave', () => {
        zone.classList.remove('drop-hover');
      });

      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.classList.remove('drop-hover', 'drop-target');

        let data;
        try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }

        const toClassId = zone.dataset.classId;

        // Only enrollments can be moved between classes
        if (data.itemType === 'enrollment' && toClassId) {
          if (toClassId === data.fromClassId) return;
          const toClass = classes.find(c => c.id === toClassId);
          // El aforo del destino solo cuenta inscripciones no canceladas (como el picker)
          const toEnrollments = (enrollmentsCache[toClassId] || []).filter(e => e.status !== 'cancelled');
          // Qué se mueve: cabecera de familia → toda la familia (mismo user_id); fila → solo esa.
          let eids;
          if (data.moveMode === 'group' && data.userId) {
            let srcList = enrollmentsCache[data.fromClassId];
            if (!srcList) { try { srcList = await fetchClassEnrollments(data.fromClassId); } catch { srcList = []; } }
            eids = (srcList || []).filter(en => en.user_id === data.userId && en.status !== 'cancelled').map(en => en.id);
          } else {
            if (!data.enrollmentId) return;
            eids = [data.enrollmentId];
          }
          if (!eids.length) return;
          await moveEnrollmentsDirect({
            fromClassId: data.fromClassId,
            eids,
            toClassId,
            toEnrolled: toEnrollments.length,
            toMax: toClass?.max_students || 0,
            label: data.clientName,
            onDone: () => { delete enrollmentsCache[data.fromClassId]; delete enrollmentsCache[toClassId]; render(); },
          });
        }
        // If dragging a rental into a class drop zone — ignore (can't mix)
      });
    });

    // Drop outside any zone → delete the item
    const dayContent = container.querySelector('.cal-day-content');
    if (dayContent) {
      dayContent.addEventListener('dragover', (e) => {
        // Only show delete hint if not over a drop zone
        if (!e.target.closest('.cal-clients-list')) {
          e.preventDefault();
          dayContent.classList.add('drop-outside-active');
        }
      });
      dayContent.addEventListener('dragleave', (e) => {
        if (!dayContent.contains(e.relatedTarget)) {
          dayContent.classList.remove('drop-outside-active');
        }
      });
      dayContent.addEventListener('drop', async (e) => {
        dayContent.classList.remove('drop-outside-active');
        if (e.target.closest('.cal-clients-list')) return; // handled above
        e.preventDefault();
        let data;
        try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }

        if (data.itemType === 'rental' && data.rentalId) {
          if (!confirm(`¿Eliminar la reserva de alquiler de ${data.clientName}?`)) return;
          try {
            await updateEquipmentReservationStatus(data.rentalId, 'cancelled');
            showToast(`Alquiler de ${data.clientName} cancelado`, 'success');
            render();
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        } else if (data.itemType === 'enrollment' && data.enrollmentId) {
          if (!confirm(`¿Eliminar la inscripción de ${data.clientName}?`)) return;
          try {
            await deleteEnrollment(data.enrollmentId);
            // Borra pagos de clase suelta (type 'enrollment') para no dejar huérfanos
            // que sigan sumando en estadísticas. Los de bono viven en el bono.
            for (const p of await fetchPayments('enrollment', data.enrollmentId)) { await deletePayment(p.id); }
            showToast(`${data.clientName} eliminado de la sesión`, 'success');
            render();
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        }
      });
    }
  }

  // ======== EVENTS ========
  function bindEvents(container, classes, rentalReservations = []) {
    container.querySelector('#cal-prev')?.addEventListener('click', () => {
      currentDate.setDate(currentDate.getDate() + (viewMode === 'day' ? -1 : -7));
      render();
    });
    container.querySelector('#cal-next')?.addEventListener('click', () => {
      currentDate.setDate(currentDate.getDate() + (viewMode === 'day' ? 1 : 7));
      render();
    });
    container.querySelector('#cal-today')?.addEventListener('click', () => {
      currentDate = new Date(); currentDate.setHours(0, 0, 0, 0); render();
    });
    container.querySelector('#cal-date')?.addEventListener('change', (e) => {
      const v = e.target.value; if (!v) return;
      const [y, m, d] = v.split('-').map(Number);
      currentDate = new Date(y, m - 1, d); currentDate.setHours(0, 0, 0, 0);
      render();
    });

    container.querySelectorAll('.cal-view-btn').forEach(btn => {
      btn.addEventListener('click', () => { viewMode = btn.dataset.view; render(); });
    });

    // Dropdown "+" del topbar — Nueva reserva / Nueva clase
    const addTrigger = container.querySelector('#cal-add-trigger');
    const addMenu = container.querySelector('#cal-add-menu');
    const addWrap = container.querySelector('#cal-add-wrap');
    if (addTrigger && addMenu) {
      const closeMenu = () => {
        addMenu.hidden = true;
        addWrap?.classList.remove('open');
        document.removeEventListener('click', onDocClick);
      };
      const onDocClick = (e) => {
        if (!addWrap?.contains(e.target)) closeMenu();
      };
      addTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = addMenu.hidden;
        addMenu.hidden = !willOpen;
        addWrap?.classList.toggle('open', willOpen);
        if (willOpen) setTimeout(() => document.addEventListener('click', onDocClick), 0);
        else document.removeEventListener('click', onDocClick);
      });
      container.querySelector('#cal-menu-new-booking')?.addEventListener('click', () => {
        closeMenu();
        openBookingWizard();
      });
      container.querySelector('#cal-menu-new-session')?.addEventListener('click', () => {
        closeMenu();
        openNewSessionModal();
      });
      container.querySelector('#cal-menu-bulk-edit')?.addEventListener('click', () => {
        closeMenu();
        openBulkEditClasses();
      });
      container.querySelector('#cal-menu-bulk-delete')?.addEventListener('click', () => {
        closeMenu();
        openBulkDeleteClasses();
      });
    }

    // Click on session header → show enrollments
    container.querySelectorAll('.cal-session-header').forEach(header => {
      const card = header.closest('.cal-session-card');
      const id = card?.dataset.id;
      header.addEventListener('click', async (e) => {
        if (e.target.closest('.cal-session-visibility')) return;
        if (!id) return;
        const cls = classes.find(c => c.id === id);
        if (cls) await showEnrollments(cls);
      });
    });

    // Session notes row → open editor
    container.querySelectorAll('.cal-session-notes-row').forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = row.dataset.id;
        const cls = classes.find(c => c.id === id);
        if (cls) openSessionNotesEditor(cls);
      });
    });

    // Visibility toggle → publish/unpublish class
    container.querySelectorAll('.cal-session-visibility').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const cls = classes.find(c => c.id === id);
        if (!cls) return;
        try {
          await supabase.from('surf_classes').update({ published: !cls.published }).eq('id', cls.id).then(({ error }) => { if (error) throw error; });
          showToast(cls.published ? 'Clase ocultada' : 'Clase publicada', 'success');
          render();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    // Client row pay icon click → toggle payment status (enrollment or rental)
    container.querySelectorAll('.cal-client-pay-icon').forEach(icon => {
      icon.style.cursor = 'pointer';
      icon.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = icon.closest('.cal-client-row');
        if (!row) return;
        const itemType = row.dataset.itemType;
        const isPaid = row.classList.contains('paid');

        if (itemType === 'enrollment') {
          const eid = row.dataset.enrollmentId;
          const classId = row.dataset.classId;
          const cls = classes.find(c => c.id === classId);
          const enrollment = (enrollmentsCache[classId] || []).find(en => en.id === eid);
          if (!cls || !enrollment) return;
          // Si la inscripción va con bono → ficha de bono ÚNICA (misma que clientes/reserva-clases)
          if (enrollment.bono_id) { openBonoFicha(enrollment.bono_id, { onChange: render }); return; }
          openEnrollmentPayModal(cls, enrollment);
        } else if (itemType === 'rental') {
          const rid = row.dataset.rentalId;
          const reservation = rentalReservations.find(r => r.id === rid);
          const rTotal = Number(reservation?.total_amount || 0);
          const rDeposit = Number(reservation?.deposit_paid || 0);
          const rentalIsPaid = rTotal > 0 ? rDeposit >= rTotal : rDeposit > 0;
          try {
            if (rentalIsPaid) {
              // Borra los pagos y recalcula deposit_paid = SUM (payments = verdad)
              const pays = await fetchPayments('rental', rid);
              for (const p of pays) { try { await deletePayment(p.id); } catch {} }
              await recalcPaidState('rental', rid);
              showToast('Marcado como pendiente', 'success');
            } else {
              // Cobra solo el RESTO (no el total de nuevo si ya había señal) y recalcula.
              const already = (await fetchPayments('rental', rid)).reduce((s, p) => s + Number(p.amount || 0), 0);
              const remainder = rTotal > 0 ? round2(rTotal - already) : 0;
              if (remainder > 0) {
                await createPayment({
                  amount: remainder,
                  payment_method: 'efectivo',
                  channel: 'in_person',
                  reservation_type: 'rental',
                  reference_id: rid,
                  concept: `Alquiler ${reservation?.rental_equipment?.name || reservation?.equipment_type || ''}`.trim(),
                });
              }
              await recalcPaidState('rental', rid);
              showToast('Marcado como pagado', 'success');
            }
            render();
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        }
      });
    });

    // Botón "dejar pendiente": libera el crédito del bono SIN canjearlo. Cancela la
    // inscripción (el trigger repone used_credits y la plaza), así el crédito queda
    // "pendiente de asignar" y el cliente lo puede usar otro día (figura en su ficha).
    container.querySelectorAll('.cal-pending-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const eid = btn.dataset.eid;
        const name = btn.dataset.clientName || 'esta persona';
        if (!eid) return;
        // Si ya está marcada como asistida, avisar de la incoherencia (devolver el
        // crédito de una clase a la que ya asistió).
        const msg = btn.dataset.attended === 'true'
          ? `${name} ya está marcada como ASISTIÓ a esta clase.\n\n¿Aun así dejarla pendiente y devolver el crédito del bono?`
          : `¿Dejar pendiente la clase de ${name}?\n\nEl crédito del bono no se gasta: queda pendiente de asignar para usarlo otro día.`;
        if (!confirm(msg)) return;
        try {
          const { error } = await supabase.from('class_enrollments')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', eid);
          if (error) throw error;
          showToast('Clase liberada · crédito pendiente de asignar', 'success');
          render();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    // "x": QUITAR esta clase del bono. A diferencia de "dejar pendiente" (que libera el
    // crédito para otro día), aquí la clase se PIERDE: baja total_credits en 1 y RECALCULA
    // el precio con las tarifas configuradas (quita el marginal de esa clase). Si el bono
    // queda pagado de más, la ficha del bono muestra el saldo a favor.
    container.querySelectorAll('.cal-remove-bono-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const eid = btn.dataset.eid;
        const bonoId = btn.dataset.bonoId || null;
        const name = btn.dataset.clientName || 'esta persona';
        if (!eid) return;
        let bono = null;
        if (bonoId) { try { const { data } = await supabase.from('bonos').select('*').eq('id', bonoId).maybeSingle(); bono = data; } catch {} }
        let msg = `¿Quitar la clase de ${name} del bono? La clase se pierde (el crédito no se devuelve).`;
        if (bono) {
          const oldTotal = bono.total_credits || 0;
          const newTotal = Math.max(0, oldTotal - 1);
          const newExpected = Math.max(0, round2(bonoExpected(bono) - (getPackPrice(bono.class_type, oldTotal) - getPackPrice(bono.class_type, newTotal))));
          msg = `¿Quitar esta clase del bono de ${name}?\n\nEl bono pasará de ${oldTotal} a ${newTotal} clase(s) y su precio a ${newExpected.toFixed(2)}€.\nLa clase se pierde (el crédito no se devuelve).`;
        }
        if (!confirm(msg)) return;
        try {
          await deleteEnrollment(eid);
          if (bonoId) {
            // Refetch: used_credits ya lo recalculó el trigger; total/custom siguen siendo los previos.
            let fresh = null;
            try { const { data } = await supabase.from('bonos').select('*').eq('id', bonoId).maybeSingle(); fresh = data; } catch {}
            if (fresh) {
              const oldTotal = fresh.total_credits || 0;
              const newTotal = Math.max(0, oldTotal - 1);
              const newExpected = Math.max(0, round2(bonoExpected(fresh) - (getPackPrice(fresh.class_type, oldTotal) - getPackPrice(fresh.class_type, newTotal))));
              const used = fresh.used_credits || 0;
              const status = (fresh.status === 'cancelled' || fresh.status === 'expired') ? fresh.status : (used >= newTotal ? 'exhausted' : 'active');
              await extendBono(bonoId, { newTotalCredits: newTotal, newCustomTotal: newExpected, status });
            }
          }
          showToast('Clase quitada del bono · precio recalculado', 'success');
          render();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    // Attendance checkbox → mark as completed/returned or revert
    container.querySelectorAll('.cal-attendance-check').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        e.stopPropagation();
        const checked = cb.checked;
        const itemType = cb.dataset.type;

        if (itemType === 'enrollment') {
          const eid = cb.dataset.eid;
          try {
            if (checked) {
              // Prevent marking attendance if class hasn't started
              const row = cb.closest('.cal-client-row');
              const classId = row?.dataset.classId;
              const cls = classes.find(c => c.id === classId);
              if (cls) {
                // Ventana de "pasar lista": desde 30 min antes de la clase en adelante
                // (durante y después ya está permitido; no hay límite superior).
                const classStart = new Date(`${cls.date}T${cls.time_start || '00:00'}`);
                const windowOpen = new Date(classStart.getTime() - 30 * 60 * 1000);
                if (new Date() < windowOpen) {
                  cb.checked = false;
                  showToast('Solo puedes pasar lista desde 30 min antes de la clase', 'error');
                  return;
                }
              }
              // Marcar asistencia: solo toca attendance, NO el estado de pago
              await updateEnrollmentAttendance(eid, true);
              showToast('Asistencia confirmada', 'success');
            } else {
              // Revertir asistencia: el color de pago no se toca
              await updateEnrollmentAttendance(eid, null);
              showToast('Asistencia revertida', 'success');
            }
            render();
          } catch (err) { showToast('Error: ' + err.message, 'error'); cb.checked = !checked; }
        } else if (itemType === 'rental') {
          const rid = cb.dataset.rid;
          // checked = returned (finalized), unchecked = active
          const newStatus = checked ? 'returned' : 'active';
          try {
            await updateEquipmentReservationStatus(rid, newStatus);
            showToast(checked ? 'Material devuelto — finalizado' : 'Marcado como activo', 'success');
            render();
          } catch (err) { showToast('Error: ' + err.message, 'error'); cb.checked = !checked; }
        }
      });
    });

    // Click on client row → open detail panel
    container.querySelectorAll('.cal-client-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.cal-client-pay-icon') || e.target.closest('.cal-client-attendance') || e.target.closest('.cal-client-drag') || e.target.closest('.cal-move-btn')) return;
        const itemType = row.dataset.itemType;
        const clientName = row.dataset.clientName;

        if (itemType === 'enrollment') {
          const eid = row.dataset.enrollmentId;
          const classId = row.dataset.classId;
          const cls = classes.find(c => c.id === classId);
          if (cls && eid) {
            (async () => {
              try {
                const classEnrollments = enrollmentsCache[classId] || [];
                const enrollment = classEnrollments.find(en => en.id === eid);
                // Inscripción con bono → ficha de bono ÚNICA (misma que clientes/reserva-clases)
                if (enrollment?.bono_id) { openBonoFicha(enrollment.bono_id, { onChange: render }); return; }
                const userId = enrollment?.user_id || null;
                let profile = null;
                if (userId) {
                  const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).single();
                  profile = p;
                }
                let familyMember = null;
                if (enrollment?.family_member_id) {
                  const { data: fm } = await supabase.from('family_members').select('*').eq('id', enrollment.family_member_id).single();
                  familyMember = fm;
                }
                // Hermanos / niños del tutor (para mostrar tutor + niños en la ficha)
                let siblings = [];
                if (userId) {
                  const { data: fams } = await supabase.from('family_members').select('*').eq('user_id', userId).order('created_at', { ascending: true });
                  siblings = fams || [];
                }
                // Histórico de pagos de la reserva: si va con bono, los pagos
                // están en el bono (web o playa); si es suelta, en la inscripción.
                const _bonoId = enrollment?.bono_id || null;
                const payments = _bonoId
                  ? [...(await fetchPayments('bono', _bonoId)), ...(await fetchPayments('enrollment', eid))]
                  : await fetchPayments('enrollment', eid);
                const isPaid = row.classList.contains('paid');

                // Check if enrollment is linked to a bono
                const linkedBonoId = enrollment?.bono_id || null;

                // Load bonos for this user
                const personCredits = {};
                let linkedBono = null;
                if (userId) {
                  const { data: bonos } = await supabase.from('bonos').select('*').eq('user_id', userId).eq('class_type', cls.type).in('status', ['active', 'exhausted']);
                  if (bonos?.length) {
                    const enrichedBonos = await Promise.all(bonos.map(async (b) => {
                      const bPayments = await fetchPayments('bono', b.id);
                      const totalPaidReal = bPayments.reduce((s, p) => s + Number(p.amount || 0), 0) || Number(b.total_paid || 0);
                      // Total del bono: el fijado a mano (descuento) si existe, si no el del catálogo
                      const expectedPrice = bonoExpected(b);
                      const pending = Math.max(0, Math.round((expectedPrice - totalPaidReal) * 100) / 100);
                      return { ...b, totalPaidReal, expectedPrice, pendingAmount: pending, isFullyPaid: pending <= 0 };
                    }));

                    // Solo se considera "en uso" el bono realmente enganchado a la
                    // inscripción (bono_id). Si no hay, la clase es suelta y el admin
                    // decide si gastarle un crédito (toggle en la tarjeta del bono).
                    linkedBono = linkedBonoId ? (enrichedBonos.find(b => b.id === linkedBonoId) || null) : null;
                    personCredits['p1'] = {
                      allBonos: enrichedBonos,
                      useCredit: !!linkedBono,
                      selectedBonoId: linkedBono?.id || null,
                      bono: linkedBono || null,
                    };
                  }
                }

                // If linked to a bono, the session cost is covered by the bono — pending is bono's pending
                // If not linked to a bono, pending is based on pack price minus payments
                // Clase suelta (drop-in): si la clase tiene precio propio, manda sobre el de la actividad
                const packPrice = Number(cls.price) > 0 ? Number(cls.price) : getPackPrice(cls.type, 1, 0);
                let totalFinal, pendingAmount;
                if (linkedBono) {
                  totalFinal = linkedBono.expectedPrice;
                  pendingAmount = linkedBono.pendingAmount;
                } else {
                  totalFinal = packPrice;
                  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
                  pendingAmount = Math.max(0, Math.round((packPrice - totalPaid) * 100) / 100);
                }

                const res = {
                  id: eid,
                  persons: [{ id: 'p1', nombre: clientName.split(' ')[0], apellidos: clientName.split(' ').slice(1).join(' '), profileId: userId, profileName: clientName, familyMemberId: enrollment?.family_member_id || null, sessions: [cls.id] }],
                  sessions: [{ id: cls.id, date: cls.date, time_start: cls.time_start, time_end: cls.time_end, type: cls.type, title: cls.title }],
                  contact: { nombre: clientName.split(' ')[0] || '', apellidos: clientName.split(' ').slice(1).join(' ') || '', email: profile?.email || '', telefono: profile?.phone || '', pais: '', idioma: '' },
                  profile: profile,
                  familyMember: familyMember,
                  siblings: siblings,
                  activityColor: TYPE_COLORS[cls.type] || '#0f2f39',
                  activityLabel: TYPE_LABELS[cls.type] || cls.title,
                  activityType: cls.type,
                  totalFinal: totalFinal,
                  pending: pendingAmount,
                  payments: payments,
                  personCredits: personCredits,
                  linkedBonoId: linkedBonoId,
                  bonoId: linkedBono?.id || null,
                  bonoCredits: linkedBono ? Number(linkedBono.total_credits) : null,
                  singlePrice: packPrice,
                  status: isPaid ? 'paid' : (pendingAmount <= 0 ? 'paid' : 'confirmed'),
                  createdAt: new Date(enrollment?.created_at || Date.now()),
                  discount: 0,
                  cobrarAnticipo: false,
                  anticipoAmount: 0,
                  paymentMethod: '',
                };

                // Remove any existing detail overlay to prevent stacking
                document.getElementById('rv-detail-overlay')?.remove();

                const overlay = document.createElement('div');
                overlay.className = 'bk-overlay bk-overlay-fullscreen';
                overlay.id = 'rv-detail-overlay';
                overlay.innerHTML = `<div class="bk-panel bk-panel-fullscreen"><div class="bk-panel-header"></div><div class="bk-panel-body"></div></div>`;
                document.body.appendChild(overlay);

                openReservationDetail(res, overlay);
              } catch (err) {
                console.error('Error opening enrollment detail:', err);
                showToast('Error al abrir detalle: ' + err.message, 'error');
              }
            })();
          }
        } else if (itemType === 'rental') {
          const rid = row.dataset.rentalId;
          const reservation = rentalReservations.find(r => r.id === rid);
          if (reservation) openRentalDetail(reservation);
        }
      });
    });

    // Move enrollment — open calendar picker (icono de la tarjeta)
    container.querySelectorAll('.cal-move-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const clientName = btn.closest('.cal-client-row')?.dataset.clientName || 'Alumno';
        openMovePicker(btn.dataset.eid, btn.dataset.classId, clientName);
      });
    });

    // Selector de calendario para mover una inscripción a otra clase del mismo tipo.
    // clsArg permite abrirlo desde la ficha (donde la clase puede no estar en la vista actual).
    async function openMovePicker(eid, classId, clientName, clsArg) {
        const cls = clsArg || classes.find(c => c.id === classId);
        if (!cls) return;
        document.getElementById('cal-move-picker')?.remove();
        const classType = cls.type;
        const typeLabel = TYPE_LABELS[classType] || cls.title;

        // State for the picker calendar
        let pickerDate = new Date(cls.date + 'T00:00:00');
        let pickerMonth = pickerDate.getMonth();
        let pickerYear = pickerDate.getFullYear();
        let availableClasses = []; // fetched classes for current month view

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'cal-move-picker';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:16px;padding:24px;min-width:360px;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.2)';
        overlay.appendChild(panel);

        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });

        async function loadMonth() {
          const firstDay = new Date(pickerYear, pickerMonth, 1);
          const lastDay = new Date(pickerYear, pickerMonth + 1, 0);
          const from = getDateStr(firstDay);
          const to = getDateStr(lastDay);
          availableClasses = await fetchClassesInRange(from, to);
        }

        function renderPicker() {
          const monthLabel = MONTH_NAMES[pickerMonth].replace('.', '') + ' ' + pickerYear;
          const firstDay = new Date(pickerYear, pickerMonth, 1);
          const lastDay = new Date(pickerYear, pickerMonth + 1, 0);
          const startWeekDay = (firstDay.getDay() + 6) % 7; // Monday = 0

          // Build map: dateStr → classes of same type
          const dateClassMap = {};
          availableClasses.filter(c => c.type === classType && c.id !== classId).forEach(c => {
            if (!dateClassMap[c.date]) dateClassMap[c.date] = [];
            dateClassMap[c.date].push(c);
          });

          const todayStr = getDateStr(new Date());
          const currentDateStr = cls.date;

          // Calendar grid
          let gridHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">';
          // Day headers
          ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(d => {
            gridHtml += `<div style="font-size:.7rem;font-weight:600;color:#94a3b8;padding:6px 0">${d}</div>`;
          });
          // Empty cells before first day
          for (let i = 0; i < startWeekDay; i++) {
            gridHtml += '<div></div>';
          }
          // Day cells
          for (let day = 1; day <= lastDay.getDate(); day++) {
            const ds = getDateStr(new Date(pickerYear, pickerMonth, day));
            const dayClasses = dateClassMap[ds] || [];
            const hasClasses = dayClasses.length > 0;
            const isToday = ds === todayStr;
            const isCurrent = ds === currentDateStr;
            const isPast = ds < todayStr;

            let cellStyle = 'padding:6px 2px;border-radius:8px;font-size:.8rem;cursor:default;position:relative;';
            let dotHtml = '';

            if (isCurrent) {
              cellStyle += 'background:#0f2f39;color:#fff;font-weight:700;';
            } else if (hasClasses && !isPast) {
              cellStyle += 'background:#e0f2fe;color:#1a1a1a;font-weight:600;cursor:pointer;';
              // Show capacity info
              const totalSpots = dayClasses.reduce((s, c) => s + (c.max_students || 0), 0);
              const enrolledCount = dayClasses.reduce((s, c) => s + (c.enrolled_count || 0), 0);
              const spotsLeft = totalSpots - enrolledCount;
              dotHtml = `<div style="font-size:.55rem;color:${spotsLeft > 0 ? '#16a34a' : '#dc2626'};line-height:1">${spotsLeft > 0 ? spotsLeft + ' plaza' + (spotsLeft !== 1 ? 's' : '') : 'Lleno'}</div>`;
            } else if (isToday) {
              cellStyle += 'border:2px solid #1a1a1a;font-weight:600;';
            } else if (isPast) {
              cellStyle += 'color:#cbd5e1;';
            } else {
              cellStyle += 'color:#64748b;';
            }

            const clickable = hasClasses && !isPast && !isCurrent;
            gridHtml += `<div class="move-picker-day" ${clickable ? `data-date="${ds}"` : ''} style="${cellStyle}">
              ${day}${dotHtml}
            </div>`;
          }
          gridHtml += '</div>';

          panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
              <h3 style="margin:0;font-size:.95rem;color:#0f2f39">Mover a <span style="color:#1a1a1a">${clientName}</span></h3>
              <button id="move-picker-close" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:1.2rem">✕</button>
            </div>
            <div style="font-size:.75rem;color:#64748b;margin-bottom:16px">
              Actual: <strong>${shortDateLabel(currentDateStr)}</strong> · ${typeLabel} ${cls.time_start?.slice(0,5)}–${cls.time_end?.slice(0,5)}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <button class="move-picker-nav" data-dir="prev" style="background:none;border:none;cursor:pointer;padding:4px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f2f39" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span style="font-size:.85rem;font-weight:700;color:#0f2f39;text-transform:capitalize">${monthLabel}</span>
              <button class="move-picker-nav" data-dir="next" style="background:none;border:none;cursor:pointer;padding:4px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0f2f39" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
              </button>
            </div>
            ${gridHtml}
            <div id="move-picker-classes" style="margin-top:16px"></div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              <span style="font-size:.6rem;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:3px;background:#0f2f39;display:inline-block"></span>Actual</span>
              <span style="font-size:.6rem;display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:3px;background:#e0f2fe;display:inline-block"></span>Disponible</span>
            </div>
          `;

          // Close button
          panel.querySelector('#move-picker-close').addEventListener('click', () => overlay.remove());

          // Month navigation
          panel.querySelectorAll('.move-picker-nav').forEach(navBtn => {
            navBtn.addEventListener('click', async () => {
              if (navBtn.dataset.dir === 'prev') {
                pickerMonth--;
                if (pickerMonth < 0) { pickerMonth = 11; pickerYear--; }
              } else {
                pickerMonth++;
                if (pickerMonth > 11) { pickerMonth = 0; pickerYear++; }
              }
              await loadMonth();
              renderPicker();
            });
          });

          // Click on available day → show classes for that day
          panel.querySelectorAll('.move-picker-day[data-date]').forEach(dayCell => {
            dayCell.addEventListener('click', () => {
              const ds = dayCell.dataset.date;
              const dayClasses = dateClassMap[ds] || [];
              const classesDiv = panel.querySelector('#move-picker-classes');

              // Highlight selected day
              panel.querySelectorAll('.move-picker-day').forEach(d => {
                if (d.dataset.date && d !== dayCell) d.style.outline = 'none';
              });
              dayCell.style.outline = '2px solid #1a1a1a';

              classesDiv.innerHTML = `
                <div style="font-size:.75rem;font-weight:600;color:#0f2f39;margin-bottom:8px">${shortDateLabel(ds)}</div>
                ${dayClasses.map(tc => {
                  const enrolled = tc.enrolled_count || 0;
                  const max = tc.max_students || 0;
                  const full = enrolled >= max;
                  return `
                    <div class="move-picker-class" data-target-id="${tc.id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;margin-bottom:6px;background:${full ? '#fef2f2' : '#f0f9ff'};cursor:${full ? 'not-allowed' : 'pointer'};border:1px solid ${full ? '#fecaca' : '#bae6fd'};transition:all .15s">
                      <div>
                        <div style="font-size:.8rem;font-weight:600;color:${full ? '#dc2626' : '#0f2f39'}">${tc.time_start?.slice(0,5)} – ${tc.time_end?.slice(0,5)}</div>
                        <div style="font-size:.7rem;color:#64748b">${TYPE_LABELS[tc.type] || tc.title}</div>
                      </div>
                      <div style="text-align:right">
                        <div style="font-size:.75rem;font-weight:600;color:${full ? '#dc2626' : '#16a34a'}">${enrolled}/${max}</div>
                        <div style="font-size:.6rem;color:#94a3b8">${full ? 'Llena' : 'Disponible'}</div>
                      </div>
                    </div>`;
                }).join('')}
              `;

              // Click on a class to move
              classesDiv.querySelectorAll('.move-picker-class').forEach(classCard => {
                classCard.addEventListener('click', async () => {
                  const targetId = classCard.dataset.targetId;
                  const targetCls = dayClasses.find(tc => tc.id === targetId);
                  if (!targetCls) return;
                  const enrolled = targetCls.enrolled_count || 0;
                  const max = targetCls.max_students || 0;
                  if (enrolled >= max) {
                    showToast('Esta clase está llena', 'error');
                    return;
                  }
                  overlay.remove();
                  await moveEnrollmentWithGroup({
                    fromClassId: classId,
                    srcEid: eid,
                    srcName: clientName,
                    toClassId: targetId,
                    toEnrolled: enrolled,
                    toMax: max,
                    onDone: () => { delete enrollmentsCache[classId]; delete enrollmentsCache[targetId]; render(); },
                  });
                });
              });
            });
          });
        }

        await loadMonth();
        document.body.appendChild(overlay);
        renderPicker();
    }
    // Expone el picker para reusarlo desde la ficha de reserva
    _openMovePicker = openMovePicker;
    window.__openBonoExtendAssist = openBonoExtendAssist;

    // Book session (manual reservation)
    container.querySelectorAll('.book-session-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cls = classes.find(c => c.id === btn.dataset.id);
        if (cls) openBookingPanel(cls);
      });
    });

    container.querySelectorAll('.edit-session-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cls = classes.find(c => c.id === btn.dataset.id);
        if (cls) openEditSessionModal(cls);
      });
    });

    container.querySelectorAll('.delete-session-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('¿Eliminar esta sesión? Se notificará por email a los inscritos.')) return;
        const classId = btn.dataset.id;
        const cls = classes.find(c => c.id === classId);
        try {
          // Notificar ANTES de borrar (la cascada eliminará los enrollments)
          let notifyResult = { sent: 0, withoutEmail: 0, failed: 0 };
          if (cls) {
            notifyResult = await notifyEnrolledClients(classId, 'cancelled', {
              className: TYPE_LABELS[cls.type] || cls.title || 'Clase',
              classDate: formatDate(cls.date),
              classTime: `${cls.time_start?.slice(0,5) || ''} - ${cls.time_end?.slice(0,5) || ''}`,
            });
          }
          await deleteClass(classId);
          showToast(notifyToastMessage('Sesión eliminada', notifyResult), 'success');
          render();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });

    // Click on rental card header → open rental detail panel
    container.querySelectorAll('.cal-rental-card .cal-session-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest('.cal-rental-card');
        const rentalId = card?.dataset.rentalId;
        const reservation = rentalReservations.find(r => r.id === rentalId);
        if (reservation) openRentalDetail(reservation);
      });
    });

    container.querySelectorAll('.cal-week-day-header').forEach(header => {
      header.addEventListener('click', () => {
        const ds = header.closest('.cal-week-day')?.dataset.date;
        if (ds) { currentDate = new Date(ds + 'T00:00:00'); viewMode = 'day'; render(); }
      });
    });

    container.querySelectorAll('.cal-week-slot').forEach(slot => {
      slot.addEventListener('click', async () => {
        const cls = classes.find(c => c.id === slot.dataset.id);
        if (cls) await showEnrollments(cls);
      });
    });
  }

  // ======== ENROLLMENTS MODAL ========
  // Estado de PAGO (color). La asistencia se muestra aparte (columna attendance).
  const ENROLLMENT_STATUS = {
    paid:      { label: 'Pagado',           color: '#16a34a' },
    partial:   { label: 'Anticipo pagado',  color: '#d97706' },
    confirmed: { label: 'Pendiente de pago', color: '#dc2626' },
    pending:   { label: 'Pendiente de pago', color: '#dc2626' },
    unpaid:    { label: 'Pendiente de pago', color: '#dc2626' },
    cancelled: { label: 'Cancelado',         color: '#6b7280' },
  };

  function ageFromBirthDate(birthDate) {
    if (!birthDate) return '';
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return ` (${age})`;
  }

  async function showEnrollments(cls) {
    try {
      const enrollments = await fetchClassEnrollments(cls.id);
      const active = enrollments.filter(e => e.status !== 'cancelled');
      // Ordinal de crédito (qué nº de clase del bono gasta cada inscripción)
      let ordMap = {};
      try { ordMap = await buildCreditOrdinals(enrollments.map(e => e.bono_id)); } catch {}

      const listHtml = enrollments.length
        ? `<div class="enrollment-list">${enrollments.map(e => {
            const name = e.guest_name || e.family_members?.full_name || e.profiles?.full_name || 'Sin nombre';
            const ageLabel = ageFromBirthDate(e.family_members?.birth_date || e.profiles?.birth_date);
            const bonoLabel = (e.bono && (e.bono.status === 'active' || e.bono.status === 'exhausted'))
              ? `<span style="color:#1a1a1a;font-size:.7rem;font-weight:600;white-space:nowrap">Bono ${ordMap[e.id] || e.bono.used_credits}/${e.bono.total_credits}</span>`
              : '';
            // Estado de PAGO derivado del bono (como la vista-día): si va con bono, el color
            // sale del pago del bono (una reserva web con anticipo ya cobrado → naranja, no rojo).
            let st;
            if (e.status === 'cancelled') st = ENROLLMENT_STATUS.cancelled;
            else if (e.bono) {
              const fullyPaid = bonoFullyPaid(e.bono);
              const partial = !fullyPaid && Number(e.bono.total_paid || 0) > 0;
              st = fullyPaid ? { label: 'Pagado', color: '#16a34a' }
                : partial ? { label: 'Anticipo pagado', color: '#d97706' }
                : { label: 'Pendiente de pago', color: '#dc2626' };
            } else {
              st = e.status === 'paid' ? { label: 'Pagado', color: '#16a34a' }
                : e.status === 'partial' ? { label: 'Anticipo pagado', color: '#d97706' }
                : (ENROLLMENT_STATUS[e.status] || { label: e.status, color: '#6b7280' });
            }
            const att = e.attendance === true
              ? { label: 'Asistió', color: '#16a34a' }
              : e.attendance === false ? { label: 'No asistió', color: '#6b7280' } : null;
            return `
            <div style="padding:10px 0;border-bottom:1px solid var(--color-line,#eee);display:flex;justify-content:space-between;align-items:center;gap:12px">
              <strong>${escapeHtml(name)}${ageLabel}</strong>
              <span style="display:flex;align-items:center;gap:10px">
                ${bonoLabel}
                ${att ? `<span style="color:${att.color};font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em">${att.label}</span>` : ''}
                <span style="color:${st.color};font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em">${st.label}</span>
              </span>
            </div>`;
          }).join('')}</div>`
        : '<p style="color:#888;margin-top:12px">No hay inscritos</p>';

      const label = TYPE_LABELS[cls.type] || cls.title;
      openModal(`${label} — ${formatDate(cls.date)} ${cls.time_start?.slice(0, 5)}`, `
        <div style="display:flex;gap:16px;margin-bottom:16px">
          <div><strong>Inscritos:</strong> ${active.length}/${cls.max_students}</div>
          <div><strong>Publicada:</strong> ${cls.published ? 'Sí' : 'No'}</div>
        </div>
        ${listHtml}
      `);
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
  }

  // ======== BOOKING PANEL (MANUAL RESERVATION) ========
  // Puente para la ficha del bono ("Ampliar y asignar ahora"): abre el panel de reserva
  // pre-rellenado con el titular y fijado al tipo del bono. Reusa todo el flujo del panel
  // (déficit → extendBono/inscripciones → triggers). Se expone en window (ver bindEvents).
  async function openBonoExtendAssist(bono, prefill) {
    if (!bono?.class_type) { showToast('Bono sin tipo de clase', 'error'); return; }
    const todayStr = getDateStr(new Date());
    const [seedsRes, titRes, famRes] = await Promise.all([
      supabase.from('surf_classes').select('*').eq('type', bono.class_type).gte('date', todayStr).order('date', { ascending: true }).order('time_start', { ascending: true }).limit(1),
      supabase.from('profiles').select('id, full_name, last_name, email, phone, wetsuit_size').eq('id', bono.user_id).maybeSingle(),
      supabase.from('family_members').select('id, full_name, last_name, birth_date, wetsuit_size').eq('user_id', bono.user_id).order('created_at'),
    ]);
    const seed = seedsRes.data && seedsRes.data[0];
    if (!seed) { showToast('No hay clases futuras de este tipo para asignar', 'error'); return; }
    const titular = titRes.data || {};

    // Candidatos: titular + familiares de la cuenta (ninguno preseleccionado)
    const candidates = [];
    candidates.push({ key: 'tit', nombre: titular.full_name || '', apellidos: titular.last_name || '', talla: titular.wetsuit_size || '', profileId: bono.user_id, familyMemberId: null, isFamilyOfResponsable: false, role: 'Titular' });
    (famRes.data || []).forEach(m => candidates.push({ key: 'fm:' + m.id, nombre: m.full_name || '', apellidos: m.last_name || '', talla: m.wetsuit_size || '', profileId: bono.user_id, familyMemberId: m.id, isFamilyOfResponsable: true, role: 'Familiar' }));

    const chosen = new Set();
    const extra = [];
    let extraSeq = 0;
    const ov = document.createElement('div');
    ov.className = 'bk-overlay';
    ov.style.zIndex = '10020';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    const cardHtml = (c) => {
      const sel = chosen.has(c.key);
      const info = [c.talla ? `Talla ${escapeHtml(String(c.talla))}` : null, c.role].filter(Boolean).join(' · ');
      return `<div class="ba-card" data-key="${c.key}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:2px solid ${sel ? '#1a1a1a' : '#e2e8f0'};background:${sel ? '#eff6ff' : '#fff'};border-radius:10px;cursor:pointer">
        <span style="width:18px;height:18px;border-radius:5px;border:2px solid ${sel ? '#1a1a1a' : '#cbd5e1'};background:${sel ? '#1a1a1a' : '#fff'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:12px">${sel ? '✓' : ''}</span>
        <span style="flex:1"><strong>${escapeHtml(`${c.nombre} ${c.apellidos}`.trim() || 'Sin nombre')}</strong>${info ? `<br><small style="color:#64748b">${info}</small>` : ''}</span>
      </div>`;
    };

    function render() {
      const all = [...candidates, ...extra];
      ov.innerHTML = `<div style="max-width:520px;width:94%;max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.3)">
        <h3 style="margin:0 0 4px;font-size:1.15rem">Ampliar bono · ${escapeHtml(TYPE_LABELS[bono.class_type] || bono.class_type)}</h3>
        <p style="margin:0 0 14px;font-size:.86rem;color:#64748b">Elige a quién le asignas las clases (puedes marcar varios). La responsable seguirá siendo <strong>${escapeHtml(`${titular.full_name || ''} ${titular.last_name || ''}`.trim() || 'la cuenta')}</strong>.</p>
        <div style="display:flex;flex-direction:column;gap:8px">${all.map(cardHtml).join('') || '<p style="color:#94a3b8;font-size:.85rem">Sin participantes. Añade una persona abajo.</p>'}</div>
        <div style="margin-top:12px;border-top:1px solid #f1f5f9;padding-top:12px">
          <button type="button" id="ba-add-toggle" class="btn line" style="font-size:.85rem;width:100%">+ Añadir persona al bono</button>
          <div id="ba-add-form" style="display:none;margin-top:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px">
            <label style="font-size:.78rem;color:#64748b">Vincular cliente existente</label>
            <div style="position:relative;margin:4px 0 10px"><input type="text" id="ba-search" placeholder="Buscar por nombre…" autocomplete="off" style="width:100%" /><div id="ba-search-res" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:5;background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:160px;overflow:auto;box-shadow:0 8px 24px rgba(15,47,57,.12)"></div></div>
            <label style="font-size:.78rem;color:#64748b">…o escribir los datos a mano</label>
            <div style="display:flex;gap:6px;margin:4px 0 6px"><input type="text" id="ba-nombre" placeholder="Nombre" style="flex:1" /><input type="text" id="ba-apellidos" placeholder="Apellidos" style="flex:1" /></div>
            <div style="display:flex;gap:6px"><input type="text" id="ba-talla" placeholder="Talla neopreno" style="flex:1" /><input type="email" id="ba-email" placeholder="Email (opcional → crea cuenta)" style="flex:1" /></div>
            <button type="button" id="ba-add-manual" class="btn" style="margin-top:8px;width:100%;background:#1a1a1a;color:#fff;border:0;font-size:.85rem">Añadir</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button type="button" id="ba-cancel" class="btn line">Cancelar</button>
          <button type="button" id="ba-continue" class="btn red" ${chosen.size ? '' : 'disabled'} style="${chosen.size ? '' : 'opacity:.5;cursor:not-allowed'}">Continuar (${chosen.size})</button>
        </div>
      </div>`;

      ov.querySelectorAll('.ba-card').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.key; if (chosen.has(k)) chosen.delete(k); else chosen.add(k); render();
      }));
      ov.querySelector('#ba-add-toggle').addEventListener('click', () => { const f = ov.querySelector('#ba-add-form'); f.style.display = f.style.display === 'none' ? '' : 'none'; });
      let timer = null;
      ov.querySelector('#ba-search')?.addEventListener('input', (e) => {
        clearTimeout(timer); const term = e.target.value.trim(); const box = ov.querySelector('#ba-search-res');
        if (term.length < 2) { box.style.display = 'none'; return; }
        timer = setTimeout(async () => {
          const res = await searchProfiles(term);
          box.innerHTML = res.length ? res.map(p => `<div class="ba-opt" data-id="${p.id}" data-name="${escapeHtml(p.full_name || '')}" data-last="${escapeHtml(p.last_name || '')}" style="padding:7px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:.85rem">${escapeHtml(p.full_name || 'Sin nombre')}${p.phone ? ` · ${escapeHtml(p.phone)}` : ''}</div>`).join('') : '<div style="padding:8px;color:#94a3b8;font-size:.82rem">Sin resultados</div>';
          box.style.display = '';
        }, 250);
      });
      ov.querySelector('#ba-search-res')?.addEventListener('click', (e) => {
        const o = e.target.closest('.ba-opt'); if (!o) return;
        const key = 'x:' + (extraSeq++);
        extra.push({ key, nombre: o.dataset.name, apellidos: o.dataset.last, talla: '', profileId: o.dataset.id, familyMemberId: null, isFamilyOfResponsable: false, role: 'Cliente existente' });
        chosen.add(key); render();
      });
      ov.querySelector('#ba-add-manual')?.addEventListener('click', () => {
        const nombre = ov.querySelector('#ba-nombre').value.trim();
        if (!nombre) { showToast('Indica el nombre', 'error'); return; }
        const key = 'x:' + (extraSeq++);
        extra.push({ key, nombre, apellidos: ov.querySelector('#ba-apellidos').value.trim(), talla: ov.querySelector('#ba-talla').value.trim(), email: ov.querySelector('#ba-email').value.trim(), profileId: null, familyMemberId: null, isFamilyOfResponsable: true, role: 'Nuevo' });
        chosen.add(key); render();
      });
      ov.querySelector('#ba-cancel').addEventListener('click', close);
      ov.querySelector('#ba-continue').addEventListener('click', () => {
        const picked = [...candidates, ...extra].filter(c => chosen.has(c.key));
        if (!picked.length) { showToast('Elige al menos una persona', 'error'); return; }
        const personsSeed = picked.map(c => ({ nombre: c.nombre, apellidos: c.apellidos, tallaNeopreno: c.talla || '', profileId: c.profileId, familyMemberId: c.familyMemberId, profileName: `${c.nombre} ${c.apellidos}`.trim(), email: c.email || '', isFamilyOfResponsable: c.isFamilyOfResponsable }));
        close();
        openBookingPanel(seed, { extendBonoId: bono.id, persons: personsSeed, responsable: { profileId: bono.user_id, nombre: titular.full_name || '', apellidos: titular.last_name || '', email: titular.email || '' } });
      });
    }
    render();
  }

  async function openBookingPanel(cls, prefill = null) {
    const color = TYPE_COLORS[cls.type] || '#0f2f39';
    const label = TYPE_LABELS[cls.type] || cls.title;
    const price = Number(cls.price) || 0;

    // Fetch same-type sessions for the week
    const weekDates = getWeekDates(new Date(cls.date + 'T00:00:00'));
    const weekFrom = getDateStr(weekDates[0]);
    const weekTo = getDateStr(weekDates[6]);
    const weekClasses = await fetchClassesInRange(weekFrom, weekTo);
    const sameTypeWeek = weekClasses.filter(c => c.type === cls.type);

    // State
    let bookingWeekOffset = 0;
    let personIdCounter = 1;
    // En modo "ampliar este bono" NO preseleccionamos la clase semilla: 'cls' solo ancla
    // la semana del calendario. Si se dejara marcada, sumaría un crédito (y una inscripción)
    // que el usuario no pidió → "te añade clases de más".
    const isExtend = !!(prefill && prefill.extendBonoId);
    let sessionQuantities = {}; // classId → quantity
    if (!isExtend) sessionQuantities[cls.id] = 1;
    const mkPerson = (seed = {}) => ({
      id: personIdCounter++, nombre: seed.nombre || '', apellidos: seed.apellidos || '', edad: seed.edad || '',
      sabeNadar: seed.sabeNadar || '', lesion: seed.lesion || 'no', lesionDetalle: seed.lesionDetalle || '',
      tallaNeopreno: seed.tallaNeopreno || '', nivelSurf: seed.nivelSurf || 'principiante',
      profileId: seed.profileId || null, profileName: seed.profileName || null, familyMemberId: seed.familyMemberId || null,
      isFamilyOfResponsable: seed.isFamilyOfResponsable ?? true, email: seed.email || '', sessions: isExtend ? [] : [cls.id],
    });
    // "Ampliar y asignar": puede venir una LISTA de participantes ya elegidos (cards) →
    // se crean todos pre-vinculados. Si no, una sola persona (pre-cargada del prefill).
    let persons;
    if (prefill?.persons?.length) {
      persons = prefill.persons.map(mkPerson);
    } else {
      const firstPerson = mkPerson();
      if (prefill) Object.assign(firstPerson, {
        nombre: prefill.nombre || '', apellidos: prefill.apellidos || '',
        profileId: prefill.profileId || null, profileName: prefill.profileName || null,
        familyMemberId: prefill.familyMemberId || null, email: prefill.email || '',
      });
      persons = [firstPerson];
    }
    // Modo "ampliar este bono": las personas añadidas solo pueden ser familiares del titular
    // (sin vincular terceros ni email de cuenta propia) → un único dueño = este bono familiar.
    const extendMode = isExtend;

    function getTotalQuantity() {
      return Object.values(sessionQuantities).reduce((s, v) => s + v, 0);
    }

    // Clave de "dueño del bono" para previsualizar el MISMO precio que cobra el confirm:
    // cada cliente distinto se precia como su propio pack; los familiares / no vinculados
    // (sin cuenta propia) cuelgan del responsable y comparten un único pack ('resp').
    function ownerKeyForPerson(p) {
      if (p.profileId) return 'pid:' + p.profileId;
      // Familiar/nuevo del responsable → cuelga del bono del titular (mismo orden de ramas
      // que el confirm: isFamilyOfResponsable ANTES que email) para no divergir del cargo real.
      if (p.isFamilyOfResponsable && prefill?.responsable?.profileId) return 'pid:' + prefill.responsable.profileId;
      if ((p.email || '').trim()) return 'email:' + p.email.trim().toLowerCase();
      return 'resp';
    }

    // Precio = suma del pack de cada dueño (no un único pack combinado entre clientes
    // distintos, que daría un descuento por volumen que no se aplica a clientes separados).
    function getTotalPrice() {
      const totalSessions = persons.reduce((s, p) => s + p.sessions.length, 0);
      // Drop-in de 1 sola clase: respeta el precio propio de la clase si lo tiene
      if (totalSessions === 1 && Number(cls.price) > 0) return Number(cls.price);
      const byOwner = {};
      for (const p of persons) { const k = ownerKeyForPerson(p); byOwner[k] = (byOwner[k] || 0) + p.sessions.length; }
      return Object.values(byOwner).reduce((s, n) => s + getPackPrice(cls.type, n, price), 0);
    }

    // Get unit price label for display
    function getUnitPriceLabel() {
      if (Number(cls.price) > 0) return `${Number(cls.price)}€`;
      const unit = getPackPrice(cls.type, 1, price);
      return `${unit || price}€`;
    }

    function renderPanel() {
      const totalQty = getTotalQuantity();
      const totalPrice = getTotalPrice();

      // Build week session grid
      const currentWeekDates = getWeekDatesForOffset(cls.date, bookingWeekOffset);
      const cwFrom = getDateStr(currentWeekDates[0]);
      const cwTo = getDateStr(currentWeekDates[6]);
      const weekLabel = `${currentWeekDates[0].getDate()} ${MONTH_NAMES[currentWeekDates[0].getMonth()].toLowerCase()} - ${currentWeekDates[6].getDate()} ${MONTH_NAMES[currentWeekDates[6].getMonth()].toLowerCase()}`;

      let sessionGridHtml = '<div class="bk-sessions-grid">';
      currentWeekDates.forEach(wd => {
        const ds = getDateStr(wd);
        const daySessions = sameTypeWeek.filter(c => c.date === ds);
        const dayLabel = `${DAY_NAMES_SHORT[wd.getDay()].toLowerCase()} ${wd.getDate()} / ${wd.getMonth() + 1}`;

        sessionGridHtml += `<div class="bk-session-col">
          <div class="bk-session-col-header">${dayLabel}</div>`;

        if (daySessions.length) {
          daySessions.forEach(s => {
            const qty = sessionQuantities[s.id] || 0;
            const avail = (s.max_students || 0) - (s.enrolled_count || 0);
            const isSelected = qty > 0;
            sessionGridHtml += `
              <div class="bk-session-slot ${isSelected ? 'selected' : ''}">
                <div class="bk-slot-info">
                  <span class="bk-slot-time">${s.time_start?.slice(0, 5)} - ${s.time_end?.slice(0, 5)}</span>
                  <span class="bk-slot-avail">Disponible: ${avail}</span>
                </div>
                <div class="bk-slot-counter">
                  <button class="bk-counter-btn minus" data-sid="${s.id}" ${qty <= 0 ? 'disabled' : ''}>−</button>
                  <span class="bk-counter-val">${qty}</span>
                  <button class="bk-counter-btn plus" data-sid="${s.id}" ${qty >= avail ? 'disabled' : ''}>+</button>
                </div>
              </div>`;
          });
        } else {
          sessionGridHtml += '<div class="bk-session-empty">—</div>';
        }

        sessionGridHtml += '</div>';
      });
      sessionGridHtml += '</div>';

      // Build persons list
      let personsHtml = '';
      persons.forEach((p, idx) => {
        const assignedTags = p.sessions.map(sid => {
          const s = sameTypeWeek.find(c => c.id === sid) || weekClasses.find(c => c.id === sid);
          if (!s) return '';
          const tagLabel = `${shortDateLabel(s.date)} ${s.time_start?.slice(0, 5)}-${s.time_end?.slice(0, 5)}`;
          return `<span class="bk-session-tag">${tagLabel} <button class="bk-tag-remove" data-pid="${p.id}" data-sid="${sid}">×</button></span>`;
        }).join('');

        // Available sessions to add (those with qty > 0 and not yet assigned to this person)
        const availableSessions = Object.keys(sessionQuantities)
          .filter(sid => sessionQuantities[sid] > 0 && !p.sessions.includes(sid))
          .map(sid => {
            const s = sameTypeWeek.find(c => c.id === sid) || weekClasses.find(c => c.id === sid);
            if (!s) return '';
            return `<option value="${sid}">${shortDateLabel(s.date)} ${s.time_start?.slice(0, 5)}</option>`;
          }).join('');

        personsHtml += `
          <div class="bk-person-card" data-pid="${p.id}">
            <div class="bk-person-header">
              <span class="bk-person-number">Persona ${idx + 1}</span>
              <div class="bk-person-header-actions">
                <button class="bk-link-client-btn" data-pid="${p.id}" title="${extendMode ? 'Elegir familiar del titular o cliente existente' : 'Vincular cliente existente'}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                </button>
                <button class="bk-remove-person-btn" data-pid="${p.id}" title="Eliminar persona">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </div>
            ${p.profileId
              ? `<div class="bk-linked-client">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                  <span>Vinculado: <strong>${p.profileName}</strong>${p.familyMemberId ? ' <small style="color:#1a1a1a">(familiar)</small>' : ''}</span>
                  <button class="bk-unlink-btn" data-pid="${p.id}">×</button>
                </div>`
              : `<div class="bk-person-fields">
                  <div class="bk-field">
                    <label class="bk-field-label">Nombre *</label>
                    <input type="text" class="bk-field-input bk-nombre" data-pid="${p.id}" value="${p.nombre}" placeholder="Nombre" />
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">Apellidos *</label>
                    <input type="text" class="bk-field-input bk-apellidos" data-pid="${p.id}" value="${p.apellidos}" placeholder="Apellidos" />
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">Edad</label>
                    <input type="number" class="bk-field-input bk-edad" data-pid="${p.id}" value="${p.edad}" placeholder="Edad" min="1" max="99" />
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">¿Sabe nadar?</label>
                    <select class="bk-field-input bk-nadar" data-pid="${p.id}">
                      <option value="" ${!p.sabeNadar ? 'selected' : ''}>Seleccionar</option>
                      <option value="si" ${p.sabeNadar === 'si' ? 'selected' : ''}>Sí</option>
                      <option value="no" ${p.sabeNadar === 'no' ? 'selected' : ''}>No</option>
                    </select>
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">¿Tiene lesión?</label>
                    <select class="bk-field-input bk-lesion" data-pid="${p.id}">
                      <option value="no" ${p.lesion === 'no' ? 'selected' : ''}>No</option>
                      <option value="si" ${p.lesion === 'si' ? 'selected' : ''}>Sí</option>
                    </select>
                  </div>
                  <div class="bk-field bk-lesion-detalle-wrap" data-pid="${p.id}" style="display:${p.lesion === 'si' ? '' : 'none'}">
                    <label class="bk-field-label">¿Cuál?</label>
                    <input type="text" class="bk-field-input bk-lesion-detalle" data-pid="${p.id}" value="${p.lesionDetalle}" placeholder="Describe la lesión" />
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">Talla neopreno</label>
                    <select class="bk-field-input bk-talla" data-pid="${p.id}">
                      <option value="" ${!p.tallaNeopreno ? 'selected' : ''}>Seleccionar</option>
                      ${WETSUIT_SIZES.map(s => `<option value="${s}" ${p.tallaNeopreno === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                  </div>
                  <div class="bk-field">
                    <label class="bk-field-label">Nivel de surf</label>
                    <select class="bk-field-input bk-nivel" data-pid="${p.id}">
                      <option value="principiante" ${p.nivelSurf === 'principiante' ? 'selected' : ''}>Principiante (0-6 clases)</option>
                      <option value="intermedio" ${p.nivelSurf === 'intermedio' ? 'selected' : ''}>Intermedio (7-15 clases)</option>
                      <option value="avanzado" ${p.nivelSurf === 'avanzado' ? 'selected' : ''}>Avanzado (+15 clases)</option>
                    </select>
                  </div>
                  ${extendMode ? `
                  <div class="bk-field bk-field-full">
                    <p style="margin:0;font-size:.78rem;color:#1a1a1a;background:#e0f2fe;border-radius:6px;padding:7px 10px">Se asigna como familiar del titular del bono (mismo bono).</p>
                  </div>` : `
                  <div class="bk-field bk-field-full">
                    <label class="bk-familiar-check">
                      <input type="checkbox" class="bk-is-familiar" data-pid="${p.id}" ${p.isFamilyOfResponsable ? 'checked' : ''} />
                      <span>Es hijo/familiar del responsable de la reserva</span>
                    </label>
                  </div>
                  <div class="bk-field bk-field-full bk-email-wrap" data-pid="${p.id}" style="display:${p.isFamilyOfResponsable ? 'none' : ''}">
                    <label class="bk-field-label">Email <small style="font-weight:400;color:#94a3b8;text-transform:none">· solo si es un adulto con cuenta propia (se le invita)</small></label>
                    <input type="email" class="bk-field-input bk-person-email" data-pid="${p.id}" value="${p.email || ''}" placeholder="email@ejemplo.com" />
                  </div>`}
                </div>`
            }
            <div class="bk-person-sessions">
              <label class="bk-field-label">Sesiones asignadas*</label>
              <div class="bk-session-tags">
                ${assignedTags}
                ${availableSessions ? `
                  <select class="bk-add-session-select" data-pid="${p.id}">
                    <option value="">+ Añadir sesión</option>
                    ${availableSessions}
                  </select>` : ''}
              </div>
            </div>
          </div>`;
      });

      // Full panel
      const panelHtml = `
        <div class="bk-overlay bk-overlay-fullscreen" id="bk-overlay">
          <div class="bk-panel bk-panel-fullscreen">
            <div class="bk-panel-header" style="background: ${color}">
              <button class="bk-close-btn" id="bk-close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <div class="bk-header-left">
                <span class="bk-header-title">${label}</span>
              </div>
              <div class="bk-header-right">
                <div class="bk-header-total">
                  <small>TOTAL</small>
                  <span>${totalPrice.toFixed(2)}€</span>
                </div>
                <button class="bk-confirm-btn" id="bk-confirm">CONFIRMAR</button>
              </div>
            </div>

            <div class="bk-panel-body">
              <div class="bk-section">
                <h3 class="bk-section-title">Opciones de Reserva</h3>
                <div class="bk-options-card">
                  <div class="bk-options-row">
                    <div class="bk-option">
                      <label class="bk-field-label">Fecha</label>
                      <div class="bk-option-value">${cls.date.split('-').reverse().join('/')}</div>
                    </div>
                    <div class="bk-option">
                      <label class="bk-field-label">Cantidad</label>
                      <div class="bk-option-number">${totalQty}</div>
                    </div>
                    <div class="bk-option">
                      <label class="bk-field-label">Personas</label>
                      <div class="bk-option-number">${persons.length}</div>
                    </div>
                  </div>

                  <div class="bk-sessions-section">
                    <label class="bk-field-label" style="margin-bottom:8px">Por favor, selecciona las sesiones:</label>
                    <div class="bk-sessions-nav">
                      <button class="bk-sessions-nav-arrow" id="bk-week-prev">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                      </button>
                      <span class="bk-sessions-week-label">${weekLabel}</span>
                      <button class="bk-sessions-nav-arrow" id="bk-week-next">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
                      </button>
                    </div>
                    ${sessionGridHtml}
                  </div>
                </div>
              </div>

              <div class="bk-section">
                <h3 class="bk-section-title">Datos del Grupo</h3>
                ${personsHtml}
                <button class="bk-add-person-btn" id="bk-add-person">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Añadir Persona
                </button>
              </div>
            </div>
          </div>
        </div>`;

      // Remove existing panel
      document.getElementById('bk-overlay')?.remove();
      document.body.insertAdjacentHTML('beforeend', panelHtml);
      bindPanelEvents();
    }

    let weekNavLoading = false;

    function getWeekDatesForOffset(baseDateStr, offset) {
      const base = new Date(baseDateStr + 'T00:00:00');
      base.setDate(base.getDate() + offset * 7);
      return getWeekDates(base);
    }

    function bindPanelEvents() {
      const overlay = document.getElementById('bk-overlay');
      if (!overlay) return;

      // Close
      overlay.querySelector('#bk-close').addEventListener('click', () => {
        overlay.remove();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });

      // Session counter buttons
      overlay.querySelectorAll('.bk-counter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.sid;
          const current = sessionQuantities[sid] || 0;
          if (btn.classList.contains('plus')) {
            const newQty = current + 1;
            sessionQuantities[sid] = newQty;

            // Ensure we have enough persons for this session qty
            while (persons.length < newQty) {
              persons.push({
                id: personIdCounter++,
                nombre: '', apellidos: '', edad: '', sabeNadar: '',
                lesion: 'no', lesionDetalle: '', tallaNeopreno: '',
                nivelSurf: 'principiante', profileId: null, profileName: null,
                familyMemberId: null, isFamilyOfResponsable: true, email: '', sessions: []
              });
            }

            // Assign this session to the first N persons (N = newQty)
            for (let i = 0; i < persons.length; i++) {
              if (i < newQty) {
                if (!persons[i].sessions.includes(sid)) persons[i].sessions.push(sid);
              } else {
                // Remove from persons beyond the qty
                persons[i].sessions = persons[i].sessions.filter(s => s !== sid);
              }
            }
          } else {
            const newQty = Math.max(0, current - 1);
            sessionQuantities[sid] = newQty;
            if (newQty === 0) {
              delete sessionQuantities[sid];
              // Remove from all persons
              persons.forEach(p => {
                p.sessions = p.sessions.filter(s => s !== sid);
              });
            } else {
              // Keep session only for the first N persons
              for (let i = 0; i < persons.length; i++) {
                if (i < newQty) {
                  if (!persons[i].sessions.includes(sid)) persons[i].sessions.push(sid);
                } else {
                  persons[i].sessions = persons[i].sessions.filter(s => s !== sid);
                }
              }
            }
            // Remove persons that have no sessions left (keep at least 1)
            persons = persons.filter((p, i) => i === 0 || p.sessions.length > 0);
          }
          renderPanel();
        });
      });

      // Week navigation (with loading guard to prevent race conditions)
      overlay.querySelector('#bk-week-prev')?.addEventListener('click', async () => {
        if (weekNavLoading) return;
        weekNavLoading = true;
        try {
          bookingWeekOffset--;
          const wd = getWeekDatesForOffset(cls.date, bookingWeekOffset);
          const moreClasses = await fetchClassesInRange(getDateStr(wd[0]), getDateStr(wd[6]));
          moreClasses.filter(c => c.type === cls.type).forEach(c => {
            if (!sameTypeWeek.find(s => s.id === c.id)) sameTypeWeek.push(c);
          });
          renderPanel();
        } finally { weekNavLoading = false; }
      });
      overlay.querySelector('#bk-week-next')?.addEventListener('click', async () => {
        if (weekNavLoading) return;
        weekNavLoading = true;
        try {
          bookingWeekOffset++;
          const wd = getWeekDatesForOffset(cls.date, bookingWeekOffset);
          const moreClasses = await fetchClassesInRange(getDateStr(wd[0]), getDateStr(wd[6]));
          moreClasses.filter(c => c.type === cls.type).forEach(c => {
            if (!sameTypeWeek.find(s => s.id === c.id)) sameTypeWeek.push(c);
          });
          renderPanel();
        } finally { weekNavLoading = false; }
      });

      // Add person
      overlay.querySelector('#bk-add-person')?.addEventListener('click', () => {
        const selectedSessions = Object.keys(sessionQuantities).filter(sid => sessionQuantities[sid] > 0);
        persons.push({
          id: personIdCounter++,
          nombre: '',
          apellidos: '',
          edad: '',
          sabeNadar: '',
          lesion: 'no',
          lesionDetalle: '',
          tallaNeopreno: '',
          nivelSurf: 'principiante',
          profileId: null,
          profileName: null,
          familyMemberId: null,
          isFamilyOfResponsable: true,
          email: '',
          sessions: selectedSessions.length ? [selectedSessions[0]] : []
        });
        renderPanel();
      });

      // Remove person
      overlay.querySelectorAll('.bk-remove-person-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (persons.length <= 1) {
            showToast('Debe haber al menos una persona', 'error');
            return;
          }
          persons = persons.filter(p => String(p.id) !== btn.dataset.pid);
          renderPanel();
        });
      });

      // Field inputs (save on change)
      overlay.querySelectorAll('.bk-nombre').forEach(input => {
        input.addEventListener('input', () => {
          const p = persons.find(p => String(p.id) === input.dataset.pid);
          if (p) p.nombre = input.value;
        });
        // Autocompletado: sugiere fichas existentes y vincula (no duplica)
        attachClientSuggest(input, {
          onPick: (it) => {
            const p = persons.find(p => String(p.id) === input.dataset.pid);
            if (p) { p.profileId = it.id; p.profileName = it.label || it.full_name; p.familyMemberId = it.familyMemberId || null; p.nombre = ''; p.apellidos = ''; }
            renderPanel();
          },
        });
      });
      overlay.querySelectorAll('.bk-apellidos').forEach(input => {
        input.addEventListener('input', () => {
          const p = persons.find(p => String(p.id) === input.dataset.pid);
          if (p) p.apellidos = input.value;
        });
      });
      overlay.querySelectorAll('.bk-edad').forEach(input => {
        input.addEventListener('input', () => {
          const p = persons.find(p => String(p.id) === input.dataset.pid);
          if (p) p.edad = input.value;
        });
      });
      overlay.querySelectorAll('.bk-nadar').forEach(sel => {
        sel.addEventListener('change', () => {
          const p = persons.find(p => String(p.id) === sel.dataset.pid);
          if (p) p.sabeNadar = sel.value;
        });
      });
      overlay.querySelectorAll('.bk-lesion').forEach(sel => {
        sel.addEventListener('change', () => {
          const p = persons.find(p => String(p.id) === sel.dataset.pid);
          if (p) p.lesion = sel.value;
          const wrap = overlay.querySelector(`.bk-lesion-detalle-wrap[data-pid="${sel.dataset.pid}"]`);
          if (wrap) wrap.style.display = sel.value === 'si' ? '' : 'none';
        });
      });
      overlay.querySelectorAll('.bk-lesion-detalle').forEach(input => {
        input.addEventListener('input', () => {
          const p = persons.find(p => String(p.id) === input.dataset.pid);
          if (p) p.lesionDetalle = input.value;
        });
      });
      overlay.querySelectorAll('.bk-talla').forEach(sel => {
        sel.addEventListener('change', () => {
          const p = persons.find(p => String(p.id) === sel.dataset.pid);
          if (p) p.tallaNeopreno = sel.value;
        });
      });
      overlay.querySelectorAll('.bk-nivel').forEach(sel => {
        sel.addEventListener('change', () => {
          const p = persons.find(p => String(p.id) === sel.dataset.pid);
          if (p) p.nivelSurf = sel.value;
        });
      });

      // Familiar del responsable toggle (muestra/oculta email)
      overlay.querySelectorAll('.bk-is-familiar').forEach(cb => {
        cb.addEventListener('change', () => {
          const p = persons.find(p => String(p.id) === cb.dataset.pid);
          if (p) p.isFamilyOfResponsable = cb.checked;
          const wrap = overlay.querySelector(`.bk-email-wrap[data-pid="${cb.dataset.pid}"]`);
          if (wrap) wrap.style.display = cb.checked ? 'none' : '';
        });
      });
      overlay.querySelectorAll('.bk-person-email').forEach(input => {
        input.addEventListener('input', () => {
          const p = persons.find(p => String(p.id) === input.dataset.pid);
          if (p) p.email = input.value.trim();
        });
      });

      // Remove session tag from person
      overlay.querySelectorAll('.bk-tag-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = persons.find(p => String(p.id) === btn.dataset.pid);
          if (p) {
            p.sessions = p.sessions.filter(s => s !== btn.dataset.sid);
            renderPanel();
          }
        });
      });

      // Add session to person
      overlay.querySelectorAll('.bk-add-session-select').forEach(select => {
        select.addEventListener('change', () => {
          if (!select.value) return;
          const p = persons.find(p => String(p.id) === select.dataset.pid);
          if (p && !p.sessions.includes(select.value)) {
            p.sessions.push(select.value);
            renderPanel();
          }
        });
      });

      // Link client
      overlay.querySelectorAll('.bk-link-client-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          openClientSearchForPerson(btn.dataset.pid);
        });
      });

      // Unlink client
      overlay.querySelectorAll('.bk-unlink-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = persons.find(p => String(p.id) === btn.dataset.pid);
          if (p) {
            p.profileId = null;
            p.profileName = null;
            p.familyMemberId = null;
            renderPanel();
          }
        });
      });

      // Confirm → go to checkout
      overlay.querySelector('#bk-confirm')?.addEventListener('click', () => {
        // Validate
        for (const p of persons) {
          if (!p.profileId && !p.nombre.trim()) {
            showToast('Rellena el nombre de todas las personas o vincúlalas a un cliente', 'error');
            return;
          }
          if (!p.sessions.length) {
            showToast('Asigna al menos una sesión a cada persona', 'error');
            return;
          }
        }
        openCheckoutPanel();
      });
    }

    // ======== CHECKOUT PANEL ========
    async function openCheckoutPanel() {
      const totalQty = getTotalQuantity();
      let subtotal = getTotalPrice();

      // Recalculate subtotal excluding sessions covered by credit/bono
      function recalcSubtotal() {
        // Agrupa las sesiones POR DUEÑO, resta el avail del bono UNA vez por dueño, y
        // precia el déficit de forma MARGINAL (packPrice(base+deficit)−packPrice(base))
        // → coincide EXACTAMENTE con el totalCharge del confirm y con el tope del anticipo.
        const sessByOwner = {}, bonoByOwner = {};
        for (const p of persons) {
          const k = ownerKeyForPerson(p);
          sessByOwner[k] = (sessByOwner[k] || 0) + p.sessions.length;
          const pc = personCredits[p.id];
          if (pc?.useCredit && pc.bono && !bonoByOwner[k]) bonoByOwner[k] = pc.bono;
        }
        subtotal = Object.keys(sessByOwner).reduce((s, k) => {
          const need = sessByOwner[k];
          const bono = bonoByOwner[k];
          const avail = bono ? Math.max(0, (bono.total_credits || 0) - (bono.used_credits || 0)) : 0;
          const deficit = Math.max(0, need - avail);
          if (deficit <= 0) return s;
          const base = bono ? (bono.total_credits || 0) : 0;
          return s + Math.max(0, getPackPrice(cls.type, base + deficit, price) - getPackPrice(cls.type, base, price));
        }, 0);
      }

      // Checkout state
      let discountType = 'percent';
      let discountValue = 0;
      let contactSource = 'persona_1';
      let contactData = { nombre: '', apellidos: '', email: '', telefono: '', pais: '', idioma: 'Español', profileId: null };
      let cobrarAnticipo = false;
      let paymentMethod = null;
      let enviarConfirmacion = true;
      let crearInvitacion = false;
      let ocultarPrecios = false;
      let anticipoAmount = 0;

      // Credit/bono system: maps personId → { useCredit: bool, bono: bonoObj|null }
      let personCredits = {};

      // Prefill contact from first person (async if linked to profile)
      async function prefillContactFromPerson(p) {
        // For family members, use the parent profile ID for contact details
        const profileId = p.profileId;
        if (profileId) {
          contactData.profileId = profileId;
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', profileId)
              .single();
            if (profile) {
              contactData.nombre = (profile.full_name || '').trim();
              contactData.apellidos = (profile.last_name || '').trim();
              contactData.telefono = profile.phone || '';
              // Fetch email via RPC
              try {
                const { data: email } = await supabase.rpc('get_user_email', { p_user_id: profileId });
                if (email) contactData.email = email;
              } catch {}
            }
          } catch {}
        } else {
          contactData.nombre = p.nombre;
          contactData.apellidos = p.apellidos;
        }
      }
      // Responsable de la reserva: en "ampliar" es SIEMPRE la titular del bono (aunque los
      // asistentes sean sus familiares) → se pre-asigna como responsable en la confirmación.
      if (prefill?.responsable?.profileId) {
        contactSource = 'otra';
        await prefillContactFromPerson({ profileId: prefill.responsable.profileId, nombre: prefill.responsable.nombre || '', apellidos: prefill.responsable.apellidos || '' });
      } else if (persons[0]) {
        await prefillContactFromPerson(persons[0]);
      }

      // Fetch active bonos for all linked persons
      async function loadPersonCredits() {
        for (const p of persons) {
          if (p.profileId && !personCredits[p.id]) {
            try {
              const { data: bonos } = await supabase
                .from('bonos')
                .select('*')
                .eq('user_id', p.profileId)
                .eq('class_type', cls.type)
                .in('status', ['active', 'exhausted'])
                .gt('expires_at', new Date().toISOString());
              // Conservamos TAMBIÉN los bonos agotados (used>=total): el preview necesita su
              // 'base' (total_credits) para precisar el cargo marginal igual que el confirm
              // (que amplía el bono agotado). Si no, el preview cobraría un pack fresco.
              const allBonos = (bonos || []).map(b => {
                const expectedPrice = bonoExpected(b);
                const paid = Number(b.total_paid || 0);
                const bPending = Math.max(0, Math.round((expectedPrice - paid) * 100) / 100);
                return { ...b, totalPaidReal: paid, expectedPrice, pendingAmount: bPending, isFullyPaid: bPending <= 0 };
              });
              const totalRemaining = allBonos.reduce((sum, b) => sum + Math.max(0, b.total_credits - b.used_credits), 0);
              // Bono por defecto: el que tenga créditos suficientes; si no, el que tenga
              // ALGÚN crédito; si no, el más reciente (mismo criterio que findOwnerBono).
              const bestBono = allBonos.find(b => (b.total_credits - b.used_credits) >= p.sessions.length)
                || allBonos.find(b => (b.total_credits - b.used_credits) > 0)
                || allBonos[0] || null;
              personCredits[p.id] = {
                // Hay bono → se usa (se amplía si hace falta). Las clases que excedan los
                // créditos libres se cobran al precio marginal en el confirmar.
                useCredit: !!bestBono,
                bono: bestBono,
                selectedBonoId: bestBono?.id || null,
                allBonos,
                availableCredits: totalRemaining,
              };
            } catch { personCredits[p.id] = { useCredit: false, bono: null, availableCredits: 0 }; }
          }
        }
      }
      await loadPersonCredits();

      // Cuántas sesiones cubren realmente los créditos (topado por avail, por DUEÑO para
      // no contar dos veces el crédito de un bono compartido entre titular y familiares).
      function getCreditSessions() {
        const sessByOwner = {}, availByOwner = {};
        for (const p of persons) {
          const k = ownerKeyForPerson(p);
          sessByOwner[k] = (sessByOwner[k] || 0) + p.sessions.length;
          const pc = personCredits[p.id];
          if (pc?.useCredit && pc.bono && availByOwner[k] == null) availByOwner[k] = Math.max(0, (pc.bono.total_credits || 0) - (pc.bono.used_credits || 0));
        }
        let count = 0;
        for (const k of Object.keys(sessByOwner)) count += Math.min(sessByOwner[k], availByOwner[k] || 0);
        return count;
      }

      function getTotalSessions() {
        return persons.reduce((s, p) => s + p.sessions.length, 0);
      }

      function allCoveredByCredits() {
        return getCreditSessions() > 0 && getCreditSessions() >= getTotalSessions();
      }

      function getDiscount() {
        if (discountType === 'percent') return subtotal * (discountValue / 100);
        return discountValue;
      }

      function getTotal() {
        return Math.max(0, subtotal - getDiscount());
      }

      function getTax() {
        return getTotal() * 0.21; // IVA included
      }

      function renderCheckout() {
        recalcSubtotal();
        const discount = getDiscount();
        const total = getTotal();
        const taxIncluded = (total * 21 / 121).toFixed(2); // IVA included in price

        // Person options for contact selector
        const personOptions = persons.map((p, i) => {
          const name = p.profileId ? p.profileName : `${p.nombre} ${p.apellidos}`.trim();
          return `<option value="persona_${i + 1}" ${contactSource === `persona_${i + 1}` ? 'selected' : ''}>Persona ${i + 1}${name ? ' — ' + name : ''}</option>`;
        }).join('');

        const checkoutHtml = `
          <div class="bk-panel-body">
            <div class="bk-checkout-layout">
              <!-- LEFT: Contact Data -->
              <div>
                <div class="bk-section">
                  <div class="bk-contact-card">
                    <div class="bk-contact-top">
                      <h4 style="margin:0">Responsable de la reserva</h4>
                      <select class="bk-contact-select" id="bk-contact-source" style="margin-top:10px">
                        ${personOptions}
                        <option value="otra" ${contactSource === 'otra' ? 'selected' : ''}>${contactData.profileId ? `${contactData.nombre} ${contactData.apellidos}`.trim() + ' (cliente)' : 'Otra persona'}</option>
                      </select>
                    </div>
                    <div style="position:relative;margin-bottom:16px">
                      <input type="text" class="bk-contact-search" id="bk-contact-search" placeholder="Buscar cliente existente…" style="width:100%" />
                    </div>
                    ${contactData.profileId ? `<div style="padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:16px;display:flex;align-items:center;gap:8px">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      <span style="font-size:.82rem;color:#065f46;font-weight:600">Cliente con ficha${contactData.nombre ? ': ' + contactData.nombre : ' vinculado'}</span>
                    </div>` : ''}

                    <div class="bk-contact-fields">
                      <div class="bk-contact-field">
                        <label>Nombre <span class="required">*</span></label>
                        <input type="text" id="bk-co-nombre" value="${contactData.nombre}" placeholder="Nombre" />
                      </div>
                      <div class="bk-contact-field">
                        <label>Apellidos <span class="required">*</span></label>
                        <input type="text" id="bk-co-apellidos" value="${contactData.apellidos}" placeholder="Apellidos" />
                      </div>
                      <div class="bk-contact-field full-width">
                        <label>Email <span class="required">*</span></label>
                        <input type="email" id="bk-co-email" value="${contactData.email}" placeholder="email@ejemplo.com" />
                      </div>
                      <div class="bk-contact-field">
                        <label>Teléfono</label>
                        <div class="bk-phone-row">
                          <input type="text" class="bk-phone-prefix" value="+34" id="bk-co-prefix" />
                          <input type="tel" id="bk-co-telefono" value="${contactData.telefono}" placeholder="600 000 000" style="flex:1" />
                        </div>
                      </div>
                      <div class="bk-contact-field">
                        <label>País de origen</label>
                        <select id="bk-co-pais">
                          <option value="">Seleccionar</option>
                          <option value="ES" ${contactData.pais === 'ES' ? 'selected' : ''}>España</option>
                          <option value="FR" ${contactData.pais === 'FR' ? 'selected' : ''}>Francia</option>
                          <option value="DE" ${contactData.pais === 'DE' ? 'selected' : ''}>Alemania</option>
                          <option value="UK" ${contactData.pais === 'UK' ? 'selected' : ''}>Reino Unido</option>
                          <option value="PT" ${contactData.pais === 'PT' ? 'selected' : ''}>Portugal</option>
                          <option value="IT" ${contactData.pais === 'IT' ? 'selected' : ''}>Italia</option>
                          <option value="OTHER" ${contactData.pais === 'OTHER' ? 'selected' : ''}>Otro</option>
                        </select>
                      </div>
                      <div class="bk-contact-field">
                        <label>Idioma</label>
                        <select id="bk-co-idioma">
                          <option value="Español" ${contactData.idioma === 'Español' ? 'selected' : ''}>Español</option>
                          <option value="English" ${contactData.idioma === 'English' ? 'selected' : ''}>English</option>
                          <option value="Français" ${contactData.idioma === 'Français' ? 'selected' : ''}>Français</option>
                          <option value="Deutsch" ${contactData.idioma === 'Deutsch' ? 'selected' : ''}>Deutsch</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- RIGHT: Purchase Summary -->
              <div>
                <div class="bk-purchase-card">
                  <div class="bk-purchase-header" style="background: ${color}">
                    <h4>Su Compra</h4>
                  </div>
                  <div class="bk-purchase-body">
                    <div class="bk-purchase-item">
                      <div class="bk-purchase-item-row">
                        <div>
                          <div class="bk-purchase-item-name">${label}</div>
                          <div class="bk-purchase-item-meta">${persons.length} persona(s), ${totalQty} sesión(es)</div>
                        </div>
                        <div class="bk-purchase-item-price">${subtotal.toFixed(2)}€</div>
                      </div>
                      ${persons.map((p, i) => {
                        const name = p.profileId ? p.profileName : `${p.nombre} ${p.apellidos}`.trim() || `Persona ${i + 1}`;
                        return `<div class="bk-purchase-person-detail">
                          <span>${name}: ${p.sessions.length} sesión(es)</span>
                        </div>`;
                      }).join('')}
                      <div class="bk-purchase-item-actions">
                        <a class="bk-link-edit" id="bk-edit-booking">Editar</a>
                      </div>
                    </div>

                    ${(() => {
                      // Credit cards for persons with bonos — show ALL bonos with payment status
                      const creditSections = persons.map((p, i) => {
                        const pc = personCredits[p.id];
                        if (!pc || !pc.allBonos?.length) return '';
                        const name = p.profileId ? p.profileName : `${p.nombre} ${p.apellidos}`.trim() || `Persona ${i+1}`;

                        // Use credit toggle
                        let html = `<div style="margin-bottom:6px">
                          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0">
                            <input type="checkbox" class="bk-use-credit" data-person-id="${p.id}" ${pc.useCredit ? 'checked' : ''} />
                            <div style="flex:1">
                              <div style="font-size:.85rem;font-weight:700;color:var(--color-navy)">${name} — usar crédito</div>
                            </div>
                          </label>
                        </div>`;

                        if (pc.useCredit) {
                          // Show all bonos to choose from
                          html += pc.allBonos.map(b => {
                            const remaining = b.total_credits - b.used_credits;
                            const paid = b.totalPaidReal;
                            const isSelected = pc.selectedBonoId === b.id;
                            const borderColor = isSelected ? (b.isFullyPaid ? '#22c55e' : '#f59e0b') : '#e2e8f0';
                            const bgColor = isSelected ? (b.isFullyPaid ? '#f0fdf4' : '#fffbeb') : '#fff';
                            return `
                            <div class="bk-bono-option" data-person-id="${p.id}" data-bono-id="${b.id}" style="padding:10px 14px;margin-bottom:6px;border:2px solid ${borderColor};background:${bgColor};border-radius:8px;cursor:pointer;transition:all .15s">
                              <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                  <div style="font-size:.85rem;font-weight:700;color:#0f2f39">Bono ${b.total_credits} clases</div>
                                  <div style="font-size:.75rem;color:var(--color-muted)">${remaining} créditos restantes</div>
                                </div>
                                <div style="text-align:right">
                                  ${b.isFullyPaid
                                    ? '<span style="font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:6px;background:#dcfce7;color:#166534">PAGADO</span>'
                                    : `<span style="font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:6px;background:#fef3c7;color:#92400e">PENDIENTE ${b.pendingAmount.toFixed(2)}\u20ac</span>`
                                  }
                                </div>
                              </div>
                              <div style="font-size:.72rem;margin-top:4px;color:var(--color-muted)">Pagado: ${paid.toFixed(2)}\u20ac de ${b.expectedPrice.toFixed(2)}\u20ac</div>
                            </div>`;
                          }).join('');
                        }

                        return html;
                      }).join('');
                      return creditSections ? `<div style="margin-bottom:12px"><div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-navy);margin-bottom:8px">Créditos en cuenta</div>${creditSections}</div>` : '';
                    })()}

                    <div class="bk-total-row">
                      <span>Total</span>
                      <span>${total.toFixed(2)}€</span>
                    </div>

                    <div class="bk-checkout-options" ${allCoveredByCredits() ? 'style="display:none"' : ''}>
                      <div class="bk-checkout-option">
                        <input type="checkbox" id="bk-opt-anticipo" ${cobrarAnticipo ? 'checked' : ''} />
                        <div>
                          <span class="bk-checkout-option-text">Cobrar anticipo</span>
                        </div>
                      </div>
                      <div id="bk-payment-section" style="display:${cobrarAnticipo ? 'block' : 'none'}">
                        <div class="bk-anticipo-amount-row" style="margin-bottom:10px">
                          <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:4px">Importe del anticipo</label>
                          <div style="display:flex;align-items:center;gap:8px">
                            <input type="number" id="bk-anticipo-amount" value="${anticipoAmount || ''}" min="0" max="${total.toFixed(2)}" step="0.01" placeholder="${total.toFixed(2)}" style="flex:1;padding:8px 10px;border:1px solid var(--color-line);border-radius:var(--radius-sm);font-size:.9rem" />
                            <span style="font-size:.85rem;color:var(--color-muted)">€ de ${total.toFixed(2)}€</span>
                          </div>
                          <div style="margin-top:6px;display:flex;gap:6px">
                            <button type="button" class="bk-anticipo-preset" data-pct="100" style="font-size:.72rem;padding:3px 8px;border:1px solid var(--color-line);border-radius:4px;background:${anticipoAmount === total ? '#e8f5e9' : '#fff'};cursor:pointer">Total</button>
                            <button type="button" class="bk-anticipo-preset" data-pct="50" style="font-size:.72rem;padding:3px 8px;border:1px solid var(--color-line);border-radius:4px;background:${anticipoAmount === Math.round(total * 50) / 100 ? '#e8f5e9' : '#fff'};cursor:pointer">50%</button>
                            <button type="button" class="bk-anticipo-preset" data-pct="30" style="font-size:.72rem;padding:3px 8px;border:1px solid var(--color-line);border-radius:4px;cursor:pointer">30%</button>
                          </div>
                        </div>
                        <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:4px">Método de pago</label>
                        <div class="bk-payment-methods">
                          <div class="bk-payment-method ${paymentMethod === 'efectivo' ? 'selected' : ''}" data-method="efectivo">
                            <span class="bk-payment-method-icon">💵</span>
                            <span class="bk-payment-method-label">Efectivo</span>
                          </div>
                          <div class="bk-payment-method ${paymentMethod === 'tarjeta' ? 'selected' : ''}" data-method="tarjeta">
                            <span class="bk-payment-method-icon">💳</span>
                            <span class="bk-payment-method-label">Tarjeta</span>
                          </div>
                          <div class="bk-payment-method ${paymentMethod === 'transferencia' ? 'selected' : ''}" data-method="transferencia">
                            <span class="bk-payment-method-icon">🏦</span>
                            <span class="bk-payment-method-label">Transferencia</span>
                          </div>
                          <div class="bk-payment-method ${paymentMethod === 'voucher' ? 'selected' : ''}" data-method="voucher">
                            <span class="bk-payment-method-icon">🎟️</span>
                            <span class="bk-payment-method-label">Voucher</span>
                          </div>
                        </div>
                        ${anticipoAmount > 0 ? `<div style="margin-top:8px;padding:8px 12px;background:#f0fdf4;border-radius:6px;font-size:.82rem">
                          <strong>Pendiente tras anticipo:</strong> ${(total - anticipoAmount).toFixed(2)}€
                        </div>` : ''}
                      </div>

                      <div class="bk-checkout-option">
                        <input type="checkbox" id="bk-opt-confirmacion" ${enviarConfirmacion ? 'checked' : ''} />
                        <div>
                          <span class="bk-checkout-option-text">Enviar confirmación de reserva</span>
                        </div>
                      </div>
                    </div>

                    <div class="bk-checkout-buttons">
                      <button class="bk-final-confirm-btn" id="bk-final-confirm">Confirmar</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>`;

        // Replace panel body
        const overlay = document.getElementById('bk-overlay');
        if (!overlay) return;
        const panelBody = overlay.querySelector('.bk-panel-body');
        if (panelBody) panelBody.outerHTML = checkoutHtml.trim();

        // Update header: add back button and update confirm button
        const headerLeft = overlay.querySelector('.bk-header-left');
        if (headerLeft && !overlay.querySelector('#bk-checkout-back')) {
          const backBtn = document.createElement('button');
          backBtn.className = 'bk-back-btn';
          backBtn.id = 'bk-checkout-back';
          backBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
          backBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;padding:4px;margin-right:8px;display:flex;align-items:center';
          headerLeft.prepend(backBtn);
        }
        const headerConfirmBtn = overlay.querySelector('#bk-confirm');
        if (headerConfirmBtn) {
          headerConfirmBtn.textContent = 'PASO 2';
          headerConfirmBtn.disabled = true;
          headerConfirmBtn.style.background = '#94a3b8';
        }

        bindCheckoutEvents();
        // Back button goes to booking panel (step 1)
        overlay.querySelector('#bk-checkout-back')?.addEventListener('click', () => {
          renderPanel();
        });
      }

      function bindCheckoutEvents() {
        const overlay = document.getElementById('bk-overlay');
        if (!overlay) return;

        // Contact source selector
        overlay.querySelector('#bk-contact-source')?.addEventListener('change', async (e) => {
          contactSource = e.target.value;
          if (contactSource.startsWith('persona_')) {
            const idx = parseInt(contactSource.split('_')[1]) - 1;
            const p = persons[idx];
            if (p) {
              contactData = { nombre: '', apellidos: '', email: '', telefono: '', pais: '', idioma: 'Español', profileId: null };
              await prefillContactFromPerson(p);
            }
          } else {
            contactData = { nombre: '', apellidos: '', email: '', telefono: '', pais: '', idioma: 'Español', profileId: null };
          }
          renderCheckout();
        });

        // Contact search (for linking to existing client — adults only)
        let searchDebounce = null;
        const searchInput = overlay.querySelector('#bk-contact-search');
        searchInput?.addEventListener('input', () => {
          clearTimeout(searchDebounce);
          overlay.querySelector('.bk-contact-results')?.remove();
          searchDebounce = setTimeout(async () => {
            const term = searchInput.value.trim();
            if (term.length < 2) return;
            try {
              const profiles = await searchProfiles(term);
              if (!profiles.length) return;
              // Fetch emails for each profile via RPC
              const enriched = await Promise.all(profiles.map(async (pr) => {
                let email = '';
                try {
                  const { data } = await supabase.rpc('get_user_email', { p_user_id: pr.id });
                  email = data || '';
                } catch {}
                return { ...pr, email };
              }));
              const resultsEl = document.createElement('div');
              resultsEl.className = 'bk-contact-results';
              resultsEl.innerHTML = enriched.map(pr => `
                <button type="button" class="bk-contact-result" data-id="${pr.id}" data-name="${pr.full_name || ''}" data-email="${pr.email || ''}" data-phone="${pr.phone || ''}">
                  <strong>${pr.full_name || 'Sin nombre'}</strong>
                  <small>${pr.email || ''} ${pr.phone ? '· ' + pr.phone : ''}</small>
                </button>
              `).join('');
              searchInput.parentNode.appendChild(resultsEl);
              resultsEl.querySelectorAll('.bk-contact-result').forEach(btn => {
                btn.addEventListener('click', async () => {
                  const pid = btn.dataset.id;
                  contactData.profileId = pid;
                  // Fetch full profile to get all fields
                  try {
                    const { data: fullProfile } = await supabase.from('profiles').select('*').eq('id', pid).single();
                    if (fullProfile) {
                      contactData.nombre = (fullProfile.full_name || '').trim();
                      contactData.apellidos = (fullProfile.last_name || '').trim();
                      contactData.telefono = fullProfile.phone || '';
                    }
                  } catch {}
                  contactData.email = btn.dataset.email || '';
                  // Si el cliente coincide con una persona del grupo → esa persona es el titular.
                  // Si es distinto → responsable aparte ('otra'), y los asistentes serán familiares suyos.
                  {
                    const tgt = `${contactData.nombre} ${contactData.apellidos}`.trim().toLowerCase();
                    const mIdx = persons.findIndex(pp => tgt && `${pp.nombre} ${pp.apellidos}`.trim().toLowerCase() === tgt);
                    contactSource = mIdx >= 0 ? `persona_${mIdx + 1}` : 'otra';
                  }
                  searchInput.value = '';
                  resultsEl.remove();
                  renderCheckout();
                  showToast(`Responsable vinculado: ${btn.dataset.name || btn.dataset.email}`, 'success');
                });
              });
            } catch (err) { /* silent */ }
          }, 400);
        });

        // Save contact fields on input
        ['bk-co-nombre', 'bk-co-apellidos', 'bk-co-email', 'bk-co-telefono'].forEach(id => {
          overlay.querySelector(`#${id}`)?.addEventListener('input', (e) => {
            const key = id.replace('bk-co-', '');
            contactData[key] = e.target.value;
          });
        });
        // Autocompletado del responsable por nombre: vincula la ficha existente (no duplica)
        attachClientSuggest(overlay.querySelector('#bk-co-nombre'), {
          onPick: (it) => {
            contactData.profileId = it.id;
            contactData.nombre = it.full_name || '';
            contactData.apellidos = it.last_name || '';
            contactData.email = it.email || contactData.email;
            contactData.telefono = it.phone || contactData.telefono;
            renderPanel();
          },
        });

        // Auto-detectar cliente existente al escribir el email del responsable
        let emailDetectDebounce = null;
        overlay.querySelector('#bk-co-email')?.addEventListener('input', (e) => {
          const email = e.target.value.trim().toLowerCase();
          clearTimeout(emailDetectDebounce);
          if (contactData.profileId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
          emailDetectDebounce = setTimeout(async () => {
            try {
              const { data: rows } = await supabase.from('profiles').select('*').eq('email', email).limit(1);
              const prof = rows?.[0];
              if (prof && !contactData.profileId) {
                contactData.profileId = prof.id;
                contactData.nombre = (prof.full_name || '').trim();
                contactData.apellidos = (prof.last_name || '').trim();
                contactData.telefono = prof.phone || '';
                contactData.email = email;
                {
                  const tgt = `${contactData.nombre} ${contactData.apellidos}`.trim().toLowerCase();
                  const mIdx = persons.findIndex(pp => tgt && `${pp.nombre} ${pp.apellidos}`.trim().toLowerCase() === tgt);
                  contactSource = mIdx >= 0 ? `persona_${mIdx + 1}` : 'otra';
                }
                renderCheckout();
                showToast(`Ya es cliente con ficha: ${prof.full_name || email}`, 'success');
              }
            } catch { /* silent */ }
          }, 500);
        });
        overlay.querySelector('#bk-co-pais')?.addEventListener('change', (e) => {
          contactData.pais = e.target.value;
          // Autocompleta el prefijo del móvil según el país
          const dial = dialForCountry(e.target.value);
          const prefixEl = overlay.querySelector('#bk-co-prefix');
          if (dial && prefixEl) prefixEl.value = dial;
        });
        overlay.querySelector('#bk-co-idioma')?.addEventListener('change', (e) => { contactData.idioma = e.target.value; });

        // Use credit checkboxes
        overlay.querySelectorAll('.bk-use-credit').forEach(cb => {
          cb.addEventListener('change', (e) => {
            const pid = cb.dataset.personId;
            if (personCredits[pid]) {
              personCredits[pid].useCredit = e.target.checked;
            }
            // If all covered by credits, disable anticipo
            if (allCoveredByCredits()) {
              cobrarAnticipo = false;
              paymentMethod = null;
            }
            renderCheckout();
          });
        });

        // Bono selection (choose which bono to use)
        overlay.querySelectorAll('.bk-bono-option').forEach(opt => {
          opt.addEventListener('click', () => {
            const pid = opt.dataset.personId;
            const bonoId = opt.dataset.bonoId;
            if (personCredits[pid]) {
              personCredits[pid].selectedBonoId = bonoId;
              personCredits[pid].bono = personCredits[pid].allBonos?.find(b => b.id === bonoId) || personCredits[pid].bono;
            }
            renderCheckout();
          });
        });

        // Cobrar anticipo toggle
        overlay.querySelector('#bk-opt-anticipo')?.addEventListener('change', (e) => {
          cobrarAnticipo = e.target.checked;
          if (!cobrarAnticipo) paymentMethod = null;
          renderCheckout();
        });

        // Anticipo amount
        overlay.querySelector('#bk-anticipo-amount')?.addEventListener('input', (e) => {
          anticipoAmount = parseFloat(e.target.value) || 0;
          // Don't re-render on every keystroke, just update the pending display
        });
        overlay.querySelector('#bk-anticipo-amount')?.addEventListener('change', (e) => {
          anticipoAmount = parseFloat(e.target.value) || 0;
          renderCheckout();
        });
        overlay.querySelectorAll('.bk-anticipo-preset').forEach(btn => {
          btn.addEventListener('click', () => {
            const pct = parseInt(btn.dataset.pct);
            anticipoAmount = Math.round(getTotal() * pct) / 100;
            renderCheckout();
          });
        });

        // Payment methods
        overlay.querySelectorAll('.bk-payment-method').forEach(el => {
          el.addEventListener('click', () => {
            paymentMethod = el.dataset.method;
            renderCheckout();
          });
        });

        // Checkbox options
        overlay.querySelector('#bk-opt-confirmacion')?.addEventListener('change', (e) => { enviarConfirmacion = e.target.checked; });

        // Back to booking (edit)
        overlay.querySelector('#bk-edit-booking')?.addEventListener('click', (e) => {
          e.preventDefault();
          renderPanel();
        });

        // Final confirm
        overlay.querySelector('#bk-final-confirm')?.addEventListener('click', async () => {
          if (!contactData.nombre.trim()) { showToast('El nombre de contacto es obligatorio', 'error'); return; }
          if (!contactData.email.trim()) { showToast('El email de contacto es obligatorio', 'error'); return; }
          if (cobrarAnticipo && !paymentMethod) { showToast('Selecciona un método de pago para el anticipo', 'error'); return; }
          if (cobrarAnticipo && (!anticipoAmount || anticipoAmount <= 0)) {
            anticipoAmount = getTotal();
          }
          if (cobrarAnticipo && anticipoAmount > getTotal()) {
            anticipoAmount = getTotal();
          }

          const btn = overlay.querySelector('#bk-final-confirm');
          btn.disabled = true;
          btn.textContent = 'Guardando…';

          try {
            // Track accumulated bono credit usage across persons
            const bonoCreditsUsed = {}; // bonoId → total credits consumed in this booking

            // ---- Resolver la cuenta del RESPONSABLE ----
            // Prioridad: ya vinculado → email existente en BD → crear cuenta + invitación.
            let responsableId = contactData.profileId || null;
            const respEmail = contactData.email.trim().toLowerCase();
            if (!responsableId && respEmail) {
              try {
                const { data: rows } = await supabase.from('profiles').select('id').eq('email', respEmail).limit(1);
                if (rows?.[0]) { responsableId = rows[0].id; showToast('Usuario existente: se vincula la reserva a su ficha (no se envía correo)', 'info'); }
              } catch {}
            }
            // Red de seguridad anti-duplicados: si no se encontró por email, busca por teléfono
            // (un mismo cliente registrado antes con otro/sin email no debe duplicarse).
            const respPhone = normPhone(contactData.telefono);
            if (!responsableId && respPhone.length >= 6) {
              try {
                const { data: rows } = await supabase.from('profiles').select('id, phone');
                const hit = (rows || []).find(r => normPhone(r.phone) === respPhone);
                if (hit) { responsableId = hit.id; showToast('Cliente existente por teléfono: se vincula a su ficha', 'info'); }
              } catch {}
            }
            if (!responsableId && respEmail) {
              try {
                const nc = await createClientFromAdmin({
                  full_name: `${contactData.nombre} ${contactData.apellidos}`.trim(),
                  email: contactData.email.trim(),
                  phone: contactData.telefono || null,
                });
                responsableId = nc?.id || null;
                if (nc?.already_existed) showToast('Usuario existente: se vincula la reserva a su ficha (no se envía correo)', 'info');
                else if (nc?.email_sent) showToast('Cuenta creada · correo de acceso enviado al cliente', 'success');
                else if (nc?.id) showToast('Cuenta creada (no se pudo enviar el correo de acceso)', 'info');
              } catch (e) { console.warn('No se pudo crear responsable:', e.message); }
            }

            // Email obligatorio + cuenta garantizada: toda reserva queda vinculada
            // a una ficha de cliente. Si no se pudo crear/vincular, se bloquea.
            if (!responsableId) {
              showToast('No se pudo crear o vincular la cuenta del cliente. Revisa el email e inténtalo de nuevo.', 'error');
              btn.disabled = false;
              btn.textContent = 'Confirmar';
              return;
            }

            // Persona (índice) que ES el responsable y asiste, si aplica
            const respPersonIdx = contactSource.startsWith('persona_') ? (parseInt(contactSource.split('_')[1]) - 1) : -1;

            // Reutiliza un familiar existente del responsable (por nombre) o lo crea
            async function ensureFamilyMember(p) {
              const fullName = `${p.nombre} ${p.apellidos}`.trim();
              if (!responsableId || !fullName) return null;
              try {
                const { data: existing } = await supabase.from('family_members').select('id, full_name, last_name').eq('user_id', responsableId);
                const target = normName(fullName);
                const match = (existing || []).find(m => normName(`${m.full_name || ''} ${m.last_name || ''}`) === target);
                if (match) return match.id;
                const { data: created } = await supabase.from('family_members').insert({
                  user_id: responsableId,
                  full_name: p.nombre || fullName,
                  last_name: p.apellidos || '',
                  level: p.nivelSurf || null,
                  can_swim: p.sabeNadar === 'si' ? true : p.sabeNadar === 'no' ? false : null,
                  has_injury: p.lesion === 'si',
                  injury_detail: p.lesion === 'si' ? (p.lesionDetalle || null) : null,
                  wetsuit_size: p.tallaNeopreno || null,
                }).select('id').single();
                return created?.id || null;
              } catch (e) { console.warn('ensureFamilyMember', e.message); return null; }
            }
            // Cuenta propia de un adulto independiente (por email): existente o crear + invitar
            async function ensureAccountByEmail(p) {
              const email = (p.email || '').trim().toLowerCase();
              if (!email) return null;
              const who = `${p.nombre} ${p.apellidos}`.trim() || email;
              try {
                const { data: rows } = await supabase.from('profiles').select('id').eq('email', email).limit(1);
                if (rows?.[0]) { showToast(`Usuario existente vinculado: ${who} (sin correo)`, 'info'); return rows[0].id; }
                const nc = await createClientFromAdmin({ full_name: `${p.nombre} ${p.apellidos}`.trim(), email });
                if (nc?.already_existed) showToast(`Usuario existente vinculado: ${who} (sin correo)`, 'info');
                else if (nc?.email_sent) showToast(`Cuenta creada para ${who} · correo de acceso enviado`, 'success');
                else if (nc?.id) showToast(`Cuenta creada para ${who} (no se pudo enviar el correo)`, 'info');
                return nc?.id || null;
              } catch (e) { console.warn('ensureAccountByEmail', e.message); return null; }
            }

            // Destino de inscripción por persona
            const personTarget = {}; // pid → { user_id?, family_member_id?, guest_name? }
            for (let pi = 0; pi < persons.length; pi++) {
              const p = persons[pi];
              const fullName = `${p.nombre} ${p.apellidos}`.trim();
              if (pi === respPersonIdx && responsableId) {
                // Esta persona ES el responsable → asiste como titular (su propio nombre)
                personTarget[p.id] = { user_id: responsableId, family_member_id: null, guest_name: null };
              } else if (p.profileId) {
                // Vinculado manualmente vía 👤+ (cliente existente o familiar concreto)
                personTarget[p.id] = { user_id: p.profileId, family_member_id: p.familyMemberId || null, guest_name: p.familyMemberId ? p.profileName : null };
              } else if (p.isFamilyOfResponsable && responsableId) {
                // Hijo/familiar del responsable → se crea/reutiliza como familiar suyo.
                // guest_name guarda el nombre del asistente para que el calendario muestre quién va.
                const fid = await ensureFamilyMember(p);
                if (!fid) { showToast(`No se pudo registrar a ${fullName || 'un asistente'} como familiar. Reintenta.`, 'error'); btn.disabled = false; btn.textContent = 'Confirmar'; return; }
                personTarget[p.id] = { user_id: responsableId, family_member_id: fid, guest_name: fullName || null };
              } else if ((p.email || '').trim()) {
                // Adulto independiente con email → su propia cuenta + invitación
                const uid = await ensureAccountByEmail(p);
                personTarget[p.id] = uid ? { user_id: uid, family_member_id: null, guest_name: null } : { guest_name: fullName || 'Invitado' };
              } else if (responsableId && fullName) {
                // Sin vincular pero con nombre → se cuelga del responsable como familiar suyo,
                // así su reserva entra en el bono del responsable y el cobro queda registrado
                // (el dueño del bono es siempre el responsable de la reserva).
                const fid = await ensureFamilyMember(p);
                if (!fid) { showToast(`No se pudo registrar a ${fullName} como familiar. Reintenta.`, 'error'); btn.disabled = false; btn.textContent = 'Confirmar'; return; }
                personTarget[p.id] = { user_id: responsableId, family_member_id: fid, guest_name: fullName };
              } else {
                // Sin cuenta y sin nombre → invitado suelto
                personTarget[p.id] = { guest_name: fullName || 'Invitado' };
              }
            }

            // ---- BONO POR DUEÑO (modelo "un bono por cliente y tipo, se amplía") ----
            // El dueño del bono es el responsable de la reserva; sus familiares
            // cuelgan de su bono (inscripciones con user_id = responsableId). Una
            // persona enlazada a su propia cuenta usa su propio bono. Invitados sin
            // cuenta quedan sueltos. Siempre hay bono: si no existe se crea, si
            // existe se amplía para cubrir las clases nuevas. Los créditos prepagados
            // ya disponibles se consumen primero (no se cobran dos veces).

            // 0) DEDUP: no re-apuntar (ni contar/cobrar) sesiones que la persona YA tiene.
            //    Solo para personas identificables (user_id o family_member_id); los invitados
            //    sueltos sin ficha no se deduplican. p._newSessions = solo las nuevas.
            const allSessionIds = [...new Set(persons.flatMap(p => p.sessions))];
            let existingEnroll = [];
            if (allSessionIds.length) {
              // fail-CLOSED: si no se puede verificar lo ya inscrito, abortar (no seguir sin
              // dedup, que duplicaría inscripciones y cobros). supabase-js no lanza en error
              // de query → hay que mirar `error` explícitamente, además del try/catch de red.
              let qErr = null, qData = null;
              try {
                const res = await supabase.from('class_enrollments')
                  .select('class_id, user_id, family_member_id')
                  .in('class_id', allSessionIds).neq('status', 'cancelled');
                qErr = res.error; qData = res.data;
              } catch (e) { qErr = e; }
              if (qErr) {
                showToast('No se pudo verificar inscripciones existentes. Reintenta.', 'error');
                btn.disabled = false; btn.textContent = 'Confirmar';
                return;
              }
              existingEnroll = qData || [];
            }
            let _skipped = 0;
            for (const p of persons) {
              const tgt = personTarget[p.id] || {};
              if (!(tgt.user_id || tgt.family_member_id)) { p._newSessions = p.sessions.slice(); continue; }
              p._newSessions = p.sessions.filter(sid => {
                const has = existingEnroll.some(e => e.class_id === sid && (e.user_id || null) === (tgt.user_id || null) && (e.family_member_id || null) === (tgt.family_member_id || null));
                if (has) _skipped++;
                return !has;
              });
            }
            if (_skipped > 0) showToast(`${_skipped} sesión(es) ya estaban asignadas · se omiten`, 'info');

            // 1) Sesiones nuevas por dueño (user_id) — solo las que NO tenía ya
            const ownerSessions = {};
            for (const p of persons) {
              const tgt = personTarget[p.id];
              // Solo dueños con sesiones NUEVAS (si todas estaban ya asignadas, 0 → no crear
              // un bono fantasma de 1 crédito/0€ para un dueño que no tiene nada que hacer).
              if (tgt?.user_id && p._newSessions.length) ownerSessions[tgt.user_id] = (ownerSessions[tgt.user_id] || 0) + p._newSessions.length;
            }

            // 2) Déficit (clases nuevas no cubiertas por créditos prepagados) y CARGO por dueño.
            //    El cargo se calcula sobre el DÉFICIT (no sobre el total del panel) para no
            //    cobrar dos veces los créditos ya prepagados. Precio de pack del déficit con
            //    el descuento del panel aplicado. Cada dueño se precia por separado (sin
            //    mezclar el descuento por volumen entre clientes distintos).
            const _now = new Date().toISOString();
            const discRate = subtotal > 0 ? Math.min(1, getDiscount() / subtotal) : 0;
            const ownerIds = Object.keys(ownerSessions);
            const ownerInfo = {}; // userId → { bono, need, deficit, charge }
            for (const ownerId of ownerIds) {
              const need = ownerSessions[ownerId];
              let bono = null;
              // "Ampliar ESTE bono": si el asistente pasó un id explícito y el dueño es la
              // titular, ampliar EXACTAMENTE ese bono (no re-resolver por tipo, que podría
              // elegir otro bono vivo del mismo tipo y cobrar/ampliar el equivocado).
              if (isExtend && prefill?.extendBonoId && ownerId === prefill?.responsable?.profileId) {
                try { const { data } = await supabase.from('bonos').select('*').eq('id', prefill.extendBonoId).maybeSingle(); if (data) bono = data; } catch {}
              }
              if (!bono) { try { bono = await findOwnerBono(ownerId, cls.type); } catch {} }
              const avail = bonoAvailable(bono);
              const deficit = Math.max(0, need - avail);
              // Precio MARGINAL: cobrar el incremento del pack, no un pack nuevo pequeño.
              // base = créditos que YA tiene el bono (0 si no hay bono). Así las clases por
              // encima del pack máximo se cobran al extra_class_price configurado en Actividades:
              // packPrice(base+deficit) − packPrice(base). Ej: bono de 7 + 3 nuevas = 3 × extra.
              const base = bono ? (bono.total_credits || 0) : 0;
              const rawDeficit = deficit > 0
                ? Math.max(0, round2(getPackPrice(cls.type, base + deficit, Number(cls.price) || 0) - getPackPrice(cls.type, base, Number(cls.price) || 0)))
                : 0;
              const charge = Math.round(rawDeficit * (1 - discRate) * 100) / 100;

              // UPGRADE clase suelta → bono: si NO tiene bono de este tipo pero SÍ clases
              // sueltas pagadas del mismo tipo, se ofrecen para incluirlas en el bono nuevo
              // (cuentan como usadas) descontando lo ya pagado. Ej: pagó 1 clase 35€ y hace
              // bono de 4 (115€) → se cobra 115−35 = 80€.
              let absorb = null, finalCharge = charge, finalTotalCredits = deficit, finalExpected = charge;
              if (!bono && deficit > 0) {
                try {
                  const { data: priors } = await supabase.from('class_enrollments')
                    .select('id, surf_classes:class_id(type)')
                    .eq('user_id', ownerId).is('bono_id', null).neq('status', 'cancelled');
                  const ids = (priors || []).filter(e => e.surf_classes?.type === cls.type).map(e => e.id);
                  if (ids.length) {
                    const { data: pays } = await supabase.from('payments').select('amount').eq('reservation_type', 'enrollment').in('reference_id', ids);
                    const priorPaid = round2((pays || []).reduce((s, p) => s + Number(p.amount || 0), 0));
                    const lbl = TYPE_LABELS[cls.type] || cls.type;
                    if (confirm(`Este cliente ya tiene ${ids.length} clase(s) de ${lbl} fuera de bono (pagadas: ${priorPaid}€).\n\n¿Incluirlas en el bono nuevo (cuentan como usadas) y descontar lo ya pagado?`)) {
                      finalTotalCredits = deficit + ids.length;
                      finalExpected = round2(getPackPrice(cls.type, finalTotalCredits, Number(cls.price) || 0) * (1 - discRate));
                      finalCharge = Math.max(0, round2(finalExpected - priorPaid));
                      absorb = { ids, priorPaid };
                    }
                  }
                } catch (e) { console.warn('upgrade detect', e.message); }
              }
              ownerInfo[ownerId] = { bono, need, deficit, charge: finalCharge, absorb, finalTotalCredits, finalExpected };
            }

            // 3) Anticipo cobrado (no supera el cargo total)
            const totalCharge = Math.round(ownerIds.reduce((s, id) => s + ownerInfo[id].charge, 0) * 100) / 100;
            const anticipoTotal = cobrarAnticipo ? Math.max(0, Math.min(anticipoAmount, totalCharge)) : 0;

            // Reparto del anticipo SOLO entre dueños con cargo > 0 (el último de esos
            // absorbe el residuo de redondeo). Evita crear un pago de céntimos sobre un
            // bono ya saldado (deficit 0).
            const anticipoByOwner = {};
            const chargeOwners = ownerIds.filter(id => ownerInfo[id].charge > 0);
            let _anticipoAllocated = 0;
            chargeOwners.forEach((id, i) => {
              let a;
              if (i === chargeOwners.length - 1) a = Math.round((anticipoTotal - _anticipoAllocated) * 100) / 100;
              else { a = totalCharge > 0 ? Math.round(anticipoTotal * (ownerInfo[id].charge / totalCharge) * 100) / 100 : 0; _anticipoAllocated += a; }
              anticipoByOwner[id] = Math.max(0, a);
            });

            // 4) Crear/ampliar el bono de cada dueño, registrar el pago y fijar total_paid = SUM(payments)
            const bonoByOwner = {}; // userId → { id, status }
            for (let oi = 0; oi < ownerIds.length; oi++) {
              const ownerId = ownerIds[oi];
              const info = ownerInfo[ownerId];
              const { bono, deficit, charge, absorb } = info;
              const ownerAnticipo = anticipoByOwner[ownerId] || 0;

              let bId = bono?.id || null;
              let finalExpected;
              if (bono) {
                const curExpected = bonoExpected(bono);
                finalExpected = round2(curExpected + (deficit > 0 ? charge : 0));
                if (deficit > 0) {
                  await extendBono(bId, { newTotalCredits: (bono.total_credits || 0) + deficit, newCustomTotal: finalExpected });
                }
              } else if (absorb) {
                // Bono nuevo absorbiendo clases sueltas pagadas: total = nuevas + absorbidas;
                // expected = precio del pack completo; las clases y SUS pagos pasan al bono.
                finalExpected = info.finalExpected;
                bId = await createBono({ user_id: ownerId, class_type: cls.type, total_credits: info.finalTotalCredits, custom_total: finalExpected });
                try {
                  await supabase.from('payments').update({ reservation_type: 'bono', reference_id: bId }).eq('reservation_type', 'enrollment').in('reference_id', absorb.ids);
                  await supabase.from('class_enrollments').update({ bono_id: bId }).in('id', absorb.ids);
                } catch (e) { console.warn('absorb upgrade', e.message); }
              } else {
                finalExpected = charge;
                bId = await createBono({ user_id: ownerId, class_type: cls.type, total_credits: deficit, custom_total: charge });
              }

              // Registrar el pago; total_paid se deriva DESPUÉS de la suma real de payments
              // (si createPayment falla, total_paid no se infla y el pendiente sigue siendo correcto).
              if (bId && ownerAnticipo > 0) {
                try {
                  await createPayment({
                    reservation_type: 'bono', reference_id: bId, amount: ownerAnticipo,
                    payment_method: paymentMethod || 'efectivo', channel: 'in_person',
                    concept: `Reserva ${TYPE_LABELS[cls.type] || cls.type}`,
                  });
                } catch (e) { console.warn('pago bono', e.message); }
              }
              let paidSum = 0;
              if (bId) {
                // total_paid = SUM real de payments; si la consulta falla, estima
                // (previo + anticipo) en vez de poner 0 y perder el cobro recién hecho.
                try { paidSum = (await fetchPayments('bono', bId)).reduce((s, p) => s + Number(p.amount || 0), 0); }
                catch { paidSum = Math.round(((bono ? Number(bono.total_paid || 0) : 0) + ownerAnticipo) * 100) / 100; }
                await supabase.from('bonos').update({ total_paid: Math.round(paidSum * 100) / 100, updated_at: _now }).eq('id', bId);
              }
              const isFullyPaid = finalExpected > 0 ? paidSum >= finalExpected - 0.01 : paidSum > 0;
              // expected/paid = total y pagado REALES del bono (no solo el cargo de esta
              // tanda): la ficha debe mostrar el total del bono, no el cargo nuevo.
              bonoByOwner[ownerId] = { id: bId, expected: finalExpected, paid: paidSum, status: paidSum <= 0 ? 'confirmed' : (isFullyPaid ? 'paid' : 'partial') };
            }

            // 5) Crear inscripciones enganchadas al bono del dueño (el trigger cuenta créditos/aforo)
            const createdEnrollmentIds = [];
            for (const p of persons) {
              const tgt = personTarget[p.id] || { guest_name: `${p.nombre} ${p.apellidos}`.trim() || 'Invitado' };
              const ownerBono = tgt.user_id ? bonoByOwner[tgt.user_id] : null;
              // Solo las sesiones NUEVAS (las que ya tenía se omitieron en el dedup)
              for (const sid of (p._newSessions || p.sessions)) {
                const enrollData = { class_id: sid, created_at: new Date().toISOString() };
                if (ownerBono?.id) {
                  enrollData.bono_id = ownerBono.id;
                  enrollData.status = ownerBono.status; // 'paid' | 'partial' | 'confirmed' según el bono
                } else {
                  // Invitado sin cuenta y sin nombre → clase suelta sin cobro asociado aquí
                  enrollData.status = 'confirmed';
                }
                if (tgt.user_id) {
                  enrollData.user_id = tgt.user_id;
                  if (tgt.family_member_id) {
                    enrollData.family_member_id = tgt.family_member_id;
                    enrollData.guest_name = tgt.guest_name || null;
                  }
                } else {
                  enrollData.guest_name = tgt.guest_name || 'Invitado';
                }
                const createdEnr = await createEnrollment(enrollData);
                if (createdEnr?.id) createdEnrollmentIds.push(createdEnr.id);
              }
            }
            // Si la reserva cuelga de UN solo bono (caso común: responsable+familia), enlazar
            // la ficha a ese bono real para que "Añadir pago"/"Cancelar"/editar total operen
            // sobre datos reales y no sobre un id inventado.
            const bonoIdsUsed = [...new Set(Object.values(bonoByOwner).map(b => b.id).filter(Boolean))];
            const singleBonoId = bonoIdsUsed.length === 1 ? bonoIdsUsed[0] : null;
            const singleBono = singleBonoId ? Object.values(bonoByOwner).find(b => b.id === singleBonoId) : null;

            // Si la reserva cuelga de UN solo bono, la ficha representa ESE bono: total y
            // pendiente son los REALES del bono (incluye saldo previo si se amplió), no solo
            // el cargo de esta tanda — así el campo Total editable no corrompe el custom_total
            // y el pendiente cuadra con SUM(payments) del bono. Multi-bono: usa el cargo de la tanda.
            const total = singleBono ? singleBono.expected : totalCharge;
            const paidShown = singleBono ? singleBono.paid : anticipoTotal;
            const reservationData = {
              id: createdEnrollmentIds[0] || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
              enrollmentIds: createdEnrollmentIds,
              bonoId: singleBonoId,
              linkedBonoId: singleBonoId,
              createdAt: new Date(),
              status: paidShown <= 0 ? 'confirmed' : (total > 0 && paidShown >= total - 0.01 ? 'paid' : 'partial'),
              total: total,
              discount: getDiscount(),
              totalFinal: total,
              anticipoAmount: paidShown,
              pending: Math.round(Math.max(0, total - paidShown) * 100) / 100,
              paymentMethod,
              cobrarAnticipo,
              crearInvitacion,
              ocultarPrecios,
              enviarConfirmacion,
              contact: { ...contactData },
              persons: persons.map(p => ({...p})),
              personCredits: JSON.parse(JSON.stringify(personCredits)),
              sessions: Object.keys(sessionQuantities).map(sid => {
                const s = sameTypeWeek.find(c => c.id === sid) || weekClasses.find(c => c.id === sid);
                return s ? {...s} : null;
              }).filter(Boolean),
              activityType: cls.type,
              activityLabel: label,
              activityColor: color,
              payments: [],
            };

            showToast('Reserva confirmada', 'success');

            // Casilla "Enviar confirmación de reserva": antes solo se guardaba en
            // la ficha y nunca se mandaba nada. Se envía sin bloquear el flujo.
            if (enviarConfirmacion && contactData.email.trim()) {
              const fechas = reservationData.sessions
                .slice().sort((a, b) => (a.date + a.time_start).localeCompare(b.date + b.time_start))
                .map(ses => {
                  const dia = new Date(ses.date + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
                  return `${dia} · ${(ses.time_start || '').slice(0, 5)}–${(ses.time_end || '').slice(0, 5)}`;
                });
              enviarAviso({
                to: contactData.email.trim(),
                type: 'class_booked',
                data: {
                  customerName: contactData.nombre.trim(),
                  className: cls.title || label,
                  date: fechas.join(' | '),
                  message: `Tu reserva en Waya Surf School queda confirmada${fechas.length > 1 ? ` (${fechas.length} clases)` : ''}. Recuerda llegar 10 minutos antes. ¡Nos vemos en el agua!`,
                },
              })
                .then(() => showToast(`Confirmación enviada a ${contactData.email.trim()}`, 'success'))
                .catch(err => showToast('Reserva hecha, pero el email de confirmación falló: ' + err.message, 'error'));
            }

            // Caso común (responsable+familia = un bono): abrir la ficha de bono ÚNICA,
            // la misma que se ve desde clientes/reserva-clases/calendario. Multi-bono o
            // sin bono: el resumen de reserva clásico.
            if (singleBonoId) {
              if (overlay) overlay.remove();
              render();
              await openBonoFicha(singleBonoId, { onChange: render });
            } else {
              openReservationDetail(reservationData, overlay);
            }
          } catch (err) {
            console.error('Error creando reserva:', err);
            let msg = err.message || 'Error desconocido';
            if (err.code === '23505' || msg.includes('duplicate key') || msg.includes('idx_unique_enrollment')) {
              msg = 'Este cliente ya está inscrito en una de las sesiones seleccionadas.';
            } else if (err.code === '23503') {
              msg = 'Cliente o sesión no válidos (referencia rota).';
            } else if (err.details) {
              msg += ` (${err.details})`;
            }
            showToast('Error: ' + msg, 'error');
            btn.disabled = false;
            btn.textContent = 'Confirmar';
          }
        });
      }

      renderCheckout();
    }


    function openClientSearchForPerson(pid) {
      const searchOverlay = document.createElement('div');
      searchOverlay.className = 'bk-search-overlay';
      searchOverlay.innerHTML = `
        <div class="bk-search-dialog">
          <div class="bk-search-dialog-header">
            <h3>Vincular Cliente</h3>
            <button class="bk-search-close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="bk-search-body">
            <input type="text" class="bk-search-input" placeholder="Buscar por nombre o email…" autofocus />
            <div class="bk-search-results"></div>
          </div>
        </div>`;

      document.body.appendChild(searchOverlay);

      const input = searchOverlay.querySelector('.bk-search-input');
      const resultsEl = searchOverlay.querySelector('.bk-search-results');

      // Pinta una lista de clientes (+ sus familiares) y cablea el clic para vincular
      // SIN crear duplicados (se guarda profileId/familyMemberId del existente).
      function paintResults(allProfiles, familyMap) {
        if (!allProfiles.length) { resultsEl.innerHTML = '<p class="bk-search-hint">No se encontraron clientes</p>'; return; }
        resultsEl.innerHTML = allProfiles.map(pr => {
          const members = familyMap[pr.id] || [];
          let html = `
            <button class="bk-search-result" data-id="${pr.id}" data-name="${pr.full_name || ''}" data-type="profile">
              <div><strong>${pr.full_name || 'Sin nombre'}</strong><small style="color:#888;display:block">${pr.phone ? pr.phone : ''}</small></div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
            </button>`;
          if (members.length) {
            html += members.map(m => {
              const age = m.birth_date ? new Date().getFullYear() - new Date(m.birth_date).getFullYear() : null;
              return `
                <button class="bk-search-result" data-id="${pr.id}" data-name="${m.full_name}" data-family-id="${m.id}" data-type="family" style="padding-left:36px;border-left:3px solid #1a1a1a">
                  <div><small style="color:#1a1a1a;font-weight:600">↳ Familiar de ${pr.full_name || 'cuenta'}</small><strong style="display:block">${m.full_name}</strong>${age ? `<small style="color:#888">${age} años</small>` : ''}</div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
                </button>`;
            }).join('');
          }
          return html;
        }).join('');
        resultsEl.querySelectorAll('.bk-search-result').forEach(btn => {
          btn.addEventListener('click', () => {
            const p = persons.find(p => String(p.id) === pid);
            if (p) {
              p.profileId = btn.dataset.id;
              p.profileName = btn.dataset.name;
              p.familyMemberId = btn.dataset.familyId || null;
              p.nombre = '';
              p.apellidos = '';
            }
            searchOverlay.remove();
            renderPanel();
          });
        });
      }

      // En modo "ampliar": pre-carga los familiares del titular del bono para elegirlos
      // directamente (sin teclear → sin duplicar "2 Borjas").
      const titularId = extendMode ? (prefill?.profileId || null) : null;
      if (titularId) {
        (async () => {
          try {
            const [{ data: prof }, { data: members }] = await Promise.all([
              supabase.from('profiles').select('id, full_name, phone').eq('id', titularId).single(),
              supabase.from('family_members').select('id, full_name, birth_date').eq('user_id', titularId).order('created_at'),
            ]);
            if (prof) paintResults([prof], { [titularId]: members || [] });
          } catch {}
        })();
      }

      let debounce = null;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const term = input.value.trim();
          if (term.length < 2) {
            resultsEl.innerHTML = '<p class="bk-search-hint">Escribe al menos 2 caracteres</p>';
            return;
          }
          resultsEl.innerHTML = '<p class="bk-search-hint">Buscando…</p>';
          try {
            // Search profiles AND family_members in parallel
            const safeTerm = term.replace(/[%_\\]/g, '');
            const [profiles, familyDirectHits] = await Promise.all([
              searchProfiles(term),
              supabase.from('family_members').select('id, full_name, birth_date, user_id')
                .ilike('full_name', `%${safeTerm}%`).limit(10)
                .then(r => r.data || []).catch(() => []),
            ]);

            // Fetch family members for each profile found
            const profileIds = profiles.map(pr => pr.id);
            const familyPromises = profiles.map(pr =>
              supabase.from('family_members').select('id, full_name, birth_date').eq('user_id', pr.id).order('created_at')
                .then(r => ({ userId: pr.id, members: r.data || [] }))
                .catch(() => ({ userId: pr.id, members: [] }))
            );
            const familyResults = await Promise.all(familyPromises);
            const familyMap = {};
            familyResults.forEach(r => { familyMap[r.userId] = r.members; });

            // For direct family hits not already under a found profile, fetch their parent
            const extraParentIds = [...new Set(familyDirectHits.filter(m => !profileIds.includes(m.user_id)).map(m => m.user_id))];
            let extraParents = {};
            if (extraParentIds.length) {
              const { data: parents } = await supabase.from('profiles').select('id, full_name, phone').in('id', extraParentIds);
              if (parents) parents.forEach(p => { extraParents[p.id] = p; });
              // Also fetch their family members
              for (const parentId of extraParentIds) {
                if (!familyMap[parentId]) {
                  const { data: members } = await supabase.from('family_members').select('id, full_name, birth_date').eq('user_id', parentId).order('created_at');
                  familyMap[parentId] = members || [];
                }
              }
            }

            // Build combined results: profiles first, then extra parents from direct family hits
            const allProfiles = [...profiles];
            for (const parentId of extraParentIds) {
              if (extraParents[parentId] && !allProfiles.find(p => p.id === parentId)) {
                allProfiles.push(extraParents[parentId]);
              }
            }

            paintResults(allProfiles, familyMap);
          } catch (err) {
            resultsEl.innerHTML = `<p class="bk-search-hint" style="color:#b91c1c">Error: ${err.message}</p>`;
          }
        }, 300);
      });

      searchOverlay.querySelector('.bk-search-close').addEventListener('click', () => searchOverlay.remove());
      searchOverlay.addEventListener('click', (e) => {
        if (e.target === searchOverlay) searchOverlay.remove();
      });
    }

    renderPanel();
  }

  // ======== RESERVATION DETAIL VIEW ========
  function openReservationDetail(res, overlay) {
    const now = res.createdAt;
    const dateStr = `${DAY_NAMES_FULL[now.getDay()].toLowerCase()}, ${now.getDate()} de ${MONTH_NAMES[now.getMonth()].toLowerCase().replace('.', '')} de ${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const shortId = res.id.slice(0, 24);
    let statusLabel, statusColor, pendingColor;
    function recomputeStatusVars() {
      statusLabel = res.status === 'paid' ? 'Pagado' : res.status === 'partial' ? 'Pago parcial' : res.pending > 0 ? 'Pendiente' : 'Confirmado';
      statusColor = res.status === 'paid' ? '#166534' : res.status === 'partial' ? '#d97706' : res.pending > 0 ? '#b91c1c' : '#1a1a1a';
      pendingColor = res.pending > 0 ? '#b91c1c' : '#166534';
    }
    recomputeStatusVars();
    let activeTab = 'resumen';

    // Async loaded data
    let clientHistory = null; // all enrollments for this user
    let clientCreditBalance = 0;

    // Session dates for check-in/out
    const sessionDates = res.sessions.map(s => s.date).sort();
    const checkIn = sessionDates[0] || '';
    const checkOut = sessionDates[sessionDates.length - 1] || '';

    function getInitial(name) {
      return (name || '?')[0].toUpperCase();
    }

    function formatDetailDate(ds) {
      if (!ds) return '';
      const d = new Date(ds + 'T00:00:00');
      return `${DAY_NAMES_SHORT[d.getDay()].toLowerCase()}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()].toLowerCase()}`;
    }

    function renderDetail() {
      recomputeStatusVars(); // refresca badge/colores tras cambios de pago
      // Build persons + sessions table
      let personsHtml = '';
      res.persons.forEach(p => {
        const name = p.profileId ? p.profileName : `${p.nombre} ${p.apellidos}`.trim();
        const initial = getInitial(name);

        // Get sessions for this person
        const personSessions = p.sessions.map(sid => {
          return res.sessions.find(s => s.id === sid);
        }).filter(Boolean);

        // Asistente: puede ser un familiar (niño) distinto del titular que reservó.
        const fm = res.familyMember;
        const att = fm || res.profile || {};
        const attName = fm ? `${fm.full_name || ''} ${fm.last_name || ''}`.trim() : name;
        const titularName = res.profile?.full_name || name;
        const LVL = { principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' };
        const swim = att.can_swim === true ? 'Sí' : att.can_swim === false ? 'No' : '—';
        const talla = att.wetsuit_size || '—';
        const nivel = att.level ? (LVL[att.level] || att.level) : null;
        let edad = null;
        if (att.birth_date) { const b = new Date(att.birth_date); const n = new Date(); edad = n.getFullYear() - b.getFullYear() - ((n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) ? 1 : 0); }
        const lesion = att.has_injury ? (att.injury_detail || 'Sí') : null;

        personsHtml += `
          <div class="rv-person-card">
            <div class="rv-person-header">
              <div class="rv-person-avatar" style="background:${res.activityColor}">${getInitial(attName)}</div>
              <div class="rv-person-info">
                <span class="rv-person-name">${attName}</span>
                ${fm ? `<span class="rv-lang-badge" style="background:#fef3c7;color:#92400e">Familiar de ${titularName}</span>` : `<span class="rv-lang-badge">Titular</span>`}
              </div>
              ${p.profileId
                ? `<button class="rv-open-client" data-uid="${p.profileId}" style="flex:0 0 auto;margin-left:auto;font-size:.78rem;font-weight:600;padding:7px 14px;color:#1a1a1a;background:#fff;border:1px solid #bae6fd;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap">
                Ver ficha completa
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>`
                : `<span style="flex:0 0 auto;margin-left:auto;font-size:.72rem;color:#92400e;background:#fef3c7;padding:4px 10px;border-radius:20px;white-space:nowrap">Sin cuenta de cliente</span>`}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 18px;padding:14px 22px;border-bottom:1px solid rgba(0,0,0,.05);font-size:.85rem;color:var(--color-navy,#0f2f39)">
              <span>🏊 <span style="color:var(--color-muted,#64748b)">Sabe nadar:</span> <strong>${swim}</strong></span>
              <span>🩱 <span style="color:var(--color-muted,#64748b)">Talla:</span> <strong>${talla}</strong></span>
              ${nivel ? `<span>📈 <span style="color:var(--color-muted,#64748b)">Nivel:</span> <strong>${nivel}</strong></span>` : ''}
              ${edad != null ? `<span>🎂 <span style="color:var(--color-muted,#64748b)">Edad:</span> <strong>${edad}</strong></span>` : ''}
              ${lesion ? `<span style="color:#b91c1c">⚠ <strong>Lesión:</strong> ${lesion}</span>` : ''}
            </div>
            <table class="rv-sessions-table">
              <thead>
                <tr><th>Fechas</th><th>Producto</th></tr>
              </thead>
              <tbody>
                ${personSessions.map(s => `
                  <tr>
                    <td>${formatDetailDate(s.date)} / ${s.time_start?.slice(0,5)} a ${s.time_end?.slice(0,5)}</td>
                    <td>
                      <span class="rv-product-icon">⚡</span>
                      <span class="rv-product-qty">1</span>
                      <span class="rv-product-name">${TYPE_LABELS[s.type] || s.title}</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      });

      // Tabs content
      let tabContent = '';
      if (activeTab === 'resumen') {
        // Build bonos section for linked persons
        let bonosHtml = '';
        let bonoCards = '';
        let creditHtml = '';
        const linkedPersons = res.persons.filter(p => p.profileId);
        if (linkedPersons.length > 0 || res.personCredits) {
          for (const p of res.persons) {
            const pc = res.personCredits?.[p.id];
            if (!pc || !pc.allBonos?.length) continue;
            const name = p.profileName || `${p.nombre} ${p.apellidos}`.trim();
            bonoCards += pc.allBonos.map(b => {
              const remaining = b.total_credits - b.used_credits;
              const isSelected = pc.selectedBonoId === b.id && pc.useCredit;
              const paidPct = b.expectedPrice > 0 ? Math.min(100, (b.totalPaidReal / b.expectedPrice) * 100) : 0;
              const cardStyle = isSelected
                ? (b.isFullyPaid ? 'border-color:#22c55e;background:#f0fdf4;box-shadow:0 0 0 2px #22c55e40' : 'border-color:#f59e0b;background:#fffbeb;box-shadow:0 0 0 2px #f59e0b40')
                : b.isFullyPaid ? 'border-color:#22c55e;background:#f0fdf4' : '';
              const badgeHtml = isSelected
                ? (b.isFullyPaid
                  ? '<span style="font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:20px;background:#22c55e;color:#fff">En uso · Pagado</span>'
                  : '<span class="rv-bono-badge rv-bono-badge-active">En uso</span>')
                : b.isFullyPaid
                  ? '<span style="font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:20px;background:#dcfce7;color:#166534">PAGADO</span>'
                  : '<span class="rv-bono-badge">Disponible</span>';
              const payBtnHtml = (!b.isFullyPaid && b.pendingAmount > 0)
                ? `<button class="rv-bono-pay-btn" data-bono-id="${b.id}" data-pending="${b.pendingAmount.toFixed(2)}" data-person-id="${p.id}">Pagar ${b.pendingAmount.toFixed(2)}€</button>`
                : b.isFullyPaid
                  ? '<span style="color:#166534;font-size:.75rem;font-weight:600">PAGADO</span>'
                  : '';
              const expandBtnHtml = `<button class="rv-bono-expand-btn" data-bono-id="${b.id}" data-person-id="${p.id}" title="Ampliar bono">+ Ampliar</button>`;
              return `
                <div class="rv-bono-card ${isSelected ? 'rv-bono-active' : ''}" data-person-id="${p.id}" data-bono-id="${b.id}" style="${cardStyle}">
                  <div class="rv-bono-header">
                    <span class="rv-bono-name">${name}</span>
                    ${badgeHtml}
                  </div>
                  <div class="rv-bono-details">
                    <span>${TYPE_LABELS[b.class_type] || b.class_type} · ${b.used_credits}/${b.total_credits} clases</span>
                  </div>
                  <div class="rv-bono-pay-row">
                    <div class="rv-bono-bar"><div class="rv-bono-bar-fill" style="width:${paidPct}%;background:${b.isFullyPaid ? '#22c55e' : '#f59e0b'}"></div></div>
                    <span class="rv-bono-pay-label">${b.totalPaidReal.toFixed(2)}€ / ${b.expectedPrice.toFixed(2)}€</span>
                    ${payBtnHtml}
                    ${expandBtnHtml}
                  </div>
                </div>`;
            }).join('');
          }

          // Credit balance
          for (const p of res.persons) {
            if (!p.profileId) continue;
            // We'll load this async, but show placeholder
            creditHtml += `<div class="rv-credit-row" data-profile-id="${p.profileId}" data-person-name="${p.profileName || p.nombre}"></div>`;
          }

        }
        // "Bonos y Saldo" siempre visible (con botón Crear bono) si el cliente tiene cuenta
        if (linkedPersons.length > 0) {
          bonosHtml = `
            <div class="rv-info-card" style="margin-top:16px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:18px 24px 14px;border-bottom:1px solid rgba(0,0,0,.05)">
                <h3 style="margin:0;padding:0;border:none;font-family:'Space Grotesk',sans-serif;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b">Bonos y Saldo</h3>
                <button id="rv-new-bono-saldo" style="flex:0 0 auto;font-size:.78rem;padding:7px 14px;background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;font-weight:600"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Crear bono</button>
              </div>
              <div style="padding:16px 24px">
                ${bonoCards
                  ? `<p style="margin:0 0 12px;font-size:.78rem;color:var(--color-muted,#64748b)">Pulsa un bono para <strong>gastarle un crédito</strong> en esta clase (o púlsalo de nuevo para soltarla y pagarla aparte).</p>${bonoCards}`
                  : `<p style="margin:0;font-size:.78rem;color:var(--color-muted,#64748b)">Este cliente no tiene bonos de este tipo. Crea uno para gastar créditos en sus clases.</p>`}
                <div id="rv-credit-balances" style="margin-top:${creditHtml ? '12px' : '0'}">${creditHtml}</div>
              </div>
            </div>`;
        }

        // Los datos del asistente (familiar o titular) ya se muestran en la tarjeta
        // del asistente (personsHtml), sin duplicar.
        const beneficiarioHtml = '';

        // Familia: titular (tutor) + niños asociados. Cada uno enlaza a la ficha
        // del tutor (mismo deep-link que "Ver ficha completa"); pinchando en
        // cualquier hijo se llega al tutor, que lista a todos los hermanos.
        let familiaHtml = '';
        if (res.profile && ((res.siblings && res.siblings.length) || res.familyMember)) {
          const tut = res.profile;
          const tutName = `${tut.full_name || ''} ${tut.last_name || ''}`.trim() || 'Titular';
          const kids = res.siblings || [];
          const kidsCells = kids.length
            ? kids.map(k => {
                const kn = `${k.full_name || ''} ${k.last_name || ''}`.trim() || 'Familiar';
                const isThis = res.familyMember && k.id === res.familyMember.id;
                return `<div class="rv-open-client" data-uid="${tut.id}" style="cursor:pointer;margin-bottom:8px">
                  <span class="rv-who-tag rv-who-tag-child">${isThis ? 'En esta clase' : 'Familiar'}</span>
                  <div class="rv-who-name">${escapeHtml(kn)}</div>
                </div>`;
              }).join('')
            : `<div style="font-size:.84rem;color:var(--color-muted,#64748b)">Sin familiares registrados</div>`;
          familiaHtml = `
            <div class="rv-info-card" style="margin-top:16px">
              <div style="padding:18px 24px 4px"><h3 style="margin:0;font-family:'Space Grotesk',sans-serif;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b">Familia · pincha para abrir la ficha del tutor</h3></div>
              <div class="rv-who-grid">
                <div class="rv-open-client" data-uid="${tut.id}" style="cursor:pointer">
                  <span class="rv-who-tag rv-who-tag-holder">Titular / tutor</span>
                  <div class="rv-who-name">${escapeHtml(tutName)}</div>
                  <div class="rv-who-meta">${tut.phone ? `<span>${escapeHtml(tut.phone)}</span>` : ''}${tut.email ? `<span>${escapeHtml(tut.email)}</span>` : ''}</div>
                </div>
                <div>${kidsCells}</div>
              </div>
            </div>`;
        }

        tabContent = `
          <div class="rv-summary-header">
            <h2 class="rv-title">Resumen de la reserva <span class="rv-status-badge" style="background:${statusColor}15;color:${statusColor}">${statusLabel}</span></h2>
          </div>
          <div class="rv-info-card">
            <div class="rv-info-top">
              <div class="rv-info-top-left">
                <div class="rv-info-id">Reserva #${res.id.slice(0, 8).toUpperCase()}</div>
                <div class="rv-info-created">Creada el ${dateStr} · Por ADMIN</div>
              </div>
              <div class="rv-info-top-right">
                <div class="rv-info-stat">
                  <label>Total${res.bonoId ? ' (bono, editable)' : ''}</label>
                  ${res.bonoId
                    ? `<span class="rv-info-amount" style="display:inline-flex;align-items:center;gap:2px"><input type="number" id="rv-total-edit" value="${Number(res.totalFinal).toFixed(2)}" step="0.01" min="0" style="width:96px;font:inherit;font-weight:700;border:1px solid #e2e8f0;border-radius:8px;padding:2px 6px;text-align:right" title="Total del bono (descuento / precio a medida)">€</span>`
                    : `<span class="rv-info-amount">${res.totalFinal.toFixed(2)}€</span>`}
                </div>
                <div class="rv-info-stat">
                  <label>Pendiente</label>
                  <span class="rv-info-amount" style="color:${pendingColor}">${res.pending.toFixed(2)}€</span>
                </div>
                <button class="rv-add-payment-btn" id="rv-add-payment">+ Añadir pago</button>
              </div>
            </div>
            <div class="rv-info-bottom">
              <div class="rv-info-detail">
                <label>Reservado por</label>
                <div>
                  <strong>${res.contact.nombre} ${res.contact.apellidos}</strong>
                  <span class="rv-lang-badge">${res.contact.idioma || 'Español'}</span>
                </div>
                <div class="rv-contact-links">
                  ${res.contact.telefono ? `<a class="rv-contact-link" href="https://wa.me/${String(res.contact.telefono).replace(/\D/g, '')}" target="_blank" rel="noopener" title="Abrir WhatsApp"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#25d366" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg> ${escapeHtml(res.contact.telefono)}</a>` : ''}
                  ${res.contact.email ? `<a class="rv-contact-link" href="mailto:${res.contact.email}" title="Enviar email"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${escapeHtml(res.contact.email)}</a>` : ''}
                </div>
              </div>
              <div class="rv-info-detail">
                <label>Check in / Check out</label>
                <div class="rv-check-dates">
                  <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formatDetailDate(checkIn)}</span>
                  <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formatDetailDate(checkOut)}</span>
                </div>
              </div>
              <div class="rv-info-detail">
                <label>Personas</label>
                <div class="rv-persons-count">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/></svg>
                  ${res.persons.length}
                </div>
              </div>
            </div>
          </div>
          ${beneficiarioHtml}
          ${bonosHtml}
          ${personsHtml}
          ${familiaHtml}`;
      } else if (activeTab === 'datos_comprador') {
        const prof = res.profile;
        const fm = res.familyMember;
        let buyerHtml = '';
        // Helper: compute age from birth_date
        function computeAge(bd) {
          if (!bd) return null;
          const today = new Date();
          const birth = new Date(bd);
          let age = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
          return age;
        }
        const swimLabel = (v) => v === true ? 'Sí' : v === false ? 'No' : 'Sin definir';
        const injuryLabel = (v) => v ? 'Sí' : 'No';

        // Build health & equipment section for a profile or family member
        function buildHealthSection(data) {
          if (!data) return '';
          return `
            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:24px 0 12px">Salud y equipamiento</h3>
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>¿Sabe nadar?</label><input type="text" value="${swimLabel(data.can_swim)}" readonly /></div>
              <div class="bk-contact-field"><label>¿Tiene lesión?</label><input type="text" value="${injuryLabel(data.has_injury)}" readonly /></div>
              ${data.has_injury ? `<div class="bk-contact-field"><label>Detalle lesión</label><input type="text" value="${data.injury_detail || ''}" readonly /></div>` : ''}
              <div class="bk-contact-field"><label>Talla neopreno</label><input type="text" value="${data.wetsuit_size || 'Sin definir'}" readonly /></div>
              ${data.level ? `<div class="bk-contact-field"><label>Nivel</label><input type="text" value="${data.level}" readonly /></div>` : ''}
              ${data.notes ? `<div class="bk-contact-field"><label>Notas</label><input type="text" value="${data.notes}" readonly /></div>` : ''}
            </div>`;
        }

        if (fm) {
          const fmAge = computeAge(fm.birth_date);
          buyerHtml = `
            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:0 0 12px">Beneficiario (familiar)</h3>
            <div class="bk-contact-fields" style="margin-bottom:0">
              <div class="bk-contact-field"><label>Nombre</label><input type="text" value="${fm.full_name || fm.name || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Apellidos</label><input type="text" value="${fm.last_name || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Edad</label><input type="text" value="${fmAge != null ? fmAge + ' años' : (fm.birth_date || '')}" readonly /></div>
              <div class="bk-contact-field"><label>Fecha nacimiento</label><input type="text" value="${fm.birth_date || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Relación</label><input type="text" value="${fm.relationship || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Nivel</label><input type="text" value="${fm.level || ''}" readonly /></div>
            </div>
            ${buildHealthSection(fm)}

            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:24px 0 12px">Titular de la cuenta</h3>
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>Nombre completo</label><input type="text" value="${prof?.full_name || res.contact.nombre + ' ' + res.contact.apellidos}" readonly /></div>
              <div class="bk-contact-field"><label>Apellidos</label><input type="text" value="${prof?.last_name || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Email</label><input type="email" value="${prof?.email || res.contact.email || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Teléfono</label><input type="tel" value="${prof?.phone || res.contact.telefono || ''}" readonly /></div>
            </div>
            ${buildHealthSection(prof)}
            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:24px 0 12px">Dirección</h3>
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>Dirección</label><input type="text" value="${prof?.address || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Ciudad</label><input type="text" value="${prof?.city || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Código postal</label><input type="text" value="${prof?.postal_code || ''}" readonly /></div>
            </div>`;
        } else {
          const profAge = computeAge(prof?.birth_date);
          buyerHtml = `
            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:0 0 12px">Datos personales</h3>
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>Nombre completo</label><input type="text" value="${prof?.full_name || res.contact.nombre + ' ' + res.contact.apellidos}" readonly /></div>
              <div class="bk-contact-field"><label>Apellidos</label><input type="text" value="${prof?.last_name || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Email</label><input type="email" value="${prof?.email || res.contact.email || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Teléfono</label><input type="tel" value="${prof?.phone || res.contact.telefono || ''}" readonly /></div>
              ${profAge != null ? `<div class="bk-contact-field"><label>Edad</label><input type="text" value="${profAge} años" readonly /></div>` : ''}
              <div class="bk-contact-field"><label>Rol</label><input type="text" value="${prof?.role === 'admin' ? 'Admin' : 'Cliente'}" readonly /></div>
            </div>
            ${buildHealthSection(prof)}
            <h3 style="font-size:.85rem;font-weight:700;color:#0f2f39;margin:24px 0 12px">Dirección</h3>
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>Dirección</label><input type="text" value="${prof?.address || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Ciudad</label><input type="text" value="${prof?.city || ''}" readonly /></div>
              <div class="bk-contact-field"><label>Código postal</label><input type="text" value="${prof?.postal_code || ''}" readonly /></div>
            </div>`;
        }
        tabContent = `
          <h2 class="rv-title">Datos del Comprador</h2>
          <div class="rv-info-card" style="padding:24px">
            ${buyerHtml}
          </div>`;
      } else if (activeTab === 'datos_internos') {
        tabContent = `
          <h2 class="rv-title">Datos Internos</h2>
          <div class="rv-info-card" style="padding:24px">
            <div class="bk-contact-fields">
              <div class="bk-contact-field"><label>ID Reserva</label><input type="text" value="${res.id}" readonly /></div>
              <div class="bk-contact-field"><label>Creada</label><input type="text" value="${dateStr}" readonly /></div>
              <div class="bk-contact-field"><label>Estado</label><input type="text" value="${statusLabel}" readonly /></div>
              <div class="bk-contact-field"><label>Origen</label><input type="text" value="Manual (Admin)" readonly /></div>
              <div class="bk-contact-field full-width">
                <label>Notas internas</label>
                <textarea class="rv-notes-textarea" id="rv-notes" rows="4" placeholder="Añadir notas internas sobre esta reserva…"></textarea>
              </div>
            </div>
          </div>`;
      } else if (activeTab === 'pagos') {
        const METHOD_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', voucher: 'Voucher', saldo: 'Saldo a favor', online: 'Online' };
        const allPayments = [...(res.payments || [])];
        if (res.cobrarAnticipo && res.anticipoAmount > 0) {
          allPayments.unshift({ amount: res.anticipoAmount, method: res.paymentMethod, date: res.createdAt.toISOString(), creditUsed: 0 });
        }
        const totalPaid = allPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

        let paymentsListHtml = '';
        if (allPayments.length) {
          paymentsListHtml = allPayments.map((p, idx) => {
            const d = new Date(p.date || p.payment_date);
            const methodKey = p.method || p.payment_method;
            const amt = Number(p.amount || 0);
            const creditUsed = Number(p.creditUsed || 0);
            const dateLabel = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const payId = p.id || '';
            const isAnticipo = idx === 0 && res.cobrarAnticipo && res.anticipoAmount > 0;
            const channelLabel = p.channel === 'web' || methodKey === 'online' ? ' · web' : (p.channel === 'in_person' ? ' · en playa' : '');
            const actionBtns = payId && !isAnticipo
              ? `<button class="rv-edit-payment-btn" data-payment-id="${payId}" title="Editar pago" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px 4px;margin-left:6px;border-radius:4px;transition:color .15s">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="rv-delete-payment-btn" data-payment-id="${payId}" data-payment-amount="${amt}" title="Eliminar pago" style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:2px 4px;border-radius:4px;transition:color .15s">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                </button>`
              : '';
            return `
              <div class="rv-pay-row" style="align-items:center">
                <span>${dateLabel} · ${METHOD_LABELS[methodKey] || methodKey}${channelLabel}${creditUsed > 0 ? ` (${creditUsed.toFixed(2)}€ saldo)` : ''}${p.concept ? ` · ${p.concept}` : ''}</span>
                <span style="display:flex;align-items:center;gap:2px">
                  <strong style="color:#166534">+${amt.toFixed(2)}€</strong>
                  ${actionBtns}
                </span>
              </div>`;
          }).join('');
        } else {
          paymentsListHtml = '<p style="font-size:.85rem;color:#6b7280">No hay pagos registrados</p>';
        }

        tabContent = `
          <h2 class="rv-title">Pagos</h2>
          <div class="rv-info-card" style="padding:24px">
            <div class="rv-payments-summary">
              <div class="rv-pay-row"><span>Total reserva</span><strong>${res.totalFinal.toFixed(2)}€</strong></div>
              ${res.discount > 0 ? `<div class="rv-pay-row"><span>Descuento</span><span style="color:#b91c1c">-${res.discount.toFixed(2)}€</span></div>` : ''}
              <div class="rv-pay-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span>Total pagado</span><strong style="color:#166534">${totalPaid.toFixed(2)}€</strong></div>
              <div class="rv-pay-row total"><span>Pendiente</span><strong style="color:${pendingColor}">${res.pending.toFixed(2)}€</strong></div>
            </div>
            <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #e5e7eb">
              <h4 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:0 0 8px">Historial de pagos</h4>
              ${paymentsListHtml}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
              <button class="rv-add-payment-btn" id="rv-add-payment-tab">+ Añadir pago</button>
              <button class="rv-add-payment-btn" id="rv-new-bono-tab" style="background:#fff;color:#1a1a1a;border:1px solid #1a1a1a">+ Crear bono</button>
            </div>
          </div>`;
      } else if (activeTab === 'historico') {
        // Build timeline from real data
        let timelineItems = '';

        // 1. Reservation created
        timelineItems += `
          <div class="rv-timeline-item">
            <div class="rv-timeline-dot" style="background:#22c55e"></div>
            <div class="rv-timeline-content">
              <strong>Reserva creada</strong>
              <span>${dateStr}</span>
              <small>Por ADMIN · Manual</small>
            </div>
          </div>`;

        // 2. Initial payment if applicable
        if (res.cobrarAnticipo && res.anticipoAmount > 0) {
          timelineItems += `
            <div class="rv-timeline-item">
              <div class="rv-timeline-dot" style="background:#1a1a1a"></div>
              <div class="rv-timeline-content">
                <strong>Anticipo registrado (${res.paymentMethod})</strong>
                <span>${dateStr}</span>
                <small>${res.anticipoAmount.toFixed(2)}€</small>
              </div>
            </div>`;
        }

        // 3. All recorded payments
        const METHOD_LABELS_H = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', voucher: 'Voucher', saldo: 'Saldo a favor', online: 'Online' };
        (res.payments || []).forEach(p => {
          const d = new Date(p.date || p.payment_date);
          const dLabel = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          timelineItems += `
            <div class="rv-timeline-item">
              <div class="rv-timeline-dot" style="background:#1a1a1a"></div>
              <div class="rv-timeline-content">
                <strong>Pago registrado (${METHOD_LABELS_H[p.method || p.payment_method] || p.method || p.payment_method})</strong>
                <span>${dLabel}</span>
                <small>+${Number(p.amount).toFixed(2)}€${p.concept ? ` · ${p.concept}` : ''}</small>
              </div>
            </div>`;
        });

        // 4. Client enrollment history (loaded async)
        let historyHtml = '<div id="rv-client-history" style="margin-top:20px"><p style="font-size:.85rem;color:#6b7280">Cargando historial del cliente...</p></div>';

        tabContent = `
          <h2 class="rv-title">Histórico</h2>
          <div class="rv-info-card" style="padding:24px">
            <h4 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:0 0 12px">Actividad de esta reserva</h4>
            <div class="rv-timeline">${timelineItems}</div>
          </div>
          ${historyHtml}`;
      }

      const detailHtml = `
        <div class="rv-layout">
          <nav class="rv-sidebar">
            <a class="rv-nav-item ${activeTab === 'resumen' ? 'active' : ''}" data-tab="resumen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Resumen
            </a>
            <div class="rv-nav-group">Cliente</div>
            <a class="rv-nav-item ${activeTab === 'datos_comprador' ? 'active' : ''}" data-tab="datos_comprador">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4-4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Datos del comprador
            </a>
            <div class="rv-nav-group">Gestión</div>
            <a class="rv-nav-item ${activeTab === 'datos_internos' ? 'active' : ''}" data-tab="datos_internos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Datos internos
            </a>
            <a class="rv-nav-item ${activeTab === 'pagos' ? 'active' : ''}" data-tab="pagos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Pagos
            </a>
            <a class="rv-nav-item ${activeTab === 'historico' ? 'active' : ''}" data-tab="historico">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Histórico
            </a>
          </nav>

          <main class="rv-main">
            ${tabContent}
          </main>

          <aside class="rv-actions">
            <button class="rv-action-link danger" id="rv-cancel">
              <span>Cancelar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </button>
            <button class="rv-action-link" id="rv-ampliar">
              <span>Ampliar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="rv-action-link" id="rv-move">
              <span>Mover de día</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14l2 2 4-4"/></svg>
            </button>
            <button class="rv-action-link" id="rv-send-email">
              <span>Enviar Email</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
            <div class="rv-actions-separator"></div>
            <div class="rv-other-details">
              <div class="rv-other-title">Otros Detalles</div>
              <div class="rv-other-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Manual
              </div>
            </div>
          </aside>
        </div>`;

      // Replace panel content
      const panel = overlay.querySelector('.bk-panel');
      if (!panel) return;

      // Update header
      const panelHeader = panel.querySelector('.bk-panel-header');
      if (panelHeader) {
        panelHeader.innerHTML = `
          <div class="bk-header-left" style="display:flex;align-items:center;gap:14px">
            <button class="bk-close-btn" id="rv-close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <span class="bk-header-title">Ficha de Reserva</span>
            <span style="font-family:'Space Grotesk',sans-serif;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.7;background:rgba(255,255,255,.15);padding:3px 10px;border-radius:5px">${res.activityLabel || ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-family:'Space Grotesk',sans-serif;font-size:.72rem;font-weight:600;opacity:.8">#${shortId.slice(0,8)}</span>
          </div>`;
        panelHeader.style.background = `linear-gradient(135deg, ${res.activityColor}, ${res.activityColor}dd)`;
        // Remove confirm button area
        const headerRight = panelHeader.querySelector('.bk-header-right');
        if (headerRight) headerRight.remove();
      }

      // Replace body
      const panelBody = panel.querySelector('.bk-panel-body');
      if (panelBody) {
        panelBody.outerHTML = `<div class="bk-panel-body" style="padding:0">${detailHtml}</div>`;
      }

      // Make panel fullscreen for reservation detail
      panel.classList.add('bk-panel-fullscreen');
      overlay.classList.add('bk-overlay-fullscreen');

      bindDetailEvents(overlay, res);
    }

    function bindDetailEvents(overlay, res) {
      // Close
      overlay.querySelector('#rv-close')?.addEventListener('click', () => {
        overlay.remove();
        render();
      });

      // Tab navigation
      overlay.querySelectorAll('.rv-nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const tab = item.dataset.tab;
          if (tab) {
            activeTab = tab;
            renderDetail(); // renderDetail() already calls bindDetailEvents()
          }
        });
      });

      // Add payment buttons
      overlay.querySelector('#rv-add-payment')?.addEventListener('click', () => openAddPaymentModal(res, overlay));
      overlay.querySelector('#rv-add-payment-tab')?.addEventListener('click', () => openAddPaymentModal(res, overlay));

      // Recarga el histórico de pagos de la reserva (bono + inscripción)
      async function reloadResPayments() {
        const _bonoRef = res.bonoId || res.linkedBonoId; // recalculado: puede cambiar al enganchar/desenganchar
        res.payments = _bonoRef
          ? [...(await fetchPayments('bono', _bonoRef)), ...(await fetchPayments('enrollment', res.id))]
          : await fetchPayments('enrollment', res.id);
        const totalPaid = res.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        res.pending = Math.max(0, Math.round((res.totalFinal - totalPaid) * 100) / 100);
        res.status = totalPaid <= 0 ? 'confirmed' : (res.pending <= 0 ? 'paid' : 'partial');
      }

      // Editar el total del bono (descuento / precio a medida) → bonos.custom_total
      overlay.querySelector('#rv-total-edit')?.addEventListener('change', async (e) => {
        if (!res.bonoId) return;
        const v = parseFloat(e.target.value);
        if (!(v >= 0)) { e.target.value = Number(res.totalFinal).toFixed(2); return; }
        try {
          await supabase.from('bonos').update({ custom_total: v, updated_at: new Date().toISOString() }).eq('id', res.bonoId);
          res.totalFinal = v;
          await reloadResPayments();
          showToast('Total del bono actualizado', 'success');
          renderDetail();
          render(); // refresca colores del calendario
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
      // Mantiene total_paid del bono = suma de sus pagos (al editar/borrar)
      async function syncBonoPaid() {
        if (!res.linkedBonoId) return;
        await recalcBonoPaid(res.linkedBonoId);
      }

      // Editar pago (método/fecha/concepto) — da igual web o playa
      overlay.querySelectorAll('.rv-edit-payment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pay = (res.payments || []).find(p => p.id === btn.dataset.paymentId);
          if (!pay) return;
          openPaymentEditModal(pay, { onSaved: async () => { await reloadResPayments(); renderDetail(); } });
        });
      });

      // Delete payment buttons
      overlay.querySelectorAll('.rv-delete-payment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const paymentId = btn.dataset.paymentId;
          const paymentAmount = parseFloat(btn.dataset.paymentAmount) || 0;
          if (!paymentId) return;

          if (!confirm(`¿Eliminar este pago de ${paymentAmount.toFixed(2)}€? El importe se sumará al pendiente.`)) return;

          btn.disabled = true;
          try {
            await deletePayment(paymentId);
            await syncBonoPaid();          // si era pago de bono, recalcula su total_paid
            await reloadResPayments();     // refresca histórico + pendiente + estado
            if (res.linkedBonoId) {
              // Coherencia: las inscripciones del bono siguen el estado de pago del bono
              await supabase.from('class_enrollments').update({ status: res.status })
                .eq('bono_id', res.linkedBonoId).neq('status', 'cancelled');
            } else {
              await updateEnrollmentStatus(res.id, res.status).catch(() => {});
            }

            showToast('Pago eliminado', 'success');
            renderDetail();
            render(); // refresca el color del grid del calendario
          } catch (err) {
            showToast('Error al eliminar: ' + err.message, 'error');
            btn.disabled = false;
          }
        });
      });

      // Bono card clicks — engancha/desengancha la inscripción al bono (gasta/libera
      // un crédito). Es opcional: si la clase se paga aparte, se deja sin enganchar.
      overlay.querySelectorAll('.rv-bono-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.rv-bono-pay-btn') || e.target.closest('.rv-bono-expand-btn')) return;
          const pid = card.dataset.personId;
          const bid = card.dataset.bonoId;
          const pc = res.personCredits?.[pid];
          if (!pc) return;
          const bono = pc.allBonos?.find(b => b.id === bid);
          const turningOn = !(pc.selectedBonoId === bid && pc.useCredit);
          card.style.pointerEvents = 'none';
          try {
            if (turningOn) {
              if (bono && (Number(bono.total_credits) - Number(bono.used_credits)) <= 0) {
                showToast('Ese bono no tiene créditos libres', 'error'); card.style.pointerEvents = ''; return;
              }
              const newStatus = bono?.isFullyPaid ? 'paid' : 'confirmed';
              const { error } = await supabase.from('class_enrollments').update({ bono_id: bid, status: newStatus }).eq('id', res.id);
              if (error) throw error;
              pc.useCredit = true; pc.selectedBonoId = bid; pc.bono = bono;
              if (bono) bono.used_credits = Number(bono.used_credits) + 1;
              res.linkedBonoId = bid; res.bonoId = bid;
              if (bono) res.totalFinal = bono.expectedPrice;
              showToast('Crédito del bono asignado a esta clase', 'success');
            } else {
              const { error } = await supabase.from('class_enrollments').update({ bono_id: null, status: 'confirmed' }).eq('id', res.id);
              if (error) throw error;
              if (bono) bono.used_credits = Math.max(0, Number(bono.used_credits) - 1);
              pc.useCredit = false; pc.selectedBonoId = null;
              res.linkedBonoId = null; res.bonoId = null;
              if (res.singlePrice != null) res.totalFinal = res.singlePrice;
              showToast('Clase desvinculada del bono (se paga aparte)', 'success');
            }
            await reloadResPayments();
            renderDetail();
            render();
          } catch (err) {
            card.style.pointerEvents = '';
            showToast('Error: ' + (err.message || err), 'error');
          }
        });
      });

      // Bono pay buttons
      // Pagar y ampliar bono → ficha de bono ÚNICA (misma que el resto de paneles)
      overlay.querySelectorAll('.rv-bono-pay-btn, .rv-bono-expand-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const bonoId = btn.dataset.bonoId;
          if (bonoId) openBonoFicha(bonoId, { onChange: () => { renderDetail(); render(); } });
        });
      });

      // Load credit balances for linked persons
      overlay.querySelectorAll('.rv-credit-row').forEach(async (row) => {
        const profileId = row.dataset.profileId;
        const personName = row.dataset.personName;
        try {
          const { data } = await supabase.from('profiles').select('credit_balance').eq('id', profileId).single();
          const balance = Number(data?.credit_balance || 0);
          if (balance > 0) {
            row.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px dashed #e5e7eb;margin-top:8px">
                <div>
                  <span style="font-size:.82rem;color:#0f2f39;font-weight:600">${personName}</span>
                  <span style="font-size:.78rem;color:#6b7280"> — Saldo a favor: </span>
                  <strong style="color:#166534">${balance.toFixed(2)}€</strong>
                </div>
                <button class="rv-use-credit-btn rv-add-payment-btn" data-profile-id="${profileId}" data-balance="${balance}" data-person-name="${personName}" style="font-size:.75rem;padding:5px 12px">Usar saldo</button>
              </div>`;
            row.querySelector('.rv-use-credit-btn')?.addEventListener('click', () => {
              openUseCreditModal(res, overlay, profileId, balance, personName);
            });
          }
        } catch {}
      });

      // Cancel reservation
      overlay.querySelector('#rv-cancel')?.addEventListener('click', async () => {
        if (confirm('¿Cancelar esta reserva? Esta acción no se puede deshacer.')) {
          // Borra TODAS las inscripciones de la reserva (una reserva nueva puede tener
          // varias clases/personas). Si no hay lista, cae al id único (ficha desde inscripción).
          const ids = (Array.isArray(res.enrollmentIds) && res.enrollmentIds.length) ? res.enrollmentIds : [res.id];
          try {
            for (const eid of ids) {
              try {
                await deleteEnrollment(eid);
                for (const p of await fetchPayments('enrollment', eid)) { await deletePayment(p.id); }
              } catch {
                await updateEnrollmentStatus(eid, 'cancelled').catch(() => {});
              }
            }
            showToast('Reserva cancelada', 'success');
          } catch {
            showToast('Reserva cancelada', 'success');
          }
          overlay.remove();
          render();
        }
      });

      // Send email
      overlay.querySelector('#rv-send-email')?.addEventListener('click', () => {
        showToast('Funcionalidad de email próximamente', 'success');
      });

      // Crear bono para el cliente de esta reserva (en "Bonos y Saldo" o pestaña Pagos)
      const onNewBono = () => {
        const uid = res.persons?.[0]?.profileId;
        if (!uid) { showToast('Este cliente no tiene cuenta para asignarle un bono', 'error'); return; }
        openCreateBonoModalCal(uid, res.activityType, () => { renderDetail(); render(); });
      };
      overlay.querySelector('#rv-new-bono-saldo')?.addEventListener('click', onNewBono);
      overlay.querySelector('#rv-new-bono-tab')?.addEventListener('click', onNewBono);

      // Ver ficha completa del cliente → abre la sección Clientes con esa ficha
      // (una por asistente con cuenta; cada botón lleva su propio data-uid)
      overlay.querySelectorAll('.rv-open-client').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.uid;
          if (!uid) { showToast('Este asistente no tiene cuenta de cliente', 'error'); return; }
          window.__openClientId = uid;
          overlay.remove();
          // Si ya estamos en #clientes, el hash no cambia → forzar el re-render
          if (location.hash === '#clientes') window.dispatchEvent(new Event('hashchange'));
          else location.hash = '#clientes';
        });
      });

      // Mover de día — reutiliza el selector de calendario (con pregunta de grupo conjunto)
      overlay.querySelector('#rv-move')?.addEventListener('click', () => {
        const sess = res.sessions?.[0];
        if (!sess) { showToast('No hay sesión asociada para mover', 'error'); return; }
        if (typeof _openMovePicker !== 'function') { showToast('Abre el calendario para mover', 'error'); return; }
        const name = res.persons?.[0]?.profileName || res.contact?.nombre || 'Alumno';
        document.getElementById('rv-detail-overlay')?.remove();
        _openMovePicker(res.id, sess.id, name, sess);
      });

      // Ampliar — open booking panel for same activity type
      overlay.querySelector('#rv-ampliar')?.addEventListener('click', async () => {
        if (!res.sessions?.length) { showToast('No hay sesión asociada para ampliar', 'error'); return; }
        const firstSession = res.sessions[0];
        // Trae la clase real de la BD (precio y aforo configurables, sin hardcodear)
        const { data: realCls } = await supabase.from('surf_classes').select('*').eq('id', firstSession.id).single();
        const cls = realCls || {
          id: firstSession.id, date: firstSession.date, time_start: firstSession.time_start,
          time_end: firstSession.time_end, type: firstSession.type || res.activityType,
          title: firstSession.title || res.activityLabel,
        };
        // Pre-carga el cliente del bono (no pedir sus datos de nuevo)
        const person = res.persons?.[0] || {};
        const prefill = {
          nombre: person.nombre || res.contact?.nombre || '',
          apellidos: person.apellidos || res.contact?.apellidos || '',
          profileId: person.profileId || null,
          profileName: person.profileName || null,
          familyMemberId: person.familyMemberId || null,
          email: res.profile?.email || res.contact?.email || '',
        };
        overlay.remove();
        openBookingPanel(cls, prefill);
      });

      // Load client history for Histórico tab
      const historyEl = overlay.querySelector('#rv-client-history');
      if (historyEl) {
        const userId = res.persons?.[0]?.profileId;
        if (userId) {
          (async () => {
            try {
              // Fetch all enrollments for this user
              const { data: enrollments } = await supabase
                .from('class_enrollments')
                .select('id, class_id, status, created_at, attendance')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50);

              if (!enrollments?.length) {
                historyEl.innerHTML = '<div class="rv-info-card" style="padding:24px"><p style="font-size:.85rem;color:#6b7280">No hay historial previo para este cliente</p></div>';
                return;
              }

              // Fetch class details for these enrollments
              const classIds = [...new Set(enrollments.map(e => e.class_id))];
              const { data: classes } = await supabase
                .from('surf_classes')
                .select('id, type, date, time_start, time_end, title')
                .in('id', classIds);
              const classMap = {};
              (classes || []).forEach(c => { classMap[c.id] = c; });

              // Stats
              const total = enrollments.length;
              const attended = enrollments.filter(e => e.attendance === true || e.status === 'completed').length;
              const cancelled = enrollments.filter(e => e.status === 'cancelled').length;
              const noShow = enrollments.filter(e => e.attendance === false && e.status !== 'cancelled').length;

              // Credit balance
              let creditHtml = '';
              try {
                const { data: profile } = await supabase.from('profiles').select('credit_balance').eq('id', userId).single();
                clientCreditBalance = Number(profile?.credit_balance || 0);
                if (clientCreditBalance > 0) {
                  creditHtml = `<div style="margin-top:12px;padding:12px 16px;background:#ecfdf5;border-radius:10px;display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:.85rem;color:#065f46;font-weight:600">Saldo a favor</span>
                    <strong style="color:#166534;font-size:1rem">${clientCreditBalance.toFixed(2)}€</strong>
                  </div>`;
                }
              } catch {}

              // Fetch bonos for this user
              let bonoTimelineHtml = '';
              try {
                const { data: userBonos } = await supabase.from('bonos').select('*').eq('user_id', userId).order('created_at', { ascending: false });
                if (userBonos?.length) {
                  bonoTimelineHtml = `
                    <div style="margin-top:20px">
                      <h4 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:0 0 12px">Bonos del cliente</h4>
                      <div class="rv-timeline">
                        ${userBonos.map(bo => {
                          const boDate = new Date(bo.created_at);
                          const boDateStr = boDate.getDate() + '/' + (boDate.getMonth() + 1) + '/' + boDate.getFullYear();
                          const statusLbl = bo.status === 'active' ? 'Activo' : bo.status === 'exhausted' ? 'Agotado' : bo.status === 'completed' ? 'Completado' : bo.status === 'expired' ? 'Expirado' : bo.status;
                          const statusClr = bo.status === 'active' ? '#1a1a1a' : bo.status === 'completed' ? '#22c55e' : '#6b7280';
                          return `<div class="rv-timeline-item">
                            <div class="rv-timeline-dot" style="background:${statusClr}"></div>
                            <div class="rv-timeline-content">
                              <strong>Bono ${TYPE_LABELS[bo.class_type] || bo.class_type} · ${bo.total_credits} clases</strong>
                              <span>${boDateStr}</span>
                              <small>${statusLbl} · ${bo.used_credits}/${bo.total_credits} usadas</small>
                            </div>
                          </div>`;
                        }).join('')}
                      </div>
                    </div>`;
                }
              } catch {}

              let historyRows = enrollments.slice(0, 20).map(e => {
                const c = classMap[e.class_id];
                const typeLbl = c ? (TYPE_LABELS[c.type] || c.type) : '—';
                const dateL = c ? formatDetailDate(c.date) : '—';
                const time = c ? `${c.time_start?.slice(0,5)} - ${c.time_end?.slice(0,5)}` : '';
                const statusMap = { confirmed: ['Confirmado', '#1a1a1a'], paid: ['Pagado', '#166534'], completed: ['Asistió', '#22c55e'], cancelled: ['Cancelado', '#b91c1c'], 'no-show': ['No show', '#92400e'] };
                const isCurrent = e.id === res.id;
                const [sLbl, sClr] = statusMap[e.status] || [e.status, '#6b7280'];
                const attendLbl = e.attendance === true ? '✓ Asistió' : e.attendance === false ? '✗ No asistió' : '';
                return `<tr style="${isCurrent ? 'background:#fffbeb' : ''}">
                  <td style="font-size:.82rem">${dateL}</td>
                  <td style="font-size:.82rem">${typeLbl}</td>
                  <td style="font-size:.82rem">${time}</td>
                  <td><span style="font-size:.72rem;font-weight:600;padding:2px 8px;border-radius:20px;background:${sClr}15;color:${sClr}">${sLbl}</span></td>
                  <td style="font-size:.78rem;color:#6b7280">${attendLbl}</td>
                </tr>`;
              }).join('');

              historyEl.innerHTML = `
                <div class="rv-info-card" style="padding:24px">
                  <h4 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:0 0 12px">Historial del cliente</h4>
                  <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
                    <div style="flex:1;min-width:100px;padding:12px 16px;background:#f0fdf4;border-radius:10px;text-align:center">
                      <div style="font-size:1.2rem;font-weight:700;color:#166534">${attended}</div>
                      <div style="font-size:.72rem;color:#065f46;text-transform:uppercase;letter-spacing:.03em">Asistencias</div>
                    </div>
                    <div style="flex:1;min-width:100px;padding:12px 16px;background:#fef2f2;border-radius:10px;text-align:center">
                      <div style="font-size:1.2rem;font-weight:700;color:#b91c1c">${cancelled}</div>
                      <div style="font-size:.72rem;color:#991b1b;text-transform:uppercase;letter-spacing:.03em">Cancelaciones</div>
                    </div>
                    <div style="flex:1;min-width:100px;padding:12px 16px;background:#f0f9ff;border-radius:10px;text-align:center">
                      <div style="font-size:1.2rem;font-weight:700;color:#1a1a1a">${total}</div>
                      <div style="font-size:.72rem;color:#0c4a6e;text-transform:uppercase;letter-spacing:.03em">Total reservas</div>
                    </div>
                  </div>
                  ${creditHtml}
                  <div style="margin-top:16px;overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse;font-family:'Manrope',sans-serif">
                      <thead>
                        <tr style="border-bottom:2px solid #e5e7eb">
                          <th style="text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;padding:8px 6px">Fecha</th>
                          <th style="text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;padding:8px 6px">Actividad</th>
                          <th style="text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;padding:8px 6px">Hora</th>
                          <th style="text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;padding:8px 6px">Estado</th>
                          <th style="text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;padding:8px 6px">Asistencia</th>
                        </tr>
                      </thead>
                      <tbody>${historyRows}</tbody>
                    </table>
                  </div>
                </div>
                ${bonoTimelineHtml}`;
            } catch (err) {
              historyEl.innerHTML = `<div class="rv-info-card" style="padding:24px"><p style="font-size:.85rem;color:#b91c1c">Error cargando historial: ${err.message}</p></div>`;
            }
          })();
        } else {
          historyEl.innerHTML = '<div class="rv-info-card" style="padding:24px"><p style="font-size:.85rem;color:#6b7280">Cliente no vinculado — sin historial disponible</p></div>';
        }
      }
    }

    function openAddPaymentModal(res, overlayRef) {
      // Check for persons with credit balance
      const personsWithCredit = res.persons.filter(p => p.profileId);
      let creditOptionHtml = '';
      if (personsWithCredit.length) {
        creditOptionHtml = `
          <div style="margin-top:8px;padding-top:12px;border-top:1px dashed #e5e7eb">
            <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;cursor:pointer">
              <input type="checkbox" class="rv-pay-use-credit-cb" style="width:16px;height:16px;accent-color:#0f2f39" />
              Usar saldo a favor del cliente
            </label>
            <div class="rv-credit-info-el" style="display:none;margin-top:8px;font-size:.82rem;color:#065f46;background:#ecfdf5;padding:8px 12px;border-radius:6px"></div>
          </div>`;
      }

      // Create a high z-index modal instead of using openModal (which renders behind the overlay)
      const modal = document.createElement('div');
      modal.className = 'bk-overlay';
      modal.style.zIndex = '10001';
      modal.innerHTML = `
        <div class="bk-panel" style="max-width:480px;margin:auto;border-radius:16px;overflow:hidden">
          <div class="bk-panel-header" style="background:var(--color-navy,#0f2f39);padding:16px 22px">
            <div class="bk-header-left" style="display:flex;align-items:center;gap:12px">
              <button class="bk-close-btn rv-pay-modal-close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <span class="bk-header-title" style="font-size:1.1rem">Añadir Pago</span>
            </div>
          </div>
          <div style="padding:24px">
            <form class="rv-payment-form-el trip-form" style="gap:16px">
              <div>
                <label style="display:block;margin-bottom:6px">Importe (€)</label>
                <input type="number" class="rv-pay-amount-el" name="amount" step="0.01" value="${res.pending.toFixed(2)}" required />
              </div>
              <div>
                <label style="display:block;margin-bottom:6px">Método de pago</label>
                <select name="method" required>
                  <option value="">Seleccionar…</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="voucher">Voucher</option>
                  <option value="saldo">Saldo a favor</option>
                </select>
              </div>
              ${creditOptionHtml}
              <div>
                <label style="display:block;margin-bottom:6px">Notas</label>
                <input type="text" name="notes" placeholder="Opcional" />
              </div>
              <button type="submit" class="bk-final-confirm-btn" style="margin-top:4px">Registrar Pago</button>
            </form>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('.rv-pay-modal-close')?.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      // Load credit balance for "saldo" option
      let clientCreditBalance = 0;
      let clientProfileId = null;
      if (personsWithCredit.length) {
        const firstLinked = personsWithCredit[0];
        clientProfileId = firstLinked.profileId;
        supabase.from('profiles').select('credit_balance').eq('id', clientProfileId).single().then(({ data }) => {
          clientCreditBalance = Number(data?.credit_balance || 0);
          const creditInfo = modal.querySelector('.rv-credit-info-el');
          if (creditInfo) creditInfo.textContent = `Saldo disponible: ${clientCreditBalance.toFixed(2)}€`;
        });

        modal.querySelector('.rv-pay-use-credit-cb')?.addEventListener('change', (e) => {
          const infoEl = modal.querySelector('.rv-credit-info-el');
          if (infoEl) infoEl.style.display = e.target.checked ? 'block' : 'none';
          if (e.target.checked) {
            const amountInput = modal.querySelector('.rv-pay-amount-el');
            const currentAmount = parseFloat(amountInput.value) || 0;
            const creditToUse = Math.min(clientCreditBalance, currentAmount);
            if (creditToUse > 0) {
              const infoEl2 = modal.querySelector('.rv-credit-info-el');
              if (infoEl2) infoEl2.textContent = `Saldo disponible: ${clientCreditBalance.toFixed(2)}€ — Se aplicarán ${creditToUse.toFixed(2)}€`;
            }
          }
        });
      }

      modal.querySelector('.rv-payment-form-el')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const amount = parseFloat(fd.get('amount')) || 0;
        const method = fd.get('method');
        const useCredit = modal.querySelector('.rv-pay-use-credit-cb')?.checked;

        if (!method && !useCredit) { showToast('Selecciona un método', 'error'); return; }

        const _payBtn = e.target.querySelector('button[type="submit"]');
        if (_payBtn) { _payBtn.disabled = true; _payBtn.textContent = 'Registrando…'; }
        try {
        let creditUsed = 0;
        if (useCredit && clientCreditBalance > 0 && clientProfileId) {
          creditUsed = Math.min(clientCreditBalance, amount);
          const newBalance = clientCreditBalance - creditUsed;
          await supabase.from('profiles').update({ credit_balance: newBalance }).eq('id', clientProfileId);
        }

        const effectiveMethod = creditUsed >= amount ? 'saldo' : (method || 'saldo');

        // Si la inscripción va con bono, el pago se registra en el BONO (no en
        // la inscripción) para no duplicar el ingreso ni dejar el bono sin saldar.
        const isBono = !!res.linkedBonoId;
        const savedPayment = await createPayment({
          reservation_type: isBono ? 'bono' : 'enrollment',
          reference_id: isBono ? res.linkedBonoId : res.id,
          amount,
          payment_method: effectiveMethod,
          concept: `Pago ${isBono ? 'bono' : 'reserva'} ${res.activityLabel || ''}${creditUsed > 0 ? ` (${creditUsed.toFixed(2)}€ saldo)` : ''}`.trim(),
        });

        res.pending = Math.max(0, Math.round((res.pending - amount) * 100) / 100);
        res.payments.push({ ...savedPayment, method: effectiveMethod, creditUsed, date: savedPayment.payment_date || new Date().toISOString() });

        if (isBono) {
          // total_paid del bono = suma de sus pagos (dominio); si queda saldado, sus
          // inscripciones pasan a 'paid' (el color del calendario sale del bono)
          await recalcBonoPaid(res.linkedBonoId);
          if (res.pending <= 0) {
            await supabase.from('class_enrollments').update({ status: 'paid' })
              .eq('bono_id', res.linkedBonoId).in('status', ['confirmed', 'partial']);
          }
        } else {
          const newStatus = res.pending <= 0 ? 'paid' : 'partial';
          res.status = newStatus;
          await updateEnrollmentStatus(res.id, newStatus).catch(() => {});
        }

        modal.remove();
        showToast(`Pago de ${amount.toFixed(2)}€ registrado${creditUsed > 0 ? ` (${creditUsed.toFixed(2)}€ de saldo)` : ` (${effectiveMethod})`}`, 'success');
        renderDetail();
        render(); // refresca el grid del calendario (color de pago)
        } catch (err) {
          if (_payBtn) { _payBtn.disabled = false; _payBtn.textContent = 'Registrar Pago'; }
          showToast('Error al registrar el pago: ' + (err?.message || err), 'error');
        }
      });
    }

    function openUseCreditModal(res, overlayRef, profileId, balance, personName) {
      // Create a high z-index modal instead of using openModal (which renders behind the overlay)
      const modal = document.createElement('div');
      modal.className = 'bk-overlay';
      modal.style.zIndex = '10001';
      modal.innerHTML = `
        <div class="bk-panel" style="max-width:480px;margin:auto;border-radius:16px;overflow:hidden">
          <div class="bk-panel-header" style="background:var(--color-navy,#0f2f39);padding:16px 22px">
            <div class="bk-header-left" style="display:flex;align-items:center;gap:12px">
              <button class="bk-close-btn rv-credit-modal-close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <span class="bk-header-title" style="font-size:1.1rem">Usar Saldo a Favor</span>
            </div>
          </div>
          <div style="padding:24px">
            <form class="rv-use-credit-form-el trip-form">
              <div style="background:#ecfdf5;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:16px">
                <div style="font-size:.88rem;color:#065f46;font-weight:700">${personName}</div>
                <div style="font-size:.88rem;color:#065f46;margin-top:4px">Saldo disponible: <strong>${balance.toFixed(2)}€</strong></div>
              </div>
              <label>Importe a aplicar</label>
              <input type="number" name="amount" step="0.01" value="${Math.min(balance, res.pending).toFixed(2)}" max="${balance.toFixed(2)}" required />
              <p style="font-size:.78rem;color:#6b7280;margin:4px 0 0">Pendiente de la reserva: ${res.pending.toFixed(2)}€</p>
              <button type="submit" class="bk-final-confirm-btn" style="margin-top:12px">Aplicar Saldo</button>
            </form>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('.rv-credit-modal-close')?.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      modal.querySelector('.rv-use-credit-form-el')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(new FormData(e.target).get('amount')) || 0;
        if (amount > balance) { showToast('El importe supera el saldo disponible', 'error'); return; }
        if (amount <= 0) { showToast('Introduce un importe válido', 'error'); return; }

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Aplicando…';

        try {
          await supabase.from('profiles').update({ credit_balance: Math.max(0, balance - amount) }).eq('id', profileId);

          // Persist payment to DB
          await createPayment({
            reservation_type: 'enrollment',
            reference_id: res.id,
            amount,
            payment_method: 'saldo',
            concept: `Saldo a favor de ${personName} (${amount.toFixed(2)}€)`,
          });

          res.pending = Math.max(0, res.pending - amount);
          if (res.pending <= 0) res.status = 'paid';
          res.payments.push({ amount, method: 'saldo', creditUsed: amount, date: new Date().toISOString() });

          // Update enrollment status if fully paid
          if (res.pending <= 0) {
            await updateEnrollmentStatus(res.id, 'paid').catch(() => {});
          }

          modal.remove();
          showToast(`${amount.toFixed(2)}€ de saldo aplicados a la reserva`, 'success');
          renderDetail(); // ya re-engancha los eventos vía bindDetailEvents
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Aplicar Saldo';
        }
      });
    }

    renderDetail();
  }

  // ======== BOOKING WIZARD ========
  function openBookingWizard() {
    // Remove existing wizard overlay if any
    document.getElementById('bkw-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'bk-overlay bk-overlay-fullscreen';
    overlay.id = 'bkw-overlay';
    document.body.appendChild(overlay);

    let selectedType = null;
    let calMonth = new Date();
    calMonth.setDate(1);

    const MONTH_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const DAY_INITIALS = ['L','M','X','J','V','S','D'];

    renderStep1();

    function closeWizard() { overlay.remove(); }

    // Step 1: Actividad vs Alquiler
    function renderStep1() {
      overlay.innerHTML = `
        <div class="bk-panel bk-panel-fullscreen">
          <div class="bk-panel-header" style="background:#0f2f39;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:16px 24px">
            <h2 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px">CREAR RESERVA</h2>
            <button id="bkw-close" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="bk-panel-body" style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 64px)">
            <div class="bkw-step">
              <p style="text-align:center;color:#6b7280;margin-bottom:24px;font-size:.95rem">¿Qué tipo de reserva quieres crear?</p>
              <div class="bkw-type-grid">
                <button class="bkw-type-card" data-choice="actividad">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FFCC01" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  <span class="bkw-type-label">Actividad</span>
                  <span class="bkw-type-desc">Clases, yoga, paddle surf...</span>
                </button>
                <button class="bkw-type-card" data-choice="alquiler">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12c0-2.2 1.8-4 4-4m0 8c2.2 0 4-1.8 4-4"/><circle cx="12" cy="12" r="1.5" fill="#1a1a1a"/></svg>
                  <span class="bkw-type-label">Alquiler</span>
                  <span class="bkw-type-desc">Material, neoprenos, tablas...</span>
                </button>
              </div>
            </div>
          </div>
        </div>`;
      overlay.querySelector('#bkw-close').addEventListener('click', closeWizard);
      overlay.querySelectorAll('.bkw-type-card').forEach(card => {
        card.addEventListener('click', () => {
          if (card.dataset.choice === 'alquiler') {
            closeWizard();
            openNewSessionModal();
            // Auto-switch to material tab after a tick
            setTimeout(() => {
              const matTab = document.querySelector('[data-modal-type="material"]');
              if (matTab) matTab.click();
            }, 50);
          } else {
            renderStep2();
          }
        });
      });
    }

    // Step 2: Tipo de actividad
    function renderStep2() {
      const types = Object.entries(TYPE_LABELS);
      const cardsHtml = types.map(([key, label]) => {
        const color = TYPE_COLORS[key] || '#0f2f39';
        return `<button class="bkw-activity-card" data-type="${key}" style="--ac-color:${color}">
          <span class="bkw-ac-dot" style="background:${color}"></span>
          <span class="bkw-ac-label">${label}</span>
        </button>`;
      }).join('');

      overlay.innerHTML = `
        <div class="bk-panel bk-panel-fullscreen">
          <div class="bk-panel-header" style="background:#0f2f39;color:#fff;display:flex;align-items:center;gap:12px;padding:16px 24px">
            <button id="bkw-back" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px">TIPO DE ACTIVIDAD</h2>
            <div style="flex:1"></div>
            <button id="bkw-close" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="bk-panel-body" style="padding:24px;max-width:600px;margin:0 auto;width:100%">
            <div class="bkw-step">
              <input type="text" id="bkw-search" class="bkw-search" placeholder="Buscar actividad..." />
              <div class="bkw-activity-grid" id="bkw-activity-grid">
                ${cardsHtml}
              </div>
            </div>
          </div>
        </div>`;
      overlay.querySelector('#bkw-close').addEventListener('click', closeWizard);
      overlay.querySelector('#bkw-back').addEventListener('click', () => renderStep1());
      // Search filter
      overlay.querySelector('#bkw-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        overlay.querySelectorAll('.bkw-activity-card').forEach(c => {
          const label = c.querySelector('.bkw-ac-label').textContent.toLowerCase();
          c.style.display = label.includes(q) ? '' : 'none';
        });
      });
      // Card click → step 3
      overlay.querySelectorAll('.bkw-activity-card').forEach(card => {
        card.addEventListener('click', () => {
          selectedType = card.dataset.type;
          renderStep3();
        });
      });
    }

    // Step 3: Calendario mensual
    async function renderStep3() {
      const typeColor = TYPE_COLORS[selectedType] || '#0f2f39';
      const typeLabel = TYPE_LABELS[selectedType] || selectedType;

      // Show loading state
      overlay.innerHTML = `
        <div class="bk-panel bk-panel-fullscreen">
          <div class="bk-panel-header" style="background:${typeColor};color:#fff;display:flex;align-items:center;gap:12px;padding:16px 24px">
            <button id="bkw-back" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px">${typeLabel.toUpperCase()}</h2>
            <div style="flex:1"></div>
            <button id="bkw-close" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="bk-panel-body" style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 64px)">
            <div style="text-align:center;color:#9ca3af"><div class="spinner" style="margin:0 auto 12px"></div>Cargando disponibilidad...</div>
          </div>
        </div>`;
      overlay.querySelector('#bkw-close').addEventListener('click', closeWizard);
      overlay.querySelector('#bkw-back').addEventListener('click', () => renderStep2());

      // Fetch classes for the current calendar month
      const monthStart = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
      const monthEnd = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
      const fromStr = getDateStr(monthStart);
      const toStr = getDateStr(monthEnd);

      let monthClasses = [];
      try {
        const all = await fetchClassesInRange(fromStr, toStr);
        monthClasses = all.filter(c => c.type === selectedType);
      } catch (e) { /* ignore fetch errors */ }

      // Build availability map: dateStr → hasAvailable
      const availMap = {};
      monthClasses.forEach(c => {
        const enrolled = c.enrolled_count || 0;
        const max = c.max_students || 0;
        if (enrolled < max) availMap[c.date] = true;
      });

      // Build calendar grid
      const year = calMonth.getFullYear();
      const month = calMonth.getMonth();
      const firstDay = new Date(year, month, 1);
      let startDay = firstDay.getDay(); // 0=Sun
      startDay = startDay === 0 ? 6 : startDay - 1; // convert to Mon=0
      const daysInMonth = monthEnd.getDate();
      const todayStr = getDateStr(new Date());

      let calCells = '';
      // Empty cells before first day
      for (let i = 0; i < startDay; i++) calCells += `<div class="bkw-cal-day empty"></div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isAvail = availMap[ds];
        const isToday = ds === todayStr;
        const cls = `bkw-cal-day${isAvail ? ' available' : ' unavailable'}${isToday ? ' today' : ''}`;
        calCells += `<div class="${cls}" data-date="${ds}">${d}</div>`;
      }

      overlay.innerHTML = `
        <div class="bk-panel bk-panel-fullscreen">
          <div class="bk-panel-header" style="background:${typeColor};color:#fff;display:flex;align-items:center;gap:12px;padding:16px 24px">
            <button id="bkw-back" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <h2 style="margin:0;font-family:'Bebas Neue',sans-serif;font-size:1.4rem;letter-spacing:1px">${typeLabel.toUpperCase()}</h2>
            <div style="flex:1"></div>
            <button id="bkw-close" style="background:none;border:none;color:#fff;cursor:pointer;padding:4px">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="bk-panel-body" style="padding:24px;max-width:480px;margin:0 auto;width:100%">
            <div class="bkw-step">
              <div class="bkw-cal-nav">
                <button id="bkw-prev" class="bkw-cal-arrow">&larr;</button>
                <span class="bkw-cal-title">${MONTH_FULL[month]} ${year}</span>
                <button id="bkw-next" class="bkw-cal-arrow">&rarr;</button>
              </div>
              <div class="bkw-calendar">
                <div class="bkw-cal-header">
                  ${DAY_INITIALS.map(d => `<div class="bkw-cal-day-name">${d}</div>`).join('')}
                </div>
                <div class="bkw-cal-grid">
                  ${calCells}
                </div>
              </div>
              <div class="bkw-cal-legend">
                <span><span class="bkw-legend-dot" style="background:#22c55e"></span> Disponible</span>
                <span><span class="bkw-legend-dot" style="background:#fca5a5"></span> Sin plazas</span>
              </div>
            </div>
          </div>
        </div>`;

      overlay.querySelector('#bkw-close').addEventListener('click', closeWizard);
      overlay.querySelector('#bkw-back').addEventListener('click', () => renderStep2());
      overlay.querySelector('#bkw-prev').addEventListener('click', () => {
        calMonth.setMonth(calMonth.getMonth() - 1);
        renderStep3();
      });
      overlay.querySelector('#bkw-next').addEventListener('click', () => {
        calMonth.setMonth(calMonth.getMonth() + 1);
        renderStep3();
      });
      // Day click → open booking panel
      overlay.querySelectorAll('.bkw-cal-day.available').forEach(cell => {
        cell.addEventListener('click', () => {
          const dateStr = cell.dataset.date;
          const dayClasses = monthClasses.filter(c => c.date === dateStr);
          if (dayClasses.length > 0) {
            closeWizard();
            openBookingPanel(dayClasses[0]);
          }
        });
      });
    }
  }

  // ======== ENROLLMENT PAY MODAL (icono billete en la card) ========
  async function openEnrollmentPayModal(cls, enrollment) {
    const eid = enrollment.id;
    const personName = enrollment.guest_name || enrollment.family_members?.full_name || enrollment.profiles?.full_name || 'Sin nombre';
    const clsLabel = TYPE_LABELS[cls.type] || cls.title || 'Clase';
    // Si la clase no tiene precio (no se pide al crear), usar el precio de 1 sesión del pack
    const clsPrice = Number(cls.price) > 0 ? Number(cls.price) : getPackPrice(cls.type, 1, 0);
    const hasBono = !!enrollment.bono_id;

    document.getElementById('epm-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'epm-overlay';
    overlay.className = 'epm-overlay';
    overlay.innerHTML = `
      <div class="epm-panel">
        <header class="epm-header">
          <div class="epm-avatar">${(personName[0] || '?').toUpperCase()}</div>
          <div class="epm-header-text">
            <h2>${escapeHtml(personName)}</h2>
            <p>${escapeHtml(clsLabel)} · ${formatDate(cls.date)} · ${cls.time_start?.slice(0,5) || ''}</p>
          </div>
          <button class="epm-close" id="epm-close" title="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div class="epm-body">
          <div id="epm-content">
            <div style="text-align:center;color:#9ca3af;padding:40px 0"><div class="spinner" style="margin:0 auto 10px"></div>Cargando…</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function closeEpm() {
      const dirty = overlay._dirty;
      overlay.remove();
      if (dirty) render();
    }
    overlay.querySelector('#epm-close')?.addEventListener('click', closeEpm);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEpm(); });

    const contentEl = overlay.querySelector('#epm-content');

    async function refreshStatusFromPayments() {
      const payments = await fetchPayments('enrollment', eid);
      const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
      // Si la inscripción va con bono, sus pagos viven en reservation_type='bono'
      // (aquí saldría 0) y el estado lo gobierna el bono: NO recalcular ni pisar el
      // status, que machacaría el 'paid'/'partial' y descuadraría créditos/aforo.
      if (hasBono) return { payments, totalPaid };
      let newStatus;
      if (totalPaid <= 0) newStatus = 'confirmed';
      else if (clsPrice > 0 && totalPaid >= clsPrice) newStatus = 'paid';
      else newStatus = 'partial';
      // El pago se recalcula desde los pagos; una reserva cancelada no se toca
      if (enrollment.status !== 'cancelled') {
        if (enrollment.status !== newStatus) {
          try { await updateEnrollmentStatus(eid, newStatus); enrollment.status = newStatus; } catch {}
        }
      }
      return { payments, totalPaid };
    }

    async function paint() {
      const { payments, totalPaid } = await refreshStatusFromPayments();
      const pending = Math.max(0, Math.round((clsPrice - totalPaid) * 100) / 100);
      const isPaid = clsPrice > 0 ? totalPaid >= clsPrice : totalPaid > 0;
      const isPartial = !isPaid && totalPaid > 0;
      const statusClass = isPaid ? 'paid' : isPartial ? 'partial' : 'pending';
      const statusLabel = isPaid ? 'Pagado' : isPartial ? 'Anticipo' : 'Pendiente';
      const progressPct = clsPrice > 0 ? Math.min(100, (totalPaid / clsPrice) * 100) : (totalPaid > 0 ? 100 : 0);

      const methodIcons = {
        efectivo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>',
        tarjeta: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        transferencia: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="3" x2="17" y2="21"/><polyline points="13 7 17 3 21 7"/><line x1="7" y1="21" x2="7" y2="3"/><polyline points="3 17 7 21 11 17"/></svg>',
        voucher: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/></svg>',
        saldo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 100 4h4a2 2 0 010 4H8M12 6v2m0 8v2"/></svg>',
      };
      const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', voucher: 'Voucher', saldo: 'Saldo' };

      const paymentsHtml = payments.length ? payments.map(p => {
        const d = new Date(p.payment_date || p.created_at);
        const dl = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const mIcon = methodIcons[p.payment_method] || methodIcons.efectivo;
        const mLbl = methodLabels[p.payment_method] || p.payment_method;
        return `
          <div class="epm-pay-card" data-pid="${p.id}">
            <div class="epm-pay-icon">${mIcon}</div>
            <div class="epm-pay-info">
              <div class="epm-pay-amount">+${Number(p.amount).toFixed(2)}€</div>
              <div class="epm-pay-meta">${mLbl} · ${dl}</div>
            </div>
            <button class="epm-del" data-pid="${p.id}" title="Eliminar pago">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            </button>
          </div>`;
      }).join('') : '<div class="epm-empty">Sin pagos registrados</div>';

      const bonoBanner = hasBono
        ? `<div class="epm-bono-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="14" rx="2"/><circle cx="12" cy="11" r="2"/></svg>
            <div><strong>Esta clase la cubre un bono.</strong> Gestiona los pagos del bono desde la ficha del cliente.</div>
          </div>` : '';

      contentEl.innerHTML = `
        ${bonoBanner}

        <!-- Hero: total grande con barra de progreso -->
        <div class="epm-hero epm-hero-${statusClass}">
          <div class="epm-hero-top">
            <div>
              <div class="epm-hero-label">Total clase</div>
              <div class="epm-hero-amount">${clsPrice.toFixed(2)}€</div>
            </div>
            <span class="epm-pill epm-pill-${statusClass}">${statusLabel}</span>
          </div>
          <div class="epm-bar">
            <div class="epm-bar-fill epm-bar-${statusClass}" style="width:${progressPct}%"></div>
          </div>
          <div class="epm-hero-bottom">
            <span>Pagado <strong>${totalPaid.toFixed(2)}€</strong></span>
            <span class="epm-pending-${pending > 0 ? 'open' : 'closed'}">Pendiente <strong>${pending.toFixed(2)}€</strong></span>
          </div>
        </div>

        ${!hasBono ? `
        <div class="epm-section">
          <div class="epm-section-title">Registrar pago</div>
          ${pending > 0 ? `<div class="epm-quick-row">
            <button class="epm-quick epm-quick-full" data-amount="${pending.toFixed(2)}">
              <span class="epm-quick-label">Total</span>
              <span class="epm-quick-amount">${pending.toFixed(2)}€</span>
            </button>
            <button class="epm-quick epm-quick-half" data-amount="${(pending / 2).toFixed(2)}">
              <span class="epm-quick-label">Mitad</span>
              <span class="epm-quick-amount">${(pending / 2).toFixed(2)}€</span>
            </button>
          </div>` : ''}
          <div class="epm-row-2">
            <input type="number" id="epm-amount" placeholder="Importe €" step="0.01" min="0.01" class="epm-input" />
            <select id="epm-method" class="epm-input">
              <option value="efectivo">💵 Efectivo</option>
              <option value="tarjeta">💳 Tarjeta</option>
              <option value="transferencia">🏦 Transferencia</option>
              <option value="voucher">🎟️ Voucher</option>
              <option value="saldo">💰 Saldo a favor</option>
            </select>
          </div>
          <button id="epm-save" class="epm-submit">Registrar pago</button>
        </div>
        ` : ''}

        <div class="epm-section-title epm-history-title">Historial de pagos${payments.length ? ` · ${payments.length}` : ''}</div>
        <div id="epm-list" class="epm-list">${paymentsHtml}</div>
      `;

      // Quick amount buttons
      contentEl.querySelectorAll('.epm-quick').forEach(btn => {
        btn.addEventListener('click', () => {
          contentEl.querySelector('#epm-amount').value = btn.dataset.amount;
        });
      });

      // Submit payment
      contentEl.querySelector('#epm-save')?.addEventListener('click', async () => {
        const amount = parseFloat(contentEl.querySelector('#epm-amount').value);
        const method = contentEl.querySelector('#epm-method').value;
        if (!amount || amount <= 0) { showToast('Importe inválido', 'error'); return; }
        const btn = contentEl.querySelector('#epm-save');
        btn.disabled = true; btn.textContent = 'Guardando…';
        try {
          // Saldo: descontar del balance del usuario
          if (method === 'saldo' && enrollment.user_id) {
            const { data: profile } = await supabase.from('profiles').select('credit_balance').eq('id', enrollment.user_id).single();
            const balance = Number(profile?.credit_balance || 0);
            if (balance < amount) {
              showToast(`Saldo insuficiente (${balance.toFixed(2)}€ disponible)`, 'error');
              btn.disabled = false; btn.textContent = 'Registrar pago';
              return;
            }
            await supabase.from('profiles').update({ credit_balance: balance - amount }).eq('id', enrollment.user_id);
          }
          await createPayment({
            reservation_type: 'enrollment',
            reference_id: eid,
            amount,
            payment_method: method,
            concept: `Pago clase ${clsLabel}`,
          });
          showToast(`+${amount.toFixed(2)}€ registrado`, 'success');
          await paint();
          // Refrescar render principal del calendario al cerrar
          overlay._dirty = true;
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Registrar pago';
        }
      });

      // Delete payment
      contentEl.querySelectorAll('.epm-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este pago?')) return;
          try {
            await deletePayment(btn.dataset.pid);
            showToast('Pago eliminado', 'success');
            await paint();
            overlay._dirty = true;
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });
    }

    await paint();
  }

  // ======== NEW SESSION MODAL ========
  function openSessionNotesEditor(cls) {
    const title = TYPE_LABELS[cls.type] || cls.title || 'Sesión';
    const timeLabel = `${cls.time_start?.slice(0, 5) || ''}${cls.time_end ? ` - ${cls.time_end.slice(0, 5)}` : ''}`;
    openModal('Notas de sesión', `
      <div style="margin-bottom:12px;color:#6b7280;font-size:.85rem">${title} · ${timeLabel}</div>
      <textarea id="session-notes-textarea" rows="6"
        style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font:inherit;resize:vertical"
        placeholder="Escribe aquí notas sobre la sesión (condiciones del mar, incidencias, observaciones del grupo…)">${escapeHtml(cls.notes || '')}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        ${cls.notes ? '<button id="session-notes-delete" class="btn" style="background:#fee2e2;color:#b91c1c">Eliminar</button>' : ''}
        <button id="session-notes-cancel" class="btn">Cancelar</button>
        <button id="session-notes-save" class="btn red">Guardar</button>
      </div>
    `);

    const textarea = document.getElementById('session-notes-textarea');
    textarea?.focus();

    document.getElementById('session-notes-cancel')?.addEventListener('click', () => closeModal());

    document.getElementById('session-notes-save')?.addEventListener('click', async () => {
      const newNotes = textarea.value.trim();
      try {
        const { error } = await supabase
          .from('surf_classes')
          .update({ notes: newNotes || null })
          .eq('id', cls.id);
        if (error) throw error;
        showToast('Nota guardada', 'success');
        closeModal();
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('session-notes-delete')?.addEventListener('click', async () => {
      try {
        const { error } = await supabase
          .from('surf_classes')
          .update({ notes: null })
          .eq('id', cls.id);
        if (error) throw error;
        showToast('Nota eliminada', 'success');
        closeModal();
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  // ======== BULK DELETE CLASSES ========
  async function openBulkDeleteClasses() {
    document.getElementById('bd-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bd-overlay';
    overlay.className = 'ns-overlay';

    const today = getDateStr(new Date());
    const inThreeMonths = new Date();
    inThreeMonths.setMonth(inThreeMonths.getMonth() + 3);
    const defaultTo = getDateStr(inThreeMonths);

    const typeOptions = Object.entries(TYPE_LABELS)
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    overlay.innerHTML = `
      <div class="ns-panel">
        <header class="ns-header" style="background:#7f1d1d">
          <div>
            <h2>Borrar clases</h2>
            <p>Esta acción no se puede deshacer</p>
          </div>
          <button class="ns-close" id="bd-close" title="Cerrar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div class="ns-tabs">
          <button type="button" class="ns-tab active" data-bd-mode="range">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Por rango
          </button>
          <button type="button" class="ns-tab" data-bd-mode="manual">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Selección manual
          </button>
          <button type="button" class="ns-tab" data-bd-mode="all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            Todas las futuras
          </button>
        </div>

        <div class="ns-body">
          <!-- RANGO -->
          <div class="bd-pane" data-bd-pane="range">
            <section class="ns-section">
              <h3>Rango de fechas</h3>
              <div class="ns-field-2col">
                <div class="ns-field">
                  <label>Desde</label>
                  <input type="date" id="bd-from" value="${today}" />
                </div>
                <div class="ns-field">
                  <label>Hasta</label>
                  <input type="date" id="bd-to" value="${defaultTo}" />
                </div>
              </div>
              <div class="ns-field-2col">
                <div class="ns-field">
                  <label>Tipo de clase</label>
                  <select id="bd-type">
                    <option value="">Todas las actividades</option>
                    ${typeOptions}
                  </select>
                </div>
                <div class="ns-field">
                  <label>Solo sin alumnos</label>
                  <select id="bd-empty">
                    <option value="all">Borrar todas (con o sin inscritos)</option>
                    <option value="empty" selected>Solo clases sin inscritos</option>
                  </select>
                </div>
              </div>
              <div id="bd-range-preview" class="ns-price-summary" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;display:none"></div>
            </section>
          </div>

          <!-- MANUAL -->
          <div class="bd-pane" data-bd-pane="manual" style="display:none">
            <section class="ns-section">
              <h3>Selecciona qué clases borrar</h3>
              <div class="ns-field-2col">
                <div class="ns-field">
                  <label>Desde</label>
                  <input type="date" id="bd-m-from" value="${today}" />
                </div>
                <div class="ns-field">
                  <label>Hasta</label>
                  <input type="date" id="bd-m-to" value="${defaultTo}" />
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <button type="button" class="ns-btn ns-btn-secondary" id="bd-m-load" style="padding:8px 16px;font-size:.82rem">Cargar clases del rango</button>
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;color:#6b7280;cursor:pointer">
                  <input type="checkbox" id="bd-m-all" />
                  Seleccionar todas
                </label>
                <span id="bd-m-counter" style="font-size:.82rem;color:#6b7280;margin-left:auto"></span>
              </div>
              <div id="bd-m-list" style="max-height:50vh;overflow-y:auto;border:1px solid #e5e7eb;border-radius:9px;padding:6px;background:#fff;min-height:120px">
                <p style="text-align:center;color:#9ca3af;padding:30px 16px;font-size:.85rem">Pulsa "Cargar clases del rango" para ver el listado</p>
              </div>
            </section>
          </div>

          <!-- TODAS -->
          <div class="bd-pane" data-bd-pane="all" style="display:none">
            <section class="ns-section" style="background:#fef2f2;border-color:#fecaca">
              <h3 style="color:#991b1b">⚠️ Borrar TODAS las clases futuras</h3>
              <p style="font-size:.92rem;color:#7f1d1d;margin:0">
                Esto eliminará todas las clases programadas a partir de hoy
                (<strong>${formatDate(today)}</strong>) en adelante, sin excepción.
                Las inscripciones asociadas también se borrarán por cascada.
              </p>
              <div id="bd-all-stat" style="padding:14px;background:#fff;border:1px solid #fecaca;border-radius:9px;font-size:.9rem">
                <span style="color:#6b7280">Calculando…</span>
              </div>
              <label class="ns-checkbox" style="color:#991b1b">
                <input type="checkbox" id="bd-all-confirm" />
                <span>Confirmo que quiero borrar TODAS las clases futuras</span>
              </label>
            </section>
          </div>
        </div>

        <footer class="ns-footer">
          <button type="button" class="ns-btn ns-btn-secondary" id="bd-cancel">Cancelar</button>
          <button type="button" class="ns-btn" id="bd-submit" style="background:#dc2626;color:#fff">Borrar</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    function closeBd() { overlay.remove(); }
    overlay.querySelector('#bd-close')?.addEventListener('click', closeBd);
    overlay.querySelector('#bd-cancel')?.addEventListener('click', closeBd);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBd(); });

    let currentMode = 'range';
    let manualClasses = []; // [{id, date, type, enrolled, ...}]
    let allFutureClasses = [];

    // Tab switching
    overlay.querySelectorAll('[data-bd-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-bd-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.bdMode;
        overlay.querySelectorAll('[data-bd-pane]').forEach(p => {
          p.style.display = p.dataset.bdPane === currentMode ? '' : 'none';
        });
        const submit = overlay.querySelector('#bd-submit');
        if (currentMode === 'range') submit.textContent = 'Buscar y borrar';
        else if (currentMode === 'manual') submit.textContent = 'Borrar seleccionadas';
        else submit.textContent = 'Borrar TODAS las futuras';
      });
    });

    // ----- RANGO: live preview -----
    async function refreshRangePreview() {
      const from = overlay.querySelector('#bd-from').value;
      const to = overlay.querySelector('#bd-to').value;
      const type = overlay.querySelector('#bd-type').value;
      const onlyEmpty = overlay.querySelector('#bd-empty').value === 'empty';
      const preview = overlay.querySelector('#bd-range-preview');
      if (!from || !to) { preview.style.display = 'none'; return; }
      try {
        const all = await fetchClassesInRange(from, to);
        const filtered = all.filter(c => (!type || c.type === type) && (!onlyEmpty || (c.enrolled_count || 0) === 0));
        const withStudents = filtered.filter(c => (c.enrolled_count || 0) > 0).length;
        preview.style.display = '';
        preview.innerHTML = `Se borrarán <strong>${filtered.length} clases</strong>${withStudents > 0 ? ` · <strong>${withStudents}</strong> tienen alumnos inscritos` : ''}`;
      } catch (e) { preview.style.display = 'none'; }
    }
    ['#bd-from', '#bd-to', '#bd-type', '#bd-empty'].forEach(sel => {
      overlay.querySelector(sel)?.addEventListener('change', refreshRangePreview);
    });
    refreshRangePreview();

    // ----- MANUAL: load list -----
    function renderManualList() {
      const listEl = overlay.querySelector('#bd-m-list');
      if (!manualClasses.length) {
        listEl.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:30px 16px;font-size:.85rem">No hay clases en el rango seleccionado</p>';
        return;
      }
      // group by date
      const byDate = {};
      manualClasses.forEach(c => { (byDate[c.date] = byDate[c.date] || []).push(c); });
      const sortedDates = Object.keys(byDate).sort();
      listEl.innerHTML = sortedDates.map(d => {
        const items = byDate[d].map(c => {
          const en = c.enrolled_count || 0;
          const enrColor = en > 0 ? '#b91c1c' : '#16a34a';
          return `
            <label class="bd-row" data-class-id="${c.id}">
              <input type="checkbox" class="bd-row-check" data-class-id="${c.id}" />
              <span class="bd-row-time">${c.time_start?.slice(0,5) || '--:--'}</span>
              <span class="bd-row-title">${TYPE_LABELS[c.type] || c.type}${c.instructor ? ' · ' + escapeHtml(c.instructor) : ''}</span>
              <span class="bd-row-cap" style="color:${enrColor}">${en} / ${c.max_students || 0}</span>
            </label>`;
        }).join('');
        return `
          <div class="bd-day-group">
            <div class="bd-day-header">${formatDate(d)}</div>
            ${items}
          </div>`;
      }).join('');

      listEl.querySelectorAll('.bd-row-check').forEach(cb => {
        cb.addEventListener('change', updateManualCounter);
      });
      updateManualCounter();
    }

    function updateManualCounter() {
      const checked = overlay.querySelectorAll('.bd-row-check:checked').length;
      overlay.querySelector('#bd-m-counter').textContent = checked > 0 ? `${checked} seleccionadas` : '';
    }

    overlay.querySelector('#bd-m-load')?.addEventListener('click', async () => {
      const from = overlay.querySelector('#bd-m-from').value;
      const to = overlay.querySelector('#bd-m-to').value;
      if (!from || !to) { showToast('Indica un rango', 'error'); return; }
      const listEl = overlay.querySelector('#bd-m-list');
      listEl.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:20px;font-size:.85rem">Cargando…</p>';
      try {
        manualClasses = await fetchClassesInRange(from, to);
        renderManualList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    overlay.querySelector('#bd-m-all')?.addEventListener('change', (e) => {
      overlay.querySelectorAll('.bd-row-check').forEach(cb => { cb.checked = e.target.checked; });
      updateManualCounter();
    });

    // ----- TODAS: load stat -----
    (async () => {
      try {
        const veryFar = new Date();
        veryFar.setFullYear(veryFar.getFullYear() + 5);
        allFutureClasses = await fetchClassesInRange(today, getDateStr(veryFar));
        const total = allFutureClasses.length;
        const withStudents = allFutureClasses.filter(c => (c.enrolled_count || 0) > 0).length;
        overlay.querySelector('#bd-all-stat').innerHTML = `
          <strong style="font-size:1.2rem;color:#991b1b">${total} clases</strong> programadas a partir de hoy.
          ${withStudents > 0 ? `<br><span style="color:#b91c1c">⚠️ ${withStudents} tienen alumnos inscritos.</span>` : ''}
        `;
      } catch (err) {
        overlay.querySelector('#bd-all-stat').innerHTML = '<span style="color:#b91c1c">Error cargando stat</span>';
      }
    })();

    // ----- SUBMIT -----
    overlay.querySelector('#bd-submit')?.addEventListener('click', async () => {
      const submit = overlay.querySelector('#bd-submit');

      let toDelete = [];
      if (currentMode === 'range') {
        const from = overlay.querySelector('#bd-from').value;
        const to = overlay.querySelector('#bd-to').value;
        const type = overlay.querySelector('#bd-type').value;
        const onlyEmpty = overlay.querySelector('#bd-empty').value === 'empty';
        if (!from || !to) { showToast('Indica un rango', 'error'); return; }
        try {
          const all = await fetchClassesInRange(from, to);
          toDelete = all.filter(c => (!type || c.type === type) && (!onlyEmpty || (c.enrolled_count || 0) === 0));
        } catch (err) { showToast('Error: ' + err.message, 'error'); return; }
      } else if (currentMode === 'manual') {
        const ids = [...overlay.querySelectorAll('.bd-row-check:checked')].map(cb => cb.dataset.classId);
        toDelete = manualClasses.filter(c => ids.includes(c.id));
      } else if (currentMode === 'all') {
        if (!overlay.querySelector('#bd-all-confirm').checked) {
          showToast('Marca la casilla de confirmación', 'error');
          return;
        }
        toDelete = allFutureClasses;
      }

      if (!toDelete.length) { showToast('No hay clases que borrar', 'error'); return; }

      const withStudents = toDelete.filter(c => (c.enrolled_count || 0) > 0).length;
      const msg = withStudents > 0
        ? `Vas a borrar ${toDelete.length} clases. ${withStudents} tienen alumnos inscritos (sus inscripciones se borrarán también).\n\n¿Continuar?`
        : `Vas a borrar ${toDelete.length} clases. ¿Continuar?`;
      if (!confirm(msg)) return;

      submit.disabled = true;
      submit.textContent = `Borrando 0 / ${toDelete.length}…`;

      let done = 0, failed = 0;
      const notifySum = { sent: 0, withoutEmail: 0, failed: 0 };
      for (const c of toDelete) {
        try {
          if ((c.enrolled_count || 0) > 0) {
            const r = await notifyEnrolledClients(c.id, 'cancelled', {
              className: TYPE_LABELS[c.type] || c.title || 'Clase',
              classDate: formatDate(c.date),
              classTime: `${c.time_start?.slice(0,5) || ''} - ${c.time_end?.slice(0,5) || ''}`,
            });
            notifySum.sent += r.sent;
            notifySum.withoutEmail += r.withoutEmail;
            notifySum.failed += r.failed;
          }
          await deleteClass(c.id);
          done++;
        } catch (err) {
          console.error('No se pudo borrar', c.id, err);
          failed++;
        }
        submit.textContent = `Borrando ${done} / ${toDelete.length}…`;
      }

      closeBd();
      const base = failed > 0 ? `${done} borradas · ${failed} con error` : `${done} clases borradas`;
      showToast(notifyToastMessage(base, notifySum), failed > 0 ? 'error' : 'success');
      render();
    });
  }

  // ======== BULK EDIT CLASSES ========
  async function openBulkEditClasses() {
    document.getElementById('be-overlay')?.remove();
    const today = getDateStr(new Date());
    // "Hasta" por defecto = ÚLTIMA clase programada, no un +3 meses fijo. Con el +3
    // meses, las clases más lejanas quedaban fuera del rango y "Seleccionar todas"
    // no las cargaba → la edición masiva "no se aplicaba a todas las fechas".
    let defaultTo;
    try {
      const { data: lastCls } = await supabase.from('surf_classes')
        .select('date').neq('status', 'cancelled').gte('date', today)
        .order('date', { ascending: false }).limit(1).maybeSingle();
      defaultTo = lastCls?.date || null;
    } catch { defaultTo = null; }
    if (!defaultTo) { const f = new Date(); f.setMonth(f.getMonth() + 6); defaultTo = getDateStr(f); }
    const typeOptions = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'be-overlay';
    overlay.className = 'ns-overlay';
    overlay.innerHTML = `
      <div class="ns-panel">
        <header class="ns-header">
          <div><h2>Editar clases en bloque</h2><p>Aplica un cambio a varias clases a la vez</p></div>
          <button class="ns-close" id="be-close" title="Cerrar"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </header>
        <div class="ns-body">
          <section class="ns-section">
            <h3>1. Qué clases</h3>
            <div class="ns-field-2col">
              <div class="ns-field"><label>Desde</label><input type="date" id="be-from" value="${today}" /></div>
              <div class="ns-field"><label>Hasta</label><input type="date" id="be-to" value="${defaultTo}" /></div>
            </div>
            <div class="ns-field"><label>Tipo de clase</label>
              <select id="be-type"><option value="">Todas las actividades</option>${typeOptions}</select>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">
              <button type="button" class="ns-btn ns-btn-secondary" id="be-load" style="padding:8px 16px;font-size:.82rem">Cargar clases</button>
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;color:#6b7280;cursor:pointer"><input type="checkbox" id="be-all" /> Seleccionar todas</label>
              <span id="be-counter" style="font-size:.82rem;color:#6b7280;margin-left:auto"></span>
            </div>
            <div id="be-list" style="max-height:38vh;overflow-y:auto;border:1px solid #e5e7eb;border-radius:9px;padding:6px;background:#fff;min-height:90px;margin-top:8px">
              <p style="text-align:center;color:#9ca3af;padding:24px 16px;font-size:.85rem">Pulsa "Cargar clases" para ver el listado</p>
            </div>
          </section>
          <section class="ns-section">
            <h3>2. Cambios a aplicar</h3>
            <p style="font-size:.82rem;color:#6b7280;margin:0 0 10px">Marca solo lo que quieras cambiar. El resto se queda igual.</p>
            <label class="be-change-row"><input type="checkbox" class="be-chg" data-field="time"> <span>Hora de inicio</span>
              <input type="time" id="be-time" value="10:00" disabled /></label>
            <label class="be-change-row"><input type="checkbox" class="be-chg" data-field="instructor"> <span>Instructor</span>
              <select id="be-instructor" disabled><option value="">Sin asignar</option></select></label>
            <label class="be-change-row"><input type="checkbox" class="be-chg" data-field="capacity"> <span>Capacidad máxima</span>
              <input type="number" id="be-capacity" min="1" value="6" disabled /></label>
            <label class="be-change-row"><input type="checkbox" class="be-chg" data-field="published"> <span>Estado</span>
              <select id="be-published" disabled><option value="true">Publicar</option><option value="false">Ocultar</option></select></label>
          </section>
        </div>
        <footer class="ns-footer">
          <button type="button" class="ns-btn ns-btn-secondary" id="be-cancel">Cancelar</button>
          <button type="button" class="ns-btn" id="be-submit">Aplicar cambios</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);

    const closeBe = () => overlay.remove();
    overlay.querySelector('#be-close').onclick = closeBe;
    overlay.querySelector('#be-cancel').onclick = closeBe;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBe(); });
    populateInstructorSelect(overlay.querySelector('#be-instructor'));

    // Habilitar/deshabilitar inputs según su checkbox
    overlay.querySelectorAll('.be-chg').forEach(chk => {
      chk.addEventListener('change', () => {
        const f = chk.dataset.field;
        const map = { time: '#be-time', instructor: '#be-instructor', capacity: '#be-capacity', published: '#be-published' };
        const input = overlay.querySelector(map[f]);
        if (input) input.disabled = !chk.checked;
      });
    });

    let classes = [];
    function renderList() {
      const listEl = overlay.querySelector('#be-list');
      if (!classes.length) { listEl.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px 16px;font-size:.85rem">No hay clases en el rango/tipo seleccionado</p>'; return; }
      const byDate = {};
      classes.forEach(c => { (byDate[c.date] = byDate[c.date] || []).push(c); });
      listEl.innerHTML = Object.keys(byDate).sort().map(d => `
        <div class="bd-day-group">
          <div class="bd-day-header">${formatDate(d)}</div>
          ${byDate[d].map(c => `
            <label class="bd-row" data-class-id="${c.id}">
              <input type="checkbox" class="be-row-check" data-class-id="${c.id}" checked />
              <span class="bd-row-time">${c.time_start?.slice(0,5) || '--:--'}</span>
              <span class="bd-row-title">${TYPE_LABELS[c.type] || c.type}${c.instructor ? ' · ' + escapeHtml(c.instructor) : ''}</span>
              <span class="bd-row-cap">${c.enrolled_count || 0} / ${c.max_students || 0}</span>
            </label>`).join('')}
        </div>`).join('');
      listEl.querySelectorAll('.be-row-check').forEach(cb => cb.addEventListener('change', updateCounter));
      updateCounter();
    }
    function updateCounter() {
      const n = overlay.querySelectorAll('.be-row-check:checked').length;
      overlay.querySelector('#be-counter').textContent = n ? `${n} seleccionadas` : '';
    }

    overlay.querySelector('#be-load').onclick = async () => {
      const from = overlay.querySelector('#be-from').value;
      const to = overlay.querySelector('#be-to').value;
      const type = overlay.querySelector('#be-type').value;
      if (!from || !to) { showToast('Indica un rango', 'error'); return; }
      overlay.querySelector('#be-list').innerHTML = '<p style="text-align:center;color:#9ca3af;padding:20px;font-size:.85rem">Cargando…</p>';
      try {
        const all = await fetchClassesInRange(from, to);
        // Excluir canceladas: editarlas/propagarles cambios en bloque no tiene sentido
        // (fetchClassesInRange no filtra status; aquí sí, como hace loadApplyCandidates).
        classes = all.filter(c => c.status !== 'cancelled' && (!type || c.type === type));
        renderList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    };
    overlay.querySelector('#be-all').onchange = (e) => {
      overlay.querySelectorAll('.be-row-check').forEach(cb => { cb.checked = e.target.checked; });
      updateCounter();
    };

    overlay.querySelector('#be-submit').onclick = async () => {
      const ids = [...overlay.querySelectorAll('.be-row-check:checked')].map(cb => cb.dataset.classId);
      if (!ids.length) { showToast('Selecciona al menos una clase', 'error'); return; }
      const selected = classes.filter(c => ids.includes(c.id));

      // Construir cambios marcados
      const changes = {};
      let changeTime = false, newTime = null;
      overlay.querySelectorAll('.be-chg:checked').forEach(chk => {
        const f = chk.dataset.field;
        if (f === 'time') { changeTime = true; newTime = overlay.querySelector('#be-time').value; }
        else if (f === 'instructor') changes.instructor = overlay.querySelector('#be-instructor').value || null;
        else if (f === 'capacity') changes.max_students = parseInt(overlay.querySelector('#be-capacity').value) || 1;
        else if (f === 'published') changes.published = overlay.querySelector('#be-published').value === 'true';
      });
      if (!changeTime && !Object.keys(changes).length) { showToast('Marca al menos un cambio', 'error'); return; }

      const submit = overlay.querySelector('#be-submit');
      submit.disabled = true;
      let done = 0, failed = 0, capacitySkipped = 0;
      const notifySum = { sent: 0, withoutEmail: 0, failed: 0 };
      for (const c of selected) {
        const upd = { ...changes };
        // No bajar el aforo por debajo de los inscritos de ESTA clase: se omite ese
        // campo solo para las clases donde no cabría (el resto del cambio sí se aplica).
        if (upd.max_students != null && upd.max_students < Number(c.enrolled_count || 0)) {
          delete upd.max_students;
          capacitySkipped++;
        }
        let scheduleChanged = false;
        if (changeTime && newTime) {
          upd.time_start = newTime;
          upd.time_end = addMinutesToTime(newTime, TYPE_DURATIONS[c.type] || 90);
          scheduleChanged = (c.time_start?.slice(0,5) || '') !== newTime;
        }
        try {
          // OJO: surf_classes NO tiene columna updated_at → incluirla da 400 en cada update.
          const { error } = await supabase.from('surf_classes').update(upd).eq('id', c.id);
          if (error) throw error;
          if (scheduleChanged && (c.enrolled_count || 0) > 0) {
            const r = await notifyEnrolledClients(c.id, 'rescheduled', {
              className: TYPE_LABELS[c.type] || c.title || 'Clase',
              classDate: formatDate(c.date),
              classTime: `${upd.time_start} - ${upd.time_end}`,
              oldClassDate: formatDate(c.date),
              oldClassTime: `${c.time_start?.slice(0,5) || ''} - ${c.time_end?.slice(0,5) || ''}`,
            });
            notifySum.sent += r.sent; notifySum.withoutEmail += r.withoutEmail; notifySum.failed += r.failed;
          }
          done++;
        } catch (err) { console.error('bulk edit', c.id, err); failed++; }
        submit.textContent = `Aplicando ${done} / ${selected.length}…`;
      }
      closeBe();
      let base = failed > 0 ? `${done} actualizadas · ${failed} con error` : `${done} clases actualizadas`;
      if (capacitySkipped > 0) base += ` · aforo no bajado en ${capacitySkipped} (tienen más inscritos)`;
      showToast(notifyToastMessage(base, notifySum), failed > 0 ? 'error' : 'success');
      render();
    };
  }

  function openNewSessionModal() {
    const dateStr = getDateStr(currentDate);
    const typeOptions = Object.entries(TYPE_LABELS)
      .map(([val, label]) => `<option value="${val}">${label}</option>`)
      .join('');

    const dayCheckboxes = DAY_NAMES_FULL.map((name, i) => {
      const checked = i === currentDate.getDay() ? 'checked' : '';
      return `<label class="ns-day-pill">
        <input type="checkbox" name="repeat_days" value="${i}" ${checked} />
        <span>${name.slice(0, 3)}</span>
      </label>`;
    }).join('');

    const defaultCapacities = { grupal: 6, individual: 1, yoga: 10, paddle: 8, surfskate: 8 };
    const startDateStr = getDateStr(currentDate);

    // Remove any existing overlay
    document.getElementById('ns-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ns-overlay';
    overlay.className = 'ns-overlay';
    overlay.innerHTML = `
      <div class="ns-panel">
        <header class="ns-header">
          <div>
            <h2>Nueva sesión</h2>
            <p>${formatDate(startDateStr)} · ${TYPE_LABELS['grupal'] || 'Clase'}</p>
          </div>
          <button class="ns-close" id="ns-close" title="Cerrar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div class="ns-tabs">
          <button type="button" class="ns-tab active" data-modal-type="clase">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Clase
          </button>
          <button type="button" class="ns-tab" data-modal-type="material">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12c0-2.2 1.8-4 4-4m0 8c2.2 0 4-1.8 4-4"/></svg>
            Alquiler de material
          </button>
        </div>

        <div class="ns-body">
          <!-- ============ CLASE ============ -->
          <div id="ns-clase-form" class="ns-form-wrap">
            <form id="new-session-form" class="ns-grid">
              <section class="ns-section ns-section-when">
                <h3>Cuándo</h3>
                <div class="ns-field">
                  <div class="ns-mode-toggle">
                    <button type="button" class="ns-mode-btn active" data-mode="single">Un solo día</button>
                    <button type="button" class="ns-mode-btn" data-mode="repeat">Varios días</button>
                  </div>
                </div>
                <div class="ns-field ns-mode-single">
                  <label>Fecha</label>
                  <input type="date" name="single_date" value="${startDateStr}" />
                </div>
                <div class="ns-field ns-mode-repeat" style="display:none">
                  <label>Días de repetición</label>
                  <div class="ns-days-row">${dayCheckboxes}</div>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Hora de inicio</label>
                    <input type="time" name="time_start" id="ns-time-start" value="10:00" required />
                  </div>
                  <div class="ns-field">
                    <label>Hora de fin <span style="font-weight:400;color:#94a3b8;text-transform:none;letter-spacing:0">· automática</span></label>
                    <input type="time" id="ns-time-end" value="11:30" readonly tabindex="-1" style="background:#f1f5f9;color:#64748b;cursor:not-allowed" />
                  </div>
                </div>
                <div class="ns-field ns-mode-repeat" style="display:none">
                  <label>Repetir hasta</label>
                  <input type="date" name="repeat_until" value="${getEndOfMonthStr(currentDate)}" />
                </div>
              </section>

              <section class="ns-section ns-section-detail">
                <h3>Detalles</h3>
                <div class="ns-field">
                  <label>Actividad</label>
                  <select name="type" id="ns-type" required>${typeOptions}</select>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Capacidad máxima</label>
                    <input type="number" name="max_students" id="ns-capacity" value="6" min="1" required />
                  </div>
                  <div class="ns-field">
                    <label>Público</label>
                    <select name="audience">${audienceOptionsHtml()}</select>
                  </div>
                </div>
                <div class="ns-field">
                  <label>Precio clase suelta (€)</label>
                  <input type="number" name="price" id="ns-price" value="" min="0" step="0.01" />
                  <small style="color:#94a3b8;font-size:.72rem">Lo que paga quien reserva esta clase suelta. Prerrelleno con el precio de la actividad; bájalo para abaratarla ese día. No afecta a los bonos.</small>
                </div>
                <div class="ns-field">
                  <label>Instructor</label>
                  <select name="instructor" id="ns-instructor"><option value="">Sin asignar</option></select>
                </div>
                <label class="ns-checkbox">
                  <input type="checkbox" name="published" checked />
                  <span>Publicar inmediatamente (visible para clientes)</span>
                </label>
              </section>
            </form>
          </div>

          <!-- ============ ALQUILER ============ -->
          <div id="ns-material-form" class="ns-form-wrap" style="display:none">
            <form id="new-rental-form" class="ns-grid">
              <section class="ns-section">
                <h3>Material y fechas</h3>
                <div class="ns-field">
                  <label>Material</label>
                  <select name="equipment_id" id="nr-equipment" required>
                    <option value="">Cargando material…</option>
                  </select>
                </div>
                <div class="ns-field" id="nr-size-wrap" style="display:none">
                  <label>Talla</label>
                  <select name="size" id="nr-size"></select>
                </div>
                <div class="ns-field" id="nr-unit-wrap" style="display:none">
                  <label>Neopreno / unidad concreta <span style="font-weight:400;color:#94a3b8">(opcional)</span></label>
                  <select name="assigned_unit_id" id="nr-unit"><option value="">— Sin asignar —</option></select>
                  <p id="nr-unit-hint" style="margin:4px 0 0;font-size:.78rem;color:#64748b"></p>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Tarifa</label>
                    <select name="duration_key" id="nr-duration" required>
                      <option value="">Selecciona un material…</option>
                    </select>
                  </div>
                  <div class="ns-field">
                    <label>Cantidad</label>
                    <input type="number" name="quantity" value="1" min="1" required />
                  </div>
                </div>
                <div class="ns-field" id="nr-custom-price-wrap" style="display:none">
                  <label>Precio personalizado (€)</label>
                  <input type="number" name="custom_price" id="nr-custom-price" step="0.01" min="0" value="0" />
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Fecha inicio</label>
                    <input type="date" name="date_start" value="${dateStr}" required />
                  </div>
                  <div class="ns-field">
                    <label>Hora inicio</label>
                    <input type="time" name="time_start" value="10:00" required />
                  </div>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Fecha fin</label>
                    <input type="date" name="date_end" value="${dateStr}" required />
                  </div>
                </div>
                <div id="nr-price-summary" class="ns-price-summary" style="display:none"></div>
                <button type="button" id="nr-add-line" style="margin-top:10px;width:100%;padding:10px;border:1px dashed #1a1a1a;background:#f0f9ff;color:#1a1a1a;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer">+ Añadir este material a la reserva</button>
                <div id="nr-lines" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div>
                <div id="nr-lines-total" style="display:none;margin-top:8px;text-align:right;font-weight:700;color:#0f2f39"></div>
              </section>

              <section class="ns-section">
                <h3>Cliente</h3>
                <div class="ns-field" id="nr-client-search-wrap" style="position:relative">
                  <label>Buscar cliente existente <span style="font-weight:400;color:#94a3b8">(opcional — o rellena los datos abajo)</span></label>
                  <input type="text" id="nr-client-search" placeholder="Nombre o teléfono…" autocomplete="off" />
                  <input type="hidden" name="user_id" id="nr-user-id" />
                  <div id="nr-client-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:20;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,47,57,.12);max-height:220px;overflow:auto"></div>
                  <div id="nr-client-chip" style="display:none;margin-top:8px;padding:8px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:.85rem;color:#065f46"></div>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Nombre</label>
                    <input type="text" name="guest_name" placeholder="Nombre" required />
                  </div>
                  <div class="ns-field">
                    <label>Apellidos</label>
                    <input type="text" name="guest_last_name" placeholder="Apellidos" />
                  </div>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Email</label>
                    <input type="email" name="guest_email" placeholder="email@ejemplo.com" />
                  </div>
                  <div class="ns-field">
                    <label>Teléfono</label>
                    <input type="tel" name="guest_phone" placeholder="+34 600 000 000" />
                  </div>
                </div>
                <div class="ns-field-2col">
                  <div class="ns-field">
                    <label>Talla neopreno</label>
                    <select name="wetsuit_size">${wetsuitOptionsHtml()}</select>
                  </div>
                  <div class="ns-field">
                    <label>¿Sabe nadar?</label>
                    <select name="can_swim">
                      <option value="">Sin definir</option>
                      <option value="si">Sí</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                </div>
                <div class="ns-field">
                  <label>¿Tiene alguna lesión?</label>
                  <select name="has_injury" id="nr-has-injury">
                    <option value="no">No</option>
                    <option value="si">Sí</option>
                  </select>
                </div>
                <div class="ns-field" id="nr-injury-detail-wrap" style="display:none">
                  <label>Detalle de la lesión</label>
                  <input type="text" name="injury_detail" placeholder="Describe la lesión" />
                </div>
              </section>
            </form>
          </div>
        </div>

        <footer class="ns-footer">
          <button type="button" class="ns-btn ns-btn-secondary" id="ns-cancel">Cancelar</button>
          <button type="button" class="ns-btn ns-btn-primary" id="ns-submit">Crear sesiones</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    // Helpers locales (sustituyen a closeModal global)
    function closeNsOverlay() { overlay.remove(); }
    overlay.querySelector('#ns-close')?.addEventListener('click', closeNsOverlay);
    overlay.querySelector('#ns-cancel')?.addEventListener('click', closeNsOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNsOverlay(); });

    let currentTab = 'clase';
    function updateSubmitLabel() {
      const submit = overlay.querySelector('#ns-submit');
      if (!submit) return;
      submit.textContent = currentTab === 'clase' ? 'Crear sesiones' : 'Crear reserva de material';
    }

    // El botón global de footer dispara el submit del form correspondiente
    overlay.querySelector('#ns-submit')?.addEventListener('click', () => {
      const form = currentTab === 'clase'
        ? overlay.querySelector('#new-session-form')
        : overlay.querySelector('#new-rental-form');
      form?.requestSubmit();
    });

    // Tab switching between Clase and Material
    overlay.querySelectorAll('[data-modal-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-modal-type]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const isClase = btn.dataset.modalType === 'clase';
        overlay.querySelector('#ns-clase-form').style.display = isClase ? '' : 'none';
        overlay.querySelector('#ns-material-form').style.display = isClase ? 'none' : '';
        currentTab = isClase ? 'clase' : 'material';
        updateSubmitLabel();
      });
    });

    // Expongo cierre para los handlers de submit que se definen más abajo
    overlay._close = closeNsOverlay;

    // Injury toggle in rental form
    document.getElementById('nr-has-injury')?.addEventListener('change', (e) => {
      document.getElementById('nr-injury-detail-wrap').style.display = e.target.value === 'si' ? '' : 'none';
    });

    // Load equipment for rental form — store data in JS map (not data attributes, avoids JSON parsing issues)
    const equipmentMap = {};
    (async () => {
      try {
        const equipment = await fetchEquipment();
        const sel = document.getElementById('nr-equipment');
        if (!sel) return;
        equipment.filter(e => e.active).forEach(e => { equipmentMap[e.id] = e; });
        sel.innerHTML = '<option value="">— Selecciona material —</option>' +
          equipment.filter(e => e.active).map(e => `<option value="${e.id}">${e.name}</option>`).join('');
      } catch (err) { console.warn('Error loading equipment:', err); }
    })();

    const DURATION_LABELS = { '1h': '1 hora', '2h': '2 horas', '4h': '4 horas', '1d': '1 día', '1w': '1 semana', '2w': '2 semanas', '1m': '1 mes' };

    // When equipment changes, update durations + sizes
    document.getElementById('nr-equipment')?.addEventListener('change', (e) => {
      const eqId = e.target.value;
      const eq = equipmentMap[eqId];
      if (!eq) return;
      const pricing = eq.pricing || {};
      const type = eq.type;
      const sizes = eq.sizes || [];
      const deposit = Number(eq.deposit) || 0;

      // Duration options
      const durSel = document.getElementById('nr-duration');
      const entries = Object.entries(pricing).filter(([, p]) => Number(p) > 0);
      durSel.innerHTML = entries.map(([key, price]) =>
        `<option value="${key}" data-price="${price}">${DURATION_LABELS[key] || key} — ${price}€</option>`
      ).join('') + '<option value="custom">Precio personalizado</option>';

      // Size selector
      const sizeWrap = document.getElementById('nr-size-wrap');
      if (type === 'con_talla' && sizes.length) {
        sizeWrap.style.display = '';
        document.getElementById('nr-size').innerHTML = sizes.map(s => `<option value="${s}">${s}</option>`).join('');
      } else {
        sizeWrap.style.display = 'none';
      }

      updateRentalPriceSummary(deposit);
      loadRentalUnits(true);
    });

    // Duration change — show/hide custom price
    document.getElementById('nr-duration')?.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'custom';
      document.getElementById('nr-custom-price-wrap').style.display = isCustom ? '' : 'none';
      const eqId = document.getElementById('nr-equipment')?.value;
      const deposit = Number(equipmentMap[eqId]?.deposit) || 0;
      updateRentalPriceSummary(deposit);
    });

    document.getElementById('nr-custom-price')?.addEventListener('input', () => {
      const eqId = document.getElementById('nr-equipment')?.value;
      updateRentalPriceSummary(Number(equipmentMap[eqId]?.deposit) || 0);
    });

    // ---- Unidad concreta (neopreno físico) disponible para el material + fechas ----
    const unitSizeOf = (u) => (u.category === 'tabla' && u.pies != null)
      ? `${Math.trunc(u.pies)}'${Math.round((u.pies - Math.trunc(u.pies)) * 10)}`
      : (u.talla || null);

    async function loadRentalUnits(rebuildSizes = false) {
      const wrap = document.getElementById('nr-unit-wrap');
      const sel = document.getElementById('nr-unit');
      const hint = document.getElementById('nr-unit-hint');
      if (!wrap || !sel) return;
      const eqId = document.getElementById('nr-equipment')?.value;
      const form = document.getElementById('new-rental-form');
      const ds = form?.querySelector('[name="date_start"]')?.value;
      const de = form?.querySelector('[name="date_end"]')?.value || ds;
      if (!eqId || !ds) { wrap.style.display = 'none'; return; }
      try {
        const [unitsRes, busyRes] = await Promise.all([
          supabase.from('inventory_units')
            .select('id,number,talla,pies,category,descripcion,marca,estado,equipment_id')
            .eq('equipment_id', eqId),
          // Reservas que ya ocupan una unidad y solapan en fecha con la nueva
          supabase.from('equipment_reservations')
            .select('assigned_unit_id')
            .eq('equipment_id', eqId)
            .not('assigned_unit_id', 'is', null)
            .in('status', ['pending', 'confirmed', 'active'])
            .lte('date_start', de)
            .gte('date_end', ds),
        ]);
        const units = unitsRes.data || [];
        if (!units.length) { wrap.style.display = 'none'; return; } // material sin inventario por unidad

        // Talla: el desplegable sale de las tallas REALES del inventario (no de la lista
        // manual del catálogo, que está desfasada). Así "8" casa con la unidad "8".
        const sizeWrap = document.getElementById('nr-size-wrap');
        const sizeSel = document.getElementById('nr-size');
        if (rebuildSizes && sizeSel) {
          const realSizes = [...new Set(units.map(u => unitSizeOf(u)).filter(Boolean))].sort(compareSizes);
          if (realSizes.length) {
            const prev = sizeSel.value;
            sizeSel.innerHTML = realSizes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
            const keep = realSizes.find(s => normSize(s) === normSize(prev));
            sizeSel.value = keep || realSizes[0];
            if (sizeWrap) sizeWrap.style.display = '';
          }
        }

        const occupied = new Set((busyRes.data || []).map(b => b.assigned_unit_id));
        const fuera = new Set(['reparacion', 'perdido', 'baja']);
        const wantSize = (sizeWrap && sizeWrap.style.display !== 'none') ? sizeSel?.value : null;
        const avail = units.filter(u => !occupied.has(u.id) && !fuera.has(u.estado) && (!wantSize || normSize(unitSizeOf(u)) === normSize(wantSize)));
        wrap.style.display = '';
        sel.innerHTML = '<option value="">— Sin asignar —</option>' + avail.map(u => {
          const desc = [u.number ? `Nº ${u.number}` : null, unitSizeOf(u), u.marca, u.descripcion].filter(Boolean).join(' · ');
          return `<option value="${u.id}" data-size="${escapeHtml(unitSizeOf(u) || '')}">${escapeHtml(desc)}</option>`;
        }).join('');
        if (hint) hint.textContent = avail.length
          ? `${avail.length} unidad(es) libre(s) en esas fechas — elige el neopreno concreto o déjalo sin asignar.`
          : 'No hay unidades libres en esas fechas; puedes crear el alquiler sin asignar.';
      } catch (err) { console.warn('loadRentalUnits:', err); wrap.style.display = 'none'; }
    }

    // Al cambiar talla: solo re-filtrar. Al cambiar fechas: rehacer tallas (cambia el stock).
    document.getElementById('nr-size')?.addEventListener('change', () => loadRentalUnits(false));
    document.querySelector('#new-rental-form [name="date_start"]')?.addEventListener('change', () => loadRentalUnits(true));
    document.querySelector('#new-rental-form [name="date_end"]')?.addEventListener('change', () => loadRentalUnits(true));
    document.getElementById('nr-unit')?.addEventListener('change', (e) => {
      const sz = e.target.selectedOptions[0]?.dataset.size;
      const sizeSel = document.getElementById('nr-size');
      if (sz && sizeSel && [...sizeSel.options].some(o => o.value === sz)) sizeSel.value = sz;
    });

    // ---- Carrito de materiales: varios materiales en una misma reserva (un cliente) ----
    // Los campos de arriba editan UNA línea; "+ Añadir" la guarda en esta lista. Al crear
    // la reserva se insertan N filas equipment_reservations con un group_id compartido.
    const rentalLines = [];
    // Lee la línea que hay ahora mismo en el editor (o null si no hay material/tarifa).
    function readMaterialEditor() {
      const eqSel = document.getElementById('nr-equipment');
      const eqId = eqSel?.value;
      if (!eqId) return null;
      const durSel = document.getElementById('nr-duration');
      const durKey = durSel?.value;
      if (!durKey) return null;
      const eq = equipmentMap[eqId];
      let unitPrice, durLabel;
      if (durKey === 'custom') {
        unitPrice = parseFloat(document.getElementById('nr-custom-price')?.value) || 0;
        durLabel = 'Personalizado';
      } else {
        unitPrice = Number(durSel.selectedOptions[0]?.dataset.price) || 0;
        durLabel = DURATION_LABELS[durKey] || durKey;
      }
      const qty = parseInt(document.querySelector('#new-rental-form [name="quantity"]')?.value) || 1;
      const sizeWrap = document.getElementById('nr-size-wrap');
      const size = (sizeWrap && sizeWrap.style.display !== 'none') ? (document.getElementById('nr-size')?.value || null) : null;
      const unitWrap = document.getElementById('nr-unit-wrap');
      const unitSel = document.getElementById('nr-unit');
      const assignedUnitId = (unitWrap && unitWrap.style.display !== 'none') ? (unitSel?.value || null) : null;
      const unitLabel = assignedUnitId ? (unitSel?.selectedOptions[0]?.textContent?.trim() || null) : null;
      const form = document.getElementById('new-rental-form');
      const dateStart = form.querySelector('[name="date_start"]').value;
      const timeStart = form.querySelector('[name="time_start"]').value || null;
      const dateEnd = form.querySelector('[name="date_end"]').value || dateStart;
      return {
        equipment_id: eqId, equipment_name: eq?.name || 'Material',
        size, assigned_unit_id: assignedUnitId, unit_label: unitLabel,
        duration_key: durKey, duration_label: durLabel,
        quantity: qty, unit_price: unitPrice,
        line_total: Math.round(unitPrice * qty * 100) / 100,
        date_start: dateStart, time_start: timeStart, date_end: dateEnd,
      };
    }
    function renderRentalLines() {
      const wrap = document.getElementById('nr-lines');
      const totalEl = document.getElementById('nr-lines-total');
      if (!wrap) return;
      wrap.innerHTML = rentalLines.map((ln, i) => {
        const bits = [ln.duration_label, ln.size ? `talla ${ln.size}` : null, ln.quantity > 1 ? `×${ln.quantity}` : null, ln.unit_label].filter(Boolean).join(' · ');
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:.85rem">
          <span style="flex:1"><strong>${escapeHtml(ln.equipment_name)}</strong>${bits ? ` <span style="color:#64748b">— ${escapeHtml(bits)}</span>` : ''}</span>
          <span style="font-weight:700;color:#0f2f39">${ln.line_total.toFixed(2)}€</span>
          <button type="button" class="nr-line-del" data-i="${i}" title="Quitar" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px">×</button>
        </div>`;
      }).join('');
      if (totalEl) {
        const total = rentalLines.reduce((s, l) => s + l.line_total, 0);
        totalEl.style.display = rentalLines.length ? '' : 'none';
        totalEl.textContent = `Total reserva: ${total.toFixed(2)}€ · ${rentalLines.length} material(es)`;
      }
    }
    // Delegación: un único listener para los botones "×" (no se re-engancha en cada render).
    document.getElementById('nr-lines')?.addEventListener('click', (e) => {
      const b = e.target.closest('.nr-line-del');
      if (!b) return;
      rentalLines.splice(Number(b.dataset.i), 1);
      renderRentalLines();
    });
    // Resetea el editor para añadir el siguiente material (mantiene fechas/horas).
    function resetMaterialEditor() {
      const eqSel = document.getElementById('nr-equipment');
      if (eqSel) eqSel.value = '';
      const durSel = document.getElementById('nr-duration');
      if (durSel) durSel.innerHTML = '<option value="">Selecciona un material…</option>';
      document.getElementById('nr-custom-price-wrap').style.display = 'none';
      document.getElementById('nr-size-wrap').style.display = 'none';
      document.getElementById('nr-unit-wrap').style.display = 'none';
      const qtyEl = document.querySelector('#new-rental-form [name="quantity"]');
      if (qtyEl) qtyEl.value = '1';
      const summary = document.getElementById('nr-price-summary');
      if (summary) summary.style.display = 'none';
    }
    document.getElementById('nr-add-line')?.addEventListener('click', () => {
      const ln = readMaterialEditor();
      if (!ln) { showToast('Elige material y tarifa antes de añadir', 'error'); return; }
      if (!ln.date_start) { showToast('Indica la fecha de inicio', 'error'); return; }
      rentalLines.push(ln);
      renderRentalLines();
      resetMaterialEditor();
      document.getElementById('nr-equipment')?.focus();
    });

    // ---- Buscar y enlazar un cliente existente (opcional) ----
    // Si se enlaza, la reserva guarda user_id → aparece en la ficha del cliente
    // y en su "DEBE €X" automáticamente (ambos ya leen por user_id).
    {
      const csearch = document.getElementById('nr-client-search');
      const cresults = document.getElementById('nr-client-results');
      const cuser = document.getElementById('nr-user-id');
      const cchip = document.getElementById('nr-client-chip');
      const rform = document.getElementById('new-rental-form');
      const setField = (n, v) => { const el = rform?.querySelector(`[name="${n}"]`); if (el) el.value = v || ''; };
      let ctimer = null;
      csearch?.addEventListener('input', () => {
        clearTimeout(ctimer);
        const term = csearch.value.trim();
        if (term.length < 2) { cresults.style.display = 'none'; return; }
        ctimer = setTimeout(async () => {
          const res = await searchProfiles(term);
          cresults.innerHTML = res.length
            ? res.map(p => `<div class="nr-client-opt" data-id="${p.id}" data-name="${escapeHtml(p.full_name || '')}" data-lastname="${escapeHtml(p.last_name || '')}" data-phone="${escapeHtml(p.phone || '')}" data-email="${escapeHtml(p.email || '')}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:.88rem">${escapeHtml(p.full_name || 'Sin nombre')}${p.phone ? ` · <span style="color:#64748b">${escapeHtml(p.phone)}</span>` : ''}</div>`).join('')
            : '<div style="padding:10px;color:#94a3b8;font-size:.85rem">Sin resultados</div>';
          cresults.style.display = '';
        }, 250);
      });
      cresults?.addEventListener('click', (e) => {
        const opt = e.target.closest('.nr-client-opt');
        if (!opt) return;
        cuser.value = opt.dataset.id;
        setField('guest_name', opt.dataset.name);
        setField('guest_last_name', opt.dataset.lastname);
        setField('guest_phone', opt.dataset.phone);
        setField('guest_email', opt.dataset.email);
        cresults.style.display = 'none';
        csearch.value = '';
        cchip.innerHTML = `✓ Enlazado a <strong>${escapeHtml(opt.dataset.name)}</strong> — saldrá en su ficha. <button type="button" id="nr-client-clear" style="background:none;border:none;color:#065f46;text-decoration:underline;cursor:pointer;font-size:.85rem;padding:0;margin-left:6px">quitar</button>`;
        cchip.style.display = '';
      });
      cchip?.addEventListener('click', (e) => {
        if (e.target.id !== 'nr-client-clear') return;
        cuser.value = '';
        cchip.style.display = 'none';
        setField('guest_name', ''); setField('guest_phone', '');
        setField('guest_last_name', ''); setField('guest_email', '');
      });
      // Autocompletado de fichas en los propios campos de nombre/email (vincula y no duplica)
      const linkPicked = (it) => {
        cuser.value = it.id;
        setField('guest_name', it.full_name);
        setField('guest_last_name', it.last_name);
        setField('guest_phone', it.phone);
        setField('guest_email', it.email);
        cchip.innerHTML = `✓ Enlazado a <strong>${escapeHtml(it.label || it.full_name)}</strong> — saldrá en su ficha. <button type="button" id="nr-client-clear" style="background:none;border:none;color:#065f46;text-decoration:underline;cursor:pointer;font-size:.85rem;padding:0;margin-left:6px">quitar</button>`;
        cchip.style.display = '';
      };
      attachClientSuggest(rform?.querySelector('[name="guest_name"]'), { onPick: linkPicked });
      attachClientSuggest(rform?.querySelector('[name="guest_email"]'), { onPick: linkPicked, includeFamily: false });
      document.addEventListener('click', (e) => {
        if (cresults && cresults.style.display !== 'none' && !cresults.contains(e.target) && e.target !== csearch) cresults.style.display = 'none';
      });
    }

    function updateRentalPriceSummary(deposit) {
      const durSel = document.getElementById('nr-duration');
      const summary = document.getElementById('nr-price-summary');
      if (!durSel || !summary) return;
      let price = 0;
      if (durSel.value === 'custom') {
        price = parseFloat(document.getElementById('nr-custom-price')?.value) || 0;
      } else {
        const durOpt = durSel.selectedOptions[0];
        price = Number(durOpt?.dataset.price) || 0;
      }
      const qty = parseInt(document.querySelector('#new-rental-form [name="quantity"]')?.value) || 1;
      const total = price * qty;
      summary.style.display = total > 0 ? '' : 'none';
      summary.innerHTML = `Total: ${total}€${deposit > 0 ? ` · Depósito: ${deposit}€` : ''}`;
    }

    // Duración por tipo (min). La hora de fin se calcula sola desde inicio + duración.
    const durations = { grupal: 90, individual: 90, paddle: 90, surfskate: 90, yoga: 60 };
    function addMinutes(hhmm, mins) {
      const [h, m] = (hhmm || '0:0').split(':').map(Number);
      const total = (h * 60 + m + mins) % (24 * 60);
      const eh = Math.floor(total / 60), em = total % 60;
      return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    }
    function recomputeEnd() {
      const t = document.getElementById('ns-type')?.value;
      const start = document.getElementById('ns-time-start')?.value;
      const endEl = document.getElementById('ns-time-end');
      if (endEl && start) endEl.value = addMinutes(start, durations[t] || 90);
    }
    // Carga las duraciones reales desde activities (sobrescribe el fallback)
    supabase.from('activities').select('type_key, duracion').eq('activo', true).then(({ data }) => {
      (data || []).forEach(a => { if (a.duracion) durations[a.type_key] = Number(a.duracion); });
      recomputeEnd();
    });

    // Instructor: select de staff registrado
    populateInstructorSelect(document.getElementById('ns-instructor'));

    // Auto-update capacity + hora de fin when type changes (class form)
    document.getElementById('ns-type')?.addEventListener('change', (e) => {
      const t = e.target.value;
      document.getElementById('ns-capacity').value = defaultCapacities[t] || 8;
      // Prerrellena el precio de clase suelta con el de la actividad (editable)
      const priceEl = document.getElementById('ns-price');
      if (priceEl && !priceEl.dataset.touched) priceEl.value = getPackPrice(t, 1, 0);
      recomputeEnd();
    });
    document.getElementById('ns-price')?.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    document.getElementById('ns-time-start')?.addEventListener('input', recomputeEnd);

    // Dispatch change event on load to sync capacity with default type
    document.getElementById('ns-type')?.dispatchEvent(new Event('change'));
    recomputeEnd();

    // Toggle "Un solo día" / "Varios días"
    let sessionMode = 'single';
    overlay.querySelectorAll('.ns-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sessionMode = btn.dataset.mode;
        overlay.querySelectorAll('.ns-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        overlay.querySelectorAll('.ns-mode-single').forEach(el => el.style.display = sessionMode === 'single' ? '' : 'none');
        overlay.querySelectorAll('.ns-mode-repeat').forEach(el => el.style.display = sessionMode === 'repeat' ? '' : 'none');
      });
    });

    // Class session form submit
    document.getElementById('new-session-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const type = fd.get('type');
      const timeStart = fd.get('time_start');
      const timeEnd = addMinutes(timeStart, durations[type] || 90);
      // Respeta el aforo escrito (la individual también admite grupo privado >1).
      let maxStudents = parseInt(fd.get('max_students'), 10);
      if (!maxStudents || maxStudents < 1) maxStudents = defaultCapacities[type] || 1;
      // Precio de clase suelta (drop-in). Si vacío, usa el de la actividad.
      let classPrice = parseFloat(fd.get('price'));
      if (!(classPrice >= 0)) classPrice = getPackPrice(type, 1, 0);
      const instructor = fd.get('instructor') || null;
      const audience = fd.get('audience') || null;
      const published = e.target.published.checked;

      const dates = [];
      if (sessionMode === 'single') {
        const single = fd.get('single_date');
        if (!single) { showToast('Elige una fecha', 'error'); return; }
        dates.push(single);
      } else {
        const repeatUntil = fd.get('repeat_until');
        const repeatDays = fd.getAll('repeat_days').map(Number);
        if (!repeatDays.length) { showToast('Selecciona al menos un día', 'error'); return; }
        if (!repeatUntil) { showToast('Indica hasta qué fecha repetir', 'error'); return; }
        const start = new Date(getDateStr(currentDate) + 'T00:00:00');
        const end = new Date(repeatUntil + 'T00:00:00');
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          if (repeatDays.includes(d.getDay())) dates.push(getDateStr(new Date(d)));
        }
      }

      if (!dates.length) { showToast('No hay fechas que coincidan', 'error'); return; }

      const submitBtn = document.getElementById('ns-submit') || e.target.querySelector('button[type="submit"]');
      const nLabel = dates.length === 1 ? '1 sesión' : `${dates.length} sesiones`;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = `Creando ${nLabel}…`; }

      try {
        for (const date of dates) {
          await upsertClass({
            title: TYPE_LABELS[type], type, level: 'todos', date,
            time_start: timeStart, time_end: timeEnd,
            max_students: maxStudents, instructor, audience, price: classPrice, published,
            location: 'Playa del Hombre', status: 'scheduled',
          });
        }
        document.getElementById('ns-overlay')?.remove();
        closeModal();
        showToast(dates.length === 1 ? 'Sesión creada' : `${dates.length} sesiones creadas`, 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear sesiones';
      }
    });

    // Rental reservation form submit
    // Valida el stock de TODOS los materiales del carrito en sus fechas. Stock total =
    // unidades físicas del inventario si las hay; si no, el campo 'stock' del catálogo
    // (gestión por cantidad). Devuelve {ok} o {ok:false, message} con el material que falta.
    const datesOverlap = (a, b) => a.date_start <= (b.date_end || b.date_start) && b.date_start <= (a.date_end || a.date_start);
    async function checkRentalStock(lines) {
      const byEq = {};
      for (const ln of lines) (byEq[ln.equipment_id] ||= []).push(ln);
      for (const eqId of Object.keys(byEq)) {
        const eq = equipmentMap[eqId];
        const eqLines = byEq[eqId];
        // Stock total del material
        let usable = 0;
        try {
          const { data: units } = await supabase.from('inventory_units').select('id,estado').eq('equipment_id', eqId);
          usable = (units || []).filter(u => !['reparacion', 'perdido', 'baja'].includes(u.estado)).length;
        } catch {}
        const totalStock = usable > 0 ? usable : (Number(eq?.stock) || 0);
        for (const ln of eqLines) {
          let reservedDb = 0;
          try {
            const { data: busy } = await supabase.from('equipment_reservations')
              .select('quantity,date_start,date_end')
              .eq('equipment_id', eqId)
              .in('status', ['pending', 'confirmed', 'active'])
              .lte('date_start', ln.date_end)
              .gte('date_end', ln.date_start);
            reservedDb = (busy || []).reduce((s, b) => s + (Number(b.quantity) || 1), 0);
          } catch {}
          // Otras líneas del MISMO material en el carrito que solapan en fecha
          const cartOther = eqLines.filter(o => o !== ln && datesOverlap(o, ln)).reduce((s, o) => s + (o.quantity || 1), 0);
          const need = (ln.quantity || 1) + cartOther;
          if (reservedDb + need > totalStock) {
            const libres = Math.max(0, totalStock - reservedDb);
            return { ok: false, message: `Sin stock de ${eq?.name || 'material'}: ${libres} libre(s) en esas fechas y pides ${need}.` };
          }
        }
      }
      return { ok: true };
    }

    document.getElementById('new-rental-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);

      // Líneas a crear = las añadidas al carrito + la que esté ahora en el editor (si la hay
      // y no se pulsó "+ Añadir"), para que el flujo de un solo material funcione sin añadir.
      const lines = [...rentalLines];
      const editorLine = readMaterialEditor();
      if (editorLine) lines.push(editorLine);
      if (!lines.length) { showToast('Añade al menos un material', 'error'); return; }

      const submitBtn = document.getElementById('ns-submit') || e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando reserva…'; }

      // Bloqueo por stock: si algún material no tiene disponibilidad en sus fechas, no crea.
      const stockCheck = await checkRentalStock(lines);
      if (!stockCheck.ok) {
        showToast(stockCheck.message, 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Crear reserva de material'; }
        return;
      }

      // Datos de cliente compartidos por todas las líneas
      const extraData = {};
      const wetsuitSize = fd.get('wetsuit_size')?.trim();
      const canSwim = fd.get('can_swim');
      const hasInjury = fd.get('has_injury');
      const injuryDetail = fd.get('injury_detail')?.trim();
      const guestLastName = fd.get('guest_last_name')?.trim();
      if (wetsuitSize) extraData.wetsuit_size = wetsuitSize;
      if (canSwim) extraData.can_swim = canSwim;
      if (hasInjury === 'si') extraData.injury = injuryDetail || 'Sí';
      if (guestLastName) extraData.guest_last_name = guestLastName;
      const notes = Object.keys(extraData).length ? JSON.stringify(extraData) : null;

      const fullName = [fd.get('guest_name')?.trim(), guestLastName].filter(Boolean).join(' ') || null;
      const userId = fd.get('user_id') || null;
      const guestEmail = fd.get('guest_email')?.trim() || null;
      const guestPhone = fd.get('guest_phone')?.trim() || null;
      // group_id: enlaza las líneas de una misma reserva multi-material. 1 sola línea → null
      // (compatible con los alquileres antiguos, que se siguen mostrando individuales).
      const groupId = lines.length > 1 ? crypto.randomUUID() : null;

      try {
        for (const ln of lines) {
          const payload = {
            equipment_id: ln.equipment_id,
            user_id: userId,
            guest_name: fullName,
            guest_email: guestEmail,
            guest_phone: guestPhone,
            date_start: ln.date_start,
            date_end: ln.date_end,
            duration_key: ln.duration_key === 'custom' ? 'custom' : ln.duration_key,
            size: ln.size || null,
            assigned_unit_id: ln.assigned_unit_id || null,
            quantity: ln.quantity,
            total_amount: ln.line_total,
            // Nace SIN cobrar: deposit_paid lo sincroniza el icono de pago (que crea el
            // payment). Antes se metía aquí la fianza del material y salía siempre pagado.
            deposit_paid: 0,
            time_start: ln.time_start || null,
            status: 'confirmed',
            notes,
          };
          // Solo añadimos group_id cuando hay varios materiales → los alquileres de 1
          // material siguen funcionando aunque la columna group_id no exista todavía.
          if (groupId) payload.group_id = groupId;
          await createEquipmentReservation(payload);
        }
        document.getElementById('ns-overlay')?.remove();
        closeModal();
        showToast(lines.length > 1 ? `Reserva con ${lines.length} materiales creada` : 'Reserva de material creada', 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Crear reserva de material';
      }
    });
  }

  // ======== RENTAL DETAIL PANEL (fullscreen ficha) ========
  function openRentalDetail(r) {
    const equipName = r.rental_equipment?.name || 'Material';
    const clientName = r.guest_name || r.profiles?.full_name || 'Sin nombre';
    const clientEmail = r.guest_email || '—';
    const clientPhone = r.guest_phone || '—';
    let currentStatus = r.status || 'pending';
    const durationLabel = DURATION_KEY_LABELS[r.duration_key] || r.duration_key || '—';
    let totalAmount = Number(r.total_amount || 0);
    let currentDepositPaid = Number(r.deposit_paid || 0);
    const idShort = (r.id || '').slice(0, 24);
    const createdAt = r.created_at ? new Date(r.created_at).toLocaleString('es-ES') : '—';
    let rdActiveTab = 'resumen';
    let payments = null; // lazy loaded
    let unitChoices = null; // unidades candidatas para asignar (lazy)

    function unitRentalSize(u) {
      if (u.category === 'tabla' && u.pies != null) {
        const t = Math.trunc(u.pies);
        return `${t}'${Math.round((u.pies - t) * 10)}`;
      }
      return u.talla || null;
    }

    // Duración en minutos de las franjas por horas (el resto = día completo)
    const DUR_MIN = { '1h': 60, '2h': 120, '4h': 240 }; // resto (1d/1w/2w/1m/custom) = día completo
    function franjaMin(res) {
      const m = DUR_MIN[res.duration_key];
      if (!m || !res.time_start) return null; // null = ocupa el día entero
      const [h, mm] = String(res.time_start).slice(0, 5).split(':').map(Number);
      const start = h * 60 + (mm || 0);
      return [start, start + m];
    }
    // ¿Dos alquileres solapan en la franja horaria? (la fecha ya viene solapada por la query)
    function overlapsFranja(a, b) {
      const fa = franjaMin(a), fb = franjaMin(b);
      if (!fa || !fb) return true; // alguno es de día completo → ocupa todo el día
      return fa[0] < fb[1] && fb[0] < fa[1];
    }

    async function loadUnits() {
      try {
        if (!r.equipment_id) { unitChoices = []; renderRdPanel(); return; }
        const ds = String(r.date_start || '').slice(0, 10);
        const de = String(r.date_end || r.date_start || '').slice(0, 10);
        const [unitsRes, busyRes] = await Promise.all([
          supabase.from('inventory_units')
            .select('id,number,talla,pies,category,descripcion,marca,estado,equipment_id')
            .eq('equipment_id', r.equipment_id),
          // Reservas que ocupan una unidad y solapan en FECHA con esta (excluida ella misma)
          supabase.from('equipment_reservations')
            .select('id,assigned_unit_id,date_start,date_end,time_start,duration_key')
            .eq('equipment_id', r.equipment_id)
            .not('assigned_unit_id', 'is', null)
            .neq('id', r.id)
            .in('status', ['pending', 'confirmed', 'active'])
            .lte('date_start', de)
            .gte('date_end', ds),
        ]);
        // Unidades ocupadas en ESTA franja (fecha + hora)
        const occupied = new Set((busyRes.data || []).filter(b => overlapsFranja(b, r)).map(b => b.assigned_unit_id));
        const noAsignable = new Set(['reparacion', 'perdido', 'baja']); // físicamente fuera de juego
        unitChoices = (unitsRes.data || []).filter(u =>
          (u.id === r.assigned_unit_id) || // la ya asignada siempre visible
          (!occupied.has(u.id) && !noAsignable.has(u.estado)
            && (!r.size || normSize(unitRentalSize(u)) === normSize(r.size)))
        );
        renderRdPanel();
      } catch (err) { console.warn('loadUnits:', err); unitChoices = []; }
    }

    function renderUnitAssign() {
      if (!r.equipment_id) {
        return `<p style="margin:0;font-size:.85rem;color:var(--color-muted)">Esta reserva no está vinculada a un material del catálogo, no se puede asignar unidad.</p>`;
      }
      if (unitChoices === null) {
        loadUnits();
        return `<p style="margin:0;font-size:.85rem;color:var(--color-muted)">Cargando unidades…</p>`;
      }
      const opts = [`<option value="">— Sin asignar —</option>`].concat(
        unitChoices.map(u => {
          const sz = unitRentalSize(u);
          const desc = [u.number ? `Nº ${u.number}` : null, sz, u.marca, u.descripcion].filter(Boolean).join(' · ');
          const tag = u.estado !== 'disponible' ? ` [${u.estado}]` : '';
          return `<option value="${u.id}" ${r.assigned_unit_id === u.id ? 'selected' : ''}>${escapeHtml(desc)}${tag}</option>`;
        })
      ).join('');
      const none = unitChoices.length === 0 ? `<p style="margin:6px 0 0;font-size:.8rem;color:#b45309">No hay unidades disponibles${r.size ? ` de la talla ${escapeHtml(r.size)}` : ''}.</p>` : '';
      return `<select id="rd-unit-assign" class="rv-info-input" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem;font-family:inherit;cursor:pointer">${opts}</select>${none}`;
    }

    // Remove any existing rental detail overlay
    document.getElementById('rental-detail-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'bk-overlay bk-overlay-fullscreen';
    overlay.id = 'rental-detail-overlay';
    document.body.appendChild(overlay);

    function getStatusLabel() { return RENTAL_STATUS_LABELS[currentStatus] || currentStatus; }
    function getStatusColor() {
      const c = { pending: '#f59e0b', confirmed: '#1a1a1a', active: '#22c55e', returned: '#64748b', cancelled: '#ef4444' };
      return c[currentStatus] || '#64748b';
    }
    function getStatusBg() {
      const c = { pending: '#fef3c7', confirmed: '#e0f2fe', active: '#dcfce7', returned: '#f1f5f9', cancelled: '#fee2e2' };
      return c[currentStatus] || '#f1f5f9';
    }
    function getPending() { return Math.max(0, totalAmount - currentDepositPaid); }
    function isPaidFn() { return totalAmount > 0 ? currentDepositPaid >= totalAmount : currentDepositPaid > 0; }

    function renderRdPanel() {
      const statusLabel = getStatusLabel();
      const statusColor = getStatusColor();
      const statusBg = getStatusBg();
      const pending = getPending();
      const paid = isPaidFn();
      const pendingColor = pending > 0 ? '#b91c1c' : '#166534';

      let tabContent = '';
      if (rdActiveTab === 'resumen') {
        tabContent = `
          <div class="rv-summary-header">
            <h2 class="rv-title">Resumen de la reserva <span class="rv-status-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span></h2>
          </div>
          <div class="rv-info-card">
            <div class="rv-info-top">
              <div class="rv-info-top-left">
                <div class="rv-info-id">Reserva ${idShort}</div>
                <div style="font-size:.82rem;color:var(--color-muted);margin-top:2px">Creada el ${createdAt} · Por Admin</div>
              </div>
              <div class="rv-info-top-right">
                <div class="rv-info-stat"><label>Total</label>
                  <span class="rd-total-show" style="display:inline-flex;align-items:center;gap:6px"><span class="rv-info-amount">${totalAmount.toFixed(2)}€</span>
                    <button class="rd-total-edit" title="Editar precio" style="background:none;border:none;color:#1a1a1a;cursor:pointer;font-size:.95rem">✎</button></span>
                  <span class="rd-total-edit-box" style="display:none;align-items:center;gap:4px">
                    <input type="number" step="0.01" min="0" class="rd-total-input" value="${totalAmount.toFixed(2)}" style="width:90px;padding:3px 6px;border:1px solid #1a1a1a;border-radius:6px" />
                    <button class="rd-total-save" style="background:none;border:none;color:#16a34a;cursor:pointer;font-weight:700;font-size:1.05rem">✓</button>
                    <button class="rd-total-cancel" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:1.05rem">✕</button>
                  </span>
                </div>
                <div class="rv-info-stat"><label>Pendiente</label><span class="rv-info-amount" style="color:${pendingColor}">${pending.toFixed(2)}€</span></div>
                ${pending > 0 ? `<button class="btn rd-add-payment-btn" style="padding:6px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;font-size:.82rem;cursor:pointer;font-weight:600;color:#0f2f39">Añadir pago</button>` : ''}
              </div>
            </div>
            <div class="rv-info-bottom" style="border-top:1px solid #f1f5f9;padding-top:16px">
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
                <div>
                  <div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600;letter-spacing:.5px;margin-bottom:4px">Reservado por</div>
                  <strong style="font-size:.95rem">${clientName}</strong>
                  ${clientPhone !== '—' ? `<div style="font-size:.82rem;color:var(--color-muted);margin-top:2px">${clientPhone}</div>` : ''}
                  ${clientEmail !== '—' ? `<div style="font-size:.82rem;color:var(--color-muted)">${clientEmail}</div>` : ''}
                </div>
                <div>
                  <div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600;letter-spacing:.5px;margin-bottom:4px">Check in / Check out</div>
                  <div style="display:flex;align-items:center;gap:6px;font-size:.9rem">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <input type="date" id="rd-date-start" value="${r.date_start?.slice(0, 10) || ''}" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.85rem;font-family:inherit" />
                    <input type="time" id="rd-time-start" value="${r.time_start ? r.time_start.slice(0, 5) : ''}" title="Hora de inicio" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.85rem;font-family:inherit" />
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;font-size:.9rem;margin-top:4px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <input type="date" id="rd-date-end" value="${r.date_end?.slice(0, 10) || ''}" style="padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:.85rem;font-family:inherit" />
                  </div>
                  ${currentStatus !== 'cancelled' ? `<button class="rd-extend-btn" style="margin-top:8px;font-size:.8rem;padding:6px 12px;background:#1a1a1a;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600">+ Alargar alquiler</button>` : ''}
                </div>
                <div>
                  <div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600;letter-spacing:.5px;margin-bottom:4px">Material</div>
                  <div style="font-size:.9rem">${equipName}</div>
                  ${r.size ? `<div style="font-size:.82rem;color:var(--color-muted)">Talla: ${r.size}</div>` : ''}
                  ${r.quantity > 1 ? `<div style="font-size:.82rem;color:var(--color-muted)">Cant: ${r.quantity}</div>` : ''}
                </div>
              </div>
            </div>
          </div>
          <div class="rv-info-card" style="padding:16px;margin-top:12px">
            <div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600;letter-spacing:.5px;margin-bottom:8px">Unidad física asignada</div>
            ${renderUnitAssign()}
          </div>
          <div class="rv-person-card">
            <div class="rv-person-header">
              <div class="rv-person-avatar" style="background:#1a1a1a">${(clientName || '?')[0].toUpperCase()}</div>
              <div class="rv-person-info"><span class="rv-person-name">${clientName}</span></div>
              ${clientPhone !== '—' ? `<a class="rv-person-action" href="https://wa.me/${clientPhone.replace(/[^0-9+]/g, '')}" target="_blank" title="WhatsApp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg></a>` : ''}
              ${clientPhone !== '—' ? `<a class="rv-person-action" href="tel:${clientPhone}" title="Llamar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg></a>` : ''}
              ${clientEmail !== '—' ? `<a class="rv-person-action" href="mailto:${clientEmail}" title="Email"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></a>` : ''}
            </div>
            <table class="rv-sessions-table">
              <thead><tr><th>Fechas</th><th>Producto</th><th>Duración</th></tr></thead>
              <tbody>
                <tr>
                  <td>${r.date_start?.slice(0, 10) || '—'} → ${r.date_end?.slice(0, 10) || '—'}</td>
                  <td><strong>${equipName}</strong></td>
                  <td>${durationLabel}</td>
                </tr>
              </tbody>
            </table>
          </div>`;
      } else if (rdActiveTab === 'datos') {
        tabContent = `
          <h2 class="rv-title">Datos del comprador</h2>
          <div class="rv-info-card" style="padding:24px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="rv-info-detail"><label>Nombre</label><strong>${clientName}</strong></div>
              <div class="rv-info-detail"><label>Email</label><div>${clientEmail}</div></div>
              <div class="rv-info-detail"><label>Teléfono</label><div>${clientPhone}</div></div>
              <div class="rv-info-detail"><label>Estado reserva</label><div style="color:${statusColor}">${statusLabel}</div></div>
            </div>
          </div>
          ${r.notes ? `<h3 class="rv-title" style="margin-top:16px">Notas</h3><div class="rv-info-card" style="padding:16px"><p style="margin:0">${r.notes}</p></div>` : ''}`;
      } else if (rdActiveTab === 'pagos') {
        const paymentsList = payments || [];
        const totalPaid = paymentsList.reduce((s, p) => s + Number(p.amount || 0), 0);
        const displayDeposit = Math.max(currentDepositPaid, totalPaid);
        const displayPending = Math.max(0, totalAmount - displayDeposit);
        tabContent = `
          <h2 class="rv-title">Pagos</h2>
          <div class="rv-info-card" style="padding:0;overflow:hidden">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #f1f5f9">
              <div style="padding:16px;text-align:center"><div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);margin-bottom:4px">Subtotal</div><div style="font-size:1.1rem;font-weight:600">${totalAmount.toFixed(2)}€</div></div>
              <div style="padding:16px;text-align:center"><div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);margin-bottom:4px">Descuento</div><div style="font-size:1.1rem;font-weight:600;color:#f59e0b">0.00€</div></div>
              <div style="padding:16px;text-align:center"><div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);margin-bottom:4px">Total</div><div style="font-size:1.1rem;font-weight:600">${totalAmount.toFixed(2)}€</div></div>
              <div style="padding:16px;text-align:center"><div style="font-size:.72rem;text-transform:uppercase;color:var(--color-muted);margin-bottom:4px">Pendiente</div><div style="font-size:1.1rem;font-weight:600;color:${displayPending > 0 ? '#b91c1c' : '#166534'}">${displayPending.toFixed(2)}€</div></div>
            </div>
            ${paymentsList.length ? `
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:#f8fafc">
                <th style="padding:10px 16px;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600">Concepto</th>
                <th style="padding:10px 16px;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600">Tipo</th>
                <th style="padding:10px 16px;text-align:left;font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600">Fecha</th>
                <th style="padding:10px 16px;text-align:right;font-size:.72rem;text-transform:uppercase;color:var(--color-muted);font-weight:600">Total</th>
                <th style="padding:10px 16px;width:60px"></th>
              </tr></thead>
              <tbody>${paymentsList.map(p => `
                <tr style="border-top:1px solid #f1f5f9">
                  <td style="padding:10px 16px"><span style="display:inline-block;width:8px;height:100%;background:#22c55e;border-radius:2px;margin-right:8px"></span>${p.concept || 'Pago'}</td>
                  <td style="padding:10px 16px;text-transform:capitalize">${p.payment_method}</td>
                  <td style="padding:10px 16px">${new Date(p.payment_date).toLocaleString('es-ES')}</td>
                  <td style="padding:10px 16px;text-align:right;font-weight:600">${Number(p.amount).toFixed(2)}€</td>
                  <td style="padding:10px 16px;text-align:right;white-space:nowrap">${p.channel === 'web' ? '' : `
                    <button class="rd-edit-payment" data-pid="${p.id}" style="background:none;border:none;cursor:pointer;color:#1a1a1a;margin-right:8px" title="Editar pago"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <button class="rd-delete-payment" data-pid="${p.id}" style="background:none;border:none;cursor:pointer;color:#b91c1c" title="Eliminar pago"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>`}</td>
                </tr>`).join('')}
              </tbody>
            </table>` : `<div style="padding:24px;text-align:center;color:var(--color-muted)">No hay pagos registrados</div>`}
          </div>
          <button class="btn rd-add-payment-btn" style="margin-top:16px;background:#22c55e;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600">Añadir pago</button>`;
        if (!payments) loadPayments();
      } else if (rdActiveTab === 'historico') {
        const timeline = [];
        if (r.created_at) timeline.push({ date: r.created_at, label: 'Reserva creada', color: '#1a1a1a' });
        if (currentStatus === 'confirmed' || currentStatus === 'active' || currentStatus === 'returned') timeline.push({ date: r.created_at, label: 'Reserva confirmada', color: '#22c55e' });
        if (currentDepositPaid > 0) timeline.push({ date: r.updated_at || r.created_at, label: `Pago registrado: ${currentDepositPaid.toFixed(2)}€`, color: '#22c55e' });
        if (currentStatus === 'active') timeline.push({ date: r.updated_at || r.created_at, label: 'Material entregado (activa)', color: '#1a1a1a' });
        if (currentStatus === 'returned') timeline.push({ date: r.updated_at || r.created_at, label: 'Material devuelto', color: '#64748b' });
        if (currentStatus === 'cancelled') timeline.push({ date: r.updated_at || r.created_at, label: 'Reserva cancelada', color: '#ef4444' });

        // Include payment records in timeline
        if (payments?.length) {
          payments.forEach(p => timeline.push({ date: p.payment_date, label: `Pago: ${Number(p.amount).toFixed(2)}€ (${p.payment_method})${p.concept ? ' — ' + p.concept : ''}`, color: '#22c55e' }));
        } else if (!payments) { loadPayments(); }

        timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

        tabContent = `
          <h2 class="rv-title">Histórico</h2>
          <div class="rv-info-card" style="padding:24px">
            <div class="rv-timeline">
              ${timeline.map(t => `
                <div class="rv-timeline-item">
                  <div class="rv-timeline-dot" style="background:${t.color}"></div>
                  <div class="rv-timeline-content">
                    <strong>${t.label}</strong>
                    <span>${new Date(t.date).toLocaleString('es-ES')}</span>
                  </div>
                </div>`).join('')}
            </div>
          </div>`;
      }

      overlay.innerHTML = `
        <div class="bk-panel bk-panel-fullscreen">
          <div class="bk-panel-header" style="background:linear-gradient(135deg,#1a1a1a,#1a1a1add)">
            <div class="bk-header-left" style="display:flex;align-items:center;gap:14px">
              <button class="bk-close-btn" id="rd-close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <span class="bk-header-title">Ficha de Reserva</span>
              <span style="font-family:'Space Grotesk',sans-serif;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.7;background:rgba(255,255,255,.15);padding:3px 10px;border-radius:5px">${equipName}</span>
            </div>
            <div class="bk-header-right" style="display:flex;align-items:center;gap:16px">
              <div class="bk-header-total"><small>Total</small><span>${totalAmount.toFixed(2)}€</span></div>
              <div class="bk-header-total"><small>Pendiente</small><span style="color:${getPending() > 0 ? '#fca5a5' : '#86efac'}">${getPending().toFixed(2)}€</span></div>
            </div>
          </div>
          <div class="bk-panel-body" style="padding:0">
            <div class="rv-layout">
              <nav class="rv-sidebar">
                <a class="rv-nav-item ${rdActiveTab === 'resumen' ? 'active' : ''}" data-tab="resumen">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  Resumen
                </a>
                <div class="rv-nav-group">Cliente</div>
                <a class="rv-nav-item ${rdActiveTab === 'datos' ? 'active' : ''}" data-tab="datos">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Datos del comprador
                </a>
                <div class="rv-nav-group">Gestión</div>
                <a class="rv-nav-item ${rdActiveTab === 'pagos' ? 'active' : ''}" data-tab="pagos">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  Pagos
                </a>
                <a class="rv-nav-item ${rdActiveTab === 'historico' ? 'active' : ''}" data-tab="historico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Histórico
                </a>
              </nav>
              <main class="rv-main" id="rd-main">${tabContent}</main>
              <aside class="rv-actions">
                ${currentStatus !== 'cancelled' ? `
                <button class="rv-action-link danger" id="rd-cancel">
                  <span>Cancelar alquiler</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                </button>` : ''}
                ${currentStatus === 'pending' ? `
                <button class="rv-action-link" id="rd-confirm">
                  <span>Confirmar reserva</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </button>` : ''}
                ${currentStatus === 'confirmed' || currentStatus === 'active' ? `
                <button class="rv-action-link" id="rd-mark-returned">
                  <span>Marcar devuelto</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                </button>` : ''}
                <button class="rv-action-link rd-add-payment-btn" style="color:#22c55e">
                  <span>Añadir pago</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                </button>
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
                  <div style="font-size:.7rem;text-transform:uppercase;color:var(--color-muted);font-weight:600;letter-spacing:.5px;margin-bottom:8px">Otros detalles</div>
                  <div style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--color-muted)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    Manual
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>`;

      bindRdEvents();
    }

    async function loadPayments() {
      try {
        payments = await fetchPayments('rental', r.id);
        // Pagado del alquiler = SUM(payments) (única verdad).
        currentDepositPaid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
        renderRdPanel();
      } catch (err) { console.warn('Error loading payments:', err); }
    }

    // Recalcula deposit_paid = SUM(payments) en BD y sincroniza el estado en memoria
    // (cualquier pestaña). Lo usan alta/edición/borrado de pagos.
    async function refreshRentalPaid() {
      await recalcPaidState('rental', r.id);
      payments = await fetchPayments('rental', r.id);
      currentDepositPaid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
    }

    function openAddPaymentModal() {
      const pending = getPending();
      const modal = document.createElement('div');
      modal.className = 'bk-overlay';
      modal.style.zIndex = '10001';
      modal.innerHTML = `
        <div class="bk-panel" style="max-width:480px;margin:auto;border-radius:12px;overflow:hidden">
          <div class="bk-panel-header" style="background:#22c55e;padding:16px 20px">
            <button class="bk-close-btn" id="pay-modal-close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div class="bk-header-left"><span class="bk-header-title" style="font-size:1rem">Añadir pago</span></div>
          </div>
          <div style="padding:24px">
            <form id="add-payment-form">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
                <div>
                  <label style="display:block;font-size:.75rem;text-transform:uppercase;font-weight:600;color:var(--color-muted);margin-bottom:6px">Concepto</label>
                  <input type="text" name="concept" placeholder="Alquiler material" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem;font-family:inherit" />
                </div>
                <div>
                  <label style="display:block;font-size:.75rem;text-transform:uppercase;font-weight:600;color:var(--color-muted);margin-bottom:6px">Tipo</label>
                  <select name="payment_method" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem;font-family:inherit;background:#fff">
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="voucher">Voucher</option>
                  </select>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
                <div>
                  <label style="display:block;font-size:.75rem;text-transform:uppercase;font-weight:600;color:var(--color-muted);margin-bottom:6px">Fecha</label>
                  <input type="datetime-local" name="payment_date" value="${new Date().toISOString().slice(0, 16)}" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem;font-family:inherit" />
                </div>
                <div>
                  <label style="display:block;font-size:.75rem;text-transform:uppercase;font-weight:600;color:var(--color-muted);margin-bottom:6px">Total (€)</label>
                  <input type="number" name="amount" step="0.01" min="0" value="${pending.toFixed(2)}" style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem;font-family:inherit" required />
                </div>
              </div>
              <button type="submit" class="bk-final-confirm-btn" style="margin-top:0">Guardar pago</button>
            </form>
          </div>
        </div>`;
      document.body.appendChild(modal);

      modal.querySelector('#pay-modal-close')?.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      modal.querySelector('#add-payment-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const amount = parseFloat(fd.get('amount'));
        if (!amount || amount <= 0) { showToast('Introduce un importe válido', 'error'); return; }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Guardando...';
        try {
          await createPayment({
            reservation_type: 'rental',
            reference_id: r.id,
            amount,
            payment_method: fd.get('payment_method'),
            concept: fd.get('concept')?.trim() || null,
            payment_date: fd.get('payment_date') ? new Date(fd.get('payment_date')).toISOString() : new Date().toISOString(),
          });
          // deposit_paid = SUM(payments) (payments = única verdad), no math manual
          await refreshRentalPaid();
          modal.remove();
          showToast('Pago registrado', 'success');
          renderRdPanel();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Guardar pago';
        }
      });
    }

    function bindRdEvents() {
      // Close
      overlay.querySelector('#rd-close')?.addEventListener('click', () => { overlay.remove(); render(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); render(); } });

      // Tab navigation
      overlay.querySelectorAll('.rv-nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const tab = item.dataset.tab;
          if (tab) { rdActiveTab = tab; renderRdPanel(); }
        });
      });

      // Editar el precio (total_amount) in-place
      overlay.querySelector('.rd-total-edit')?.addEventListener('click', () => {
        overlay.querySelector('.rd-total-show').style.display = 'none';
        const box = overlay.querySelector('.rd-total-edit-box');
        box.style.display = 'inline-flex';
        box.querySelector('.rd-total-input')?.focus();
      });
      overlay.querySelector('.rd-total-cancel')?.addEventListener('click', () => {
        overlay.querySelector('.rd-total-edit-box').style.display = 'none';
        overlay.querySelector('.rd-total-show').style.display = 'inline-flex';
      });
      overlay.querySelector('.rd-total-save')?.addEventListener('click', async () => {
        const v = parseFloat(overlay.querySelector('.rd-total-input').value);
        if (isNaN(v) || v < 0) { showToast('Precio inválido', 'error'); return; }
        try {
          await updateEquipmentReservation(r.id, { total_amount: v });
          totalAmount = v; r.total_amount = v;
          showToast('Precio actualizado', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); renderRdPanel(); }
      });

      // Cancelar alquiler: corrección de error → cancelado + importe a 0
      // (se eliminan los pagos y se libera la unidad). No borra el registro.
      overlay.querySelector('#rd-cancel')?.addEventListener('click', async () => {
        if (!confirm('¿Cancelar este alquiler? Quedará marcado como CANCELADO y su importe pasará a 0 € (se eliminan los pagos registrados y se libera la unidad). Úsalo para corregir un alquiler creado por error.')) return;
        try {
          await cancelEquipmentReservation(r.id);
          currentStatus = 'cancelled';
          totalAmount = 0; r.total_amount = 0;
          currentDepositPaid = 0; r.deposit_paid = 0;
          r.assigned_unit_id = null;
          payments = [];
          unitChoices = null;
          showToast('Alquiler cancelado · importe a 0', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      // Confirm
      overlay.querySelector('#rd-confirm')?.addEventListener('click', async () => {
        try {
          await updateEquipmentReservationStatus(r.id, 'confirmed');
          currentStatus = 'confirmed';
          showToast('Reserva confirmada', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      // Mark returned
      overlay.querySelector('#rd-mark-returned')?.addEventListener('click', async () => {
        try {
          await updateEquipmentReservationStatus(r.id, 'returned');
          currentStatus = 'returned';
          showToast('Material devuelto', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });

      // Add payment buttons (multiple on page)
      overlay.querySelectorAll('.rd-add-payment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => { e.preventDefault(); openAddPaymentModal(); });
      });

      // Edit payment (mismo editor que el resto de fichas)
      overlay.querySelectorAll('.rd-edit-payment').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = payments?.find(x => x.id === btn.dataset.pid);
          if (p) openPaymentEditModal(p, { onSaved: async () => { await refreshRentalPaid(); renderRdPanel(); } });
        });
      });

      // Delete payment (deposit_paid se recalcula desde SUM(payments))
      overlay.querySelectorAll('.rd-delete-payment').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este pago?')) return;
          try {
            await deletePayment(btn.dataset.pid);
            await refreshRentalPaid();
            showToast('Pago eliminado', 'success');
            renderRdPanel();
          } catch (err) { showToast('Error: ' + err.message, 'error'); }
        });
      });

      // Asignar unidad física
      overlay.querySelector('#rd-unit-assign')?.addEventListener('change', async (e) => {
        const newUnit = e.target.value || null;
        try {
          await updateEquipmentReservation(r.id, { assigned_unit_id: newUnit });
          r.assigned_unit_id = newUnit;
          unitChoices = null; // recargar candidatas
          showToast(newUnit ? 'Unidad asignada' : 'Unidad liberada', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); renderRdPanel(); }
      });

      // Date change handlers
      const dateStartInput = overlay.querySelector('#rd-date-start');
      const dateEndInput = overlay.querySelector('#rd-date-end');
      const timeStartInput = overlay.querySelector('#rd-time-start');

      timeStartInput?.addEventListener('change', async () => {
        const newTime = timeStartInput.value || null;
        try {
          await updateEquipmentReservation(r.id, { time_start: newTime });
          r.time_start = newTime;
          unitChoices = null; // la franja cambió → recalcular unidades disponibles
          showToast('Hora actualizada', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); renderRdPanel(); }
      });

      dateStartInput?.addEventListener('change', async () => {
        const newStart = dateStartInput.value;
        const currentEnd = dateEndInput.value;
        if (!newStart) return;
        try {
          const updates = { date_start: newStart };
          if (currentEnd && newStart > currentEnd) updates.date_end = newStart;
          await updateEquipmentReservation(r.id, updates);
          r.date_start = newStart;
          if (updates.date_end) r.date_end = newStart;
          unitChoices = null; // la franja cambió → recalcular unidades disponibles
          showToast('Fecha actualizada', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); renderRdPanel(); }
      });

      dateEndInput?.addEventListener('change', async () => {
        const newEnd = dateEndInput.value;
        if (!newEnd) return;
        if (r.date_start && newEnd < r.date_start.slice(0, 10)) {
          showToast('La fecha fin no puede ser anterior a la de inicio', 'error'); renderRdPanel(); return;
        }
        try {
          await updateEquipmentReservation(r.id, { date_end: newEnd });
          r.date_end = newEnd;
          unitChoices = null; // la franja cambió → recalcular unidades disponibles
          showToast('Fecha actualizada', 'success');
          renderRdPanel();
        } catch (err) { showToast('Error: ' + err.message, 'error'); renderRdPanel(); }
      });

      // ---- Alargar alquiler ----
      overlay.querySelector('.rd-extend-btn')?.addEventListener('click', () => openExtendRental());
      function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
      // Precio/día derivado de las TARIFAS configuradas del material (no hardcodeado).
      function dailyRateFromPricing(pr) {
        pr = pr || {};
        if (Number(pr['1d']) > 0) return Number(pr['1d']);
        if (Number(pr['1w']) > 0) return Number(pr['1w']) / 7;
        if (Number(pr['2w']) > 0) return Number(pr['2w']) / 14;
        if (Number(pr['1m']) > 0) return Number(pr['1m']) / 30;
        if (Number(pr['4h']) > 0) return Number(pr['4h']);
        return 0;
      }
      // Disponibilidad en el tramo ampliado (por cantidad + unidad concreta), excluyendo esta reserva.
      async function extensionAvailability(fromDate, toDate) {
        let usable = 0;
        try { const { data: units } = await supabase.from('inventory_units').select('id,estado').eq('equipment_id', r.equipment_id); usable = (units || []).filter(u => !['reparacion', 'perdido', 'baja'].includes(u.estado)).length; } catch {}
        let stockTotal = usable;
        if (!usable) { try { const { data: eq } = await supabase.from('rental_equipment').select('stock').eq('id', r.equipment_id).maybeSingle(); stockTotal = Number(eq?.stock) || 0; } catch {} }
        let busy = [];
        try {
          const { data } = await supabase.from('equipment_reservations').select('quantity, assigned_unit_id')
            .eq('equipment_id', r.equipment_id).neq('id', r.id)
            .in('status', ['pending', 'confirmed', 'active'])
            .lte('date_start', toDate).gte('date_end', fromDate);
          busy = data || [];
        } catch {}
        const reserved = busy.reduce((s, b) => s + (Number(b.quantity) || 1), 0);
        const qty = Number(r.quantity) || 1;
        if (reserved + qty > stockTotal) return { ok: false, msg: `No se puede alargar: no hay stock de ${equipName} del ${fromDate} al ${toDate} (quedan ${Math.max(0, stockTotal - reserved)} libre(s) y necesitas ${qty}).` };
        if (r.assigned_unit_id && busy.some(b => b.assigned_unit_id === r.assigned_unit_id)) return { ok: false, msg: `No se puede alargar: la unidad asignada ya está reservada del ${fromDate} al ${toDate}. Quítala o cámbiala primero.` };
        return { ok: true };
      }
      async function openExtendRental() {
        let pricing = r.rental_equipment?.pricing || null;
        if (!pricing && r.equipment_id) { try { const { data } = await supabase.from('rental_equipment').select('pricing').eq('id', r.equipment_id).maybeSingle(); pricing = data?.pricing; } catch {} }
        const perDay = dailyRateFromPricing(pricing);
        const qty = Number(r.quantity) || 1;
        const curEnd = String(r.date_end || r.date_start || '').slice(0, 10);
        const nextDay = (() => { const d = new Date(curEnd + 'T00:00:00'); d.setDate(d.getDate() + 1); return getDateStr(d); })();
        const ov = document.createElement('div'); ov.className = 'bk-overlay'; ov.style.zIndex = '10030'; document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        ov.innerHTML = `<div style="max-width:440px;width:94%;background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.3)">
          <h3 style="margin:0 0 4px;font-size:1.1rem">Alargar alquiler · ${escapeHtml(equipName)}</h3>
          <p style="margin:0 0 14px;font-size:.84rem;color:#64748b">Ahora hasta <strong>${curEnd}</strong>. Elige la nueva fecha fin.</p>
          <label style="font-size:.8rem;color:#64748b">Nueva fecha fin</label>
          <input type="date" id="ex-end" min="${nextDay}" value="${nextDay}" style="width:100%;margin:4px 0 12px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px" />
          <label style="font-size:.8rem;color:#64748b">Precio de la extensión (€) <span style="color:#94a3b8">— sugerido de las tarifas, editable</span></label>
          <input type="number" id="ex-price" step="0.01" min="0" style="width:100%;margin:4px 0 6px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px" />
          <div id="ex-hint" style="font-size:.78rem;color:#64748b;margin-bottom:12px"></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.86rem;margin-bottom:8px"><input type="checkbox" id="ex-charge" checked /> Cobrar ahora (si no, queda pendiente)</label>
          <div id="ex-method-wrap"><label style="font-size:.8rem;color:#64748b">Método</label>
            <select id="ex-method" style="width:100%;margin:4px 0 12px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px"><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option><option value="bizum">Bizum</option></select></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
            <button class="btn line" id="ex-cancel">Cancelar</button>
            <button class="btn red" id="ex-save">Alargar</button>
          </div>
        </div>`;
        const $ = id => ov.querySelector('#' + id);
        function recompute() {
          const newEnd = $('ex-end').value;
          if (!newEnd || newEnd <= curEnd) { $('ex-hint').textContent = 'La nueva fecha debe ser posterior a la actual.'; return; }
          const extraDays = daysBetween(curEnd, newEnd);
          $('ex-price').value = (Math.round(extraDays * perDay * qty * 100) / 100).toFixed(2);
          $('ex-hint').textContent = perDay ? `+${extraDays} día(s) · ${perDay.toFixed(2)}€/día${qty > 1 ? ` × ${qty}` : ''}` : `+${extraDays} día(s) · sin tarifa/día configurada — pon el precio a mano`;
        }
        $('ex-end').addEventListener('change', recompute);
        $('ex-charge').addEventListener('change', () => { $('ex-method-wrap').style.display = $('ex-charge').checked ? '' : 'none'; });
        recompute();
        $('ex-cancel').addEventListener('click', close);
        $('ex-save').addEventListener('click', async () => {
          const newEnd = $('ex-end').value;
          if (!newEnd || newEnd <= curEnd) { showToast('La nueva fecha debe ser posterior a la actual', 'error'); return; }
          const extraPrice = parseFloat($('ex-price').value) || 0;
          const btn = $('ex-save'); btn.disabled = true; btn.textContent = 'Comprobando…';
          const avail = await extensionAvailability(nextDay, newEnd);
          if (!avail.ok) { showToast(avail.msg, 'error'); btn.disabled = false; btn.textContent = 'Alargar'; return; }
          try {
            const newTotal = Math.round((Number(r.total_amount || 0) + extraPrice) * 100) / 100;
            await updateEquipmentReservation(r.id, { date_end: newEnd, total_amount: newTotal });
            r.date_end = newEnd; r.total_amount = newTotal; totalAmount = newTotal;
            if ($('ex-charge').checked && extraPrice > 0) {
              try { await createPayment({ reservation_type: 'rental', reference_id: r.id, amount: extraPrice, payment_method: $('ex-method').value, concept: `Extensión alquiler ${equipName} (hasta ${newEnd})` }); await refreshRentalPaid(); } catch (e) { console.warn('pago extensión', e.message); }
            }
            unitChoices = null;
            close();
            showToast('Alquiler alargado', 'success');
            renderRdPanel();
          } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Alargar'; }
        });
      }
    }

    renderRdPanel();
    loadPayments(); // deriva el pagado real (SUM payments) ya en el resumen
  }


  // ======== EDIT SESSION MODAL ========
  function openEditSessionModal(cls) {
    const typeOptions = Object.entries(TYPE_LABELS)
      .map(([val, label]) => `<option value="${val}" ${cls.type === val ? 'selected' : ''}>${label}</option>`)
      .join('');
    const color = TYPE_COLORS[cls.type] || '#0f2f39';

    document.getElementById('ns-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'ns-overlay';
    overlay.className = 'ns-overlay';
    overlay.innerHTML = `
      <div class="ns-panel">
        <header class="ns-header" style="background:${color}">
          <div>
            <h2>Editar sesión</h2>
            <p>${formatDate(cls.date)} · ${TYPE_LABELS[cls.type] || 'Clase'}</p>
          </div>
          <button class="ns-close" id="es-close" title="Cerrar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div class="ns-body">
          <form id="edit-session-form" class="ns-grid">
            <section class="ns-section ns-section-when">
              <h3>Cuándo</h3>
              <div class="ns-field">
                <label>Fecha</label>
                <input type="date" name="date" value="${cls.date}" required />
              </div>
              <div class="ns-field-2col">
                <div class="ns-field">
                  <label>Hora de inicio</label>
                  <input type="time" name="time_start" id="es-start" value="${cls.time_start?.slice(0, 5) || '10:00'}" required />
                </div>
                <div class="ns-field">
                  <label>Hora de fin <small style="font-weight:400;color:#94a3b8;text-transform:none">· automática</small></label>
                  <input type="time" id="es-end" value="${cls.time_end?.slice(0, 5) || '11:30'}" readonly tabindex="-1" style="background:#f1f5f9;color:#64748b;cursor:not-allowed" />
                </div>
              </div>
            </section>
            <section class="ns-section ns-section-detail">
              <h3>Detalles</h3>
              <div class="ns-field">
                <label>Actividad</label>
                <select name="type" id="es-type" required>${typeOptions}</select>
              </div>
              <div class="ns-field-2col">
                <div class="ns-field">
                  <label>Capacidad máxima</label>
                  <input type="number" name="max_students" value="${cls.max_students || 8}" min="1" required />
                </div>
                <div class="ns-field">
                  <label>Público</label>
                  <select name="audience">${audienceOptionsHtml(cls.audience || '')}</select>
                </div>
              </div>
              <div class="ns-field">
                <label>Precio clase suelta (€)</label>
                <input type="number" name="price" value="${Number(cls.price) > 0 ? Number(cls.price) : getPackPrice(cls.type, 1, 0)}" min="0" step="0.01" />
                <small style="color:#94a3b8;font-size:.72rem">Lo que paga quien reserva esta clase suelta. Bájalo para abaratarla ese día; no afecta a los bonos.</small>
              </div>
              <div class="ns-field">
                <label>Instructor</label>
                <select name="instructor" id="es-instructor"><option value="">Sin asignar</option></select>
              </div>
              <label class="ns-checkbox">
                <input type="checkbox" name="published" ${cls.published ? 'checked' : ''} />
                <span>Publicada (visible para clientes)</span>
              </label>
            </section>
            <section class="ns-section">
              <h3>Aplicar cambios a</h3>
              <div class="ns-field">
                <select name="apply_scope" id="es-apply-scope">
                  <option value="this">Solo esta clase</option>
                  <option value="type">Todas las clases programadas de este tipo</option>
                  <option value="select">Elegir clases…</option>
                </select>
              </div>
              <div class="ns-field" id="es-apply-list-wrap" style="display:none">
                <label>Clases del mismo tipo</label>
                <div id="es-apply-list" class="es-apply-list"><p style="font-size:.8rem;color:#94a3b8">Cargando…</p></div>
                <p style="font-size:.72rem;color:#94a3b8;margin-top:6px">Se aplican los detalles (hora, instructor, capacidad, público, publicada). La fecha de cada clase se mantiene.</p>
              </div>
            </section>
          </form>
        </div>
        <footer class="ns-footer">
          <button type="button" class="ns-btn ns-btn-secondary" id="es-cancel">Cancelar</button>
          <button type="submit" form="edit-session-form" class="ns-btn" id="es-submit">Guardar cambios</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);

    const closeEs = () => overlay.remove();
    overlay.querySelector('#es-close').onclick = closeEs;
    overlay.querySelector('#es-cancel').onclick = closeEs;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEs(); });

    populateInstructorSelect(overlay.querySelector('#es-instructor'), cls.instructor || '');

    // Hora de fin automática según duración del tipo
    function recomputeEnd() {
      const t = overlay.querySelector('#es-type').value;
      const start = overlay.querySelector('#es-start').value;
      const endEl = overlay.querySelector('#es-end');
      if (endEl && start) endEl.value = addMinutesToTime(start, TYPE_DURATIONS[t] || 90);
    }
    overlay.querySelector('#es-type').addEventListener('change', recomputeEnd);
    overlay.querySelector('#es-start').addEventListener('input', recomputeEnd);

    // "Aplicar a": otras clases programadas (futuras) del mismo tipo
    let applyCandidates = [];
    let applyCandidatesPromise = null;
    const applyScopeSel = overlay.querySelector('#es-apply-scope');
    const applyListWrap = overlay.querySelector('#es-apply-list-wrap');
    const applyListEl = overlay.querySelector('#es-apply-list');
    // Cache de PROMESA (no de booleano): si se llama dos veces seguidas — el change
    // del select y luego el submit — la segunda espera la MISMA carga en vuelo en
    // vez de devolver la lista aún vacía y propagar a 0 clases (race que dejaba la
    // edición sin aplicarse a las demás fechas).
    function loadApplyCandidates() {
      if (!applyCandidatesPromise) {
        applyCandidatesPromise = (async () => {
          const today = getDateStr(new Date());
          // Todas las clases futuras NO canceladas del tipo (igual que las que muestra
          // el calendario, que no filtra por status). Antes exigía status='scheduled'
          // y dejaba fuera 'completed'/otras → la edición "no se aplicaba a todas".
          const { data } = await supabase.from('surf_classes')
            .select('id, date, time_start, type')
            .eq('type', cls.type).neq('status', 'cancelled').gte('date', today).neq('id', cls.id)
            .order('date', { ascending: true }).order('time_start', { ascending: true });
          applyCandidates = data || [];
          applyListEl.innerHTML = applyCandidates.length
            ? applyCandidates.map(c => `<label class="es-apply-item"><input type="checkbox" class="es-apply-cb" value="${c.id}"><span>${formatDate(c.date)} · ${(c.time_start || '').slice(0, 5)}</span></label>`).join('')
            : '<p style="font-size:.8rem;color:#94a3b8">No hay otras clases programadas de este tipo</p>';
          return applyCandidates;
        })();
      }
      return applyCandidatesPromise;
    }
    applyScopeSel.addEventListener('change', async () => {
      const v = applyScopeSel.value;
      applyListWrap.style.display = v === 'select' ? '' : 'none';
      if (v === 'select' || v === 'type') await loadApplyCandidates();
    });

    overlay.querySelector('#edit-session-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const obj = Object.fromEntries(fd);
      obj.time_end = addMinutesToTime(obj.time_start, TYPE_DURATIONS[obj.type] || 90);
      obj.published = e.target.published.checked;
      obj.id = cls.id;
      obj.title = TYPE_LABELS[obj.type] || cls.title;
      obj.level = cls.level || 'todos';
      obj.location = cls.location || 'Playa del Hombre';
      obj.status = cls.status || 'scheduled';
      if (!obj.instructor) obj.instructor = null;
      if (!obj.audience) obj.audience = null;
      obj.max_students = parseInt(obj.max_students, 10) || cls.max_students || 8;
      // No permitir un aforo por debajo de las inscripciones ya existentes (dejaría
      // la clase sobre-reservada y 'Disponible' en negativo).
      const curEnrolled = Number(cls.enrolled_count || 0);
      if (obj.max_students < curEnrolled) {
        showToast(`La clase tiene ${curEnrolled} inscrito(s): no puedes bajar el aforo por debajo`, 'error');
        return;
      }
      // Precio de clase suelta editable (drop-in). Si vacío, usa el de la actividad.
      const editPrice = parseFloat(fd.get('price'));
      obj.price = (editPrice >= 0) ? editPrice : (Number(cls.price) || getPackPrice(obj.type, 1, 0));

      // Alcance del cambio (no es columna de la tabla → fuera del obj)
      const applyScope = obj.apply_scope || 'this';
      delete obj.apply_scope;

      // Detectar si cambia el horario o la fecha → notificar a inscritos
      const oldDate = cls.date;
      const oldTimeStart = cls.time_start?.slice(0, 5) || '';
      const oldTimeEnd = cls.time_end?.slice(0, 5) || '';
      const newTimeStart = obj.time_start?.slice(0, 5) || '';
      const newTimeEnd = obj.time_end?.slice(0, 5) || '';
      const scheduleChanged = oldDate !== obj.date || oldTimeStart !== newTimeStart || oldTimeEnd !== newTimeEnd;

      const submitBtn = overlay.querySelector('#es-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando…'; }
      try {
        await upsertClass(obj);

        // Propaga SOLO los campos que el admin CAMBIÓ respecto a esta clase (la fecha
        // de cada una se respeta). Antes copiaba TODOS los campos a todas las clases
        // del tipo: cambiar solo la capacidad reescribía también la hora/instructor de
        // las 105 y descuadraba el horario entero.
        let propagated = 0, propFailed = 0;
        if (applyScope !== 'this') {
          await loadApplyCandidates();
          const targetIds = applyScope === 'type'
            ? applyCandidates.map(c => c.id)
            : [...overlay.querySelectorAll('.es-apply-cb:checked')].map(cb => cb.value);
          // OJO: surf_classes NO tiene columna updated_at → no incluirla (daría 400).
          const propagate = {};
          if (newTimeStart !== oldTimeStart || newTimeEnd !== oldTimeEnd) {
            propagate.time_start = obj.time_start; propagate.time_end = obj.time_end;
          }
          if (obj.type !== cls.type) { propagate.type = obj.type; propagate.title = obj.title; }
          if (Number(obj.max_students) !== Number(cls.max_students || 0)) propagate.max_students = Number(obj.max_students) || cls.max_students || 8;
          if ((obj.audience || null) !== (cls.audience || null)) propagate.audience = obj.audience;
          if ((obj.instructor || null) !== (cls.instructor || null)) propagate.instructor = obj.instructor;
          if (Boolean(obj.published) !== Boolean(cls.published)) propagate.published = obj.published;
          const hasChanges = Object.keys(propagate).length > 0;
          for (const id of (hasChanges ? targetIds : [])) {
            const { error } = await supabase.from('surf_classes').update(propagate).eq('id', id);
            if (error) { console.error('propagar clase', id, error.message); propFailed++; }
            else propagated++;
          }
        }

        closeEs();
        // Si cambió la fecha, salta a ese día para que la clase no "desaparezca" de la vista
        if (obj.date && obj.date !== oldDate) {
          currentDate = new Date(obj.date + 'T00:00:00');
          viewMode = 'day';
        }
        let toastMsg = propagated > 0 ? `Sesión actualizada · ${propagated} clases más aplicadas` : 'Sesión actualizada';
        if (propFailed > 0) toastMsg += ` · ${propFailed} con error`;
        if (scheduleChanged && (cls.enrolled_count || 0) > 0) {
          const r = await notifyEnrolledClients(cls.id, 'rescheduled', {
            className: TYPE_LABELS[obj.type] || obj.title || 'Clase',
            classDate: formatDate(obj.date),
            classTime: `${newTimeStart} - ${newTimeEnd}`,
            instructor: obj.instructor || '',
            oldClassDate: formatDate(oldDate),
            oldClassTime: `${oldTimeStart} - ${oldTimeEnd}`,
          });
          toastMsg = notifyToastMessage(toastMsg, r);
        }
        showToast(toastMsg, 'success');
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Guardar cambios'; }
      }
    });
  }

  function getEndOfMonthStr(date) {
    const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return getDateStr(d);
  }

  await render();
}
