/* ============================================================
   Cupones Section — Discount code management
   ============================================================ */
import { fetchCoupons, upsertCoupon, deleteCoupon, fetchCamps } from '../modules/api.js';
import { showToast } from '../modules/ui.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

const APPLIES_TO = [
  { value: 'all', label: 'Todo' },
  { value: 'camps', label: 'Surf Camps' },
  { value: 'classes', label: 'Clases / Bonos' },
  { value: 'products', label: 'Productos (tienda)' },
  { value: 'rentals', label: 'Alquiler material' },
];

const CLASS_TYPES = [
  { value: '', label: 'Todas las clases' },
  { value: 'grupal', label: 'Grupal' },
  { value: 'privada', label: 'Privada' },
  { value: 'semiprivada', label: 'Semi-Privada' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'residente', label: 'Bono Residentes' },
  { value: 'kids', label: 'Waya Kids' },
];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function couponStatus(c) {
  if (!c.active) return { label: 'Desactivado', status: 'draft' };
  const now = new Date();
  if (c.expires_at && new Date(c.expires_at) < now) return { label: 'Expirado', status: 'cancelled' };
  if (c.starts_at && new Date(c.starts_at) > now) return { label: 'Programado', status: 'coming_soon' };
  if (c.max_uses && c.used_count >= c.max_uses) return { label: 'Agotado', status: 'full' };
  return { label: 'Activo', status: 'active' };
}

