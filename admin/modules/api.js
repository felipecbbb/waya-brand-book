/* ============================================================
   API Helpers — Supabase queries for Admin Panel
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { getPackPrice, bonoExpected, classPrice, loadPricing } from '/lib/domain/pricing.js';

// ---- Simple query cache (30s TTL) ----
const _cache = {};
function cached(key, ttl, fn) {
  return async (...args) => {
    const k = key + JSON.stringify(args);
    const entry = _cache[k];
    if (entry && Date.now() - entry.ts < ttl) return entry.data;
    const data = await fn(...args);
    _cache[k] = { data, ts: Date.now() };
    return data;
  };
}
export function invalidateCache(prefix) {
  for (const k in _cache) {
    if (!prefix || k.startsWith(prefix)) delete _cache[k];
  }
}

// ---- Stats ----
export async function fetchStats() {
  const [bookings, camps, classes, orders] = await Promise.all([
    supabase.from('bookings').select('id, total_amount, deposit_amount, status'),
    supabase.from('surf_camps').select('id, status, date_start').gte('date_start', new Date().toISOString().slice(0, 10)),
    supabase.from('surf_classes').select('id, status').eq('status', 'scheduled'),
    supabase.from('orders').select('id, total, status')
  ]);

  const totalBookings = bookings.data?.length || 0;
  const upcomingCamps = camps.data?.length || 0;
  const scheduledClasses = classes.data?.length || 0;

  // Solo cuenta lo realmente cobrado: total si está pagado entero, señal si solo hay señal
  const revenue = (bookings.data || [])
    .filter(b => ['deposit_paid', 'fully_paid'].includes(b.status))
    .reduce((sum, b) => sum + Number((b.status === 'fully_paid' ? b.total_amount : b.deposit_amount) || 0), 0);

  const orderRevenue = (orders.data || [])
    .filter(o => ['paid', 'shipped', 'delivered'].includes(o.status))
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  return { totalBookings, upcomingCamps, scheduledClasses, revenue: revenue + orderRevenue };
}

// ---- Dashboard Stats (full, with date range) ----
export async function fetchDashboardStats(dateFrom, dateTo) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Helper: run query and log errors instead of silently swallowing them
  async function safeQuery(label, queryPromise) {
    const result = await queryPromise;
    if (result.error) {
      console.warn(`Dashboard query [${label}] failed:`, result.error.message);
      return [];
    }
    return result.data || [];
  }

  try {
    const [payments, bookings, orders, classes, enrollments, bonos, equipment, futureCamps, futureClasses] = await Promise.all([
      // Payments (the single source of truth for money)
      safeQuery('payments', supabase.from('payments').select('id, amount, payment_method, payment_date, reservation_type, reference_id')
        .gte('payment_date', dateFrom).lte('payment_date', dateTo + 'T23:59:59')),
      // Bookings (camps)
      safeQuery('bookings', supabase.from('bookings').select('id, total_amount, status, created_at')
        .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')),
      // Orders (shop)
      safeQuery('orders', supabase.from('orders').select('id, total, status, created_at')
        .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')),
      // Classes in range
      safeQuery('classes', supabase.from('surf_classes').select('id, type, date, max_students, enrolled_count, status')
        .gte('date', dateFrom).lte('date', dateTo)),
      // Enrollments in range (via created_at)
      safeQuery('enrollments', supabase.from('class_enrollments').select('id, class_id, status, bono_id, created_at')
        .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')),
      // Bonos created in range
      safeQuery('bonos', supabase.from('bonos').select('id, class_type, total_credits, used_credits, total_paid, status, created_at')
        .gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')),
      // Equipment reservations
      safeQuery('equipment', supabase.from('equipment_reservations').select('id, total_amount, deposit_paid, status, date_start')
        .gte('date_start', dateFrom).lte('date_start', dateTo + 'T23:59:59')),
      // Upcoming camps (always future)
      safeQuery('futureCamps', supabase.from('surf_camps').select('id, title, date_start, status, max_spots, spots_taken')
        .gte('date_start', todayStr)),
      // Scheduled classes (always future)
      safeQuery('futureClasses', supabase.from('surf_classes').select('id').eq('status', 'scheduled')
        .gte('date', todayStr)),
    ]);

    return { payments, bookings, orders, classes, enrollments, bonos, equipment, futureCamps, futureClasses };
  } catch (err) {
    console.error('fetchDashboardStats error:', err);
    return { payments: [], bookings: [], orders: [], classes: [], enrollments: [], bonos: [], equipment: [], futureCamps: [], futureClasses: [] };
  }
}

// ---- Dashboard operativo (sin importes ni agregados sensibles) ----
// Vista del día y próximos 7 días: clases con alumnos, alquileres activos, camps próximos.
export async function fetchDashboardOperational() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = fmt(today);
  const in7 = new Date(today); in7.setDate(today.getDate() + 7);
  const in7Str = fmt(in7);

  async function safe(label, q) {
    const r = await q;
    if (r.error) { console.warn(`Dashboard op [${label}]:`, r.error.message); return []; }
    return r.data || [];
  }

  // 1) Clases de hoy (con conteo de inscritos básico desde surf_classes)
  const todayClasses = await safe('todayClasses', supabase
    .from('surf_classes')
    .select('id, type, title, date, time_start, time_end, max_students, enrolled_count, status, level')
    .eq('date', todayStr)
    .order('time_start', { ascending: true }));

  // 2) Inscripciones de las clases de hoy (con nombres de alumnos)
  let todayEnrollments = [];
  if (todayClasses.length) {
    const classIds = todayClasses.map(c => c.id);
    todayEnrollments = await safe('todayEnrollments', supabase
      .from('class_enrollments')
      .select('id, class_id, status, guest_name, profiles(full_name), family_members(full_name)')
      .in('class_id', classIds));
  }

  // 3) Alquileres activos hoy (empezaron hoy o antes y aún no terminaron)
  const activeRentals = await safe('activeRentals', supabase
    .from('equipment_reservations')
    .select('id, status, date_start, date_end, guest_name, duration_key, rental_equipment(name, type), profiles:user_id(full_name)')
    .lte('date_start', todayStr)
    .gte('date_end', todayStr)
    .in('status', ['confirmed', 'active'])
    .order('date_end', { ascending: true }));

  // 4) Próximos 7 días — clases
  const upcomingClasses = await safe('upcomingClasses', supabase
    .from('surf_classes')
    .select('id, type, date, time_start, time_end, max_students, enrolled_count, status')
    .gt('date', todayStr)
    .lte('date', in7Str)
    .eq('status', 'scheduled')
    .order('date', { ascending: true })
    .order('time_start', { ascending: true }));

  // 5) Próximos 7 días — alquileres que empiezan
  const upcomingRentals = await safe('upcomingRentals', supabase
    .from('equipment_reservations')
    .select('id, status, date_start, date_end, guest_name, rental_equipment(name, type), profiles:user_id(full_name)')
    .gt('date_start', todayStr)
    .lte('date_start', in7Str)
    .in('status', ['pending', 'confirmed'])
    .order('date_start', { ascending: true }));

  // 6) Próximos camps (3 más cercanos)
  const upcomingCamps = await safe('upcomingCamps', supabase
    .from('surf_camps')
    .select('id, title, slug, date_start, date_end, max_spots, spots_taken, status')
    .gte('date_start', todayStr)
    .order('date_start', { ascending: true })
    .limit(3));

  return { todayClasses, todayEnrollments, activeRentals, upcomingClasses, upcomingRentals, upcomingCamps };
}

// ---- Eliminar reservas (con sus pagos asociados) ----
const ENTITY_TABLE = {
  booking: 'bookings',
  rental: 'equipment_reservations',
  order: 'orders',
  bono: 'bonos',
  enrollment: 'class_enrollments',
};
const ENTITY_PAYMENT_TYPE = {
  booking: 'booking',
  rental: 'rental',
  order: 'order',
  bono: ['bono', 'enrollment'], // pagos del bono pueden estar como 'enrollment'
  enrollment: 'enrollment',
};

export async function deleteReservationFully(entity, id) {
  const table = ENTITY_TABLE[entity];
  if (!table) throw new Error(`Entidad desconocida: ${entity}`);

  // 1) borrar payments asociados (no hay FK, hay que hacerlo a mano)
  if (entity === 'bono') {
    // Pagos del propio bono (reservation_type='bono', reference_id=bono_id)
    await supabase.from('payments').delete().eq('reservation_type', 'bono').eq('reference_id', id);
    // Pagos de inscripción de este bono: su reference_id es el enrollment_id (no el bono_id),
    // así que hay que resolver los enrollment_id ANTES de que el ON DELETE CASCADE borre las
    // inscripciones; si no, esos pagos quedarían huérfanos.
    const { data: enrolls } = await supabase.from('class_enrollments').select('id').eq('bono_id', id);
    const eids = (enrolls || []).map(e => e.id);
    if (eids.length) {
      await supabase.from('payments').delete().eq('reservation_type', 'enrollment').in('reference_id', eids);
    }
  } else {
    const types = ENTITY_PAYMENT_TYPE[entity];
    if (Array.isArray(types)) {
      await supabase.from('payments').delete().in('reservation_type', types).eq('reference_id', id);
    } else {
      await supabase.from('payments').delete().eq('reservation_type', types).eq('reference_id', id);
    }
  }

  // 2) borrar la reserva en sí (las inscripciones del bono caen por FK on delete cascade)
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// Fusiona dos fichas de cliente duplicadas: reasigna TODO lo de `dropId` al `keepId`
// (reservas, bonos, inscripciones, alquileres, familiares, pedidos) y borra la ficha
// duplicada. Devuelve un resumen de lo movido. (La cuenta auth huérfana queda sin
// ficha → invisible en el panel; su limpieza definitiva es aparte.)
// Normalizadores para detectar/deduplicar (sin tildes, espacios colapsados).
const _nn = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const _nphone = s => String(s == null ? '' : s).replace(/\D/g, '');

// Detecta grupos de fichas de cliente duplicadas: agrupa por email, teléfono o
// nombre+apellido iguales (union-find, así una ficha que coincide por varias claves
// cae en el mismo grupo). Devuelve array de grupos (cada grupo = array de perfiles, >1).
export async function findDuplicateProfiles() {
  const profiles = await fetchProfiles();
  const parent = {};
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  profiles.forEach(p => { parent[p.id] = p.id; });
  const byKey = {};
  profiles.forEach(p => {
    const keys = [];
    const em = (p.email || '').trim().toLowerCase(); if (em) keys.push('e:' + em);
    const ph = _nphone(p.phone); if (ph.length >= 6) keys.push('p:' + ph);
    const nm = _nn(`${p.full_name || ''} ${p.last_name || ''}`); if (nm) keys.push('n:' + nm);
    keys.forEach(k => { if (byKey[k]) union(p.id, byKey[k]); else byKey[k] = p.id; });
  });
  const comps = {};
  profiles.forEach(p => { const r = find(p.id); (comps[r] ||= []).push(p); });
  return Object.values(comps)
    .filter(g => g.length > 1)
    .map(g => g.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
}

export async function mergeClients(keepId, dropId) {
  if (!keepId || !dropId) throw new Error('Faltan fichas');
  if (keepId === dropId) throw new Error('Son la misma ficha');

  // Familiares CON dedupe: si el que se queda ya tiene ese niño (mismo nombre
  // normalizado), las clases del duplicado se reapuntan a ese y se borra el duplicado
  // → A no acaba con "2 Borja". Los demás familiares se reasignan normal.
  try {
    const [{ data: keepFam }, { data: dropFam }] = await Promise.all([
      supabase.from('family_members').select('id, full_name, last_name').eq('user_id', keepId),
      supabase.from('family_members').select('id, full_name, last_name').eq('user_id', dropId),
    ]);
    const keepByName = {};
    (keepFam || []).forEach(m => { keepByName[_nn(`${m.full_name || ''} ${m.last_name || ''}`)] = m.id; });
    for (const m of (dropFam || [])) {
      const key = _nn(`${m.full_name || ''} ${m.last_name || ''}`);
      if (keepByName[key]) {
        await supabase.from('class_enrollments').update({ user_id: keepId, family_member_id: keepByName[key] }).eq('family_member_id', m.id);
        await supabase.from('family_members').delete().eq('id', m.id);
      } else {
        await supabase.from('family_members').update({ user_id: keepId }).eq('id', m.id);
        keepByName[key] = m.id;
      }
    }
  } catch (e) { throw new Error(`Al fusionar familiares: ${e.message}`); }

  // TODAS las tablas con user_id que referencian a un cliente (incluidas las legacy
  // class_bookings/equipment_rentals que tienen ON DELETE CASCADE → si NO se reasignan,
  // el DELETE del perfil las borraría). Se reasignan ANTES de borrar para no perder datos.
  const tables = ['bookings', 'class_bookings', 'equipment_rentals', 'equipment_reservations', 'bonos', 'class_enrollments', 'orders'];
  const moved = {};
  const missing = (msg) => /does not exist|relation .* does not exist|could not find/i.test(msg || '');
  for (const t of tables) {
    try {
      const { data, error } = await supabase.from(t).update({ user_id: keepId }).eq('user_id', dropId).select('id');
      if (error) { if (missing(error.message)) continue; throw new Error(`Al mover ${t}: ${error.message}`); }
      if ((data || []).length) moved[t] = data.length;
    } catch (e) { if (missing(e.message)) continue; throw e; }
  }
  // Pagos 'custom' (deuda manual): reference_id = user_id (no es FK → quedarían huérfanos).
  try { await supabase.from('payments').update({ reference_id: keepId }).eq('reservation_type', 'custom').eq('reference_id', dropId); } catch {}
  // Borra la ficha duplicada (ya no le cuelga nada → el cascade no borra datos reales).
  const { error: delErr } = await supabase.from('profiles').delete().eq('id', dropId);
  if (delErr) throw new Error(`Datos movidos, pero no se pudo borrar la ficha duplicada: ${delErr.message}`);
  invalidateCache('profiles'); invalidateCache('bookings');
  return moved;
}

// ---- Papelera (soft-delete con restaurar) ----
// Archiva una instantánea completa (fila + pagos + inscripciones) en deleted_items y
// LUEGO borra de verdad. Restaurar reinserta todo. Soporta 'bono' y 'booking'.
export async function moveToTrash(entityType, id, label) {
  const snapshot = {};
  if (entityType === 'bono') {
    const { data: row } = await supabase.from('bonos').select('*').eq('id', id).single();
    const { data: enrolls } = await supabase.from('class_enrollments').select('*').eq('bono_id', id);
    const eids = (enrolls || []).map(e => e.id);
    const { data: bonoPays } = await supabase.from('payments').select('*').eq('reservation_type', 'bono').eq('reference_id', id);
    let enrollPays = [];
    if (eids.length) { const { data } = await supabase.from('payments').select('*').eq('reservation_type', 'enrollment').in('reference_id', eids); enrollPays = data || []; }
    snapshot.row = row; snapshot.enrollments = enrolls || []; snapshot.payments = [...(bonoPays || []), ...enrollPays];
  } else if (entityType === 'booking') {
    const { data: row } = await supabase.from('bookings').select('*').eq('id', id).single();
    const { data: pays } = await supabase.from('payments').select('*').eq('reservation_type', 'booking').eq('reference_id', id);
    snapshot.row = row; snapshot.payments = pays || [];
  } else {
    throw new Error(`Papelera no soporta: ${entityType}`);
  }
  if (!snapshot.row) throw new Error('No se encontró el elemento a eliminar');
  const { error: insErr } = await supabase.from('deleted_items').insert({ entity_type: entityType, entity_id: id, label: label || null, snapshot });
  if (insErr) throw insErr;
  await deleteReservationFully(entityType, id);
  invalidateCache('bookings');
}

export async function fetchTrash({ includeRestored = false } = {}) {
  let q = supabase.from('deleted_items').select('*').order('deleted_at', { ascending: false });
  if (!includeRestored) q = q.is('restored_at', null);
  const { data, error } = await q;
  if (error) { console.warn('fetchTrash:', error.message); return []; }
  return data || [];
}

export async function restoreFromTrash(trashId) {
  const { data: item, error } = await supabase.from('deleted_items').select('*').eq('id', trashId).single();
  if (error || !item) throw new Error('No se encontró el elemento en la papelera');
  if (item.restored_at) throw new Error('Este elemento ya fue restaurado');
  const snap = item.snapshot || {};
  if (item.entity_type === 'bono') {
    if (snap.row) { const { error: e } = await supabase.from('bonos').insert(snap.row); if (e) throw e; }
    if (snap.enrollments?.length) await supabase.from('class_enrollments').insert(snap.enrollments);
    if (snap.payments?.length) await supabase.from('payments').insert(snap.payments);
  } else if (item.entity_type === 'booking') {
    if (snap.row) { const { error: e } = await supabase.from('bookings').insert(snap.row); if (e) throw e; }
    if (snap.payments?.length) await supabase.from('payments').insert(snap.payments);
  } else {
    throw new Error(`Papelera no soporta restaurar: ${item.entity_type}`);
  }
  await supabase.from('deleted_items').update({ restored_at: new Date().toISOString() }).eq('id', trashId);
  invalidateCache('bookings');
}

// ---- Pagos con filtros (channel, método, tipo, rango) ----
export async function fetchPaymentsFiltered({ dateFrom, dateTo, channel, paymentMethod, reservationType } = {}) {
  let q = supabase.from('payments')
    .select('id, amount, payment_method, channel, payment_date, reservation_type, reference_id, concept')
    .order('payment_date', { ascending: false });
  if (dateFrom) q = q.gte('payment_date', dateFrom);
  if (dateTo)   q = q.lte('payment_date', dateTo + 'T23:59:59');
  if (channel && channel !== 'all') q = q.eq('channel', channel);
  if (paymentMethod && paymentMethod !== 'all') q = q.eq('payment_method', paymentMethod);
  if (reservationType && reservationType !== 'all') q = q.eq('reservation_type', reservationType);
  const { data, error } = await q;
  if (error) { console.warn('fetchPaymentsFiltered:', error.message); return []; }
  return data || [];
}

// Mapa de cómo obtener el cliente para cada reservation_type.
// payments no tiene user_id → hay que ir a la tabla origen por reference_id.
const PAYMENT_CLIENT_SOURCES = {
  booking:    { table: 'bookings',                userCol: 'user_id', guestCol: 'guest_name' },
  rental:     { table: 'equipment_reservations',  userCol: 'user_id', guestCol: 'guest_name' },
  order:      { table: 'orders',                  userCol: 'user_id', guestCol: null },
  bono:       { table: 'bonos',                   userCol: 'user_id', guestCol: null },
  enrollment: { table: 'class_enrollments',       userCol: 'user_id', guestCol: 'guest_name' },
};

// Enriquece una lista de payments con client_name y client_email.
// Hace queries en bulk: una por tabla origen + una a profiles.
export async function enrichPaymentsWithClient(payments) {
  if (!payments?.length) return [];

  // Agrupa references por reservation_type
  const byType = {};
  payments.forEach(p => {
    const t = p.reservation_type;
    if (!PAYMENT_CLIENT_SOURCES[t]) return;
    (byType[t] = byType[t] || new Set()).add(p.reference_id);
  });

  // ref_id → { client_name, client_email }
  const clientByRef = {};
  const userIdsToFetch = new Set();
  const guestByRef = {}; // ref_id → guest_name (cuando no hay user_id)

  await Promise.all(Object.entries(byType).map(async ([type, refIds]) => {
    const cfg = PAYMENT_CLIENT_SOURCES[type];
    const cols = ['id', cfg.userCol, cfg.guestCol].filter(Boolean).join(', ');
    const { data } = await supabase.from(cfg.table).select(cols).in('id', [...refIds]);
    (data || []).forEach(row => {
      if (row[cfg.userCol]) {
        userIdsToFetch.add(row[cfg.userCol]);
        clientByRef[row.id] = { user_id: row[cfg.userCol] };
      } else if (cfg.guestCol && row[cfg.guestCol]) {
        guestByRef[row.id] = row[cfg.guestCol];
      }
    });
  }));

  // Profiles bulk
  let profilesById = {};
  if (userIdsToFetch.size) {
    const { data } = await supabase.from('profiles')
      .select('id, full_name, email')
      .in('id', [...userIdsToFetch]);
    (data || []).forEach(p => { profilesById[p.id] = p; });
  }

  return payments.map(p => {
    const ref = clientByRef[p.reference_id];
    if (ref) {
      const prof = profilesById[ref.user_id];
      return { ...p, client_name: prof?.full_name || 'Cliente', client_email: prof?.email || null };
    }
    if (guestByRef[p.reference_id]) {
      return { ...p, client_name: guestByRef[p.reference_id], client_email: null };
    }
    return { ...p, client_name: '—', client_email: null };
  });
}

// ---- Pendientes de cobro por entidad ----
// Devuelve por entidad: { id, client, total, paid, pending, status, created_at, meta }
async function _profilesById(ids) {
  if (!ids.length) return {};
  const { data } = await supabase.from('profiles').select('id, full_name, email, phone').in('id', ids);
  const map = {};
  (data || []).forEach(p => { map[p.id] = p; });
  return map;
}

async function _paymentsSumBy(reservationType, refIds) {
  if (!refIds.length) return {};
  const { data } = await supabase.from('payments')
    .select('reference_id, amount')
    .eq('reservation_type', reservationType)
    .in('reference_id', refIds);
  const sum = {};
  (data || []).forEach(p => { sum[p.reference_id] = (sum[p.reference_id] || 0) + Number(p.amount || 0); });
  return sum;
}

export async function fetchPendingBookings() {
  const { data } = await supabase.from('bookings')
    .select('id, user_id, total_amount, deposit_amount, status, created_at, guest_name, surf_camps(title)')
    .in('status', ['pending', 'deposit_paid'])
    .order('created_at', { ascending: false });
  const list = data || [];
  const userIds = [...new Set(list.map(b => b.user_id).filter(Boolean))];
  const ids = list.map(b => b.id);
  const [profilesMap, paidMap] = await Promise.all([_profilesById(userIds), _paymentsSumBy('booking', ids)]);
  return list.map(b => {
    // pagado real = máximo entre suma de payments y deposit_amount (cubre reservas antiguas
    // donde la señal web se registró como reservation_type='order' y no aparece en paidMap)
    const paidFromPayments = paidMap[b.id] || 0;
    const paidFromDeposit  = b.status === 'pending' ? 0 : Number(b.deposit_amount || 0);
    const paid  = Math.max(paidFromPayments, paidFromDeposit);
    const total = Number(b.total_amount || 0);
    const pending = Math.max(0, total - paid);
    return {
      id: b.id,
      client: profilesMap[b.user_id]?.full_name || b.guest_name || 'Sin nombre',
      email: profilesMap[b.user_id]?.email || null,
      phone: profilesMap[b.user_id]?.phone || null,
      total, paid, pending,
      status: b.status,
      created_at: b.created_at,
      meta: b.surf_camps?.title || 'Surf camp',
      entity: 'booking',
    };
  }).filter(b => b.pending > 0);
}

export async function fetchPendingRentals() {
  const { data } = await supabase.from('equipment_reservations')
    .select('id, user_id, guest_name, total_amount, deposit_paid, status, date_start, rental_equipment(name)')
    .in('status', ['pending', 'confirmed', 'active'])
    .order('date_start', { ascending: false });
  const list = data || [];
  const userIds = [...new Set(list.map(r => r.user_id).filter(Boolean))];
  const profilesMap = await _profilesById(userIds);
  return list.map(r => {
    const total = Number(r.total_amount || 0);
    const paid = Number(r.deposit_paid || 0);
    const pending = Math.max(0, total - paid);
    return {
      id: r.id,
      client: profilesMap[r.user_id]?.full_name || r.guest_name || 'Sin nombre',
      email: profilesMap[r.user_id]?.email || null,
      phone: profilesMap[r.user_id]?.phone || null,
      total, paid, pending,
      status: r.status,
      created_at: r.date_start,
      meta: r.rental_equipment?.name || 'Material',
      entity: 'rental',
    };
  }).filter(r => r.pending > 0);
}

export async function fetchPendingOrders() {
  const { data } = await supabase.from('orders')
    .select('id, user_id, total, status, created_at, shipping_address, notes')
    .in('status', ['pending'])
    .order('created_at', { ascending: false });
  const list = data || [];
  const userIds = [...new Set(list.map(o => o.user_id).filter(Boolean))];
  const profilesMap = await _profilesById(userIds);
  return list.map(o => {
    const total = Number(o.total || 0);
    return {
      id: o.id,
      client: profilesMap[o.user_id]?.full_name || 'Invitado',
      email: profilesMap[o.user_id]?.email || null,
      phone: profilesMap[o.user_id]?.phone || null,
      total, paid: 0, pending: total,
      status: o.status,
      created_at: o.created_at,
      entity: 'order',
    };
  }).filter(o => o.pending > 0);
}

// Precio esperado del bono y de clase suelta: una sola fuente en /lib/domain/pricing.js
// (getPackPrice/bonoExpected/classPrice, ya DB-driven vía loadPricing). Sin espejo paralelo.

// Bonos activos cuyo total_paid < precio esperado del catálogo.
// Si total_paid es 0 pero hay order_id (compra web), asumimos que al menos se cobró el deposit.
export async function fetchPendingBonos() {
  const { data } = await supabase.from('bonos')
    .select('id, user_id, order_id, class_type, total_credits, used_credits, total_paid, status, created_at, custom_total')
    .in('status', ['active', 'exhausted'])
    .order('created_at', { ascending: false });
  const list = data || [];
  const userIds = [...new Set(list.map(b => b.user_id).filter(Boolean))];
  const ids = list.map(b => b.id);
  // Fuente de verdad del cobro: SUM(payments) del bono; total_paid solo como
  // respaldo para bonos antiguos sin filas en payments. (Sin suponer importes.)
  await loadPricing();
  const [profilesMap, paidMap] = await Promise.all([_profilesById(userIds), _paymentsSumBy('bono', ids)]);

  const TYPE_LBL = { grupal: 'Surf grupal', individual: 'Surf individual', yoga: 'Yoga', paddle: 'Paddle', surfskate: 'SurfSkate' };

  return list.map(b => {
    const expected = bonoExpected(b);
    const paid     = Math.max(Number(paidMap[b.id] || 0), Number(b.total_paid || 0));
    const pending  = Math.max(0, Math.round((expected - paid) * 100) / 100);
    return {
      id: b.id,
      client: profilesMap[b.user_id]?.full_name || 'Sin nombre',
      email: profilesMap[b.user_id]?.email || null,
      phone: profilesMap[b.user_id]?.phone || null,
      total: expected,
      paid,
      pending,
      status: b.status,
      created_at: b.created_at,
      meta: `${TYPE_LBL[b.class_type] || b.class_type} · ${b.total_credits} ${b.total_credits === 1 ? 'clase' : 'clases'}`,
      entity: 'bono',
    };
  }).filter(b => b.pending > 0);
}

// Inscripciones de clase SUELTAS (sin bono) pendientes de pago: reservas
// manuales del admin y las clases "rojas" de Ampliar que exceden los créditos.
// Las inscripciones ligadas a un bono NO entran aquí (su pendiente está en el bono).
export async function fetchPendingEnrollments() {
  const { data } = await supabase.from('class_enrollments')
    .select('id, user_id, guest_name, family_member_id, status, created_at, surf_classes:class_id(title, type, date, price)')
    .is('bono_id', null)
    .in('status', ['confirmed', 'partial'])
    .order('created_at', { ascending: false });
  const list = data || [];
  const ids = list.map(e => e.id);
  const userIds = [...new Set(list.map(e => e.user_id).filter(Boolean))];
  await loadPricing();
  const [profilesMap, paidMap] = await Promise.all([_profilesById(userIds), _paymentsSumBy('enrollment', ids)]);
  const TYPE_LBL = { grupal: 'Surf grupal', individual: 'Surf individual', yoga: 'Yoga', paddle: 'Paddle', surfskate: 'SurfSkate' };

  return list.map(e => {
    const type = e.surf_classes?.type;
    // Precio de la clase suelta: el propio de la clase si lo tiene, si no el del catálogo
    const total = classPrice(e.surf_classes || {});
    const paid = paidMap[e.id] || 0;
    const pending = Math.max(0, Math.round((total - paid) * 100) / 100);
    return {
      id: e.id,
      client: profilesMap[e.user_id]?.full_name || e.guest_name || 'Sin nombre',
      email: profilesMap[e.user_id]?.email || null,
      phone: profilesMap[e.user_id]?.phone || null,
      total, paid, pending,
      status: e.status,
      created_at: e.created_at,
      meta: e.surf_classes?.title || TYPE_LBL[type] || 'Clase',
      entity: 'enrollment',
    };
  }).filter(e => e.pending > 0);
}

// Pendiente de pago AGRUPADO POR CLIENTE: bonos sin saldar + clases sueltas
// sin pagar. Devuelve { userId: { total, items: [{concept, pending}] } }.
export async function fetchClientsPending() {
  const TYPE_LBL = { grupal: 'Surf grupal', individual: 'Surf individual', yoga: 'Yoga', paddle: 'Paddle', surfskate: 'SurfSkate' };
  const [bonosRes, enrRes, rentRes] = await Promise.all([
    supabase.from('bonos').select('id, user_id, class_type, total_credits, order_id, total_paid, status, custom_total').in('status', ['active', 'exhausted']),
    supabase.from('class_enrollments').select('id, user_id, status, surf_classes:class_id(title, type, price)')
      .is('bono_id', null).in('status', ['confirmed', 'partial']),
    supabase.from('equipment_reservations')
      .select('id, user_id, total_amount, deposit_paid, status, rental_equipment(name)')
      .in('status', ['pending', 'confirmed', 'active']),
  ]);
  const bonos = bonosRes.data || [];
  const enr = enrRes.data || [];
  const rentals = rentRes.data || [];
  await loadPricing();
  const [paidMap, bonoPaidMap] = await Promise.all([
    _paymentsSumBy('enrollment', enr.map(e => e.id)),
    _paymentsSumBy('bono', bonos.map(b => b.id)),
  ]);

  const map = {};
  const add = (uid, concept, pending) => {
    if (!uid || pending <= 0) return;
    (map[uid] || (map[uid] = { total: 0, items: [] }));
    map[uid].items.push({ concept, pending });
    map[uid].total = Math.round((map[uid].total + pending) * 100) / 100;
  };
  for (const b of bonos) {
    if (!b.user_id) continue;
    const expected = bonoExpected(b);
    const paid = Math.max(Number(bonoPaidMap[b.id] || 0), Number(b.total_paid || 0));
    add(b.user_id, `Bono ${TYPE_LBL[b.class_type] || b.class_type} · ${b.total_credits} clases`, Math.max(0, Math.round((expected - paid) * 100) / 100));
  }
  for (const e of enr) {
    const total = classPrice(e.surf_classes || {});
    const paid = paidMap[e.id] || 0;
    add(e.user_id, `Clase ${e.surf_classes?.title || TYPE_LBL[e.surf_classes?.type] || ''}`.trim(), Math.max(0, Math.round((total - paid) * 100) / 100));
  }
  for (const r of rentals) {
    if (!r.user_id) continue;
    const pending = Math.max(0, Math.round((Number(r.total_amount || 0) - Number(r.deposit_paid || 0)) * 100) / 100);
    add(r.user_id, `Alquiler ${r.rental_equipment?.name || 'material'}`, pending);
  }
  return map;
}

// ---- Estadísticas (extended dashboard stats with enrollment-class type cross + user names) ----
export async function fetchEstadisticas(dateFrom, dateTo) {
  const base = await fetchDashboardStats(dateFrom, dateTo);

  // Enrollments with class type — two separate queries to avoid schema cache issues
  const { data: enrollmentsRaw } = await supabase
    .from('class_enrollments')
    .select('id, class_id, bono_id, user_id, guest_name, status, created_at')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59');

  const enrollmentsList = enrollmentsRaw || [];

  // Get unique class IDs to fetch their types + details
  const classIds = [...new Set(enrollmentsList.map(e => e.class_id).filter(Boolean))];
  let classTypeMap = {};
  if (classIds.length) {
    const { data: classTypes } = await supabase
      .from('surf_classes')
      .select('id, type')
      .in('id', classIds);
    if (classTypes) classTypes.forEach(c => { classTypeMap[c.id] = c.type; });
  }

  // Merge type into enrollments
  const enrollmentsWithType = enrollmentsList.map(e => ({
    ...e,
    class_type: classTypeMap[e.class_id] || null,
  }));

  // Bonos with user_id for drill-down
  const { data: bonosDetailed } = await supabase
    .from('bonos')
    .select('id, class_type, total_credits, used_credits, total_paid, status, user_id, created_at')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59');

  // Bookings with user_id
  const { data: bookingsDetailed } = await supabase
    .from('bookings')
    .select('id, total_amount, status, user_id, created_at')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59');

  // Orders with user_id
  const { data: ordersDetailed } = await supabase
    .from('orders')
    .select('id, total, status, user_id, created_at')
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59');

  // Equipment with user info
  const { data: equipDetailed } = await supabase
    .from('equipment_reservations')
    .select('id, total_amount, deposit_paid, status, user_id, date_start, date_end')
    .gte('date_start', dateFrom)
    .lte('date_start', dateTo + 'T23:59:59');

  // Collect all user IDs and resolve to profile names in one batch
  const allUserIds = new Set();
  (bonosDetailed || []).forEach(b => b.user_id && allUserIds.add(b.user_id));
  (bookingsDetailed || []).forEach(b => b.user_id && allUserIds.add(b.user_id));
  (ordersDetailed || []).forEach(o => o.user_id && allUserIds.add(o.user_id));
  (equipDetailed || []).forEach(e => e.user_id && allUserIds.add(e.user_id));
  enrollmentsList.forEach(e => e.user_id && allUserIds.add(e.user_id));

  let profileMap = {};
  const userIdArr = [...allUserIds];
  if (userIdArr.length) {
    // Supabase .in() max is ~300; batch if needed
    for (let i = 0; i < userIdArr.length; i += 200) {
      const batch = userIdArr.slice(i, i + 200);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .in('id', batch);
      if (profiles) profiles.forEach(p => { profileMap[p.id] = p; });
    }
  }

  // Helper to attach profile name
  const withName = (item) => ({
    ...item,
    _name: (item.user_id && profileMap[item.user_id]?.full_name) || item.guest_name || null,
  });

  return {
    ...base,
    enrollmentsWithType: enrollmentsWithType.map(withName),
    bonosDetailed: (bonosDetailed || []).map(withName),
    bookingsDetailed: (bookingsDetailed || []).map(withName),
    ordersDetailed: (ordersDetailed || []).map(withName),
    equipDetailed: (equipDetailed || []).map(withName),
    profileMap,
  };
}

// ---- Bookings ----
export const fetchBookings = cached('bookings', 30000, async (statusFilter) => {
  let query = supabase
    .from('bookings')
    .select('*, profiles:user_id(id, full_name, last_name, phone, birth_date, address, city, postal_code, can_swim, has_injury, injury_detail, wetsuit_size), surf_camps:camp_id(id, title, slug, date_start, date_end, max_spots, spots_taken)')
    .order('created_at', { ascending: false });

  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query;
  if (error) { console.error('fetchBookings error:', error.message); return []; }
  return data || [];
});

export async function updateBookingStatus(id, status) {
  const { error } = await supabase.from('bookings').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  invalidateCache('bookings');
}

// Alta manual de una reserva de camp desde el admin. La tabla bookings admite
// invitados (user_id nullable + guest_name/guest_email/guest_phone, ver
// migration-guest-checkout). El trigger on_booking_status_change ajusta spots_taken
// según el status, así que NO hay que tocar spots_taken a mano.
export async function createBooking(payload) {
  const { data, error } = await supabase
    .from('bookings')
    .insert(payload)
    .select('*, surf_camps:camp_id(id, title, slug, date_start, date_end)')
    .single();
  if (error) throw error;
  invalidateCache('bookings');
  invalidateCache('camps'); // spots_taken pudo cambiar por el trigger
  return data;
}

// Envía el email de confirmación de reserva de camp (reusa la edge function
// send-email, tipo 'camp'). `to` es el correo del cliente (manual o de su perfil).
export async function sendBookingConfirmationEmail({ to, customerName, booking }) {
  if (!to) throw new Error('No hay email del cliente al que enviar la confirmación');
  const total = Number(booking.total_amount || 0);
  const campTitle = booking.surf_camps?.title || 'Surf Camp';
  // enviarAviso lanza excepción si falla (no devuelve {error} como el SDK),
  // así que se deja subir tal cual: quien llama ya la captura.
  await enviarAviso({
    to,
    type: 'camp',
    data: {
      customerName: customerName || '',
      orderId: booking.id,
      campName: campTitle,
      amount: total ? `${total.toLocaleString('es-ES')}€` : '',
    },
  });
}

// ---- Surf Camps ----
export const fetchCamps = cached('camps', 30000, async () => {
  const { data, error } = await supabase
    .from('surf_camps')
    .select('*')
    .order('date_start', { ascending: true });
  if (error) throw error;
  return data || [];
});

export async function upsertCamp(camp) {
  camp.updated_at = new Date().toISOString();
  delete camp.duration_days;
  delete camp.photos;
  delete camp.testimonials;
  delete camp.faqs;
  let error, data;
  if (camp.id) {
    const id = camp.id;
    delete camp.id;
    ({ data, error } = await supabase.from('surf_camps').update(camp).eq('id', id).select());
    if (!error && (!data || data.length === 0)) {
      throw new Error('No se actualizó ninguna fila (permisos o id inválido)');
    }
  } else {
    ({ data, error } = await supabase.from('surf_camps').insert(camp).select());
  }
  if (error) throw error;
  invalidateCache('camps');
  return data?.[0] || null;
}

export async function deleteCamp(id) {
  const { error } = await supabase.from('surf_camps').delete().eq('id', id);
  if (error) throw error;
  invalidateCache('camps');
}

// ---- Duplicate Camp (clones surf_camps + camp_photos + camp_testimonials + camp_faqs) ----
export async function duplicateCamp(sourceId) {
  // Fetch full source
  const full = await fetchCampFull(sourceId);
  if (!full) throw new Error('Camp no encontrado');

  // Generate unique slug by appending -copia or -copia-N
  const { data: existing } = await supabase.from('surf_camps').select('slug');
  const takenSlugs = new Set((existing || []).map(c => c.slug));
  let baseSlug = `${full.slug}-copia`;
  let newSlug = baseSlug;
  let n = 2;
  while (takenSlugs.has(newSlug)) { newSlug = `${baseSlug}-${n}`; n++; }

  // Build clone: drop id / timestamps / generated cols, override slug + title
  const clone = { ...full };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  delete clone.duration_days;
  delete clone.photos;
  delete clone.testimonials;
  delete clone.faqs;
  clone.slug = newSlug;
  clone.title = `${full.title} (copia)`;
  clone.spots_taken = 0;
  clone.sold_out = false;
  clone.status = 'coming_soon';

  const { data: inserted, error: insertErr } = await supabase
    .from('surf_camps')
    .insert(clone)
    .select()
    .single();
  if (insertErr) throw insertErr;

  const newId = inserted.id;

  // Clone photos
  if (full.photos?.length) {
    const photosClone = full.photos.map(p => ({
      camp_id: newId, url: p.url, alt_text: p.alt_text, sort_order: p.sort_order,
    }));
    await supabase.from('camp_photos').insert(photosClone);
  }
  // Clone testimonials
  if (full.testimonials?.length) {
    const testsClone = full.testimonials.map(t => ({
      camp_id: newId, author_name: t.author_name, quote: t.quote, stars: t.stars, sort_order: t.sort_order,
    }));
    await supabase.from('camp_testimonials').insert(testsClone);
  }
  // Clone FAQs
  if (full.faqs?.length) {
    const faqsClone = full.faqs.map(f => ({
      camp_id: newId, question: f.question, answer: f.answer, col_index: f.col_index, sort_order: f.sort_order,
    }));
    await supabase.from('camp_faqs').insert(faqsClone);
  }

  invalidateCache('camps');
  return inserted;
}

// ---- Camp Full (with photos, testimonials, faqs) ----
export async function fetchCampFull(id) {
  const [camp, photos, testimonials, faqs] = await Promise.all([
    supabase.from('surf_camps').select('*').eq('id', id).single(),
    supabase.from('camp_photos').select('*').eq('camp_id', id).order('sort_order'),
    supabase.from('camp_testimonials').select('*').eq('camp_id', id).order('sort_order'),
    supabase.from('camp_faqs').select('*').eq('camp_id', id).order('sort_order'),
  ]);
  if (camp.error) throw camp.error;
  return {
    ...camp.data,
    photos: photos.data || [],
    testimonials: testimonials.data || [],
    faqs: faqs.data || [],
  };
}

export async function upsertCampPhoto(photo) {
  const { data, error } = await supabase.from('camp_photos').upsert(photo).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCampPhoto(id) {
  const { error } = await supabase.from('camp_photos').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertCampTestimonial(t) {
  const { data, error } = await supabase.from('camp_testimonials').upsert(t).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCampTestimonial(id) {
  const { error } = await supabase.from('camp_testimonials').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertCampFaq(f) {
  const { data, error } = await supabase.from('camp_faqs').upsert(f).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCampFaq(id) {
  const { error } = await supabase.from('camp_faqs').delete().eq('id', id);
  if (error) throw error;
}

/* ==================== SITE SETTINGS ====================
   Textos e imágenes editables de páginas estáticas (heros).
   Ver migración 0033. */
