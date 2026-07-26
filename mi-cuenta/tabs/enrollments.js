/**
 * Tab "Mis Clases" — panel de cliente Waya.
 * Muestra las inscripciones del usuario separadas en próximas (cards con datos
 * de la clase + asistente + botón Cancelar) e historial colapsable.
 *
 * Contrato de montaje del shell (account.js → loadExternalTab):
 *   export async function renderEnrollments(container, switchTab)
 * - `container`: <div class="tab-panel"> ya en el DOM y vacío. Re-render completo
 *   en cada entrada (idempotente, sin caché → datos frescos).
 * - `switchTab`: no se usa en este tab.
 *
 * Nombres de tabla/RPC EXACTOS del contrato: class_enrollments (+ joins
 * surf_classes, family_members, bonos), RPC cancel_enrollment (vía lib/booking.js).
 * cancelEnrollment ya dispara los emails (notifyClass) internamente: aquí NO se
 * replica el envío.
 */
import { fetchUserEnrollments, cancelEnrollment } from '/lib/booking.js';
import { formatDate, TYPE_LABELS, esc, showToast } from '/lib/utils.js';

function formatTime(t) { return t?.slice(0, 5) || ''; }

// Estilos propios del tab (clases aún no portadas a account.css desde Entreolas).
// Se inyectan una sola vez; usan los tokens puente de account.css (Waya).
function ensureStyles() {
  if (document.getElementById('enrollments-tab-styles')) return;
  const style = document.createElement('style');
  style.id = 'enrollments-tab-styles';
  style.textContent = `
    .enr-section-title {
      margin: 0 0 12px;
      font-family: var(--font-heading, 'Outfit', sans-serif);
      text-transform: uppercase;
      letter-spacing: .04em;
      font-size: .85rem;
      color: var(--color-navy);
    }
    .booking-card-item {
      border: 1px solid var(--color-line, #e5e5e0);
      border-radius: var(--radius-md, 12px);
      padding: 14px 16px;
      margin-bottom: 12px;
      background: #fff;
      box-shadow: var(--shadow, 0 1px 3px rgba(0,0,0,.06));
    }
    .booking-card-item .meta {
      font-size: .82rem;
      color: var(--color-muted);
      margin: 6px 0 0;
    }
    .bono-type-badge {
      display: inline-block;
      font-family: var(--font-heading, 'Outfit', sans-serif);
      text-transform: uppercase;
      letter-spacing: .03em;
      font-size: .68rem;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--color-primary, #FDD802);
      color: var(--color-dark, #1a1a1a);
    }
    .enr-history { margin-top: 24px; }
    .enr-history > summary {
      cursor: pointer;
      font-family: var(--font-heading, 'Outfit', sans-serif);
      text-transform: uppercase;
      letter-spacing: .04em;
      font-size: .8rem;
      color: var(--color-muted);
      margin-bottom: 12px;
    }
    .enr-cancel-btn { font-size: .8rem; padding: 6px 12px; }
    .enr-cancel-btn:disabled { opacity: .4; cursor: not-allowed; }
    .enr-empty { color: var(--color-muted); }
  `;
  document.head.appendChild(style);
}

