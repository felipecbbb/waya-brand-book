/* ============================================================
   Autocompletado de fichas de cliente (anti-duplicados)
   ============================================================
   attachClientSuggest(input, { onPick, includeFamily })
   Al escribir en un campo de nombre/email, despliega las fichas existentes que
   coinciden (cliente por nombre/email/teléfono + sus familiares) y, al elegir una,
   llama onPick(picked) para VINCULARLA en vez de crear un duplicado.

   picked = {
     type: 'profile' | 'family',
     id,            // id del PERFIL (cuenta) — para family es el del titular
     full_name, last_name, email, phone,
     familyMemberId,// solo si type==='family'
     label          // texto mostrado
   }
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { searchProfiles } from './api.js';

const esc = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

export function attachClientSuggest(input, { onPick, includeFamily = true } = {}) {
  if (!input || input._suggestAttached) return;
  input._suggestAttached = true;

  let box = null, timer = null, items = [];

  const closeBox = () => { box?.remove(); box = null; };

  function positionBox() {
    if (!box) return;
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 2}px`;
    box.style.width = `${r.width}px`;
  }

  function render() {
    closeBox();
    if (!items.length) return;
    box = document.createElement('div');
    box.className = 'client-suggest-box';
    box.style.cssText = 'position:fixed;z-index:10050;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(15,47,57,.16);max-height:240px;overflow:auto;font-size:.86rem';
    box.innerHTML = items.map((it, i) => `
      <div class="cs-opt" data-i="${i}" style="padding:8px 11px;cursor:pointer;border-bottom:1px solid #f1f5f9;${it.type === 'family' ? 'padding-left:24px;border-left:3px solid #1a1a1a' : ''}">
        ${it.type === 'family' ? `<small style="color:#1a1a1a;font-weight:600">↳ Familiar de ${esc(it.parentName)}</small><br>` : ''}
        <strong>${esc(it.label)}</strong>${it.sub ? ` <span style="color:#64748b">· ${esc(it.sub)}</span>` : ''}
      </div>`).join('');
    document.body.appendChild(box);
    positionBox();
    box.querySelectorAll('.cs-opt').forEach(el => {
      // mousedown (no click) para que dispare antes del blur del input
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = items[Number(el.dataset.i)];
        closeBox();
        if (it && onPick) onPick(it);
      });
    });
  }

  async function run() {
    const term = input.value.trim();
    if (term.length < 2) { items = []; closeBox(); return; }
    try {
      const profiles = await searchProfiles(term);
      const list = [];
      for (const p of profiles) {
        list.push({ type: 'profile', id: p.id, full_name: p.full_name || '', last_name: p.last_name || '', email: p.email || '', phone: p.phone || '', familyMemberId: null, label: p.full_name || 'Sin nombre', sub: p.phone || p.email || '' });
      }
      if (includeFamily) {
        const safe = term.replace(/[%_\\]/g, '');
        const { data: fams } = await supabase.from('family_members')
          .select('id, full_name, last_name, user_id, profiles:user_id(full_name)')
          .ilike('full_name', `%${safe}%`).limit(8);
        (fams || []).forEach(m => list.push({
          type: 'family', id: m.user_id, familyMemberId: m.id,
          full_name: m.full_name || '', last_name: m.last_name || '',
          email: '', phone: '', parentName: m.profiles?.full_name || 'cuenta',
          label: `${m.full_name || ''}${m.last_name ? ' ' + m.last_name : ''}`.trim(), sub: '',
        }));
      }
      items = list;
      render();
    } catch { items = []; closeBox(); }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  input.addEventListener('blur', () => setTimeout(closeBox, 150));
}
