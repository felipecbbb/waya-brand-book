/* ============================================================
   Noticias Section — publicar en /blog.html desde el panel.
   Lee la tabla posts directamente (es pública) y escribe vía
   /noticias.php (la tabla solo deja escribir a info@wayasurf.com
   por RLS; el PHP comprueba que eres staff y usa la service_role).

   El texto se escribe en llano, sin HTML:
     - línea en blanco  → párrafo nuevo
     - "## Algo"        → subtítulo
     - **algo**         → negrita
   y se guarda como HTML (es lo que pinta blog-engine.js).
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { showToast } from '../modules/ui.js';

const esc = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';

// Las categorías las limita la tabla (posts_category_chk).
const CATEGORIES = [
  { value: 'THOUGHTS', label: 'Opinión / Novedades' },
  { value: 'CULTURE', label: 'Cultura surf' },
  { value: 'PEOPLE', label: 'Gente / Comunidad' },
  { value: 'GEAR', label: 'Material' },
  { value: 'TRAVEL', label: 'Viajes / Surfcamps' },
];

async function api(cuerpo) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sin sesión');
  const res = await fetch('/noticias.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(cuerpo),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Error ${res.status}`);
  return out;
}

/* ---- Texto llano ⇄ HTML ---- */
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function textoAHtml(texto) {
  return String(texto || '').trim().split(/\n\s*\n/).map(bloque => {
    const b = bloque.trim();
    if (!b) return '';
    if (b.startsWith('## ')) return `<h2>${inline(b.slice(3).trim())}</h2>`;
    return `<p>${b.split('\n').map(inline).join('<br>')}</p>`;
  }).join('\n');
}
function htmlATexto(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const bloques = [];
  const plano = el => {
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeName === 'BR') out += '\n';
      else if (n.nodeName === 'STRONG' || n.nodeName === 'B') out += `**${plano(n)}**`;
      else out += plano(n);
    });
    return out;
  };
  doc.body.firstChild.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent.trim()) bloques.push(n.textContent.trim()); return; }
    const txt = plano(n).trim();
    if (!txt) return;
    if (/^H[2-6]$/.test(n.nodeName)) bloques.push('## ' + txt);
    else if (n.nodeName === 'UL' || n.nodeName === 'OL') bloques.push([...n.querySelectorAll('li')].map(li => '- ' + plano(li).trim()).join('\n'));
    else bloques.push(txt);
  });
  return bloques.join('\n\n');
}

