/* ============================================================
   Tienda — catálogo público en vivo desde Supabase.
   Renderiza los productos creados en el panel (tabla products).

   NO es un e-commerce: aquí no se paga ni se añade al carrito. Cada
   producto lleva a WhatsApp con un mensaje prellenado (producto, variante
   y precio) para que el cliente cierre la compra hablando con la escuela.
   ============================================================ */
import { supabase } from '/lib/supabase.js';

const WHATSAPP = '34636562448';

const esc = (s) => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const csv = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const uniq = (a) => [...new Set(a.filter(Boolean))];
const price = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}€`;

const root = document.getElementById('shop-root');
const filtersEl = document.getElementById('shop-filters');

let PRODUCTS = [];
let categoriaActiva = null;

/* ---------- Datos ---------- */

// El RLS ya limita al público a active/out_of_stock (migración 0029), pero se
// filtra también aquí: si algún día se afloja la policy, la web no destapa
// borradores por accidente.
async function loadProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,slug,description,price,image_url,stock,category,status,colors,sizes,gallery,sizes_stock')
    .in('status', ['active', 'out_of_stock'])
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

/* ---------- Variantes ---------- */

// sizes_stock guarda [{color,size,stock}] (ver admin/sections/productos.js).
// Puede venir vacío: entonces el producto no tiene variantes y manda `stock`.
function variantesDe(p) {
  const raw = Array.isArray(p.sizes_stock) ? p.sizes_stock : [];
  return raw
    .map(v => ({ color: v.color || '', size: v.size || '', stock: Number(v.stock) || 0 }))
    .filter(v => v.color || v.size);
}

function agotado(p) {
  if (p.status === 'out_of_stock') return true;
  const vs = variantesDe(p);
  if (vs.length) return vs.every(v => v.stock <= 0);
  return Number(p.stock) <= 0;
}

/* ---------- WhatsApp ---------- */

function enlaceWhatsapp(p, variante) {
  const partes = [];
  if (variante?.color) partes.push(variante.color);
  if (variante?.size) partes.push(`talla ${variante.size}`);
  const detalle = partes.length ? ` (${partes.join(', ')})` : '';

  const texto = `Hola! Me interesa: ${p.name}${detalle} — ${price(p.price)}. ¿Está disponible?`;
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
}

/* ---------- Tarjetas ---------- */

function tarjeta(p) {
  const sinStock = agotado(p);
  const img = p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" class="shop-card-img">`
    : `<div class="shop-card-noimg" aria-hidden="true">
         <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
           <path d="M21 15l-5-5L5 21"/>
         </svg>
       </div>`;

  const variantes = variantesDe(p);
  const colores = uniq(variantes.map(v => v.color).concat(csv(p.colors)));
  const tallas = uniq(variantes.map(v => v.size).concat(csv(p.sizes)));

  const meta = [];
  if (colores.length) meta.push(`${colores.length} color${colores.length !== 1 ? 'es' : ''}`);
  if (tallas.length) meta.push(`tallas ${tallas.slice(0, 4).join('/')}${tallas.length > 4 ? '…' : ''}`);

  return `
    <article class="shop-card${sinStock ? ' is-out' : ''}" data-product="${esc(p.id)}" tabindex="0" role="button"
             aria-label="Ver detalles de ${esc(p.name)}">
      <div class="shop-card-media">
        ${img}
        ${sinStock ? '<span class="shop-badge shop-badge--out">Agotado</span>' : ''}
        ${p.category ? `<span class="shop-badge shop-badge--cat">${esc(p.category)}</span>` : ''}
      </div>
      <div class="shop-card-body">
        <h3 class="shop-card-title">${esc(p.name)}</h3>
        ${meta.length ? `<p class="shop-card-meta">${esc(meta.join(' · '))}</p>` : ''}
        <div class="shop-card-foot">
          <span class="shop-card-price">${price(p.price)}</span>
          <span class="shop-card-cta">${sinStock ? 'Ver' : 'Consultar'}</span>
        </div>
      </div>
    </article>`;
}

