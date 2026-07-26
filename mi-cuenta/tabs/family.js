// Tab "Mi Familia" — panel de cliente Waya Surf School.
// CRUD de miembros familiares (hijos / acompañantes) para poder reservarles clases.
// Firma de montaje del shell: renderFamily(container, switchTab) — switchTab no se usa aquí.
//
// Datos: /lib/family.js (tabla `family_members`, contrato SQL §2.5).
// Opciones de nivel / talla de neopreno: /lib/shared-constants.js (enum Waya).

import { fetchFamilyMembers, createFamilyMember, updateFamilyMember, deleteFamilyMember } from '/lib/family.js';
import { wetsuitOptionsHtml, levelOptionsHtml } from '/lib/shared-constants.js';
import { esc, showToast } from '/lib/utils.js';

export async function renderFamily(container, switchTab) {
  async function render() {
    const members = await fetchFamilyMembers();

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0;font-family:var(--font-heading,'Outfit',sans-serif);text-transform:uppercase;font-size:.85rem;color:var(--color-navy)">Miembros de la familia</h3>
        <button class="btn btn-primary" id="add-member-btn" style="font-size:.8rem;padding:10px 18px">+ Añadir miembro</button>
      </div>`;

    if (members.length) {
      html += members.map(m => `
        <div class="family-member-card" data-id="${esc(m.id)}">
          <div class="family-member-info">
            <strong>${esc(m.full_name)}${m.last_name ? ' ' + esc(m.last_name) : ''}</strong>
            <span class="meta">${m.level ? esc(m.level) : 'Sin nivel'}${m.birth_date ? ' · ' + new Date(m.birth_date).toLocaleDateString('es-ES') : ''}</span>
            ${m.notes ? `<span class="meta">${esc(m.notes)}</span>` : ''}
            ${m.wetsuit_size ? `<span class="meta">Neopreno: ${esc(m.wetsuit_size)}</span>` : ''}
            ${m.can_swim === false ? '<span class="meta" style="color:#b91c1c">No sabe nadar</span>' : ''}
            ${m.has_injury ? `<span class="meta" style="color:#b91c1c">Lesión: ${m.injury_detail ? esc(m.injury_detail) : 'Sí'}</span>` : ''}
          </div>
          <div class="family-member-actions">
            <button class="btn btn-secondary" data-action="edit" data-id="${esc(m.id)}" style="font-size:.75rem;padding:8px 14px">Editar</button>
            <button class="btn btn-secondary" data-action="delete" data-id="${esc(m.id)}" style="font-size:.75rem;padding:8px 14px;color:#c0392b;border-color:#c0392b">Eliminar</button>
          </div>
        </div>`).join('');
    } else {
      html += '<p style="color:var(--color-muted)">No has añadido miembros familiares. Añade a tus hijos o acompañantes para poder reservar clases para ellos.</p>';
    }

    // Formulario inline (oculto por defecto) — alta y edición.
    html += `
      <div id="family-form-wrap" class="family-form" style="display:none">
        <h4 id="family-form-title">Añadir miembro</h4>
        <form id="family-form">
          <input type="hidden" name="id" value="">
          <label>Nombre <input type="text" name="full_name" required></label>
          <label>Apellidos <input type="text" name="last_name" placeholder="Apellidos"></label>
          <label>Fecha de nacimiento <input type="date" name="birth_date"></label>
          <label>Nivel
            <select name="level">
              ${levelOptionsHtml('', true)}
            </select>
          </label>
          <label>Notas <input type="text" name="notes" placeholder="Alergias, observaciones..."></label>
          <label>¿Sabe nadar?
            <select name="can_swim">
              <option value="">Sin definir</option>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          </label>
          <label>¿Tiene alguna lesión?
            <select name="has_injury" class="family-injury-select">
              <option value="false">No</option>
              <option value="true">Sí</option>
            </select>
          </label>
          <label class="family-injury-detail-wrap" style="display:none">Describe la lesión
            <input type="text" name="injury_detail" placeholder="Ej: rodilla derecha">
          </label>
          <label>Talla de neopreno
            <select name="wetsuit_size">
              ${wetsuitOptionsHtml()}
            </select>
          </label>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="submit" class="btn btn-primary" style="font-size:.8rem">Guardar</button>
            <button type="button" class="btn btn-secondary" id="cancel-family-form" style="font-size:.8rem">Cancelar</button>
          </div>
        </form>
      </div>`;

    container.innerHTML = html;

    // Toggle del campo "describe la lesión" según el select.
    container.querySelector('.family-injury-select')?.addEventListener('change', (e) => {
      container.querySelector('.family-injury-detail-wrap').style.display = e.target.value === 'true' ? '' : 'none';
    });

    // Añadir miembro → abre el formulario en blanco.
    container.querySelector('#add-member-btn').addEventListener('click', () => {
      const wrap = container.querySelector('#family-form-wrap');
      const form = container.querySelector('#family-form');
      form.reset();
      form.querySelector('[name="id"]').value = '';
      wrap.querySelector('.family-injury-detail-wrap').style.display = 'none';
      container.querySelector('#family-form-title').textContent = 'Añadir miembro';
      wrap.style.display = 'block';
    });

    // Cancelar → oculta el formulario.
    container.querySelector('#cancel-family-form')?.addEventListener('click', () => {
      container.querySelector('#family-form-wrap').style.display = 'none';
    });

    // Editar → precarga el formulario con los datos del miembro.
    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = members.find(x => x.id === btn.dataset.id);
        if (!m) return;
        const wrap = container.querySelector('#family-form-wrap');
        const form = container.querySelector('#family-form');
        form.querySelector('[name="id"]').value = m.id;
        form.querySelector('[name="full_name"]').value = m.full_name;
        form.querySelector('[name="last_name"]').value = m.last_name || '';
        form.querySelector('[name="birth_date"]').value = m.birth_date || '';
        form.querySelector('[name="level"]').value = m.level || '';
        form.querySelector('[name="notes"]').value = m.notes || '';
        form.querySelector('[name="can_swim"]').value = m.can_swim === true ? 'true' : m.can_swim === false ? 'false' : '';
        form.querySelector('[name="has_injury"]').value = m.has_injury ? 'true' : 'false';
        form.querySelector('[name="injury_detail"]').value = m.injury_detail || '';
        form.querySelector('[name="wetsuit_size"]').value = m.wetsuit_size || '';
        wrap.querySelector('.family-injury-detail-wrap').style.display = m.has_injury ? '' : 'none';
        container.querySelector('#family-form-title').textContent = 'Editar miembro';
        wrap.style.display = 'block';
      });
    });

    // Eliminar → confirmación nativa + borrado + refresco.
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este miembro familiar?')) return;
        try {
          await deleteFamilyMember(btn.dataset.id);
          showToast('Miembro eliminado');
          await render();
        } catch (err) {
          showToast('Error: ' + (err?.message || 'no se pudo eliminar'), 'error');
        }
      });
    });

    // Guardar (alta o edición).
    container.querySelector('#family-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const obj = Object.fromEntries(fd);
      obj.can_swim = obj.can_swim === 'true' ? true : obj.can_swim === 'false' ? false : null;
      obj.has_injury = obj.has_injury === 'true';
      obj.injury_detail = obj.injury_detail || null;
      obj.wetsuit_size = obj.wetsuit_size || null;
      obj.level = obj.level || null;
      const id = obj.id;
      delete obj.id;

      const fullName = (obj.full_name || '').trim();
      if (!fullName) {
        showToast('El nombre es obligatorio.', 'error');
        return;
      }
      obj.full_name = fullName;

      try {
        if (id) {
          await updateFamilyMember(id, obj);
          showToast('Miembro actualizado');
        } else {
          await createFamilyMember(obj);
          showToast('Miembro añadido');
        }
        await render();
      } catch (err) {
        showToast('Error: ' + (err?.message || 'no se pudo guardar'), 'error');
      }
    });
  }

  await render();
}