/* ==================== TRADUCCIÓN AUTOMÁTICA ====================
   Postgres llama a DeepL por nosotros (función traducir_camp, migración 0034).
   Se hace por RPC y no desde aquí porque la clave de DeepL no puede estar en
   este bundle —es descargable por cualquiera— y porque DeepL no admite
   llamadas desde el navegador (no manda cabeceras CORS).
   La función guarda ella misma la columna i18n del camp. */
export async function traducirCamp(campId) {
  const { data, error } = await supabase.rpc('traducir_camp', { p_camp_id: campId });
  if (error) throw new Error(error.message || 'No se pudo traducir');
  return data || {};
}

/* ==================== AVISOS POR CORREO ====================
   Va a /enviar-aviso.php (Hostinger) y no a la Edge Function 'send-email':
   esa función NUNCA se desplegó — devolvía 404 y, como las llamadas van en
   try/catch, llevaba meses fallando en silencio.
   Mismo contrato { to, type, data } para no tocar cada punto de llamada. */
/* Asegura que un cliente tenga ficha (profiles) a partir de su email.
   profiles.id es FK de auth.users, así que sin cuenta no hay ficha: este
   endpoint la crea en silencio (sin correos ni contraseña utilizable) para
   que las reservas manuales no dejen clientes sueltos como "invitado".
   Devuelve el id del perfil. */