/* ---------- Filtros ---------- */

function pintarFiltros() {
  const cats = uniq(PRODUCTS.map(p => p.category));
  if (cats.length < 2) { filtersEl.hidden = true; return; }

  filtersEl.hidden = false;
  filtersEl.innerHTML = [
    `<button class="shop-filter${categoriaActiva === null ? ' is-active' : ''}" data-cat="">Todo</button>`,
    ...cats.map(c => `<button class="shop-filter${categoriaActiva === c ? ' is-active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`),
  ].join('');

  filtersEl.querySelectorAll('.shop-filter').forEach(b => {
    b.addEventListener('click', () => {
      categoriaActiva = b.dataset.cat || null;
      pintarFiltros();
      pintarGrid();
    });
  });
}

function pintarGrid() {
  const lista = categoriaActiva
    ? PRODUCTS.filter(p => p.category === categoriaActiva)
    : PRODUCTS;

  if (!lista.length) {
    root.innerHTML = `<p class="shop-empty">No hay productos en esta categoría.</p>`;
    return;
  }
  root.innerHTML = lista.map(tarjeta).join('');
  root.querySelectorAll('[data-product]').forEach(el => {
    const abrir = () => abrirDetalle(el.dataset.product);
    el.addEventListener('click', abrir);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
    });
  });
}

/* ---------- Detalle ---------- */

