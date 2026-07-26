import { fetchUserBonos, fetchPacksForType, upgradeBono, startBonoBalanceCheckout } from '/lib/bonos.js';
import { formatDate, formatPrice, TYPE_LABELS } from '/lib/utils.js';
import { bonoExpected } from '/lib/domain/pricing.js';

// Tab "Mis Bonos" del panel de cliente Waya.
// Muestra cada bono activo (badge tipo, barra de progreso créditos usados/total,
// caducidad, estado de pago) con acciones: Reservar clase (salta a `calendario`),
// pagar saldo pendiente (SumUp vía startBonoBalanceCheckout) y ampliar pack
// (upgradeBono). Los bonos inactivos se listan atenuados debajo.
//
// Los estilos de este tab aún no viven en account.css: se inyectan una sola vez
// (re-tokenizados a las variables puente de account.css: --color-navy,
// --color-yellow, --color-line, --color-muted, --radius-md).

export async function renderBonos(panel, switchTab) {
  injectBonoStyles();
  const bonos = await fetchUserBonos();

  if (!bonos.length) {
    panel.innerHTML = `
      <div class="no-bonos-prompt">
        <h3>Todavía no tienes bonos</h3>
        <p>Compra un pack de clases en nuestra web y tu bono aparecerá aquí,
           listo para reservar tus sesiones.</p>
        <a class="btn btn-primary" href="/reservar.html">Ver clases</a>
      </div>`;
    return;
  }

  panel.innerHTML = buildBonosHtml(bonos, switchTab);
  bindEvents(panel, switchTab);
}

function buildBonosHtml(bonos, switchTab) {
  const active = bonos.filter(b => b.status === 'active' || b.status === 'exhausted');
  const inactive = bonos.filter(b => b.status !== 'active' && b.status !== 'exhausted');

  let html = '';
  if (active.length) {
    html += active.map(b => renderBonoCard(b, false, switchTab)).join('');
  }
  if (inactive.length) {
    html += `<h4 class="bonos-past-title">Bonos anteriores</h4>`;
    html += inactive.map(b => renderBonoCard(b, true, switchTab)).join('');
  }
  return html;
}