export async function renderEnrollments(container, _switchTab) {
  ensureStyles();

  async function render() {
    container.innerHTML = '<p class="tab-loading">Cargando tus clases…</p>';

    let enrollments;
    try {
      enrollments = await fetchUserEnrollments();
    } catch (err) {
      container.innerHTML = `<p class="enr-empty">No se pudieron cargar tus clases: ${esc(err.message)}</p>`;
      return;
    }

    const now = new Date();

    // Próximas: cualquier inscripción de una clase futura (confirmada, pagada,
    // anticipo o cancelada). El estado de pago no la saca de "próximas".
    const upcoming = enrollments.filter(e => {
      const cls = e.surf_classes;
      if (!cls) return false;
      return new Date(cls.date + 'T' + cls.time_start) > now;
    });

    // Pasadas: clases ya celebradas (o sin fecha conocida).
    const past = enrollments.filter(e => {
      const cls = e.surf_classes;
      if (!cls) return true;
      return new Date(cls.date + 'T' + cls.time_start) <= now;
    });

    let html = '';

    // ---- Próximas ----
    html += `<h3 class="enr-section-title" data-i18n="account.enrollments.upcoming">Próximas clases</h3>`;

    if (upcoming.length) {
      html += upcoming.map(e => {
        const cls = e.surf_classes;
        const isCancelled = e.status === 'cancelled';
        const canCancel = !isCancelled &&
          new Date(cls.date + 'T' + cls.time_start) > new Date(Date.now() + 2 * 3600 * 1000);
        const attendee = e.family_members?.full_name || 'Yo';

        let statusHtml;
        if (isCancelled) {
          const cancelledLabel = e.cancelled_by === 'admin'
            ? 'Cancelada por la escuela'
            : 'Cancelada por mí';
          statusHtml = `<span class="status-badge cancelled">${cancelledLabel}</span>`;
        } else {
          statusHtml = `<span class="status-badge active">Confirmada</span>`;
        }

        return `
          <div class="booking-card-item"${isCancelled ? ' style="opacity:.55;border-left:3px solid #ef4444"' : ''}>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div>
                <strong>${esc(cls.title)}</strong>
                <span class="bono-type-badge" style="margin-left:8px">${esc(TYPE_LABELS[cls.type] || cls.type)}</span>
              </div>
              ${statusHtml}
            </div>
            <p class="meta">${formatDate(cls.date)} · ${formatTime(cls.time_start)} — ${formatTime(cls.time_end)}${cls.instructor ? ' · ' + esc(cls.instructor) : ''}</p>
            <p class="meta">Asistente: <strong>${esc(attendee)}</strong></p>
            ${!isCancelled ? `<div style="margin-top:10px">
              <button class="btn enr-cancel-btn" data-action="cancel" data-id="${e.id}"${canCancel ? '' : ' disabled'}>
                ${canCancel ? 'Cancelar reserva' : 'No cancelable (&lt;2h)'}
              </button>
            </div>` : ''}
          </div>`;
      }).join('');
    } else {
      html += '<p class="enr-empty">No tienes clases próximas reservadas.</p>';
    }

    // ---- Historial (colapsable) ----
    if (past.length) {
      html += `
        <details class="enr-history">
          <summary>Historial de clases (${past.length})</summary>
          ${past.map(e => {
            const cls = e.surf_classes;
            const attendee = e.family_members?.full_name || 'Yo';
            let statusLabel = e.status === 'cancelled'
              ? 'Cancelada'
              : e.attendance === true ? 'Asistió'
              : e.attendance === false ? 'No asistió'
              : 'Completada';
            if (e.status === 'cancelled' && e.cancelled_by) {
              statusLabel = e.cancelled_by === 'admin' ? 'Cancelada por la escuela' : 'Cancelada por mí';
            }
            const badgeClass = e.status === 'cancelled' ? 'cancelled' : 'active';
            return `
              <div class="booking-card-item" style="opacity:.7">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
                  <strong>${esc(cls?.title || 'Clase')}</strong>
                  <span class="status-badge ${badgeClass}">${statusLabel}</span>
                </div>
                <p class="meta">${cls ? formatDate(cls.date) + ' · ' + formatTime(cls.time_start) : 'Fecha desconocida'} · ${esc(attendee)}</p>
              </div>`;
          }).join('')}
        </details>`;
    }

    container.innerHTML = html;

    // ---- Cancelar reserva ----
    container.querySelectorAll('[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!confirm('¿Cancelar esta reserva? El crédito se devolverá a tu bono.')) return;
        btn.disabled = true;
        btn.textContent = 'Cancelando…';
        try {
          // cancelEnrollment (lib/booking.js) ejecuta la RPC cancel_enrollment
          // y dispara los emails de aviso internamente.
          await cancelEnrollment(btn.dataset.id);
          showToast('Reserva cancelada. El crédito vuelve a tu bono.');
          await render();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Cancelar reserva';
        }
      });
    });
  }

  await render();
}
