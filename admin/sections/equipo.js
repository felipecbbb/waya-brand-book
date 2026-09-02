/* ============================================================
   Equipo Section — Gestión de cuentas admin/encargado
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { showToast, openModal, closeModal } from '../modules/ui.js';
import { getProfile } from '../modules/auth.js';
import { GRANTABLE_SECTIONS, sectionTitles } from '../modules/router.js';

const esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function fetchStaff() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at, allowed_sections')
    .in('role', ['admin', 'encargado'])
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Va a /crear-staff.php. Antes llamaba a la Edge Function 'create-staff',
// que nunca se desplegó: daba 404 y dar de alta un encargado fallaba siempre.
async function callCreateStaff({ email, password, full_name }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sin sesión');
  const res = await fetch('/crear-staff.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, password, full_name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `No se pudo crear el encargado (${res.status})`);
  }
  return data; // { ok, user_id }
}

async function updateAllowedSections(userId, sections) {
  const { error } = await supabase.from('profiles')
    .update({ allowed_sections: sections, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// Checklist de secciones concedibles. `selected` = array (marcadas) o null (todas).
function sectionChecklist(selected) {
  return GRANTABLE_SECTIONS.map(s => {
    const checked = !Array.isArray(selected) || selected.includes(s);
    return `<label class="eq-perm"><input type="checkbox" class="eq-perm-cb" value="${s}" ${checked ? 'checked' : ''}><span>${esc(sectionTitles[s] || s)}</span></label>`;
  }).join('');
}

// Cablea los enlaces "Todas / Ninguna" y devuelve un getter de las marcadas
function wirePermControls(formEl) {
  formEl.querySelector('#eq-all')?.addEventListener('click', (e) => {
    e.preventDefault(); formEl.querySelectorAll('.eq-perm-cb').forEach(cb => { cb.checked = true; });
  });
  formEl.querySelector('#eq-none')?.addEventListener('click', (e) => {
    e.preventDefault(); formEl.querySelectorAll('.eq-perm-cb').forEach(cb => { cb.checked = false; });
  });
  return () => [...formEl.querySelectorAll('.eq-perm-cb:checked')].map(cb => cb.value);
}

export async function renderEquipo(container) {
  const myId = getProfile()?.id;

  async function render() {
    let staff;
    try {
      staff = await fetchStaff();
    } catch (err) {
      container.innerHTML = `<p style="color:#ef4444;padding:24px">Error: ${esc(err.message)}</p>`;
      return;
    }

    const permSummary = (s) => {
      if (s.role === 'admin') return 'Acceso total';
      if (!Array.isArray(s.allowed_sections)) return 'Todas las secciones';
      const n = s.allowed_sections.length;
      return n === 0 ? 'Solo Dashboard' : `${n} ${n === 1 ? 'sección' : 'secciones'}`;
    };

    container.innerHTML = `
      <div class="cp-header">
        <span class="sc-count">${staff.length} ${staff.length === 1 ? 'cuenta' : 'cuentas'}</span>
        <button class="sc-new-btn" id="eq-new">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo encargado
        </button>
      </div>

      <div class="cp-table" style="margin-top:16px">
        <div class="cp-table-head">
          <span style="flex:2">Nombre</span>
          <span style="flex:2">Email</span>
          <span style="flex:1">Rol</span>
          <span style="flex:1.3">Acceso</span>
          <span style="flex:1">Alta</span>
          <span style="flex:0 0 96px;text-align:right"></span>
        </div>
        ${staff.map(s => `
          <div class="cp-table-row" data-id="${s.id}">
            <span style="flex:2">${esc(s.full_name || '—')}${s.id === myId ? ' <small style="color:#64757d">(tú)</small>' : ''}</span>
            <span style="flex:2">${esc(s.email || '—')}</span>
            <span style="flex:1"><span class="admin-badge" data-status="${s.role === 'admin' ? 'active' : 'coming_soon'}">${s.role === 'admin' ? 'Admin' : 'Encargado'}</span></span>
            <span style="flex:1.3;font-size:.82rem;color:var(--color-muted)">${permSummary(s)}</span>
            <span style="flex:1">${fmtDate(s.created_at)}</span>
            <span style="flex:0 0 96px;text-align:right;display:flex;gap:6px;justify-content:flex-end">
              ${s.role === 'encargado' ? `
                <button class="cp-action-btn" data-action="perms" data-id="${esc(s.id)}" title="Editar permisos">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                </button>` : ''}
              ${s.role === 'encargado' && s.id !== myId ? `
                <button class="cp-action-btn cp-action-danger" data-action="delete" data-id="${esc(s.id)}" title="Eliminar encargado">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>` : ''}
            </span>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelector('#eq-new')?.addEventListener('click', openCreateModal);

    container.querySelectorAll('[data-action="perms"]').forEach(btn => {
      btn.addEventListener('click', () => openPermsModal(staff.find(s => s.id === btn.dataset.id)));
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const s = staff.find(x => x.id === id);
        if (!confirm(`¿Eliminar a ${s?.full_name || 'este encargado'}? Esta acción no se puede deshacer.`)) return;
        try {
          const { error } = await supabase.rpc('delete_user', { p_user_id: id });
          if (error) throw error;
          showToast('Encargado eliminado', 'success');
          await render();
        } catch (err) {
          showToast(`Error: ${err.message}`, 'error');
        }
      });
    });
  }

  function openCreateModal() {
    openModal('Nuevo encargado', `
      <form id="eq-form" class="eq-form">
        <div class="eq-card">
          <h3 class="eq-card-title">Datos de acceso</h3>
          <div class="ns-field"><label>Nombre completo</label><input class="act-form-input" name="full_name" required placeholder="Ej: María García"></div>
          <div class="ns-field"><label>Email</label><input class="act-form-input" name="email" type="email" required placeholder="encargado@wayasurf.com"></div>
          <div class="ns-field"><label>Contraseña temporal (mín. 8 caracteres)</label><input class="act-form-input" name="password" type="text" required minlength="8" placeholder="EncargadoEO!2026"></div>
          <small style="color:var(--color-muted);display:block">Compártela por un canal privado. El encargado podrá cambiarla más adelante.</small>
        </div>
        <div class="eq-card">
          <div class="eq-card-title-row"><h3 class="eq-card-title">Acceso al panel</h3><span class="eq-perm-actions"><a href="#" id="eq-all">Todas</a> · <a href="#" id="eq-none">Ninguna</a></span></div>
          <p class="eq-card-hint">Marca las secciones que podrá ver. (Dashboard siempre disponible · Estadísticas, Cupones y Equipo son solo de admin.)</p>
          <div class="eq-perm-grid">${sectionChecklist(null)}</div>
        </div>
        <button type="submit" class="btn red" style="width:100%" id="eq-submit">Crear encargado</button>
      </form>
    `);
    const form = document.getElementById('eq-form');
    const getChecked = wirePermControls(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        full_name: fd.get('full_name')?.toString().trim(),
        email: fd.get('email')?.toString().trim(),
        password: fd.get('password')?.toString(),
      };
      const btn = document.getElementById('eq-submit');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const res = await callCreateStaff(payload);
        if (res?.user_id) {
          try { await updateAllowedSections(res.user_id, getChecked()); } catch (err) { console.warn('perms:', err.message); }
        }
        closeModal();
        showToast('Encargado creado', 'success');
        await render();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
        btn.disabled = false; btn.textContent = 'Crear encargado';
      }
    });
  }

  function openPermsModal(staff) {
    if (!staff) return;
    openModal(`Permisos · ${staff.full_name || 'encargado'}`, `
      <form id="eq-perms-form" class="eq-form">
        <div class="eq-card">
          <div class="eq-card-title-row"><h3 class="eq-card-title">Acceso al panel</h3><span class="eq-perm-actions"><a href="#" id="eq-all">Todas</a> · <a href="#" id="eq-none">Ninguna</a></span></div>
          <p class="eq-card-hint">Dashboard siempre disponible. Los cambios se aplican la próxima vez que el encargado cargue el panel.</p>
          <div class="eq-perm-grid">${sectionChecklist(staff.allowed_sections)}</div>
        </div>
        <button type="submit" class="btn red" style="width:100%" id="eq-perms-submit">Guardar permisos</button>
      </form>
    `);
    const form = document.getElementById('eq-perms-form');
    const getChecked = wirePermControls(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('eq-perms-submit');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await updateAllowedSections(staff.id, getChecked());
        closeModal();
        showToast('Permisos actualizados', 'success');
        await render();
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
        btn.disabled = false; btn.textContent = 'Guardar permisos';
      }
    });
  }

  await render();
}