function abrirDetalle(id) {
  const p = PRODUCTS.find(x => String(x.id) === String(id));
  if (!p) return;

  const variantes = variantesDe(p);
  const sinStock = agotado(p);
  const fotos = [p.image_url, ...csv(p.gallery)].filter(Boolean);

  // Selección actual (solo si hay variantes)
  let sel = variantes.find(v => v.stock > 0) || variantes[0] || null;

  const overlay = document.createElement('div');
  overlay.className = 'shop-overlay';
  overlay.innerHTML = `<div class="shop-modal" role="dialog" aria-modal="true" aria-label="${esc(p.name)}"></div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const modal = overlay.querySelector('.shop-modal');

  function cerrar() {
    document.body.style.overflow = '';
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) { if (e.key === 'Escape') cerrar(); }
  document.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });

  function pintar() {
    const colores = uniq(variantes.map(v => v.color));
    const tallasDe = (color) => variantes.filter(v => !color || v.color === color);

    const bloqueColores = colores.length && colores[0] ? `
      <div class="shop-var-group">
        <span class="shop-var-label">Color</span>
        <div class="shop-var-opts">
          ${colores.map(c => {
            const hay = variantes.some(v => v.color === c && v.stock > 0);
            const activo = sel?.color === c;
            return `<button class="shop-var${activo ? ' is-active' : ''}${hay ? '' : ' is-out'}"
                            data-color="${esc(c)}" ${hay ? '' : 'disabled'}>${esc(c)}</button>`;
          }).join('')}
        </div>
      </div>` : '';

    const tallas = tallasDe(sel?.color).filter(v => v.size);
    const bloqueTallas = tallas.length ? `
      <div class="shop-var-group">
        <span class="shop-var-label">Talla</span>
        <div class="shop-var-opts">
          ${tallas.map(v => {
            const activo = sel?.size === v.size && sel?.color === v.color;
            return `<button class="shop-var${activo ? ' is-active' : ''}${v.stock > 0 ? '' : ' is-out'}"
                            data-size="${esc(v.size)}" data-vcolor="${esc(v.color)}"
                            ${v.stock > 0 ? '' : 'disabled'}>${esc(v.size)}</button>`;
          }).join('')}
        </div>
      </div>` : '';

    modal.innerHTML = `
      <button class="shop-close" aria-label="Cerrar">&times;</button>
      <div class="shop-modal-grid">
        <div class="shop-modal-media">
          ${fotos.length
            ? `<img src="${esc(fotos[0])}" alt="${esc(p.name)}" class="shop-modal-img" id="shop-main-img">
               ${fotos.length > 1 ? `<div class="shop-thumbs">
                 ${fotos.map((f, i) => `<button class="shop-thumb${i === 0 ? ' is-active' : ''}" data-src="${esc(f)}">
                   <img src="${esc(f)}" alt="" loading="lazy"></button>`).join('')}
               </div>` : ''}`
            : `<div class="shop-card-noimg shop-modal-noimg" aria-hidden="true"></div>`}
        </div>
        <div class="shop-modal-info">
          ${p.category ? `<span class="shop-modal-cat">${esc(p.category)}</span>` : ''}
          <h2 class="shop-modal-title">${esc(p.name)}</h2>
          <p class="shop-modal-price">${price(p.price)}</p>
          ${sinStock ? '<p class="shop-modal-out">Ahora mismo sin stock. Escríbenos y te avisamos cuando vuelva.</p>' : ''}
          ${p.description ? `<div class="shop-modal-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
          ${bloqueColores}
          ${bloqueTallas}
          <a class="btn shop-wa" href="${enlaceWhatsapp(p, sel)}" target="_blank" rel="noopener noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
            </svg>
            <span>${sinStock ? 'Preguntar disponibilidad' : 'Consultar por WhatsApp'}</span>
          </a>
          <p class="shop-modal-note">Te responde el equipo de Waya. No se paga nada por la web.</p>
        </div>
      </div>`;

    modal.querySelector('.shop-close').addEventListener('click', cerrar);

    // Galería
    modal.querySelectorAll('.shop-thumb').forEach(t => {
      t.addEventListener('click', () => {
        modal.querySelector('#shop-main-img').src = t.dataset.src;
        modal.querySelectorAll('.shop-thumb').forEach(x => x.classList.remove('is-active'));
        t.classList.add('is-active');
      });
    });

    // Selección de color: salta a la primera talla disponible de ese color
    modal.querySelectorAll('[data-color]').forEach(b => {
      b.addEventListener('click', () => {
        const c = b.dataset.color;
        sel = variantes.find(v => v.color === c && v.stock > 0) || variantes.find(v => v.color === c);
        pintar();
      });
    });

    // Selección de talla
    modal.querySelectorAll('[data-size]').forEach(b => {
      b.addEventListener('click', () => {
        sel = variantes.find(v => v.size === b.dataset.size && v.color === b.dataset.vcolor) || sel;
        pintar();
      });
    });
  }

  pintar();
}

/* ---------- Estados ---------- */

function estadoVacio() {
  root.innerHTML = `
    <div class="shop-state">
      <h2>Estamos preparando la tienda</h2>
      <p>Todavía no hay productos publicados. Mientras tanto, si buscas material
         concreto escríbenos y te decimos qué tenemos disponible.</p>
      <a class="btn" href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent('Hola! Quería preguntar por material de surf.')}"
         target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a>
    </div>`;
}

function estadoError() {
  root.innerHTML = `
    <div class="shop-state">
      <h2>No se pudo cargar la tienda</h2>
      <p>Ha habido un problema al recuperar los productos. Inténtalo de nuevo en
         un momento o escríbenos directamente.</p>
      <a class="btn" href="https://wa.me/${WHATSAPP}" target="_blank" rel="noopener noreferrer">Escríbenos por WhatsApp</a>
    </div>`;
}

/* ---------- Arranque ---------- */

(async function init() {
  if (!root) return;
  try {
    PRODUCTS = await loadProducts();
  } catch (err) {
    console.warn('tienda:', err.message);
    estadoError();
    return;
  }
  if (!PRODUCTS.length) { estadoVacio(); return; }
  pintarFiltros();
  pintarGrid();
})();
