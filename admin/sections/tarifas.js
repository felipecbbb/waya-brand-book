/* ============================================================
   Tarifas Section — DB-backed class packs pricing
   ============================================================ */
import { showToast } from '../modules/ui.js';
import {
  fetchActivities, fetchActivityFull, upsertActivity, upsertActivityPacks,
} from '../modules/api.js';

export async function renderTarifas(container) {
  let selectedActivity = null;   // full activity obj (with packs)

  /* ===================== OVERVIEW ===================== */
  async function renderOverview() {
    selectedActivity = null;

    const activities = await fetchActivities();

    // For class cards we need packs — fetch them in parallel
    const actWithPacks = await Promise.all(activities.map(a => fetchActivityFull(a.id)));

    container.innerHTML = `
      <div class="tar-page">
        <div class="tar-header">
          <h2 class="tar-title">Tarifas — Packs de clases</h2>
          <p class="tar-subtitle">Gestiona los precios por packs de clases y bonos.</p>
        </div>

        ${renderClassCards(actWithPacks)}
      </div>`;

    // Card clicks
    container.querySelectorAll('.tar-card[data-act-id]').forEach(card => {
      card.addEventListener('click', async () => {
        selectedActivity = actWithPacks.find(a => a.id === card.dataset.actId);
        if (selectedActivity) renderEditClass();
      });
    });
  }

  /* ===================== CLASS CARDS (from DB) ===================== */
  function renderClassCards(actList) {
    if (!actList.length) {
      return '<div class="admin-empty" style="padding:40px"><p>No hay actividades. Crea una en la seccion Actividades.</p></div>';
    }
    return `
      <div class="tar-cards-grid">
        ${actList.map(a => {
          const packs = a.packs || [];
          if (!packs.length) return '';
          const color = a.color || '#0f2f39';
          const basePrice = Number(packs[0].price);
          const maxTier = packs.length;
          const bestPack = packs[packs.length - 1];
          const bestPrice = (Number(bestPack.price) / bestPack.sessions).toFixed(2);
          const bestDiscount = basePrice > 0 ? Math.round((1 - Number(bestPack.price) / (basePrice * bestPack.sessions)) * 100) : 0;
          return `
            <div class="tar-card" data-act-id="${a.id}">
              <div class="tar-card-header" style="background:${color}">
                <h3>${esc(a.nombre)}</h3>
                <span class="tar-card-badge">${maxTier} packs</span>
              </div>
              <div class="tar-card-body">
                <div class="tar-card-stats">
                  <div class="tar-stat">
                    <span class="tar-stat-value">${basePrice}€</span>
                    <span class="tar-stat-label">Precio base</span>
                  </div>
                  <div class="tar-stat">
                    <span class="tar-stat-value">${bestPrice}€</span>
                    <span class="tar-stat-label">Mejor precio/sesion</span>
                  </div>
                  <div class="tar-stat">
                    <span class="tar-stat-value tar-stat-discount">-${bestDiscount}%</span>
                    <span class="tar-stat-label">Max. descuento</span>
                  </div>
                </div>
                <div class="tar-card-tiers">
                  ${packs.map(p => {
                    const w = basePrice > 0 ? Math.round((Number(p.price) / (basePrice * p.sessions)) * 100) : 100;
                    return `<div class="tar-tier-bar">
                      <span class="tar-tier-label">${p.sessions}×</span>
                      <div class="tar-tier-track"><div class="tar-tier-fill" style="width:${w}%;background:${color}"></div></div>
                      <span class="tar-tier-price">${p.price}€</span>
                    </div>`;
                  }).join('')}
                </div>
                <div class="tar-card-footer">
                  <span>Anticipo: ${a.deposit}€ · Validez: ${a.pack_validity} dias</span>
                  <button class="tar-edit-btn">Editar</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  /* ===================== EDIT CLASS (DB-backed) ===================== */
  function renderEditClass() {
    const a = selectedActivity;
    const packs = a.packs || [];
    const color = a.color || '#0f2f39';
    const basePrice = packs.length ? Number(packs[0].price) : 0;

    container.innerHTML = `
      <div class="tar-edit-page">
        <div class="tar-edit-topbar">
          <button class="act-back-btn" id="tar-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <strong style="font-size:1.1rem">${esc(a.nombre)}</strong>
            <div style="font-size:.8rem;color:var(--color-muted,#888)">Editar tarifas por packs</div>
          </div>
        </div>

        <div class="tar-edit-layout">
          <div class="tar-edit-main">
            <div class="act-form-card">
              <h3 class="act-detail-section-title">Configuracion general</h3>
              <div class="tar-edit-row">
                <div class="act-form-field">
                  <label class="act-form-label">ANTICIPO (€)</label>
                  <input type="number" class="act-form-input" id="tar-deposit" value="${a.deposit}" step="0.01" />
                </div>
                <div class="act-form-field">
                  <label class="act-form-label">VALIDEZ DEL PACK (dias)</label>
                  <input type="number" class="act-form-input" id="tar-validity" value="${a.pack_validity}" />
                </div>
              </div>
            </div>

            <div class="act-form-card" style="margin-top:20px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 class="act-detail-section-title" style="margin:0">Packs de sesiones</h3>
                <button class="tar-add-tier-btn" id="tar-add-tier">+ Anadir pack</button>
              </div>
              <table class="act-tariff-table tar-edit-table">
                <thead>
                  <tr><th>Sesiones</th><th>Precio total (€)</th><th>Precio/sesion</th><th>Ahorro vs base</th><th>Destacado</th><th></th></tr>
                </thead>
                <tbody id="tar-tiers-body">
                  ${packs.map(p => {
                    const perSession = (Number(p.price) / p.sessions).toFixed(2);
                    const fullPrice = basePrice * p.sessions;
                    const saved = fullPrice - Number(p.price);
                    const pct = p.sessions > 1 && fullPrice > 0 ? Math.round((saved / fullPrice) * 100) : 0;
                    return `<tr data-sessions="${p.sessions}">
                      <td><strong>${p.sessions} sesion${p.sessions > 1 ? 'es' : ''}</strong></td>
                      <td><input type="number" class="tar-price-input" value="${p.price}" step="0.01" min="0" /></td>
                      <td class="tar-per-session">${perSession}€</td>
                      <td>${saved > 0 ? `<span class="act-save-badge">-${saved.toFixed(2)}€ (${pct}%)</span>` : '—'}</td>
                      <td><input type="checkbox" class="tar-pack-featured" ${p.featured?'checked':''} /></td>
                      <td>${p.sessions > 1 ? `<button class="tar-remove-tier" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="tar-edit-preview">
            <div class="act-form-card">
              <h4 style="margin:0 0 12px;font-family:'Space Grotesk',sans-serif;font-size:.85rem;text-transform:uppercase;color:var(--color-muted,#888)">Vista previa</h4>
              <div class="tar-preview-chart" id="tar-preview">
                ${packs.map(p => {
                  const maxPrice = basePrice * (packs[packs.length - 1]?.sessions || 1);
                  const h = maxPrice > 0 ? Math.max(20, Math.round((Number(p.price) / maxPrice) * 140)) : 20;
                  return `<div class="tar-bar-col">
                    <div class="tar-bar" style="height:${h}px;background:${color}"></div>
                    <span class="tar-bar-label">${p.sessions}×</span>
                    <span class="tar-bar-price">${p.price}€</span>
                  </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>

        <div class="tar-edit-footer">
          <button class="act-action-btn primary" id="tar-save">Guardar cambios</button>
          <button class="act-action-link" id="tar-cancel">Cancelar</button>
        </div>
      </div>`;

    /* Events */
    container.querySelector('#tar-back')?.addEventListener('click', () => renderOverview());
    container.querySelector('#tar-cancel')?.addEventListener('click', () => renderOverview());

    container.querySelector('#tar-save')?.addEventListener('click', async () => {
      try {
        // Collect packs from table rows
        const newPacks = [];
        container.querySelectorAll('#tar-tiers-body tr').forEach(tr => {
          newPacks.push({
            sessions: Number(tr.dataset.sessions),
            price: parseFloat(tr.querySelector('.tar-price-input')?.value) || 0,
            featured: tr.querySelector('.tar-pack-featured')?.checked || false,
          });
        });
        // Save packs
        await upsertActivityPacks(a.id, newPacks);
        // Save deposit + validity on the activity
        const deposit = parseFloat(container.querySelector('#tar-deposit')?.value) || 15;
        const pack_validity = parseInt(container.querySelector('#tar-validity')?.value) || 180;
        await upsertActivity({ id: a.id, deposit, pack_validity });

        showToast('Tarifas guardadas en base de datos', 'success');
        renderOverview();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    container.querySelector('#tar-add-tier')?.addEventListener('click', () => {
      const tbody = container.querySelector('#tar-tiers-body');
      const rows = tbody.querySelectorAll('tr');
      const lastSessions = rows.length > 0 ? Number(rows[rows.length - 1].dataset.sessions) : 0;
      const next = lastSessions + 1;
      const tr = document.createElement('tr');
      tr.dataset.sessions = next;
      tr.innerHTML = `
        <td><strong>${next} sesion${next > 1 ? 'es' : ''}</strong></td>
        <td><input type="number" class="tar-price-input" value="0" step="0.01" min="0" /></td>
        <td class="tar-per-session">—</td><td>—</td>
        <td><input type="checkbox" class="tar-pack-featured" /></td>
        <td><button class="tar-remove-tier" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>`;
      tbody.appendChild(tr);
      tr.querySelector('.tar-remove-tier').addEventListener('click', () => tr.remove());
    });

    container.querySelectorAll('.tar-remove-tier').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('tr').remove());
    });

    container.querySelectorAll('.tar-price-input').forEach(input => {
      input.addEventListener('input', () => {
        const tr = input.closest('tr');
        const sessions = Number(tr.dataset.sessions);
        const val = parseFloat(input.value) || 0;
        const cell = tr.querySelector('.tar-per-session');
        if (cell && sessions > 0) cell.textContent = (val / sessions).toFixed(2) + '€';
      });
    });
  }

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  renderOverview();
}
