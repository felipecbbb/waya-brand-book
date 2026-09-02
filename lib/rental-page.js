/* ============================================================
   Rental Page — dynamic equipment from Supabase
   Card → select duration → modal (size + calendar) → add to cart
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { addItem, updateCartPill } from '/lib/cart.js';
import { pagarAhora } from '/lib/pagar.js';
import { compareSizes } from '/lib/shared-constants.js';

const DUR_LABELS = {
  '1h':'1 hora','2h':'2 horas','4h':'4 horas',
  '1d':'1 día','1w':'1 semana','2w':'2 semanas','1m':'1 mes',
};
const DUR_DAYS = { '1h':0,'2h':0,'4h':0,'1d':1,'1w':7,'2w':14,'1m':30 };

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

// Stock real por unidades: { [equipmentId]: { sizes: {talla: nDisponibles}, total: n } }
const STOCK = {};
function stockHasUnits(id) { return !!STOCK[id]; }
function stockForSize(item, size) {
  const s = STOCK[item.id];
  if (!s) return item.stock || 0;                 // ítems sin inventario por unidad (legacy)
  if (item.type === 'con_talla') return s.sizes[size] || 0;
  return s.total;                                  // básico: cuenta total de unidades disponibles
}
function stockSizes(id) {
  const s = STOCK[id];
  if (!s) return null;
  return Object.keys(s.sizes).filter(k => k && k !== 'null').sort(compareSizes);
}

function showToast(msg) {
  let t = document.querySelector('.cart-toast');
  if (!t) { t = document.createElement('div'); t.className = 'cart-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ---- Render a card (no dates, no sizes inline) ---- */
function renderCard(item) {
  const pricing = item.pricing || {};
  const deposit = item.deposit ?? 5;
  const desc = item.description || '';

  const durs = Object.entries(pricing)
    .filter(([, p]) => Number(p) > 0)
    .map(([key, price], i) => {
      const label = DUR_LABELS[key] || key;
      return `<button type="button" class="rental-dur-btn${i === 0 ? ' active' : ''}"
        data-duration="${esc(key)}" data-price="${price}" data-duration-label="${esc(label)}">
        <span class="dur-price">${price}€</span><span class="dur-label">${label}</span>
      </button>`;
    }).join('');

  const stock = stockHasUnits(item.id) ? STOCK[item.id].total : (item.stock || 0);
  const sizes = stockHasUnits(item.id) ? stockSizes(item.id) : (item.sizes || []);
  const soldOut = stock <= 0;

  return `<article class="pack-card" data-rental data-equipment-id="${item.id}">
    <div class="pack-card-header">
      <h3>${esc(item.name)}</h3>
      ${desc ? `<span class="pack-sessions">${esc(desc)}</span>` : ''}
    </div>
    <div class="rental-durations">${durs}</div>
    <div class="pack-card-details">
      <ul>
        <li>Depósito: ${deposit}€</li>
        <li>${soldOut ? 'Sin stock disponible' : `Stock: ${stock} unidades`}</li>
        ${item.type === 'con_talla' && sizes && sizes.length ? `<li>Tallas: ${sizes.map(esc).join(', ')}</li>` : ''}
      </ul>
    </div>
    <div class="pack-card-cta">
      <button class="btn red" data-add-rental ${soldOut ? 'disabled' : ''}>${soldOut ? 'Sin stock' : 'Reservar'}</button>
    </div>
  </article>`;
}

/* ---- Bind card events ---- */
function bindCard(card, item) {
  card.querySelectorAll('.rental-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.rental-dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  card.querySelector('[data-add-rental]').addEventListener('click', (e) => {
    e.preventDefault();
    const activeDur = card.querySelector('.rental-dur-btn.active');
    if (!activeDur) { showToast('Selecciona una duración'); return; }
    openRentalModal(item, activeDur.dataset.duration, Number(activeDur.dataset.price), activeDur.dataset.durationLabel);
  });
}

/* ============================================================
   MODAL — size selector + availability calendar
   ============================================================ */
