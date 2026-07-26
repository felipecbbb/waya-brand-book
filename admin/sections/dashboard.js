/* ============================================================
   Dashboard — Vista operativa del día (sin importes ni agregados)
   ============================================================ */
import { fetchDashboardOperational } from '../modules/api.js';
import { TYPE_LABELS, TYPE_COLORS } from '../modules/constants.js';
import { getProfile } from '../modules/auth.js';

const esc = (s) => s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtTime(t) {
  if (!t) return '';
  return t.slice(0, 5);
}
function firstName(profile) {
  const n = profile?.full_name || '';
  return n.split(' ')[0] || '';
}
function studentName(e) {
  return e.guest_name || e.family_members?.full_name || e.profiles?.full_name || 'Sin nombre';
}

const QUICK_ACTIONS = [
  { hash: 'calendario', label: 'Calendario',  desc: 'Clases del día',     icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
  { hash: 'reserva-clases', label: 'Bonos',   desc: 'Ventas y pagos',      icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
  { hash: 'actividades', label: 'Actividades', desc: 'Tipos y precios',    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  { hash: 'clientes',   label: 'Clientes',    desc: 'Base de datos',       icon: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4-4v2"/><circle cx="12" cy="7" r="4"/>' },
];

export async function renderDashboard(container) {
  container.innerHTML = `<div class="admin-skeleton" style="padding:24px 0">
    <div class="admin-skeleton-row"><div class="admin-skeleton-block w-full h-card"></div><div class="admin-skeleton-block w-full h-card"></div></div>
    <div class="admin-skeleton-row"><div class="admin-skeleton-block w-full h-card"></div><div class="admin-skeleton-block w-full h-card"></div></div>
  </div>`;

  let data;
  try {
    data = await fetchDashboardOperational();
  } catch (err) {
    container.innerHTML = `<p style="color:#ef4444;padding:24px">Error al cargar dashboard: ${esc(err.message)}</p>`;
    return;
  }

  const { todayClasses, todayEnrollments, activeRentals, upcomingClasses, upcomingRentals, upcomingCamps } = data;

  // Group enrollments by class
  const enrollByClass = {};
  todayEnrollments.forEach(e => {
    if (e.status === 'cancelled') return;
    if (!enrollByClass[e.class_id]) enrollByClass[e.class_id] = [];
    enrollByClass[e.class_id].push(e);
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 20) return 'Buenas tardes';
    return 'Buenas noches';
  })();
  const fname = firstName(getProfile());
  const todayLabel = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  container.innerHTML = `
    <!-- Cabecera + acciones rápidas -->
    <div class="dash-hero">
      <div class="dash-hero-text">
        <h2>${greeting}${fname ? `, ${esc(fname)}` : ''}</h2>
        <p>${esc(todayLabel)}</p>
      </div>
    </div>

    <div class="dash-actions">
      ${QUICK_ACTIONS.map(a => `
        <a href="#${a.hash}" class="dash-action">
          <span class="dash-action-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${a.icon}</svg>
          </span>
          <span class="dash-action-text">
            <strong>${a.label}</strong>
            <small>${a.desc}</small>
          </span>
        </a>
      `).join('')}
    </div>

    <!-- HOY -->
    <div class="dash-section">
      <h3 class="dash-section-title">Hoy</h3>

      ${todayClasses.length ? `
        <div class="dash-today-list">
          ${todayClasses.map(c => renderClassCard(c, enrollByClass[c.id] || [])).join('')}
        </div>
      ` : `
        <div class="dash-empty-card">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>No hay clases programadas para hoy</p>
        </div>
      `}

      ${activeRentals.length ? `
        <h4 class="dash-subtitle">Alquileres activos</h4>
        <div class="dash-rental-grid">
          ${activeRentals.map(renderRentalRow).join('')}
        </div>
      ` : ''}
    </div>

    <!-- PRÓXIMOS 7 DÍAS -->
    <div class="dash-section">
      <h3 class="dash-section-title">Próximos 7 días</h3>

      <div class="dash-next-grid">
        <div class="dash-next-card">
          <div class="dash-next-card-header">
            <h4>Clases programadas</h4>
            <span class="dash-next-count">${upcomingClasses.length}</span>
          </div>
          ${upcomingClasses.length ? `
            <ul class="dash-next-list">
              ${upcomingClasses.slice(0, 8).map(c => `
                <li>
                  <span class="dash-next-dot" style="background:${TYPE_COLORS[c.type] || '#64748b'}"></span>
                  <span class="dash-next-when">${esc(fmtDate(c.date))} · ${esc(fmtTime(c.time_start))}</span>
                  <span class="dash-next-what">${esc(TYPE_LABELS[c.type] || c.type)}</span>
                  <span class="dash-next-occ">${c.enrolled_count || 0}/${c.max_students || 0}</span>
                </li>
              `).join('')}
            </ul>
            ${upcomingClasses.length > 8 ? `<a class="dash-next-more" href="#calendario">Ver ${upcomingClasses.length - 8} más</a>` : ''}
          ` : '<p class="dash-next-empty">Sin clases en los próximos 7 días</p>'}
        </div>

        <div class="dash-next-card">
          <div class="dash-next-card-header">
            <h4>Alquileres próximos</h4>
            <span class="dash-next-count">${upcomingRentals.length}</span>
          </div>
          ${upcomingRentals.length ? `
            <ul class="dash-next-list">
              ${upcomingRentals.slice(0, 8).map(r => `
                <li>
                  <span class="dash-next-dot" style="background:#8b5cf6"></span>
                  <span class="dash-next-when">${esc(fmtDate(r.date_start))}</span>
                  <span class="dash-next-what">${esc(r.rental_equipment?.name || 'Material')} — ${esc(r.guest_name || 'Cliente')}</span>
                </li>
              `).join('')}
            </ul>
            ${upcomingRentals.length > 8 ? `<a class="dash-next-more" href="#material">Ver ${upcomingRentals.length - 8} más</a>` : ''}
          ` : '<p class="dash-next-empty">Sin alquileres próximos</p>'}
        </div>

        <div class="dash-next-card">
          <div class="dash-next-card-header">
            <h4>Surf camps próximos</h4>
            <span class="dash-next-count">${upcomingCamps.length}</span>
          </div>
          ${upcomingCamps.length ? `
            <ul class="dash-next-list">
              ${upcomingCamps.map(c => {
                const free = Math.max(0, (c.max_spots || 0) - (c.spots_taken || 0));
                return `
                  <li>
                    <span class="dash-next-dot" style="background:#1a1a1a"></span>
                    <span class="dash-next-when">${esc(fmtDate(c.date_start))}</span>
                    <span class="dash-next-what">${esc(c.title || 'Camp')}</span>
                    <span class="dash-next-occ">${free} libres</span>
                  </li>
                `;
              }).join('')}
            </ul>
          ` : '<p class="dash-next-empty">Sin camps próximos</p>'}
        </div>
      </div>
    </div>
  `;

  // Toggle alumnos expandible
  container.querySelectorAll('[data-toggle-class]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleClass;
      const list = container.querySelector(`[data-students="${id}"]`);
      if (!list) return;
      const open = list.classList.toggle('open');
      btn.querySelector('.dash-class-chev')?.classList.toggle('open', open);
    });
  });
}