export async function renderCupones(container) {
  let editingCoupon = null;
  let camps = [];

  async function render() {
    const [coupons, campsData] = await Promise.all([fetchCoupons(), fetchCamps()]);
    camps = campsData;

    if (editingCoupon !== null) {
      renderForm(editingCoupon === 'new' ? null : coupons.find(c => c.id === editingCoupon));
      return;
    }

    const active = coupons.filter(c => { const s = couponStatus(c); return s.status === 'active' || s.status === 'coming_soon'; });
    const inactive = coupons.filter(c => !active.includes(c));

    container.innerHTML = `
      <div class="cp-header">
        <span class="sc-count">${coupons.length} cupon${coupons.length !== 1 ? 'es' : ''}</span>
        <button class="sc-new-btn" id="cp-new">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo cupon
        </button>
      </div>

      ${coupons.length ? `
        <div class="cp-table">
          <div class="cp-table-head">
            <span class="cp-col-code">Codigo</span>
            <span class="cp-col-name">Nombre</span>
            <span class="cp-col-discount">Descuento</span>
            <span class="cp-col-applies">Aplica a</span>
            <span class="cp-col-uses">Usos</span>
            <span class="cp-col-dates">Vigencia</span>
            <span class="cp-col-status">Estado</span>
            <span class="cp-col-actions"></span>
          </div>
          ${coupons.map(c => {
            const st = couponStatus(c);
            const disc = c.discount_type === 'percentage' ? `${c.discount_value}%` : `${c.discount_value}€`;
            const appliesLabel = APPLIES_TO.find(a => a.value === c.applies_to)?.label || c.applies_to;
            const usesText = c.max_uses ? `${c.used_count}/${c.max_uses}` : `${c.used_count}/∞`;
            const dates = c.starts_at || c.expires_at
              ? `${c.starts_at ? fmtDate(c.starts_at) : '—'} → ${c.expires_at ? fmtDate(c.expires_at) : '∞'}`
              : 'Sin limite';
            return `
              <div class="cp-table-row" data-id="${c.id}">
                <span class="cp-col-code"><code class="cp-code-badge">${esc(c.code)}</code></span>
                <span class="cp-col-name">${esc(c.name)}</span>
                <span class="cp-col-discount"><strong>${disc}</strong></span>
                <span class="cp-col-applies">${appliesLabel}${c.activity_type ? ` · ${c.activity_type}` : ''}</span>
                <span class="cp-col-uses">${usesText}</span>
                <span class="cp-col-dates">${dates}</span>
                <span class="cp-col-status"><span class="admin-badge" data-status="${st.status}">${st.label}</span></span>
                <span class="cp-col-actions">
                  <button class="cp-action-btn" data-action="edit" data-id="${c.id}" title="Editar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button class="cp-action-btn cp-action-danger" data-action="delete" data-id="${c.id}" title="Eliminar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </span>
              </div>`;
          }).join('')}
        </div>
      ` : `
        <div class="sc-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
          <p>Aun no hay cupones creados</p>
        </div>
      `}`;

    container.querySelector('#cp-new')?.addEventListener('click', () => { editingCoupon = 'new'; render(); });

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); editingCoupon = btn.dataset.id; render(); });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const c = coupons.find(x => x.id === btn.dataset.id);
        if (!c || !confirm(`Eliminar cupon "${c.code}"?`)) return;
        try {
          await deleteCoupon(c.id);
          showToast('Cupon eliminado', 'success');
          render();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });
  }

  function renderForm(coupon) {
    const isEdit = !!coupon;
    const c = coupon || {};

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="cp-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${isEdit ? esc(c.code) : 'Nuevo cupon'}</strong>
            ${isEdit ? `<div class="act-detail-topbar-meta"><span class="admin-badge" data-status="${couponStatus(c).status}">${couponStatus(c).label}</span></div>` : ''}
          </div>
        </div>

        <div style="max-width:680px;padding:24px 0">
          <div class="act-form-card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="act-form-field">
                <label class="act-form-label">CODIGO</label>
                <div style="display:flex;gap:8px">
                  <input type="text" class="act-form-input" id="cp-code" value="${esc(c.code||'')}" placeholder="VERANO25" style="text-transform:uppercase;font-weight:700;letter-spacing:.05em" />
                  <button class="act-action-btn primary" id="cp-generate" style="white-space:nowrap;font-size:.7rem">Generar</button>
                </div>
              </div>
              <div class="act-form-field">
                <label class="act-form-label">NOMBRE / DESCRIPCION</label>
                <input type="text" class="act-form-input" id="cp-name" value="${esc(c.name||'')}" placeholder="Descuento verano 2026" />
              </div>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <h4 style="margin:0 0 16px;font-size:.95rem;color:var(--color-navy)">Descuento</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="act-form-field">
                <label class="act-form-label">TIPO DE DESCUENTO</label>
                <select class="act-form-input" id="cp-discount-type">
                  <option value="percentage" ${c.discount_type==='percentage'||!c.discount_type?'selected':''}>Porcentaje (%)</option>
                  <option value="fixed" ${c.discount_type==='fixed'?'selected':''}>Cantidad fija (€)</option>
                </select>
              </div>
              <div class="act-form-field">
                <label class="act-form-label">VALOR</label>
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="number" class="act-form-input" id="cp-discount-value" value="${c.discount_value||''}" step="0.01" min="0" style="width:100px" />
                  <span id="cp-unit" style="font-size:.88rem;color:var(--color-muted)">%</span>
                </div>
              </div>
            </div>
            <div class="act-form-field" style="margin-top:12px">
              <label class="act-form-label">IMPORTE MINIMO DE COMPRA</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="number" class="act-form-input" id="cp-min-amount" value="${c.min_amount||0}" step="0.01" min="0" style="width:120px" />
                <span style="font-size:.88rem;color:var(--color-muted)">€</span>
              </div>
              <small class="act-form-hint">0 = sin minimo.</small>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <h4 style="margin:0 0 16px;font-size:.95rem;color:var(--color-navy)">Aplica a</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="act-form-field">
                <label class="act-form-label">SERVICIO</label>
                <select class="act-form-input" id="cp-applies-to">
                  ${APPLIES_TO.map(a => `<option value="${a.value}" ${c.applies_to===a.value?'selected':''}>${a.label}</option>`).join('')}
                </select>
              </div>
              <div class="act-form-field" id="cp-class-type-field" style="display:none">
                <label class="act-form-label">TIPO DE CLASE</label>
                <select class="act-form-input" id="cp-activity-type">
                  ${CLASS_TYPES.map(t => `<option value="${t.value}" ${c.activity_type===t.value?'selected':''}>${t.label}</option>`).join('')}
                </select>
              </div>
              <div class="act-form-field" id="cp-camp-field" style="display:none">
                <label class="act-form-label">CAMP ESPECIFICO</label>
                <select class="act-form-input" id="cp-camp-id">
                  <option value="">Todos los camps</option>
                  ${camps.map(camp => `<option value="${camp.id}" ${c.camp_id===camp.id?'selected':''}>${esc(camp.title)}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <h4 style="margin:0 0 16px;font-size:.95rem;color:var(--color-navy)">Limites</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="act-form-field">
                <label class="act-form-label">USOS MAXIMOS TOTALES</label>
                <input type="number" class="act-form-input" id="cp-max-uses" value="${c.max_uses||''}" min="0" placeholder="Ilimitado" />
                <small class="act-form-hint">Vacio = sin limite.</small>
              </div>
              <div class="act-form-field">
                <label class="act-form-label">USOS POR USUARIO</label>
                <input type="number" class="act-form-input" id="cp-max-per-user" value="${c.max_uses_per_user??1}" min="1" />
              </div>
            </div>
            ${isEdit ? `<div class="act-form-field" style="margin-top:12px"><label class="act-form-label">USOS ACTUALES</label><span style="font-family:'Bebas Neue';font-size:1.4rem;color:var(--color-navy)">${c.used_count||0}</span></div>` : ''}
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <h4 style="margin:0 0 16px;font-size:.95rem;color:var(--color-navy)">Vigencia</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="act-form-field">
                <label class="act-form-label">FECHA INICIO</label>
                <input type="datetime-local" class="act-form-input" id="cp-starts" value="${c.starts_at ? c.starts_at.slice(0,16) : ''}" />
                <small class="act-form-hint">Vacio = activo inmediatamente.</small>
              </div>
              <div class="act-form-field">
                <label class="act-form-label">FECHA EXPIRACION</label>
                <input type="datetime-local" class="act-form-input" id="cp-expires" value="${c.expires_at ? c.expires_at.slice(0,16) : ''}" />
                <small class="act-form-hint">Vacio = no expira.</small>
              </div>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <div class="act-form-field">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="cp-active" ${c.active !== false ? 'checked' : ''} />
                <span style="font-size:.88rem;color:var(--color-navy);font-weight:600">Cupon activo</span>
              </label>
            </div>
          </div>

          <div style="display:flex;gap:12px;margin-top:24px">
            <button class="act-action-btn primary" id="cp-save" style="padding:10px 28px">${isEdit ? 'Guardar cambios' : 'Crear cupon'}</button>
            <button class="act-action-link" id="cp-cancel">Cancelar</button>
          </div>
        </div>
      </div>`;

    // Show/hide conditional fields
    const appliesSelect = container.querySelector('#cp-applies-to');
    const classField = container.querySelector('#cp-class-type-field');
    const campField = container.querySelector('#cp-camp-field');
    const discountType = container.querySelector('#cp-discount-type');
    const unitLabel = container.querySelector('#cp-unit');

    function toggleFields() {
      const val = appliesSelect.value;
      classField.style.display = val === 'classes' ? '' : 'none';
      campField.style.display = val === 'camps' ? '' : 'none';
    }
    toggleFields();
    appliesSelect.addEventListener('change', toggleFields);

    discountType.addEventListener('change', () => {
      unitLabel.textContent = discountType.value === 'percentage' ? '%' : '€';
    });
    unitLabel.textContent = discountType.value === 'percentage' ? '%' : '€';

    // Generate code
    container.querySelector('#cp-generate')?.addEventListener('click', () => {
      container.querySelector('#cp-code').value = generateCode();
    });

    // Back / Cancel
    const goBack = () => { editingCoupon = null; render(); };
    container.querySelector('#cp-back')?.addEventListener('click', goBack);
    container.querySelector('#cp-cancel')?.addEventListener('click', goBack);

    // Save
    container.querySelector('#cp-save')?.addEventListener('click', async () => {
      const code = container.querySelector('#cp-code')?.value.trim().toUpperCase();
      const name = container.querySelector('#cp-name')?.value.trim();
      if (!code || !name) { showToast('Codigo y nombre son obligatorios', 'error'); return; }

      const data = {
        code,
        name,
        discount_type: discountType.value,
        discount_value: parseFloat(container.querySelector('#cp-discount-value')?.value) || 0,
        applies_to: appliesSelect.value,
        activity_type: appliesSelect.value === 'classes' ? (container.querySelector('#cp-activity-type')?.value || null) : null,
        camp_id: appliesSelect.value === 'camps' ? (container.querySelector('#cp-camp-id')?.value || null) : null,
        min_amount: parseFloat(container.querySelector('#cp-min-amount')?.value) || 0,
        max_uses: parseInt(container.querySelector('#cp-max-uses')?.value) || null,
        max_uses_per_user: parseInt(container.querySelector('#cp-max-per-user')?.value) || 1,
        starts_at: container.querySelector('#cp-starts')?.value ? new Date(container.querySelector('#cp-starts').value).toISOString() : null,
        expires_at: container.querySelector('#cp-expires')?.value ? new Date(container.querySelector('#cp-expires').value).toISOString() : null,
        active: container.querySelector('#cp-active')?.checked ?? true,
      };

      if (isEdit) data.id = c.id;

      const btn = container.querySelector('#cp-save');
      btn.disabled = true;
      btn.textContent = 'Guardando...';

      try {
        await upsertCoupon(data);
        showToast(isEdit ? 'Cupon actualizado' : 'Cupon creado', 'success');
        editingCoupon = null;
        render();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = isEdit ? 'Guardar cambios' : 'Crear cupon';
      }
    });
  }

  await render();
}