/* ---- Foto: se reduce en el navegador antes de subirla ---- */
function reducirFoto(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export async function renderNoticias(container) {
  let posts = [];

  async function cargar() {
    const { data, error } = await supabase.from('posts')
      .select('id,title,excerpt,content,image,category,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    posts = data || [];
  }

  async function renderList() {
    try { await cargar(); } catch (err) { container.innerHTML = `<p style="padding:24px">No se pudieron cargar las noticias: ${esc(err.message)}</p>`; return; }

    container.innerHTML = `
      <div class="sc-header">
        <span class="sc-count">${posts.length} noticia${posts.length !== 1 ? 's' : ''} publicada${posts.length !== 1 ? 's' : ''}</span>
        <div style="display:flex;gap:10px">
          <a href="/blog.html" target="_blank" class="act-action-btn" style="text-decoration:none">Ver en la web</a>
          <button class="sc-new-btn" id="nt-new">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva noticia
          </button>
        </div>
      </div>
      ${posts.length ? `
        <div style="display:grid;gap:12px;margin-top:16px">
          ${posts.map(p => `
            <div class="act-form-card" style="display:flex;gap:16px;align-items:center;padding:14px">
              <div style="width:96px;height:64px;border-radius:10px;flex:0 0 96px;background:#f1f1f1 center/cover no-repeat;${p.image ? `background-image:url('${esc(p.image)}')` : ''}"></div>
              <div style="flex:1;min-width:0">
                <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</strong>
                <small style="color:var(--color-muted)">${fmtDate(p.created_at)} · ${esc(CATEGORIES.find(c => c.value === p.category)?.label || p.category || '')}</small>
              </div>
              <a class="cp-action-btn" href="/noticia.html?id=${p.id}" target="_blank" title="Ver">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </a>
              <button class="cp-action-btn" data-edit="${p.id}" title="Editar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="cp-action-btn cp-action-danger" data-del="${p.id}" title="Borrar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>`).join('')}
        </div>` : `
        <div class="sc-empty"><p>Aún no hay noticias. Crea la primera.</p></div>`}`;

    container.querySelector('#nt-new').onclick = () => renderForm(null);
    container.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => renderForm(posts.find(p => String(p.id) === b.dataset.edit)));
    container.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const p = posts.find(x => String(x.id) === b.dataset.del);
      if (!p || !confirm(`¿Borrar la noticia "${p.title}"? No se puede deshacer.`)) return;
      try { await api({ accion: 'borrar', id: p.id }); showToast('Noticia borrada', 'success'); renderList(); }
      catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  function renderForm(post) {
    const p = post || {};
    let imagen = p.image || '';

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="nt-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${post ? 'Editar noticia' : 'Nueva noticia'}</strong>
          </div>
        </div>

        <div style="max-width:760px;padding:24px 0">
          <div class="act-form-card">
            <div class="act-form-field">
              <label class="act-form-label">TÍTULO</label>
              <input type="text" class="act-form-input" id="nt-title" maxlength="140" value="${esc(p.title || '')}" placeholder="Ej: Abrimos inscripciones para el surfcamp de Marruecos" />
            </div>
            <div class="act-form-field" style="margin-top:14px">
              <label class="act-form-label">RESUMEN <small style="font-weight:400;text-transform:none">(sale en la tarjeta del listado · <span id="nt-ex-count">0</span>/320)</small></label>
              <textarea class="act-form-input" id="nt-excerpt" maxlength="320" rows="3" placeholder="Una o dos frases que enganchen.">${esc(p.excerpt || '')}</textarea>
            </div>
            <div class="act-form-field" style="margin-top:14px">
              <label class="act-form-label">CATEGORÍA</label>
              <select class="act-form-input" id="nt-category">
                ${CATEGORIES.map(c => `<option value="${c.value}" ${(p.category || 'THOUGHTS') === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <label class="act-form-label">FOTO DE PORTADA</label>
            <div style="display:flex;gap:16px;align-items:center;margin-top:8px;flex-wrap:wrap">
              <div id="nt-img-prev" style="width:200px;height:120px;border-radius:12px;background:#f1f1f1 center/cover no-repeat;display:grid;place-items:center;color:#999;font-size:.8rem">Sin foto</div>
              <div style="display:flex;flex-direction:column;gap:8px">
                <label class="act-action-btn primary" style="cursor:pointer">
                  <input type="file" id="nt-file" accept="image/*" style="display:none" />
                  <span id="nt-file-label">Subir foto</span>
                </label>
                <button class="act-action-btn" id="nt-img-clear" type="button">Quitar foto</button>
              </div>
            </div>
          </div>

          <div class="act-form-card" style="margin-top:16px">
            <label class="act-form-label">TEXTO DE LA NOTICIA</label>
            <small class="act-form-hint" style="display:block;margin:4px 0 8px">
              Deja una <strong>línea en blanco</strong> entre párrafos · empieza una línea con <code>## </code> para un subtítulo · <code>**así**</code> para negrita.
            </small>
            <textarea class="act-form-input" id="nt-content" rows="16" style="font-family:inherit;line-height:1.5">${esc(htmlATexto(p.content || ''))}</textarea>
          </div>

          <div style="display:flex;gap:12px;margin-top:24px">
            <button class="act-action-btn primary" id="nt-save">${post ? 'Guardar cambios' : 'Publicar noticia'}</button>
            <button class="act-action-btn" id="nt-cancel">Cancelar</button>
          </div>
        </div>
      </div>`;

    const $ = id => container.querySelector('#' + id);
    const pintarImagen = () => {
      const prev = $('nt-img-prev');
      prev.style.backgroundImage = imagen ? `url('${imagen}')` : '';
      prev.textContent = imagen ? '' : 'Sin foto';
      $('nt-img-clear').style.display = imagen ? '' : 'none';
    };
    const contar = () => { $('nt-ex-count').textContent = $('nt-excerpt').value.length; };
    pintarImagen(); contar();

    $('nt-excerpt').addEventListener('input', contar);
    $('nt-back').onclick = $('nt-cancel').onclick = () => renderList();
    $('nt-img-clear').onclick = () => { imagen = ''; pintarImagen(); };
    $('nt-file').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const label = $('nt-file-label');
      label.textContent = 'Subiendo…';
      try {
        const data = await reducirFoto(file);
        const out = await api({ accion: 'foto', data, ext: 'jpg' });
        imagen = out.url;
        pintarImagen();
      } catch (err) {
        showToast('No se pudo subir la foto: ' + err.message, 'error');
      } finally {
        label.textContent = 'Subir foto';
        e.target.value = '';
      }
    };

    $('nt-save').onclick = async (e) => {
      const title = $('nt-title').value.trim();
      const texto = $('nt-content').value.trim();
      if (title.length < 3) { showToast('Pon un título (mínimo 3 letras)', 'error'); return; }
      if (!texto) { showToast('Escribe el texto de la noticia', 'error'); return; }
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        await api({
          accion: 'guardar',
          id: p.id || null,
          title,
          excerpt: $('nt-excerpt').value.trim(),
          category: $('nt-category').value,
          content: textoAHtml(texto),
          image: imagen,
        });
        showToast(post ? 'Noticia actualizada' : 'Noticia publicada', 'success');
        renderList();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = post ? 'Guardar cambios' : 'Publicar noticia';
      }
    };
  }

  await renderList();
}