export async function openRentalModal(item, durKey, durPrice, durLabel) {
  const unitSizes = stockSizes(item.id);                 // null si el ítem no usa inventario por unidad
  const sizeList = unitSizes || item.sizes || [];
  const isTalla = item.type === 'con_talla' && sizeList.length > 0;
  const durDays = DUR_DAYS[durKey] || 1;
  let stock = 1;                                          // se recalcula por talla en setStock()

  // Fetch existing reservations for this equipment (next 90 days)
  const today = new Date(); today.setHours(0,0,0,0);
  const futureDate = new Date(today); futureDate.setDate(futureDate.getDate() + 90);
  const todayStr = fmt(today);
  const futureStr = fmt(futureDate);

  let reservations = [];
  try {
    const { data } = await supabase
      .from('equipment_reservations')
      .select('date_start, date_end, quantity, size, status')
      .eq('equipment_id', item.id)
      .in('status', ['pending','confirmed','active'])
      .gte('date_end', todayStr)
      .lte('date_start', futureStr);
    reservations = data || [];
  } catch (e) { console.warn('Error fetching reservations:', e); }

  // Build modal
  const overlay = document.createElement('div');
  overlay.className = 'booking-modal';

  overlay.innerHTML = `
    <div class="booking-modal-content rental-modal">
      <div class="rental-modal-header">
        <h3>${esc(item.name)} — ${esc(durLabel)}</h3>
        <span class="rental-modal-price">${durPrice}€</span>
        <button class="rental-modal-close" aria-label="Cerrar">&times;</button>
      </div>

      ${isTalla ? `
      <div class="rental-modal-section">
        <label class="rental-modal-label">Elige tu talla</label>
        <div class="rental-size-grid">
          ${sizeList.map((s) => {
            const n = stockForSize(item, s);
            return `<button type="button" class="rental-size-btn" data-size="${esc(s)}" ${n <= 0 ? 'disabled title="Sin stock"' : ''}>${esc(s)}${n > 0 ? ` <small>(${n})</small>` : ''}</button>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="rental-modal-section">
        <label class="rental-modal-label">Selecciona fecha${durDays > 1 ? ' de inicio' : ''}</label>
        <div class="rental-cal-nav">
          <button class="rental-cal-arrow" id="rcal-prev">‹</button>
          <span class="rental-cal-month" id="rcal-title"></span>
          <button class="rental-cal-arrow" id="rcal-next">›</button>
        </div>
        <div class="rental-cal-grid" id="rcal-grid"></div>
        <div class="rental-cal-legend">
          <span><span class="rcal-dot available"></span> Disponible</span>
          <span><span class="rcal-dot unavailable"></span> No disponible</span>
          <span><span class="rcal-dot selected"></span> Seleccionado</span>
        </div>
      </div>

      <div class="rental-modal-summary" id="rental-summary" style="display:none">
        <div id="rental-summary-text"></div>
      </div>

      <button class="btn red rental-modal-confirm" id="rental-confirm" disabled>Reservar</button>
    </div>`;

  document.body.appendChild(overlay);

  // State
  let calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let selectedDate = null;
  let selectedSize = isTalla ? (sizeList.find(s => stockForSize(item, s) > 0) || sizeList[0]) : null;

  function setStock() { stock = isTalla ? stockForSize(item, selectedSize) : (stockHasUnits(item.id) ? STOCK[item.id].total : (item.stock || 0)); }
  setStock();
  // Marca la talla inicial activa
  if (isTalla && selectedSize) {
    const initBtn = overlay.querySelector(`.rental-size-btn[data-size="${CSS.escape(selectedSize)}"]`);
    if (initBtn) initBtn.classList.add('active');
  }

  // Close
  const close = () => overlay.remove();
  overlay.querySelector('.rental-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Size buttons
  if (isTalla) {
    overlay.querySelectorAll('.rental-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        overlay.querySelectorAll('.rental-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSize = btn.dataset.size;
        setStock();        // stock de la talla elegida
        selectedDate = null;
        renderCalendar();  // re-check availability for this size
        updateSummary();
      });
    });
  }

  // Calendar navigation
  overlay.querySelector('#rcal-prev').addEventListener('click', () => {
    calMonth.setMonth(calMonth.getMonth() - 1);
    renderCalendar();
  });
  overlay.querySelector('#rcal-next').addEventListener('click', () => {
    calMonth.setMonth(calMonth.getMonth() + 1);
    renderCalendar();
  });

  // Calculate availability for a given date
  function getBookedCount(dateStr) {
    let count = 0;
    const d = new Date(dateStr + 'T00:00:00');
    for (const r of reservations) {
      const rs = new Date(r.date_start + 'T00:00:00');
      const re = new Date(r.date_end + 'T00:00:00');
      // If size matters and doesn't match, skip
      if (isTalla && selectedSize && r.size && r.size !== selectedSize) continue;
      if (d >= rs && d <= re) count += (r.quantity || 1);
    }
    return count;
  }

  function isRangeAvailable(startStr) {
    if (durDays <= 0) {
      // Hourly rental — just check the single day
      return getBookedCount(startStr) < stock;
    }
    const start = new Date(startStr + 'T00:00:00');
    for (let i = 0; i < durDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      if (getBookedCount(fmt(d)) >= stock) return false;
    }
    return true;
  }

  function renderCalendar() {
    const grid = overlay.querySelector('#rcal-grid');
    const title = overlay.querySelector('#rcal-title');
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    title.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const offset = (firstDay + 6) % 7; // Monday first
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = '<div class="rcal-weekdays"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="rcal-days">';

    for (let i = 0; i < offset; i++) html += '<span class="rcal-day empty"></span>';

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const ds = fmt(d);
      const isPast = d < today;
      const available = !isPast && isRangeAvailable(ds);
      const isSelected = selectedDate === ds;

      let cls = 'rcal-day';
      if (isPast) cls += ' past';
      else if (!available) cls += ' unavailable';
      else cls += ' available';
      if (isSelected) cls += ' selected';

      // If selected and multi-day, highlight the range
      let isInRange = false;
      if (selectedDate && durDays > 1 && !isPast) {
        const selStart = new Date(selectedDate + 'T00:00:00');
        const selEnd = new Date(selStart); selEnd.setDate(selEnd.getDate() + durDays - 1);
        if (d >= selStart && d <= selEnd) isInRange = true;
      }
      if (isInRange && !isSelected) cls += ' in-range';

      html += `<span class="${cls}" data-date="${ds}" ${available && !isPast ? '' : 'data-disabled'}>${day}</span>`;
    }

    html += '</div>';
    grid.innerHTML = html;

    // Click days
    grid.querySelectorAll('.rcal-day.available:not([data-disabled])').forEach(el => {
      el.addEventListener('click', () => {
        selectedDate = el.dataset.date;
        renderCalendar();
        updateSummary();
      });
    });
  }

  function updateSummary() {
    const summary = overlay.querySelector('#rental-summary');
    const text = overlay.querySelector('#rental-summary-text');
    const btn = overlay.querySelector('#rental-confirm');

    if (!selectedDate) {
      summary.style.display = 'none';
      btn.disabled = true;
      return;
    }

    const start = new Date(selectedDate + 'T00:00:00');
    let endDate;
    if (durDays <= 0) {
      endDate = new Date(start);
    } else {
      endDate = new Date(start);
      endDate.setDate(endDate.getDate() + durDays - 1);
    }

    const fmtEs = d => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

    let lines = `<strong>${esc(item.name)}</strong> — ${esc(durLabel)}`;
    if (selectedSize) lines += ` · Talla: ${esc(selectedSize)}`;
    if (durDays > 1) {
      lines += `<br>${fmtEs(start)} → ${fmtEs(endDate)}`;
    } else if (durDays === 1) {
      lines += `<br>${fmtEs(start)}`;
    } else {
      lines += `<br>${fmtEs(start)} (${esc(durLabel)})`;
    }
    lines += `<br><strong>${durPrice}€</strong>`;

    lines += `<br><span class="rental-deposit-detail">Pago seguro con tarjeta · reserva confirmada al instante</span>`;

    text.innerHTML = lines;
    summary.style.display = '';
    btn.disabled = false;
    btn.textContent = 'Reservar y pagar';
  }

  // Confirm button
  overlay.querySelector('#rental-confirm').addEventListener('click', (ev) => {
    if (!selectedDate) return;
    const confirmBtn = ev.currentTarget;
    const start = new Date(selectedDate + 'T00:00:00');
    const endDate = new Date(start);
    if (durDays > 0) endDate.setDate(endDate.getDate() + durDays - 1);

    // Directo a la pasarela, sin pasar por el carrito. El precio que va aquí
    // es solo informativo: el servidor lo recalcula desde la base de datos.
    pagarAhora({
      id: `rental-${item.slug}-${durKey}-${selectedDate}`,
      type: 'rental',
      name: `${item.name} — ${durLabel}`,
      price: durPrice,
      quantity: 1,
      metadata: {
        item: item.name,
        equipmentId: item.id,
        duration: durKey,
        dateStart: selectedDate,
        dateEnd: fmt(endDate),
        size: selectedSize || null,
        totalAmount: durPrice,
      },
    }, { boton: confirmBtn });
  });

  // Initial render
  renderCalendar();
}

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---- Carga de equipo + stock (reutilizable) ---- */
export async function loadRentalEquipment() {
  // Stock real basado en unidades de inventario disponibles
  try {
    const { data: stockRows } = await supabase.rpc('get_rental_stock');
    (stockRows || []).forEach(r => {
      const e = STOCK[r.equipment_id] || (STOCK[r.equipment_id] = { sizes: {}, total: 0 });
      e.sizes[r.size == null ? 'null' : r.size] = r.available;
      e.total += r.available;
    });
  } catch (e) { console.warn('get_rental_stock:', e); }

  const { data, error } = await supabase
    .from('rental_equipment')
    .select('*')
    .eq('active', true)
    .order('created_at');

  if (error) { console.error('Error loading rental equipment:', error); return []; }
  return data || [];
}

/* ---- Init (páginas con .pack-grid dinámico, estilo Entreolas) ---- */
async function init() {
  const grid = document.querySelector('.pack-grid');
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;padding:24px;color:#666">Cargando material...</p>';
  const data = await loadRentalEquipment();
  if (!data.length) { grid.innerHTML = '<p style="text-align:center;padding:24px">No hay material disponible</p>'; return; }
  grid.innerHTML = data.map(renderCard).join('');
  grid.querySelectorAll('.pack-card[data-rental]').forEach((card, i) => bindCard(card, data[i]));
}

init();