function renderClassCard(c, enrollments) {
  const ratio = (c.enrolled_count || 0) / (c.max_students || 1);
  const barColor = ratio >= 1 ? '#ef4444' : ratio >= 0.8 ? '#f59e0b' : '#22c55e';
  const pct = Math.min(Math.round(ratio * 100), 100);
  const typeColor = TYPE_COLORS[c.type] || '#64748b';
  const enrolled = enrollments.length || c.enrolled_count || 0;
  const hasStudents = enrollments.length > 0;

  return `
    <div class="dash-class-card" style="border-left:4px solid ${typeColor}">
      <button class="dash-class-head" ${hasStudents ? `data-toggle-class="${c.id}"` : 'disabled'}>
        <div class="dash-class-main">
          <span class="dash-class-time">${esc(fmtTime(c.time_start))} – ${esc(fmtTime(c.time_end))}</span>
          <span class="dash-class-type">${esc(TYPE_LABELS[c.type] || c.type)}${c.level ? ` · ${esc(c.level)}` : ''}</span>
        </div>
        <div class="dash-class-occ">
          <div class="dash-class-bar"><div style="width:${pct}%;background:${barColor}"></div></div>
          <span>${enrolled}/${c.max_students || 0}</span>
          ${hasStudents ? `<svg class="dash-class-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>` : ''}
        </div>
      </button>
      ${hasStudents ? `
        <div class="dash-class-students" data-students="${c.id}">
          <ul>
            ${enrollments.map(e => `<li>${esc(studentName(e))}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function renderRentalRow(r) {
  return `
    <div class="dash-rental-row">
      <span class="dash-rental-name">${esc(r.rental_equipment?.name || 'Material')}</span>
      <span class="dash-rental-client">${esc(r.guest_name || 'Cliente')}</span>
      <span class="dash-rental-when">hasta ${esc(fmtDate(r.date_end))}</span>
    </div>
  `;
}