function renderBonoCard(b, dimmed, switchTab) {
  const pct = b.total_credits > 0 ? Math.round((b.used_credits / b.total_credits) * 100) : 0;
  // 'exhausted' = todos los créditos usados, pero el bono sigue VIVO (puede deber
  // dinero). Con el modelo Waya es un estado habitual.
  // Gates alineados con las RPC del contrato (0017_rpc_booking.sql):
  //  - Pagar saldo: cualquier bono vivo (active|exhausted) que deba dinero.
  //  - Reservar clase: solo con crédito libre, activo y no caducado
  //    (book_class exige status='active'; == filtro de calendar.js/fetchActiveBonos).
  //  - Ampliar pack: solo bonos activos (upgrade_bono rechaza status<>'active').
  const isLive = b.status === 'active' || b.status === 'exhausted';
  const notExpired = !b.expires_at || new Date(b.expires_at) > new Date();
  const canReserve = b.status === 'active' && b.used_credits < b.total_credits && notExpired;
  const canUpgrade = b.status === 'active';

  // Info de pago — total real (respeta descuento custom_total) y pagado real.
  const expectedPrice = bonoExpected(b);
  const paid = Number(b.total_paid || 0);
  const pending = Math.max(0, Math.round((expectedPrice - paid) * 100) / 100);
  const isFullyPaid = pending <= 0;
  const payPct = expectedPrice > 0 ? Math.min(100, Math.round((paid / expectedPrice) * 100)) : 100;

  return `
    <div class="bono-card ${dimmed ? 'bono-dimmed' : ''}">
      <div class="bono-card-head">
        <span class="bono-type-badge">${TYPE_LABELS[b.class_type] || b.class_type}</span>
        <div class="bono-card-head-right">
          <span class="status-badge ${b.status}">${statusLabel(b.status)}</span>
          ${isFullyPaid
            ? '<span class="bono-pay-badge bono-pay-ok">Pagado</span>'
            : `<span class="bono-pay-badge bono-pay-pending">Debe ${formatPrice(pending)}</span>`}
        </div>
      </div>

      <div class="bono-counter">${b.used_credits}/${b.total_credits} clases usadas</div>
      <div class="bono-progress">
        <div class="bono-progress-bar" style="width:${pct}%"></div>
      </div>

      <div class="bono-payment-info">
        <div class="bono-payment-row">
          <span>Pagado</span>
          <span class="bono-payment-amount">${formatPrice(paid)} de ${formatPrice(expectedPrice)}</span>
        </div>
        <div class="bono-payment-bar">
          <div class="bono-payment-bar-fill" style="width:${payPct}%;background:${isFullyPaid ? '#22c55e' : '#f59e0b'}"></div>
        </div>
      </div>

      <div class="bono-card-foot">
        <span class="meta">Caduca: ${formatDate(b.expires_at)}</span>
        <div class="bono-card-actions">
          ${isLive && !isFullyPaid ? `<button class="btn bono-pay-btn" data-action="pay-bono" data-bono-id="${b.id}" data-pending="${pending.toFixed(2)}" data-class-type="${b.class_type}" data-total-credits="${b.total_credits}" data-paid="${paid.toFixed(2)}">Pagar ${formatPrice(pending)}</button>` : ''}
          ${canUpgrade ? `<button class="btn-outline-sm" data-action="upgrade-bono" data-bono-id="${b.id}" data-class-type="${b.class_type}" data-total="${b.total_credits}" data-total-paid="${b.total_paid || 0}">Ampliar pack</button>` : ''}
          ${canReserve && switchTab ? `<button class="btn red bono-reserve-btn" data-action="reserve-bono">Reservar clase</button>` : ''}
        </div>
      </div>
    </div>`;
}

function statusLabel(status) {
  return status === 'active' ? 'Activo'
    : status === 'exhausted' ? 'Agotado'
    : status === 'expired' ? 'Expirado'
    : status === 'cancelled' ? 'Cancelado'
    : status;
}

function bindEvents(panel, switchTab) {
  panel.querySelectorAll('[data-action="reserve-bono"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (switchTab) switchTab('calendario');
    });
  });

  panel.querySelectorAll('[data-action="upgrade-bono"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bonoId = btn.dataset.bonoId;
      const classType = btn.dataset.classType;
      const currentTotal = Number(btn.dataset.total);
      const totalPaid = Number(btn.dataset.totalPaid) || 0;
      await openUpgradeModal(panel, switchTab, bonoId, classType, currentTotal, totalPaid);
    });
  });

  panel.querySelectorAll('[data-action="pay-bono"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const bonoId = btn.dataset.bonoId;
      const pending = Number(btn.dataset.pending);
      const classType = btn.dataset.classType;
      const totalCredits = Number(btn.dataset.totalCredits);
      const paid = Number(btn.dataset.paid);
      openPayBonoModal(bonoId, classType, totalCredits, paid, pending);
    });
  });
}

