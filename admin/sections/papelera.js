/* ============================================================
   Papelera — elementos eliminados (bonos y reservas) con restaurar
   ============================================================ */
import { fetchTrash, restoreFromTrash } from '../modules/api.js';
import { formatDate, showToast } from '../modules/ui.js';

const esc = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
const TYPE_LABELS = { bono: 'Bono', booking: 'Reserva camp' };

export async function renderPapelera(container) {
  let includeRestored = false;

  async function render() {
    const items = await fetchTrash({ includeRestored });
    const pendientes = items.filter(i => !i.restored_at).length;

    container.innerHTML = `
      <div class="rv-toolbar">
        <div class="rv-toolbar-filters">
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;cursor:pointer">
            <input type="checkbox" id="pp-include" ${includeRestored ? 'checked' : ''}/> Mostrar también el histórico (restaurados)
          </label>
        </div>
        <div class="rv-toolbar-summary">
          <span class="rv-toolbar-count">${pendientes} en papelera</span>
        </div>
      </div>
      ${!items.length ? `<div class="sc-empty"><p>La papelera está vacía</p></div>` : `
        <div class="rv-bookings-list">
          ${items.map(i => {
            const restored = !!i.restored_at;
            return `
            <div class="rv-booking-row" style="${restored ? 'opacity:.6' : ''}">
              <div class="rv-booking-client">
                <strong>${esc(i.label || (TYPE_LABELS[i.entity_type] || i.entity_type))}</strong>
                <span class="rv-booking-phone">${TYPE_LABELS[i.entity_type] || i.entity_type} · eliminado ${formatDate(i.deleted_at)}</span>
              </div>
              <div>
                ${restored
                  ? `<span class="act-status-badge">Restaurado ${formatDate(i.restored_at)}</span>`
                  : `<button class="btn" data-restore="${i.id}" style="background:#22c55e;color:#fff;border:0;padding:8px 16px;font-size:.85rem">Restaurar</button>`}
              </div>
            </div>`;
          }).join('')}
        </div>`}
    `;

    container.querySelector('#pp-include')?.addEventListener('change', e => { includeRestored = e.target.checked; render(); });
    container.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Restaurar este elemento? Volverá a aparecer con sus pagos e inscripciones.')) return;
        btn.disabled = true; btn.textContent = 'Restaurando…';
        try {
          await restoreFromTrash(btn.dataset.restore);
          showToast('Elemento restaurado', 'success');
          render();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Restaurar';
        }
      });
    });
  }

  await render();
}