export async function sincronizarCliente({ email, full_name, last_name, phone }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sin sesión');
  const res = await fetch('/cliente-sync.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, full_name, last_name, phone }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'No se pudo sincronizar el cliente');
  invalidateCache('clients');
  return out;
}

export async function enviarAviso(cuerpo) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sin sesión');
  const res = await fetch('/enviar-aviso.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(cuerpo),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Error ${res.status} al enviar el correo`);
  return out;
}

export async function fetchSiteSetting(key) {
  const { data, error } = await supabase
    .from('site_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

export async function upsertSiteSetting(key, value) {
  const { data, error } = await supabase
    .from('site_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('value').single();
  if (error) throw error;
  return data?.value || null;
}

export async function uploadCampImage(file, slug) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  // Date.now() a secas colisiona al subir varias fotos de golpe (mismo ms) y
  // upload() sin upsert falla con "already exists": solo se guardaba la 1ª.
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `camps/${slug}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supabase.storage.from('activity-photos').upload(path, file);
  if (error) throw error;
  const { data: publicData } = supabase.storage.from('activity-photos').getPublicUrl(data.path);
  return publicData.publicUrl;
}

// ---- Coupons ----
export const fetchCoupons = cached('coupons', 30000, async () => {
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
});

export async function upsertCoupon(coupon) {
  coupon.updated_at = new Date().toISOString();
  let error;
  if (coupon.id) {
    const id = coupon.id;
    delete coupon.id;
    ({ error } = await supabase.from('coupons').update(coupon).eq('id', id));
  } else {
    ({ error } = await supabase.from('coupons').insert(coupon));
  }
  if (error) throw error;
  invalidateCache('coupons');
}

export async function deleteCoupon(id) {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw error;
  invalidateCache('coupons');
}

// ---- Surf Classes ----
export async function upsertClass(cls) {
  const { error } = await supabase.from('surf_classes').upsert(cls);
  if (error) throw error;
}

export async function deleteClass(id) {
  const { error } = await supabase.from('surf_classes').delete().eq('id', id);
  if (error) throw error;
}

// ---- Products ----
export const fetchProducts = cached('products', 30000, async () => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
});

export async function upsertProduct(product) {
  product.updated_at = new Date().toISOString();
  const { error } = await supabase.from('products').upsert(product);
  if (error) throw error;
  invalidateCache('products');
}

// Sube una imagen de producto al Storage y devuelve su URL pública.
export async function uploadProductImage(file, slug) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeSlug = (slug || 'producto').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'producto';
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `productos/${safeSlug}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supabase.storage
    .from('activity-photos')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data: publicData } = supabase.storage.from('activity-photos').getPublicUrl(data.path);
  return publicData.publicUrl;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
  invalidateCache('products');
}

// ---- Orders ----
export const fetchOrders = cached('orders', 30000, async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, profiles:user_id(id, full_name, phone, email), order_items(id)')
    .order('created_at', { ascending: false });
  if (error) { console.error('fetchOrders error:', error.message); return []; }
  return data || [];
});

export async function fetchOrderItems(orderId) {
  const { data, error } = await supabase
    .from('order_items')
    .select('*, products:product_id(id, name, price)')
    .eq('order_id', orderId);
  if (error) { console.error('fetchOrderItems error:', error.message); return []; }
  return data || [];
}

export async function updateOrderStatus(id, status) {
  const { error } = await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  invalidateCache('orders');
}

// ---- Profiles ----
// Crea un cliente vía la Edge Function create-client (service role): crea el
// usuario, el perfil completo y sus familiares SIN tocar la sesión del admin
// (antes usaba signUp y deslogueaba al admin al persistir la nueva sesión).
// `fields` admite además un array `family` de familiares.
export async function createClientFromAdmin(fields) {
  const f = fields || {};
  if (!f.email) throw new Error('Email es obligatorio para crear un cliente');
  // Antes llamaba a la Edge Function 'create-client', que nunca se desplegó:
  // devolvía 404 y crear un cliente desde el panel fallaba siempre.
  // cliente-sync.php hace lo mismo (crea cuenta + ficha sin tocar la sesión
  // del admin) y sí está en producción.
  const data = await sincronizarCliente({
    email: f.email,
    full_name: f.full_name,
    last_name: f.last_name,
    phone: f.phone,
  });
  // Familiares que vengan con el alta. cliente-sync solo crea la ficha
  // principal, así que estos se insertan aquí.
  let familyCreated = 0;
  const familia = Array.isArray(f.family) ? f.family.filter(m => m && m.full_name) : [];
  if (data.id && familia.length) {
    const filas = familia.map(m => ({
      user_id: data.id,
      full_name: m.full_name,
      last_name: m.last_name || null,
      birth_date: m.birth_date || null,
      level: m.level || null,
      weight_kg: m.weight_kg ? Number(m.weight_kg) : null,
      height_cm: m.height_cm ? Number(m.height_cm) : null,
      can_swim: typeof m.can_swim === 'boolean' ? m.can_swim : null,
      has_injury: m.has_injury === true,
      injury_detail: m.injury_detail || null,
    }));
    const { error: famErr } = await supabase.from('family_members').insert(filas);
    if (!famErr) familyCreated = filas.length;
  }

  invalidateCache('profiles');
  return {
    id: data.id,
    full_name: f.full_name,
    email: f.email,
    family_created: familyCreated,
    already_existed: data.creado !== true,
    // No se manda correo de bienvenida: la ficha se crea en silencio.
    email_sent: false,
  };
}

export const fetchProfiles = cached('profiles', 30000, async (search) => {
  let query = supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (search) query = query.ilike('full_name', `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
});

// ---- Recent bookings (for dashboard) ----
export async function fetchRecentBookings(limit = 5) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('fetchRecentBookings error:', error.message); return []; }
  return data || [];
}

// ---- Classes by date range (calendario) ----
export async function fetchClassesInRange(dateFrom, dateTo) {
  const { data, error } = await supabase
    .from('surf_classes')
    .select('*')
    .gte('date', dateFrom)
    .lte('date', dateTo)
    .order('date', { ascending: true })
    .order('time_start', { ascending: true });
  if (error) {
    console.error('fetchClassesInRange error:', error.message, error.code, error.details);
    return [];
  }
  return data || [];
}

// ---- Class enrollments ----
export async function fetchClassEnrollments(classId) {
  const { data, error } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('fetchClassEnrollments error:', error.message, error.code, error.details);
    return [];
  }
  if (!data?.length) return [];

  // Fetch profile names for enrollments with user_id
  const userIds = [...new Set(data.filter(e => e.user_id).map(e => e.user_id))];
  let profilesMap = {};
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, wetsuit_size')
      .in('id', userIds);
    if (profiles) profiles.forEach(p => { profilesMap[p.id] = p; });
  }

  // Fetch family member names for enrollments with family_member_id
  const familyIds = [...new Set(data.filter(e => e.family_member_id).map(e => e.family_member_id))];
  let familyMap = {};
  if (familyIds.length) {
    const { data: members } = await supabase
      .from('family_members')
      .select('id, full_name, birth_date, wetsuit_size')
      .in('id', familyIds);
    if (members) members.forEach(m => { familyMap[m.id] = m; });
  }

  // Fetch active bonos for enrollments that have bono_id
  const bonoIds = [...new Set(data.filter(e => e.bono_id).map(e => e.bono_id))];
  let bonoMap = {};
  if (bonoIds.length) {
    const { data: bonos } = await supabase
      .from('bonos')
      .select('id, total_credits, used_credits, status, total_paid, class_type, order_id, custom_total')
      .in('id', bonoIds);
    if (bonos) bonos.forEach(b => { bonoMap[b.id] = b; });
  }

  // Merge profile/family names + bono into enrollments
  return data.map(e => ({
    ...e,
    family_members: e.family_member_id ? familyMap[e.family_member_id] || null : null,
    profiles: e.user_id ? profilesMap[e.user_id] || null : null,
    bono: e.bono_id ? bonoMap[e.bono_id] || null : null,
    // Talla de neopreno del ASISTENTE concreto: si la inscripción es de un familiar,
    // solo su talla (nunca hereda la del titular); si es del titular, la suya.
    wetsuit_size: e.family_member_id
      ? (familyMap[e.family_member_id]?.wetsuit_size || null)
      : (e.user_id ? (profilesMap[e.user_id]?.wetsuit_size || null) : null),
    // Set guest_name from family member or profile if not already set
    guest_name: e.guest_name
      || (e.family_member_id && familyMap[e.family_member_id]?.full_name)
      || (e.user_id && profilesMap[e.user_id]?.full_name)
      || null,
  }));
}

// ---- Publish classes ----
export async function publishClasses(ids) {
  const { error } = await supabase
    .from('surf_classes')
    .update({ published: true })
    .in('id', ids);
  if (error) throw error;
}

// ---- Manual enrollments ----
export async function createEnrollment(enrollment) {
  const { data, error } = await supabase.from('class_enrollments').insert(enrollment).select('id, class_id, status');
  if (error) throw error;
  return data?.[0] || null;
}

export async function deleteEnrollment(id) {
  const { data, error } = await supabase.from('class_enrollments').delete().eq('id', id).select('id');
  if (error) throw error;
  return data?.[0] || null;
}

export async function searchProfiles(term) {
  const safeTerm = term.replace(/[%_\\]/g, '');
  if (!safeTerm.trim()) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, last_name, phone, email')
    .or(`full_name.ilike.%${safeTerm}%,phone.ilike.%${safeTerm}%,email.ilike.%${safeTerm}%`)
    .limit(10);
  if (error) { console.warn('searchProfiles:', error.message); return []; }
  return data || [];
}

export async function updateClassEnrolledCount(classId, count) {
  const { error } = await supabase
    .from('surf_classes')
    .update({ enrolled_count: count })
    .eq('id', classId);
  if (error) throw error;
}

// ---- Move enrollment between classes ----
export async function moveEnrollment(enrollmentId, newClassId) {
  const { data, error } = await supabase
    .from('class_enrollments')
    .update({ class_id: newClassId, updated_at: new Date().toISOString() })
    .eq('id', enrollmentId)
    .select();
  if (error) throw error;
  if (!data?.length) throw new Error('No se pudo mover la inscripción (no encontrada)');
}

// ---- Update enrollment status ----
export async function updateEnrollmentStatus(enrollmentId, status) {
  const { error } = await supabase
    .from('class_enrollments')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', enrollmentId);
  if (error) throw error;
}

// Asistencia, independiente del pago: true=asistió, false=no se presentó, null=sin marcar
export async function updateEnrollmentAttendance(enrollmentId, attendance) {
  const { error } = await supabase
    .from('class_enrollments')
    .update({ attendance, updated_at: new Date().toISOString() })
    .eq('id', enrollmentId);
  if (error) throw error;
}

// ---- Activities ----
export async function fetchActivities() {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchActivityFull(id) {
  // Fetch activity + packs + photos + testimonials + faqs in parallel
  const [act, packs, photos, testimonials, faqs] = await Promise.all([
    supabase.from('activities').select('*').eq('id', id).single(),
    supabase.from('activity_packs').select('*').eq('activity_id', id).order('sessions'),
    supabase.from('activity_photos').select('*').eq('activity_id', id).order('sort_order'),
    supabase.from('activity_testimonials').select('*').eq('activity_id', id).order('sort_order'),
    supabase.from('activity_faqs').select('*').eq('activity_id', id).order('sort_order'),
  ]);
  if (act.error) throw act.error;
  return {
    ...act.data,
    packs: packs.data || [],
    photos: photos.data || [],
    testimonials: testimonials.data || [],
    faqs: faqs.data || [],
  };
}

export async function fetchActivityBySlug(slug) {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('slug', slug)
    .eq('activo', true)
    .single();
  if (error) return null;
  // Now fetch related data
  const [packs, photos, testimonials, faqs] = await Promise.all([
    supabase.from('activity_packs').select('*').eq('activity_id', data.id).order('sessions'),
    supabase.from('activity_photos').select('*').eq('activity_id', data.id).order('sort_order'),
    supabase.from('activity_testimonials').select('*').eq('activity_id', data.id).order('sort_order'),
    supabase.from('activity_faqs').select('*').eq('activity_id', data.id).order('sort_order'),
  ]);
  return {
    ...data,
    packs: packs.data || [],
    photos: photos.data || [],
    testimonials: testimonials.data || [],
    faqs: faqs.data || [],
  };
}

export async function upsertActivity(activity) {
  activity.updated_at = new Date().toISOString();
  let data, error;
  if (activity.id) {
    // Existing activity — use update (not upsert) to allow partial field updates
    const id = activity.id;
    delete activity.id;
    ({ data, error } = await supabase.from('activities').update(activity).eq('id', id).select().single());
  } else {
    // New activity — insert
    ({ data, error } = await supabase.from('activities').insert(activity).select().single());
  }
  if (error) throw error;
  return data;
}

export async function deleteActivity(id) {
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleActivityStatus(id, activo) {
  const { error } = await supabase.from('activities').update({ activo, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ---- Activity Packs ----
export async function upsertActivityPacks(activityId, packs) {
  // Delete existing packs then insert new ones
  await supabase.from('activity_packs').delete().eq('activity_id', activityId);
  if (packs.length === 0) return;
  const rows = packs.map((p, i) => ({
    activity_id: activityId,
    sessions: p.sessions,
    price: p.price,
    featured: p.featured || false,
    public: p.public !== false,
    sort_order: i,
  }));
  const { error } = await supabase.from('activity_packs').insert(rows);
  if (error) throw error;
}

// ---- Activity Photos ----
export async function upsertActivityPhoto(photo) {
  const { data, error } = await supabase.from('activity_photos').upsert(photo).select().single();
  if (error) throw error;
  return data;
}

export async function deleteActivityPhoto(id) {
  const { error } = await supabase.from('activity_photos').delete().eq('id', id);
  if (error) throw error;
}

export async function reorderActivityPhotos(photos) {
  const updates = photos.map((p, i) => supabase.from('activity_photos').update({ sort_order: i }).eq('id', p.id));
  await Promise.all(updates);
}

// ---- Activity Testimonials ----
export async function upsertActivityTestimonial(testimonial) {
  const { data, error } = await supabase.from('activity_testimonials').upsert(testimonial).select().single();
  if (error) throw error;
  return data;
}

export async function deleteActivityTestimonial(id) {
  const { error } = await supabase.from('activity_testimonials').delete().eq('id', id);
  if (error) throw error;
}

// ---- Activity FAQs ----
export async function upsertActivityFaq(faq) {
  const { data, error } = await supabase.from('activity_faqs').upsert(faq).select().single();
  if (error) throw error;
  return data;
}

export async function deleteActivityFaq(id) {
  const { error } = await supabase.from('activity_faqs').delete().eq('id', id);
  if (error) throw error;
}

// ---- Upload photo to Supabase Storage ----
export async function uploadActivityImage(file, activitySlug) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  // Mismo motivo que en uploadCampImage: evita colisión al subir en lote.
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${activitySlug}/${Date.now()}-${rand}.${ext}`;
  const { data, error } = await supabase.storage.from('activity-photos').upload(path, file);
  if (error) throw error;
  const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(data.path);
  return urlData.publicUrl;
}

// ---- Equipment (already used by material.js and tarifas.js) ----
export async function fetchEquipment() {
  const { data, error } = await supabase
    .from('rental_equipment')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateEquipmentPricing(id, pricing, deposit) {
  const { error } = await supabase.from('rental_equipment').update({ pricing, deposit, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ---- Equipment Reservations ----
export async function createEquipmentReservation(reservation) {
  const { data, error } = await supabase.from('equipment_reservations').insert(reservation).select().single();
  if (error) throw error;
  return data;
}

export async function fetchEquipmentReservationsForDate(dateStr) {
  const { data, error } = await supabase
    .from('equipment_reservations')
    .select('*, rental_equipment(name, type, sizes)')
    .gte('date_start', dateStr)
    .lte('date_start', dateStr + 'T23:59:59')
    .order('date_start');
  if (error) { console.warn('fetchEquipmentReservationsForDate:', error.message); return []; }
  return data || [];
}

export async function fetchEquipmentReservationsOverlapping(dateStr) {
  const { data, error } = await supabase
    .from('equipment_reservations')
    .select('*, rental_equipment(name, type, sizes, pricing)')
    .lte('date_start', dateStr)
    .gte('date_end', dateStr)
    .in('status', ['pending', 'confirmed', 'active', 'returned'])
    .order('date_start');
  if (error) { console.warn('fetchEquipmentReservationsOverlapping:', error.message); return []; }
  return data || [];
}

export async function updateEquipmentReservationStatus(id, status) {
  const { error } = await supabase
    .from('equipment_reservations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function updateEquipmentReservation(id, fields) {
  const { error } = await supabase
    .from('equipment_reservations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// Cancela un alquiler como CORRECCIÓN DE ERROR: lo deja en estado 'cancelled',
// con el importe a 0 (total y pagado), sin pagos registrados y liberando la
// unidad física asignada. NO borra el registro (queda visible como cancelado).
export async function cancelEquipmentReservation(id) {
  // 1) pagos del alquiler fuera (no hay FK; el importe vuelve a 0 de verdad)
  await supabase.from('payments').delete().eq('reservation_type', 'rental').eq('reference_id', id);
  // 2) marcar cancelado, importe a 0 y liberar la unidad
  const { error } = await supabase
    .from('equipment_reservations')
    .update({ status: 'cancelled', total_amount: 0, deposit_paid: 0, assigned_unit_id: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markEquipmentReservationPaid(id, totalAmount) {
  const { error } = await supabase
    .from('equipment_reservations')
    .update({ deposit_paid: totalAmount, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function markEquipmentReservationUnpaid(id) {
  const { error } = await supabase
    .from('equipment_reservations')
    .update({ deposit_paid: 0, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---- Payments ----
export async function fetchPayments(reservationType, referenceId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('reservation_type', reservationType)
    .eq('reference_id', referenceId)
    .order('payment_date', { ascending: false });
  if (error) { console.warn('fetchPayments:', error.message); return []; }
  return data || [];
}

export async function createPayment(payment) {
  const { data, error } = await supabase
    .from('payments')
    .insert(payment)
    .select()
    .single();
  if (error) throw error;
  // Un pago afecta a estados/importes mostrados en reservas y pedidos
  invalidateCache('bookings');
  invalidateCache('orders');
  return data;
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (error) throw error;
  invalidateCache('bookings');
  invalidateCache('orders');
}

// Edita solo método de pago y fecha (importe/canal/tipo no se tocan
// para no descuadrar el estado del booking/order/etc).
export async function updatePayment(id, { payment_method, payment_date, concept }) {
  const patch = {};
  if (payment_method !== undefined) patch.payment_method = payment_method;
  if (payment_date   !== undefined) patch.payment_date   = payment_date;
  if (concept        !== undefined) patch.concept        = concept;
  if (!Object.keys(patch).length) return;
  const { error } = await supabase.from('payments').update(patch).eq('id', id);
  if (error) throw error;
}