async function openUpgradeModal(panel, switchTab, bonoId, classType, currentTotal, totalPaid) {
  // fetchPacksForType → { packs, deposit, extraClassPrice }.
  const result = await fetchPacksForType(classType);
  const packs = result.packs || result;
  const extraClassPrice = result.extraClassPrice || 0;
  const alreadyPaid = Number(totalPaid) || 0;

  if (!packs.length) {
    alert('No hay tarifas disponibles para este tipo de actividad.');
    return;
  }

  // Packs con más sesiones que el actual.
  const upgrades = packs.filter(p => p.sessions > currentTotal);

  if (!upgrades.length && !extraClassPrice) {
    alert('Ya tienes el pack más grande disponible.');
    return;
  }

  const maxPack = packs.length ? packs[packs.length - 1] : null;
  const maxSessions = maxPack ? maxPack.sessions : currentTotal;

  // Opciones de clases extra (1..5) por encima del pack máximo.
  const extraOptions = [];
  if (extraClassPrice > 0 && currentTotal >= maxSessions) {
    for (let i = 1; i <= 5; i++) {
      extraOptions.push({ sessions: currentTotal + i, extraCount: i, cost: extraClassPrice * i });
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'bono-upgrade-overlay';
  overlay.innerHTML = `
    <div class="bono-upgrade-modal">
      <div class="bono-upgrade-header">
        <h3>Ampliar pack — ${TYPE_LABELS[classType] || classType}</h3>
        <button class="bono-upgrade-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="bono-upgrade-body">
        <p class="bono-upgrade-current">Tu pack actual: <strong>${currentTotal} sesiones</strong> · Ya pagado: ${formatPrice(alreadyPaid)}</p>
        ${upgrades.length ? `
          <p class="bono-upgrade-note">Se descuentan los ${formatPrice(alreadyPaid)} que ya llevas pagados.</p>
          <div class="bono-upgrade-options">
            ${upgrades.map(p => {
              const newPrice = Number(p.price);
              const diff = Math.max(0, newPrice - alreadyPaid);
              const perSession = (newPrice / p.sessions).toFixed(2);
              return `
                <button class="bono-upgrade-option" data-sessions="${p.sessions}" data-diff="${diff.toFixed(2)}" data-mode="pack">
                  <div class="bono-upgrade-option-top">
                    <span class="bono-upgrade-sessions">${p.sessions} sesiones</span>
                    ${p.featured ? '<span class="bono-upgrade-featured">Popular</span>' : ''}
                  </div>
                  <div class="bono-upgrade-option-price">
                    <span class="bono-upgrade-total">${newPrice.toFixed(2)}€</span>
                    <span class="bono-upgrade-per">${perSession}€/sesión</span>
                  </div>
                  <div class="bono-upgrade-diff">Pagas: <strong>${diff.toFixed(2)}€</strong> <span class="bono-upgrade-diff-hint">(${newPrice.toFixed(2)}€ − ${alreadyPaid.toFixed(2)}€ pagado)</span></div>
                </button>`;
            }).join('')}
          </div>` : ''}
        ${extraOptions.length ? `
          ${upgrades.length ? '<hr class="bono-upgrade-sep">' : ''}
          <h4 class="bono-upgrade-subtitle">Clases extra · ${extraClassPrice.toFixed(2)}€/clase</h4>
          <p class="bono-upgrade-note-muted">Añade clases sueltas a tu bono al precio especial de ${extraClassPrice.toFixed(2)}€ por clase.</p>
          <div class="bono-upgrade-options">
            ${extraOptions.map(o => `
              <button class="bono-upgrade-option" data-sessions="${o.sessions}" data-diff="${o.cost.toFixed(2)}" data-mode="extra" data-extra-count="${o.extraCount}">
                <div class="bono-upgrade-option-top">
                  <span class="bono-upgrade-sessions">+${o.extraCount} clase${o.extraCount > 1 ? 's' : ''} extra</span>
                </div>
                <div class="bono-upgrade-option-price">
                  <span class="bono-upgrade-total">${o.sessions} sesiones total</span>
                  <span class="bono-upgrade-per">${extraClassPrice.toFixed(2)}€/clase extra</span>
                </div>
                <div class="bono-upgrade-diff">Pagas: <strong>${o.cost.toFixed(2)}€</strong></div>
              </button>`).join('')}
          </div>` : ''}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('.bono-upgrade-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.bono-upgrade-option').forEach(opt => {
    opt.addEventListener('click', async () => {
      const newSessions = Number(opt.dataset.sessions);
      const diff = opt.dataset.diff;
      const mode = opt.dataset.mode;
      const extraCount = opt.dataset.extraCount;

      const msg = mode === 'extra'
        ? `¿Añadir ${extraCount} clase${extraCount > 1 ? 's' : ''} extra? Coste: ${diff}€`
        : `¿Ampliar tu pack a ${newSessions} sesiones? Diferencia a pagar: ${diff}€`;

      if (!confirm(msg)) return;

      opt.disabled = true;
      opt.style.opacity = '0.5';
      try {
        await upgradeBono(bonoId, newSessions, Number(diff));
        // Verifica que la ampliación se aplicó antes de refrescar.
        const updatedBonos = await fetchUserBonos();
        const updatedBono = updatedBonos.find(b => b.id === bonoId);
        if (!updatedBono || updatedBono.total_credits !== newSessions) {
          throw new Error('La ampliación no se aplicó correctamente. Inténtalo de nuevo.');
        }
        overlay.remove();
        await refreshBonosPanel(panel, switchTab);
      } catch (err) {
        alert('Error al ampliar: ' + err.message);
        opt.disabled = false;
        opt.style.opacity = '1';
      }
    });
  });
}

function openPayBonoModal(bonoId, classType, totalCredits, alreadyPaid, pending) {
  const overlay = document.createElement('div');
  overlay.className = 'bono-upgrade-overlay';
  overlay.innerHTML = `
    <div class="bono-upgrade-modal bono-pay-modal">
      <div class="bono-upgrade-header">
        <h3>Pagar bono — ${TYPE_LABELS[classType] || classType}</h3>
        <button class="bono-upgrade-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="bono-upgrade-body">
        <p class="bono-upgrade-current">Pack de <strong>${totalCredits} sesiones</strong></p>
        <div class="bono-pay-detail-grid">
          <div class="bono-pay-detail-item">
            <span class="bono-pay-detail-label">Precio total</span>
            <span class="bono-pay-detail-value">${formatPrice(alreadyPaid + pending)}</span>
          </div>
          <div class="bono-pay-detail-item">
            <span class="bono-pay-detail-label">Ya pagado</span>
            <span class="bono-pay-detail-value bono-pay-detail-paid">${formatPrice(alreadyPaid)}</span>
          </div>
          <div class="bono-pay-detail-item bono-pay-detail-highlight">
            <span class="bono-pay-detail-label">Pendiente</span>
            <span class="bono-pay-detail-value">${formatPrice(pending)}</span>
          </div>
        </div>
        <p class="bono-pay-optional">
          Pago <strong>opcional</strong>: abónalo ahora con tarjeta o cuando vengas a la
          escuela. No hace falta para reservar tus clases.
        </p>
        <button class="btn red bono-pay-confirm" id="pay-bono-confirm">
          Pagar ${formatPrice(pending)} con tarjeta
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('.bono-upgrade-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#pay-bono-confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('#pay-bono-confirm');
    btn.disabled = true;
    btn.textContent = 'Redirigiendo al pago…';
    try {
      await startBonoBalanceCheckout(bonoId, pending, TYPE_LABELS[classType] || classType);
      // Redirige a la pasarela. Al volver (?pago=ok) el panel recarga y el webhook
      // habrá actualizado total_paid y marcado las inscripciones como pagadas.
    } catch (err) {
      alert('Error al iniciar el pago: ' + err.message);
      btn.disabled = false;
      btn.textContent = `Pagar ${formatPrice(pending)} con tarjeta`;
    }
  });
}

async function refreshBonosPanel(panel, switchTab) {
  const freshBonos = await fetchUserBonos();
  panel.innerHTML = buildBonosHtml(freshBonos, switchTab);
  bindEvents(panel, switchTab);
}

// ---------------------------------------------------------------------------
// Estilos del tab (una sola inyección). Re-tokenizados a las variables puente
// que account.css ya define: --color-navy → --color-dark, --color-yellow/--red →
// --color-primary, --color-muted → --color-gray, --color-line, --radius-md.
// Fuentes: --font-heading (Outfit). NO se inventan tokens nuevos.
// ---------------------------------------------------------------------------
function injectBonoStyles() {
  if (document.getElementById('waya-bonos-styles')) return;
  const style = document.createElement('style');
  style.id = 'waya-bonos-styles';
  style.textContent = `
  .no-bonos-prompt {
    text-align: center;
    padding: 34px 24px;
    background: #fff;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-md, var(--radius, 10px));
  }
  .no-bonos-prompt h3 {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 700;
    font-size: 1.4rem;
    color: var(--color-navy);
    margin: 0 0 8px;
  }
  .no-bonos-prompt p { font-size: .9rem; color: var(--color-muted); margin: 0 0 20px; line-height: 1.5; }

  .bonos-past-title {
    margin: 24px 0 12px;
    font-family: var(--font-heading, 'Outfit', sans-serif);
    text-transform: uppercase;
    letter-spacing: .04em;
    font-size: .8rem;
    color: var(--color-muted);
  }

  .bono-card {
    background: #fff;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-md, var(--radius, 10px));
    padding: 18px 20px;
    margin-bottom: 12px;
  }
  .bono-card.bono-dimmed { opacity: .55; }
  .bono-card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .bono-card-head-right { display: flex; gap: 6px; align-items: center; }

  .bono-type-badge {
    display: inline-block;
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    background: var(--color-yellow, var(--color-primary));
    color: var(--color-navy);
    padding: 3px 10px;
    border-radius: 20px;
  }

  .bono-counter {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 700;
    font-size: 1.25rem;
    color: var(--color-navy);
    margin: 10px 0 6px;
  }
  .bono-progress { height: 8px; background: var(--color-line); border-radius: 4px; overflow: hidden; }
  .bono-progress-bar { height: 100%; background: var(--color-yellow, var(--color-primary)); border-radius: 4px; transition: width .3s ease; }

  .bono-payment-info { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--color-line); }
  .bono-payment-row { display: flex; justify-content: space-between; font-size: .82rem; color: var(--color-muted); margin-bottom: 6px; }
  .bono-payment-amount { font-weight: 600; color: #065f46; }
  .bono-payment-bar { height: 5px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
  .bono-payment-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }

  .bono-pay-badge { font-size: .66rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
  .bono-pay-ok { background: #dcfce7; color: #166534; }
  .bono-pay-pending { background: #fef3c7; color: #92400e; }

  .bono-card-foot { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .bono-card .meta { font-size: .82rem; color: var(--color-muted); }
  .bono-card-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  /* Botón pagar saldo (verde semántico de dinero, no es color de marca) */
  .bono-pay-btn {
    font-size: .78rem;
    padding: 7px 14px;
    background: #22c55e;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  .bono-pay-btn:hover { background: #16a34a; }

  /* Botón CTA Waya (amarillo marca + texto oscuro) */
  .bono-card .btn.red, .bono-pay-confirm.btn.red {
    background: var(--color-primary, #FDD802);
    color: var(--color-dark, #1a1a1a);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 700;
  }
  .bono-reserve-btn { font-size: .8rem; padding: 6px 14px; }
  .bono-pay-confirm { width: 100%; margin-top: 18px; padding: 12px; font-size: .92rem; }

  /* Botón outline pequeño (ampliar pack) */
  .btn-outline-sm {
    font-size: .8rem;
    padding: 6px 14px;
    border: 1.5px solid var(--color-navy);
    background: transparent;
    color: var(--color-navy);
    border-radius: 6px;
    cursor: pointer;
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 600;
    transition: background .2s, color .2s;
  }
  .btn-outline-sm:hover { background: var(--color-navy); color: #fff; }

  /* Modal ampliar / pagar */
  .bono-upgrade-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .bono-upgrade-modal {
    background: #fff; border-radius: 16px;
    max-width: 520px; width: 100%;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,.2);
  }
  .bono-pay-modal { max-width: 420px; }
  .bono-upgrade-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 24px; border-bottom: 1px solid var(--color-line);
  }
  .bono-upgrade-header h3 {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 700; font-size: 1.3rem; margin: 0; color: var(--color-navy);
  }
  .bono-upgrade-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--color-muted); line-height: 1; }
  .bono-upgrade-body { padding: 24px; }
  .bono-upgrade-current { font-size: .9rem; color: var(--color-muted); margin: 0 0 20px; }
  .bono-upgrade-note { font-size: .82rem; color: #166534; margin: 0 0 16px; padding: 8px 12px; background: #f0fdf4; border-radius: 8px; }
  .bono-upgrade-note-muted { font-size: .82rem; color: var(--color-muted); margin: 0 0 12px; }
  .bono-upgrade-sep { margin: 20px 0; border: none; border-top: 1px solid var(--color-line); }
  .bono-upgrade-subtitle {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-size: .95rem; font-weight: 700; color: var(--color-navy); margin: 0 0 12px;
  }
  .bono-upgrade-options { display: flex; flex-direction: column; gap: 10px; }
  .bono-upgrade-option {
    display: block; width: 100%; text-align: left;
    padding: 16px 18px; border: 2px solid var(--color-line);
    border-radius: 12px; background: #fff; cursor: pointer;
    transition: border-color .2s, background .2s; font-family: inherit;
  }
  .bono-upgrade-option:hover { border-color: var(--color-yellow, var(--color-primary)); background: #fffdf3; }
  .bono-upgrade-option-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .bono-upgrade-sessions {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 700; font-size: 1.15rem; color: var(--color-navy);
  }
  .bono-upgrade-featured {
    font-size: .65rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    background: var(--color-yellow, var(--color-primary)); color: var(--color-navy);
    padding: 2px 8px; border-radius: 20px;
  }
  .bono-upgrade-option-price { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
  .bono-upgrade-total { font-size: 1rem; font-weight: 700; color: var(--color-navy); }
  .bono-upgrade-per { font-size: .8rem; color: var(--color-muted); }
  .bono-upgrade-diff { font-size: .95rem; color: var(--color-navy); }
  .bono-upgrade-diff strong { font-size: 1.1rem; color: #166534; }
  .bono-upgrade-diff-hint { font-size: .75rem; color: var(--color-muted); }

  /* Grid de detalle en modal de pago */
  .bono-pay-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
  .bono-pay-detail-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
  .bono-pay-detail-highlight { grid-column: 1 / -1; background: #fffbeb; border-color: #fde68a; }
  .bono-pay-detail-label { display: block; font-size: .72rem; text-transform: uppercase; font-weight: 600; color: var(--color-muted); margin-bottom: 2px; }
  .bono-pay-detail-highlight .bono-pay-detail-label { color: #92400e; }
  .bono-pay-detail-value {
    font-family: var(--font-heading, 'Outfit', sans-serif);
    font-weight: 700; font-size: 1.2rem; color: var(--color-navy);
  }
  .bono-pay-detail-paid { color: #065f46; }
  .bono-pay-detail-highlight .bono-pay-detail-value { color: #92400e; }
  .bono-pay-optional { font-size: .82rem; color: var(--color-muted); margin: 16px 0 0; }

  @media (max-width: 640px) {
    .bono-card { padding: 14px; }
    .bono-counter { font-size: 1.1rem; }
    .bono-pay-detail-grid { grid-template-columns: 1fr; }
    .bono-upgrade-overlay { padding: 10px; }
    .bono-upgrade-modal { border-radius: 12px; max-height: 92vh; overflow-y: auto; }
    .bono-upgrade-header { padding: 14px 16px; }
    .bono-upgrade-body { padding: 16px; }
    .bono-upgrade-option { padding: 12px 14px; }
  }`;
  document.head.appendChild(style);
}
