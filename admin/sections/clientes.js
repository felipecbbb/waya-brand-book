/* ============================================================
   Clientes Section — Client list + detail ficha
   ============================================================ */
import { fetchProfiles, createClientFromAdmin, createPayment, deletePayment, fetchPayments, deleteEnrollment, updateEnrollmentStatus, updateEquipmentReservationStatus, cancelEquipmentReservation, fetchClientsPending, mergeClients, searchProfiles, findDuplicateProfiles, enviarAcceso } from '../modules/api.js';
import { attachClientSuggest } from '../modules/client-suggest.js';
import { renderTable, statusBadge, formatDate, formatCurrency, openModal, closeModal, showToast } from '../modules/ui.js';
import { supabase } from '/lib/supabase.js';
import { getPackPrice, bonoExpected, classPrice } from '/lib/domain/pricing.js';
import { recalcPaidState as recalcPaymentState, recalcBonoPaid } from '/lib/domain/payments.js';
import { createBono } from '/lib/domain/bonos.js';
import { openBonoFicha } from '../components/bono-ficha.js';
import { clientLevelOptionsHtml, clientLevelLabel } from '/lib/shared-constants.js';
import { openPaymentEditModal } from '../modules/payment-edit.js';

/* "Enviar acceso": email al cliente con el enlace para crear su contraseña.
   Antes era un mailto: que Safari bloqueaba y que abría la app Mail del Mac. */
async function mandarAcceso(client, btn) {
  const nombre = [client.full_name, client.last_name].filter(Boolean).join(' ').trim();
  if (!confirm(`¿Enviar a ${client._email} el email para crear su contraseña y entrar en su cuenta?`)) return;
  if (btn) btn.disabled = true;
  try {
    await enviarAcceso({ email: client._email, name: client.full_name || nombre });
    showToast(`Acceso enviado a ${client._email}`, 'success');
  } catch (err) {
    showToast('No se pudo enviar: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// recalcPaymentState vive en /lib/domain/payments.js (recalcPaidState).

// getPackPrice / bonoExpected / classPrice viven en /lib/domain/pricing.js (fuente única).

// Nombre mostrable de un familiar (nombre + apellido si lo tiene), coherente con
// el resto del archivo. null = la persona titular de la cuenta.
function memberDisplayName(fm) {
  if (!fm) return 'Titular';
  return fm.full_name + (fm.last_name ? ' ' + fm.last_name : '');
}

function computeBonoBreakdown(bono, enrollments) {
  if (!bono) return [];
  // Cuenta toda inscripción NO cancelada (cuadra con bonos.used_credits tras
  // migration-fix-enrollment-status-counting, donde el trigger cuenta <> 'cancelled').
  const used = (enrollments || []).filter(e => e.bono_id === bono.id && e.status !== 'cancelled');
  const byMember = new Map();
  for (const e of used) {
    const key = e.family_member_id || 'titular';
    const name = memberDisplayName(e.family_member);
    const cur = byMember.get(key) || { key, name, count: 0 };
    cur.count++;
    byMember.set(key, cur);
  }
  return [...byMember.values()].sort((a, b) => b.count - a.count);
}

// Color estable por bono.id (para agrupar visualmente las clases del mismo bono
// en el histórico). Hash determinista → paleta corta.
const BONO_PALETTE = ['#1a1a1a', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
function bonoPillColor(id) {
  if (!id) return '#94a3b8';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BONO_PALETTE[h % BONO_PALETTE.length];
}

// ---- API helpers (client-specific) ----

async function fetchClientEnrollments(userId) {
  const { data: enrollments, error } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchClientEnrollments:', error.message); return []; }
  if (!enrollments?.length) return [];

  // Lookups batch (sin N+1): clases + familiares (qué hija) + bonos (qué pack)
  const classIds = [...new Set(enrollments.map(e => e.class_id).filter(Boolean))];
  const memberIds = [...new Set(enrollments.map(e => e.family_member_id).filter(Boolean))];
  const bonoIds = [...new Set(enrollments.map(e => e.bono_id).filter(Boolean))];

  const [classesRes, membersRes, bonosRes] = await Promise.all([
    classIds.length ? supabase.from('surf_classes').select('*').in('id', classIds) : Promise.resolve({ data: [] }),
    memberIds.length ? supabase.from('family_members').select('id, full_name, last_name').in('id', memberIds) : Promise.resolve({ data: [] }),
    bonoIds.length ? supabase.from('bonos').select('id, class_type, total_credits, custom_total').in('id', bonoIds) : Promise.resolve({ data: [] }),
  ]);

  const classesMap = {}; (classesRes.data || []).forEach(c => { classesMap[c.id] = c; });
  const membersMap = {}; (membersRes.data || []).forEach(m => { membersMap[m.id] = m; });
  const bonosMap = {}; (bonosRes.data || []).forEach(b => { bonosMap[b.id] = b; });

  return enrollments.map(e => ({
    ...e,
    surf_class: classesMap[e.class_id] || null,
    family_member: membersMap[e.family_member_id] || null, // null = Titular
    bono: bonosMap[e.bono_id] || null,                      // null = clase suelta
  }));
}

async function fetchClientBookings(userId) {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchClientBookings:', error.message); return []; }
  if (!bookings?.length) return [];

  const campIds = [...new Set(bookings.map(b => b.camp_id).filter(Boolean))];
  let campsMap = {};
  if (campIds.length) {
    const { data: camps } = await supabase
      .from('surf_camps')
      .select('id, title')
      .in('id', campIds);
    if (camps) camps.forEach(c => { campsMap[c.id] = c; });
  }

  return bookings.map(b => ({
    ...b,
    camp_title: campsMap[b.camp_id]?.title || null,
  }));
}

async function fetchClientOrders(userId) {
  // Solo pedidos de TIENDA reales: pagados y con productos (order_items).
  // Excluye checkouts abandonados (pending) y órdenes que en realidad eran
  // señal de surf camp o bono de clases (sin order_items) — caso Maite/Adrián.
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items!inner(id)')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchClientOrders:', error.message); return []; }
  // Dedup (el inner join puede repetir la orden por cada item)
  const seen = new Set();
  return (data || []).filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
}

async function fetchClientBonos(userId) {
  const { data, error } = await supabase
    .from('bonos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchClientBonos:', error.message); return []; }
  return data || [];
}

async function fetchClientEquipmentReservations(userId) {
  const { data: reservations, error } = await supabase
    .from('equipment_reservations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchClientEquipmentReservations:', error.message); return []; }
  if (!reservations?.length) return [];

  const equipIds = [...new Set(reservations.map(r => r.equipment_id).filter(Boolean))];
  let equipMap = {};
  if (equipIds.length) {
    const { data: equipment } = await supabase
      .from('rental_equipment')
      .select('id, name, type')
      .in('id', equipIds);
    if (equipment) equipment.forEach(e => { equipMap[e.id] = e; });
  }

  return reservations.map(r => ({
    ...r,
    equipment: equipMap[r.equipment_id] || null,
  }));
}

async function fetchClientPayments(userId) {
  // Fetch all payments across enrollments + rentals for this user via RPC
  const { data, error } = await supabase.rpc('get_user_payments', { p_user_id: userId });
  if (error) { console.warn('fetchClientPayments:', error.message); return []; }
  return data || [];
}

async function fetchClientFamilyMembers(userId) {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) { console.warn('fetchClientFamilyMembers:', error.message); return []; }
  return data || [];
}

async function createFamilyMemberAdmin(userId, fields) {
  const { data, error } = await supabase
    .from('family_members')
    .insert({ user_id: userId, ...fields })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateFamilyMemberAdmin(id, fields) {
  fields.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('family_members')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteFamilyMemberAdmin(id) {
  const { error } = await supabase.from('family_members').delete().eq('id', id);
  if (error) throw error;
}

// Fetch family member enrollments (classes booked for this family member)
async function fetchFamilyMemberEnrollments(familyMemberId) {
  const { data: enrollments, error } = await supabase
    .from('class_enrollments')
    .select('*')
    .eq('family_member_id', familyMemberId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('fetchFamilyMemberEnrollments:', error.message); return []; }
  if (!enrollments?.length) return [];

  const classIds = [...new Set(enrollments.map(e => e.class_id).filter(Boolean))];
  let classesMap = {};
  if (classIds.length) {
    const { data: classes } = await supabase.from('surf_classes').select('*').in('id', classIds);
    if (classes) classes.forEach(c => { classesMap[c.id] = c; });
  }
  return enrollments.map(e => ({ ...e, surf_class: classesMap[e.class_id] || null }));
}

async function updateProfile(id, updates) {
  updates.updated_at = new Date().toISOString();
  const { error } = await supabase.from('profiles').update(updates).eq('id', id);
  if (error) throw error;
}

async function deleteProfile(id) {
  const { error } = await supabase.rpc('delete_user', { p_user_id: id });
  if (error) throw error;
}

const TYPE_LABELS = {
  grupal: 'Grupal', individual: 'Individual', yoga: 'Yoga',
  paddle: 'Paddle Surf', surfskate: 'SurfSkate',
};

export async function renderClientes(container) {
  let searchTerm = '';
  let activeFilter = ''; // '', 'pending_pay', 'pending_assign', 'paid', 'cancelled'
  let debounceTimer = null;
  let selectedClient = null;
  let _scrollSpyObserver = null;

  // Cache for auth emails (keyed by user ID)
  const emailCache = {};

  // Cache por render de la ficha one-page: evita refetch duplicado de bonos y
  // enrollments entre renderKpis, loadBonosTab y loadClasesTab. Se resetea al
  // entrar a renderDetail y tras cualquier mutación de dinero (ver refreshMoneySections).
  let _clientCache = { id: null, bonos: null, enrollments: null };
  function resetClientCache(id) { _clientCache = { id: id ?? null, bonos: null, enrollments: null }; }
  function getBonos(c) {
    if (_clientCache.id !== c.id) resetClientCache(c.id);
    if (!_clientCache.bonos) _clientCache.bonos = fetchClientBonos(c.id);
    return _clientCache.bonos; // Promise<bono[]>
  }
  function getEnrollments(c) {
    if (_clientCache.id !== c.id) resetClientCache(c.id);
    if (!_clientCache.enrollments) _clientCache.enrollments = fetchClientEnrollments(c.id);
    return _clientCache.enrollments; // Promise<enrollment[]>
  }

  // ===================== LIST VIEW =====================
  async function renderList() {
    selectedClient = null;
    // Solo clientes: los instructores (admin/encargado) se gestionan en Equipo
    const allProfiles = await fetchProfiles(searchTerm || undefined);
    const profiles = allProfiles.filter(p => p.role !== 'admin' && p.role !== 'encargado');

    // Batch-fetch emails, family members, and enrollments for all listed profiles
    const profileIds = profiles.map(p => p.id);
    const [, familyRes, enrollRes] = await Promise.all([
      (async () => {
        for (const p of profiles) {
          if (emailCache[p.id] === undefined) {
            emailCache[p.id] = await getAuthEmail(p.id);
          }
          p._email = emailCache[p.id];
        }
      })(),
      profileIds.length
        ? supabase.from('family_members').select('id, user_id, full_name, last_name').in('user_id', profileIds).order('created_at', { ascending: true })
        : { data: [] },
      profileIds.length
        ? supabase.from('class_enrollments').select('id, user_id, status, class_id').in('user_id', profileIds)
        : { data: [] },
    ]);
    const allFamilyMembers = familyRes.data || [];
    const allEnrollments = enrollRes.data || [];
    for (const p of profiles) {
      p._family = allFamilyMembers.filter(m => m.user_id === p.id);
      p._enrollments = allEnrollments.filter(e => e.user_id === p.id);
    }

    // Para el filtro de pago pendiente, calcula cuánto y qué debe cada cliente
    if (activeFilter === 'pending_pay') {
      let pendingMap = {};
      try { pendingMap = await fetchClientsPending(); } catch (err) { console.warn('pending map:', err.message); }
      for (const p of profiles) p._pending = pendingMap[p.id] || null;
    }

    // "Pendiente de asignar" = bonos con créditos comprados SIN asignar a clase
    // (total_credits − used_credits > 0), no caducados ni cancelados. (Antes miraba
    // inscripciones sin class_id, que no existen → siempre salía vacío.)
    const unassignedSet = new Set();
    if (activeFilter === 'pending_assign') {
      try {
        const { data } = await supabase.from('bonos')
          .select('user_id, total_credits, used_credits, status')
          .in('user_id', profileIds);
        (data || []).forEach(b => {
          if (!['cancelled', 'expired'].includes(b.status) && (Number(b.total_credits) - Number(b.used_credits)) > 0) unassignedSet.add(b.user_id);
        });
      } catch (err) { console.warn('bonos sin asignar:', err.message); }
    }

    // Apply filter
    let filtered = profiles;
    if (activeFilter === 'pending_pay') {
      filtered = profiles.filter(p => p._pending && p._pending.total > 0);
    } else if (activeFilter === 'pending_assign') {
      filtered = profiles.filter(p => unassignedSet.has(p.id));
    } else if (activeFilter === 'paid') {
      filtered = profiles.filter(p => p._enrollments.some(e => e.status === 'paid'));
    } else if (activeFilter === 'cancelled') {
      filtered = profiles.filter(p => p._enrollments.some(e => e.status === 'cancelled'));
    }

    const filterBtn = (key, label, icon) => `<button class="cli-filter-btn ${activeFilter === key ? 'active' : ''}" data-filter="${key}">${icon} ${label}</button>`;
    const toolbar = `
      <div class="admin-toolbar">
        <input type="text" class="admin-search" id="clientes-search"
               placeholder="Buscar por nombre…" value="${searchTerm}" />
        <button class="btn red" id="new-client-btn">+ Nuevo Cliente</button>
        <button class="btn" id="merge-clients-btn" style="background:#1a1a1a;color:#fff;border:0">Fusionar duplicados</button>
      </div>
      <div class="cli-filters">
        ${filterBtn('', 'Todos', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>')}
        ${filterBtn('pending_pay', 'Pago pendiente', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>')}
        ${filterBtn('pending_assign', 'Sin asignar', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>')}
        ${filterBtn('paid', 'Pagado', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11.5 14.5 16 9.5"/></svg>')}
        ${filterBtn('cancelled', 'Canceladas', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>')}
      </div>`;

    const listHtml = !filtered.length
      ? '<div class="admin-empty"><p>No hay clientes</p></div>'
      : `<div class="cli-list">${filtered.map(r => {
        const fullName = esc(r.full_name) + (r.last_name ? ' ' + esc(r.last_name) : '');
        const familyHtml = (r._family || []).map(m =>
          `<div class="cli-family-tag" data-client-id="${r.id}" data-member-id="${m.id}">` +
            `<div class="cli-family-tag-left">` +
              `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` +
              `<span>${esc(m.full_name)}${m.last_name ? ' ' + esc(m.last_name) : ''}</span>` +
            `</div>` +
            `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>` +
          `</div>`
        ).join('');

        return `<div class="cli-list-card" data-id="${r.id}">
          <div class="cli-list-card-main">
            <div class="cli-list-avatar" style="background:${r.role === 'admin' ? '#0f2f39' : '#1a1a1a'}">${(r.full_name || '?')[0].toUpperCase()}</div>
            <div class="cli-list-info">
              <div class="cli-list-name">${fullName}</div>
              <div class="cli-list-meta">
                ${r._email ? `<span>${esc(r._email)}</span>` : ''}
                ${r.phone ? `<span>${esc(r.phone)}</span>` : ''}
              </div>
            </div>
            <div class="cli-list-right">
              <span class="act-status-badge ${r.role === 'admin' ? 'active' : ''}" style="font-size:.68rem">${r.role === 'admin' ? 'Admin' : 'Cliente'}</span>
              <div class="cli-list-actions">
                <button class="admin-action-btn" data-id="${r.id}" data-action="email" title="Enviar acceso a su cuenta">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </button>
                <button class="admin-action-btn danger" data-id="${r.id}" data-action="delete" title="Eliminar cliente">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
          ${activeFilter === 'pending_pay' && r._pending ? `
            <div class="cli-pending-box">
              <div class="cli-pending-head"><span>Pendiente de pago</span><strong>${formatCurrency(r._pending.total)}</strong></div>
              ${r._pending.items.map(it => `<div class="cli-pending-item"><span>${esc(it.concept)}</span><span>${formatCurrency(it.pending)}</span></div>`).join('')}
            </div>` : ''}
          ${familyHtml ? `<div class="cli-list-family">${familyHtml}</div>` : ''}
        </div>`;
      }).join('')}</div>`;

    container.innerHTML = toolbar + listHtml;

    // Search
    const searchInput = container.querySelector('#clientes-search');
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchTerm = e.target.value.trim();
        renderList();
      }, 350);
    });
    if (searchTerm) {
      searchInput.focus();
      searchInput.setSelectionRange(searchTerm.length, searchTerm.length);
    }

    // Filter buttons
    container.querySelectorAll('.cli-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        renderList();
      });
    });

    // New client
    container.querySelector('#new-client-btn').addEventListener('click', () => openNewClientModal());
    container.querySelector('#merge-clients-btn')?.addEventListener('click', () => openMergeModal());

    // Family member tag click → open client detail then member ficha
    container.querySelectorAll('.cli-family-tag').forEach(tag => {
      tag.addEventListener('click', async (e) => {
        e.stopPropagation();
        const clientId = tag.dataset.clientId;
        const memberId = tag.dataset.memberId;
        const client = profiles.find(p => p.id === clientId);
        if (!client) return;
        // Enter detail view first so the familia section exists
        selectedClient = client;
        await renderDetail();
        // Now fetch and open member ficha
        const members = await fetchClientFamilyMembers(clientId);
        const member = members.find(m => m.id === memberId);
        if (member) openMemberFicha(client, member);
      });
    });

    // Card click → open client ficha
    container.querySelectorAll('.cli-list-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.admin-action-btn') || e.target.closest('.cli-family-tag')) return;
        const client = profiles.find(p => p.id === card.dataset.id);
        if (client) {
          selectedClient = client;
          renderDetail();
        }
      });
    });

    // Email action
    container.querySelectorAll('[data-action="email"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const client = profiles.find(p => p.id === btn.dataset.id);
        if (client?._email) {
          await mandarAcceso(client, btn);
        } else {
          showToast('No se pudo obtener el email de este cliente', 'error');
        }
      });
    });

    // Delete action
    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const client = profiles.find(p => p.id === btn.dataset.id);
        if (!confirm(`¿Eliminar a "${client?.full_name || 'este cliente'}"? Esta acción no se puede deshacer.`)) return;
        try {
          await deleteProfile(btn.dataset.id);
          showToast('Cliente eliminado', 'success');
          renderList();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });
    });
  }

  // ---- Helper: get email from auth via RPC ----
  async function getAuthEmail(userId) {
    try {
      const { data, error } = await supabase.rpc('get_user_email', { p_user_id: userId });
      if (error) { console.warn('getAuthEmail RPC error:', error.message); return null; }
      return data || null;
    } catch {
      return null;
    }
  }

  // ===================== NEW CLIENT MODAL =====================
  // Fusionar dos fichas duplicadas: una se queda (keep) y absorbe a la otra (drop).
  function openMergeModal() {
    const sel = { keep: null, drop: null };
    openModal('Fusionar fichas duplicadas', `
      <div class="trip-form">
        <p style="font-size:.85rem;color:#64748b;margin:0 0 8px">Todo (reservas, bonos, clases, alquileres, familiares, pedidos) de la ficha duplicada se mueve a la ficha correcta, y la duplicada se elimina. Los familiares repetidos se unen (no quedan "2 Borja").</p>
        <div style="margin:0 0 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <strong style="font-size:.9rem">Duplicados detectados</strong>
            <button type="button" id="mg-rescan" class="btn line" style="font-size:.8rem;padding:4px 10px">Reescanear</button>
          </div>
          <div id="mg-auto"><p style="font-size:.84rem;color:#94a3b8">Buscando…</p></div>
        </div>
        <details style="margin-bottom:6px"><summary style="cursor:pointer;font-size:.86rem;color:#1a1a1a">Fusionar manualmente (elegir las dos fichas)</summary>
        <div style="padding-top:10px">
        <label>Ficha CORRECTA (se queda)</label>
        <div style="position:relative"><input type="text" id="mg-keep" placeholder="Buscar cliente…" autocomplete="off" /><div id="mg-keep-res" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:180px;overflow:auto;box-shadow:0 8px 24px rgba(15,47,57,.12)"></div></div>
        <div id="mg-keep-chip" style="display:none;margin:6px 0;font-size:.85rem;color:#065f46"></div>
        <label style="margin-top:8px">Ficha DUPLICADA (se absorbe y borra)</label>
        <div style="position:relative"><input type="text" id="mg-drop" placeholder="Buscar cliente…" autocomplete="off" /><div id="mg-drop-res" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:180px;overflow:auto;box-shadow:0 8px 24px rgba(15,47,57,.12)"></div></div>
        <div id="mg-drop-chip" style="display:none;margin:6px 0;font-size:.85rem;color:#b91c1c"></div>
        <button class="btn red" id="mg-go" style="margin-top:12px;width:100%">Fusionar</button>
        </div></details>
      </div>
    `);
    // Detección automática de duplicados
    async function loadAuto() {
      const wrap = document.getElementById('mg-auto');
      if (!wrap) return;
      wrap.innerHTML = '<p style="font-size:.84rem;color:#94a3b8">Buscando…</p>';
      let groups = [];
      try { groups = await findDuplicateProfiles(); } catch (e) { wrap.innerHTML = `<p style="font-size:.84rem;color:#b91c1c">Error: ${esc(e.message)}</p>`; return; }
      if (!groups.length) { wrap.innerHTML = '<p style="font-size:.84rem;color:#16a34a">✓ No se detectaron duplicados</p>'; return; }
      // Cargar los HIJOS (familiares) de todas las fichas de los grupos para mostrarlos.
      const allIds = groups.flat().map(p => p.id);
      const famByUser = {};
      try {
        const { data } = await supabase.from('family_members').select('user_id, full_name, last_name').in('user_id', allIds).order('created_at', { ascending: true });
        (data || []).forEach(m => { (famByUser[m.user_id] ||= []).push(m); });
      } catch {}
      wrap.innerHTML = groups.map((g, gi) => {
        const keep = g[0]; // el más antiguo se queda
        const rows = g.map((p, i) => {
          const kids = (famByUser[p.id] || []).map(m => `<div style="font-size:.75rem;color:#1a1a1a;padding-left:18px">↳ ${esc(m.full_name || '')}${m.last_name ? ' ' + esc(m.last_name) : ''}</div>`).join('');
          const kidsLabel = (famByUser[p.id] || []).length ? ` <span style="color:#94a3b8">(${famByUser[p.id].length} familiar${famByUser[p.id].length === 1 ? '' : 'es'})</span>` : '';
          return `<div style="font-size:.82rem;padding:2px 0;${i === 0 ? 'font-weight:700;color:#065f46' : 'color:#64748b'}">${i === 0 ? '✓ se queda · ' : '↳ se absorbe · '}${esc(p.full_name || '')}${p.last_name ? ' ' + esc(p.last_name) : ''}${p.email ? ` · ${esc(p.email)}` : ''}${p.phone ? ` · ${esc(p.phone)}` : ''}${kidsLabel}</div>${kids}`;
        }).join('');
        return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:8px">
          ${rows}
          <button type="button" class="btn red mg-auto-go" data-gi="${gi}" style="margin-top:6px;font-size:.82rem;padding:6px 12px">Fusionar estas ${g.length}</button>
        </div>`;
      }).join('');
      wrap.querySelectorAll('.mg-auto-go').forEach(btn => btn.addEventListener('click', async () => {
        const g = groups[Number(btn.dataset.gi)];
        const keep = g[0];
        if (!confirm(`Fusionar ${g.length} fichas en "${keep.full_name || ''}". El resto se absorbe y se borra. ¿Continuar?`)) return;
        btn.disabled = true; btn.textContent = 'Fusionando…';
        try {
          for (let i = 1; i < g.length; i++) await mergeClients(keep.id, g[i].id);
          showToast('Duplicados fusionados', 'success');
          await loadAuto();
          renderList();
        } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = `Fusionar estas ${g.length}`; }
      }));
    }
    document.getElementById('mg-rescan')?.addEventListener('click', loadAuto);
    loadAuto();
    const wire = (key) => {
      const input = document.getElementById(`mg-${key}`);
      const res = document.getElementById(`mg-${key}-res`);
      const chip = document.getElementById(`mg-${key}-chip`);
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        const term = input.value.trim();
        if (term.length < 2) { res.style.display = 'none'; return; }
        t = setTimeout(async () => {
          const list = await searchProfiles(term);
          res.innerHTML = list.length ? list.map(p => `<div class="mg-opt" data-id="${p.id}" data-name="${esc(p.full_name || '')}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:.86rem">${esc(p.full_name || 'Sin nombre')}${p.phone ? ` · <span style="color:#64748b">${esc(p.phone)}</span>` : ''}</div>`).join('') : '<div style="padding:9px;color:#94a3b8;font-size:.84rem">Sin resultados</div>';
          res.style.display = '';
        }, 250);
      });
      res.addEventListener('click', (e) => {
        const opt = e.target.closest('.mg-opt'); if (!opt) return;
        sel[key] = { id: opt.dataset.id, name: opt.dataset.name };
        res.style.display = 'none'; input.value = '';
        chip.textContent = `${key === 'keep' ? '✓ Se queda' : '🗑 Se borra'}: ${sel[key].name}`;
        chip.style.display = '';
      });
    };
    wire('keep'); wire('drop');
    document.getElementById('mg-go').addEventListener('click', async () => {
      if (!sel.keep || !sel.drop) { showToast('Elige las dos fichas', 'error'); return; }
      if (sel.keep.id === sel.drop.id) { showToast('Son la misma ficha', 'error'); return; }
      if (!confirm(`Fusionar: TODO lo de "${sel.drop.name}" pasará a "${sel.keep.name}" y se borrará la ficha duplicada. ¿Continuar?`)) return;
      const btn = document.getElementById('mg-go'); btn.disabled = true; btn.textContent = 'Fusionando…';
      try {
        const moved = await mergeClients(sel.keep.id, sel.drop.id);
        const n = Object.values(moved).reduce((s, v) => s + v, 0);
        closeModal();
        showToast(`Fusionado · ${n} registro(s) movido(s)`, 'success');
        renderList();
      } catch (err) { showToast('Error: ' + err.message, 'error'); btn.disabled = false; btn.textContent = 'Fusionar'; }
    });
  }

  function openNewClientModal() {
    // La escala real de Waya (niveles 0–5), la misma de niveles.html
    const levelOpts = (sel = '') => clientLevelOptionsHtml(sel);
    const familyRowHtml = () => `
      <div class="ncl-fam-card">
        <button type="button" class="ncl-fam-remove" title="Quitar familiar">✕</button>
        <div class="cli-form-row">
          <div class="act-form-field"><label class="act-form-label">Nombre*</label><input type="text" class="act-form-input ncl-fam-name" placeholder="Nombre" /></div>
          <div class="act-form-field"><label class="act-form-label">Apellidos</label><input type="text" class="act-form-input ncl-fam-last" placeholder="Apellidos" /></div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field"><label class="act-form-label">Fecha de nacimiento</label><input type="date" class="act-form-input ncl-fam-birth" /></div>
          <div class="act-form-field"><label class="act-form-label">Nivel</label><select class="act-form-input ncl-fam-level">${levelOpts()}</select></div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field"><label class="act-form-label">¿Sabe nadar?</label><select class="act-form-input ncl-fam-swim"><option value="">Sin definir</option><option value="true">Sí</option><option value="false">No</option></select></div>
          <div class="act-form-field"><label class="act-form-label">¿Lesión?</label><select class="act-form-input ncl-fam-injury"><option value="false">No</option><option value="true">Sí</option></select></div>
        </div>
        <div class="cli-form-row ncl-fam-injwrap" style="display:none;grid-template-columns:1fr">
          <div class="act-form-field"><label class="act-form-label">Detalle de la lesión</label><input type="text" class="act-form-input ncl-fam-injurydetail" placeholder="Describe la lesión…" /></div>
        </div>
      </div>`;

    openModal('Nuevo Cliente', `
      <form id="new-client-form" class="ncl-form">
        <div class="ncl-card">
          <h3 class="ncl-card-title">Datos del cliente</h3>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Nombre*</label><input type="text" class="act-form-input" name="full_name" required></div>
            <div class="act-form-field"><label class="act-form-label">Apellidos</label><input type="text" class="act-form-input" name="last_name"></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Email*</label><input type="email" class="act-form-input" name="email" required></div>
            <div class="act-form-field"><label class="act-form-label">Teléfono</label><input type="tel" class="act-form-input" name="phone"></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Fecha de nacimiento</label><input type="date" class="act-form-input" name="birth_date"></div>
            <div class="act-form-field"><label class="act-form-label">Nivel</label><select class="act-form-input" name="level">${levelOpts()}</select></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Dirección</label><input type="text" class="act-form-input" name="address"></div>
            <div class="act-form-field"><label class="act-form-label">Ciudad</label><input type="text" class="act-form-input" name="city"></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Código postal</label><input type="text" class="act-form-input" name="postal_code"></div>
            <div class="act-form-field"><label class="act-form-label">Peso (kg)</label><input type="number" class="act-form-input" name="weight_kg" min="1" max="299" step="0.5" placeholder="Ej: 72"></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">Altura (cm)</label><input type="number" class="act-form-input" name="height_cm" min="31" max="259" step="1" placeholder="Ej: 178"></div>
            <div class="act-form-field"></div>
          </div>
          <div class="cli-form-row">
            <div class="act-form-field"><label class="act-form-label">¿Sabe nadar?</label><select class="act-form-input" name="can_swim"><option value="">Sin definir</option><option value="true">Sí</option><option value="false">No</option></select></div>
            <div class="act-form-field"><label class="act-form-label">¿Lesión?</label><select class="act-form-input" name="has_injury" id="ncl-injury"><option value="false">No</option><option value="true">Sí</option></select></div>
          </div>
          <div class="cli-form-row" id="ncl-injury-wrap" style="display:none;grid-template-columns:1fr">
            <div class="act-form-field"><label class="act-form-label">Detalle lesión</label><input type="text" class="act-form-input" name="injury_detail" placeholder="Describe la lesión…"></div>
          </div>
        </div>

        <div class="ncl-card">
          <div class="ncl-card-title-row"><h3 class="ncl-card-title">Familiares</h3><span class="ncl-card-hint">Se crean y se le asignan al cliente</span></div>
          <div id="ncl-family"></div>
          <button type="button" class="btn ghost ncl-add-fam" id="ncl-add-fam">+ Añadir familiar</button>
        </div>

        <button type="submit" class="btn red" style="width:100%;margin-top:4px" id="ncl-submit">Crear cliente</button>
      </form>
    `);

    const famWrap = document.getElementById('ncl-family');
    document.getElementById('ncl-add-fam').addEventListener('click', () => {
      famWrap.insertAdjacentHTML('beforeend', familyRowHtml());
    });
    famWrap.addEventListener('click', (e) => {
      if (e.target.closest('.ncl-fam-remove')) e.target.closest('.ncl-fam-card').remove();
    });
    // Mostrar el detalle de lesión solo si "¿Lesión?" = Sí (por familiar)
    famWrap.addEventListener('change', (e) => {
      if (e.target.classList.contains('ncl-fam-injury')) {
        const card = e.target.closest('.ncl-fam-card');
        card.querySelector('.ncl-fam-injwrap').style.display = e.target.value === 'true' ? '' : 'none';
      }
    });
    const injurySel = document.getElementById('ncl-injury');
    injurySel.addEventListener('change', () => {
      document.getElementById('ncl-injury-wrap').style.display = injurySel.value === 'true' ? '' : 'none';
    });

    // Autocompletado: si ya existe una ficha con ese nombre, avisa y ofrece abrirla
    // (en vez de crear un duplicado).
    attachClientSuggest(document.querySelector('#new-client-form [name="full_name"]'), {
      onPick: (it) => {
        if (it.type === 'family') { showToast(`Ya existe "${it.label}" como familiar de ${it.parentName}`, 'info'); return; }
        if (confirm(`Ya existe una ficha de "${it.label}". ¿Abrir su ficha en vez de crear una nueva?`)) {
          const client = profiles.find(p => p.id === it.id);
          closeModal();
          if (client) { selectedClient = client; renderDetail(); }
        }
      },
    });

    document.getElementById('new-client-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('ncl-submit');
      const o = Object.fromEntries(new FormData(e.target));
      const clientObj = {
        full_name: o.full_name?.trim(),
        last_name: o.last_name?.trim() || null,
        email: o.email?.trim(),
        phone: o.phone?.trim() || null,
        birth_date: o.birth_date || null,
        address: o.address?.trim() || null,
        city: o.city?.trim() || null,
        postal_code: o.postal_code?.trim() || null,
        level: o.level || null,
        // Peso y altura en vez de pedir la talla de neopreno: el cliente rara
        // vez la sabe, y con estos dos datos la escuela la deduce.
        weight_kg: o.weight_kg ? Number(o.weight_kg) : null,
        height_cm: o.height_cm ? Number(o.height_cm) : null,
        can_swim: o.can_swim === 'true' ? true : o.can_swim === 'false' ? false : null,
        has_injury: o.has_injury === 'true',
        injury_detail: o.injury_detail?.trim() || null,
      };
      const familyRows = [...famWrap.querySelectorAll('.ncl-fam-card')].map(r => {
        const swim = r.querySelector('.ncl-fam-swim').value;
        return {
          full_name: r.querySelector('.ncl-fam-name').value.trim(),
          last_name: r.querySelector('.ncl-fam-last').value.trim() || null,
          birth_date: r.querySelector('.ncl-fam-birth').value || null,
          level: r.querySelector('.ncl-fam-level').value || null,
          can_swim: swim === 'true' ? true : swim === 'false' ? false : null,
          has_injury: r.querySelector('.ncl-fam-injury').value === 'true',
          injury_detail: r.querySelector('.ncl-fam-injurydetail').value.trim() || null,
        };
      }).filter(f => f.full_name);

      submitBtn.disabled = true; submitBtn.textContent = 'Creando…';
      try {
        const created = await createClientFromAdmin({ ...clientObj, family: familyRows });
        const famCount = created.family_created || 0;
        closeModal();
        if (created.already_existed) {
          showToast('Ese email ya tenía cuenta · se ha vinculado, sin duplicar ni enviar correo', 'info');
        } else {
          const base = famCount > 0 ? `Cliente creado · ${famCount} familiar(es) añadido(s)` : 'Cliente creado';
          showToast(base + (created.email_sent ? ' · correo de acceso enviado' : ''), 'success');
        }
        renderList();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        submitBtn.disabled = false; submitBtn.textContent = 'Crear cliente';
      }
    });
  }

  // ===================== DETAIL VIEW =====================
  async function renderDetail() {
    const c = selectedClient;
    if (!c) return renderList();

    // Try to fetch auth email (best-effort, cached on client object)
    if (c._email === undefined) {
      c._email = await getAuthEmail(c.id);
      if (c._email) emailCache[c.id] = c._email;
    }

    // Reset cache por render (bonos/enrollments compartidos entre secciones)
    resetClientCache(c.id);

    // Secciones del one-page (orden de scroll) + índice lateral (scrollspy).
    // Las 4 protagonistas primero; el resto debajo. 'datos' trae sus propios
    // títulos desde renderDatosTab, por eso no lleva <h3> de sección.
    const SECTIONS = [
      { id: 'compra', label: 'Resumen de compra', title: 'Resumen de compra', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
      { id: 'clases', label: 'Histórico de clases', title: 'Histórico de clases', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
      { id: 'pagos', label: 'Resumen de pagos', title: 'Resumen de pagos', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
      { id: 'familia', label: 'Familia / Reserva conjunta', title: 'Familia · Reserva conjunta', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
      { id: 'datos', label: 'Datos personales', title: null, icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
      { id: 'camps', label: 'Surf Camps', title: 'Surf Camps', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' },
      { id: 'alquileres', label: 'Alquiler material', title: 'Alquiler de material', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>' },
      { id: 'pedidos', label: 'Pedidos tienda', title: 'Pedidos tienda', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>' },
    ];

    const sectionHtml = SECTIONS.map(s => `
      <section class="cli-section" id="sec-${s.id}" data-toc="sec-${s.id}">
        ${s.title ? `<h3 class="act-detail-section-title">${s.title}</h3>` : ''}
        <div id="sec-${s.id}-body">${s.id === 'datos' ? renderDatosTab(c) : '<div class="act-form-card"><p style="color:var(--color-muted)">Cargando…</p></div>'}</div>
      </section>`).join('');

    container.innerHTML = `
      <div class="act-detail-page">
        <div class="act-detail-topbar">
          <button class="act-back-btn" id="cli-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="act-detail-topbar-info">
            <strong class="act-detail-topbar-name">${esc(c.full_name) || 'Sin nombre'}</strong>
            <div class="act-detail-topbar-meta">
              <span class="act-status-badge ${c.role === 'admin' ? 'active' : ''}">${c.role === 'admin' ? 'Admin' : 'Cliente'}</span>
              <span class="act-detail-topbar-id">Clientes · ${c.id.substring(0, 20)}</span>
            </div>
          </div>
          <span id="cli-debt-badge" class="cli-debt-badge" hidden></span>
        </div>

        <div class="act-detail-layout act-detail-layout--onepage">
          <nav class="cli-toc" id="cli-toc">
            <div class="act-nav-group-label">SECCIONES</div>
            ${SECTIONS.map(s => `
              <a class="cli-toc-item" data-target="sec-${s.id}">${s.icon} ${s.label}</a>
            `).join('')}
          </nav>

          <main class="act-detail-main cli-onepage" id="cli-onepage">
            <div class="cli-kpi-row" id="cli-kpis"></div>
            ${sectionHtml}
          </main>

          <aside class="act-detail-actions">
            <button class="act-action-btn primary" id="cli-save">
              <span>Guardar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            </button>
            ${c._email ? `
            <button class="act-action-link" id="cli-email">
              <span>Enviar acceso a su cuenta</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </button>` : ''}
            <button class="act-action-link danger" id="cli-delete">
              <span>Eliminar</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>

            <div class="cli-other-details">
              <div class="act-nav-group-label" style="margin-top:20px">OTROS DETALLES</div>
              <p class="cli-detail-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                Registrado el ${formatDate(c.created_at)}
              </p>
              ${c._email ? `<p class="cli-detail-note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                ${esc(c._email)}
              </p>` : ''}
            </div>
          </aside>
        </div>
      </div>`;

    // ---- Bind events ----
    container.querySelector('#cli-back').addEventListener('click', () => renderList());

    // Índice lateral: ancla suave a cada sección
    container.querySelectorAll('.cli-toc-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        container.querySelector('#' + item.dataset.target)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    container.querySelector('#cli-save')?.addEventListener('click', () => saveClientData(c));
    container.querySelector('#cli-email')?.addEventListener('click', (e) => {
      if (c._email) mandarAcceso(c, e.currentTarget);
    });
    container.querySelector('#cli-delete')?.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar a "${c.full_name || 'este cliente'}"? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteProfile(c.id);
        showToast('Cliente eliminado', 'success');
        renderList();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    // Injury toggle in datos tab
    container.querySelector('#cli-has-injury')?.addEventListener('change', (e) => {
      const row = container.querySelector('#cli-injury-detail-row');
      if (row) row.style.display = e.target.value === 'true' ? '' : 'none';
    });

    // Cargar todas las secciones del one-page (en paralelo, cada una pinta su body)
    renderKpis(c);
    loadBonosTab(c);
    loadClasesTab(c);
    loadPagosTab(c);
    loadFamiliaTab(c);
    loadReservasTab(c);
    loadAlquileresTab(c);
    loadPedidosTab(c);
    setupScrollSpy();
  }

  // KPIs de la cuenta (total / pendiente / bonos / clases) → #cli-kpis
  function kpiCard(label, value, tone = '') {
    return `<div class="cli-kpi-card ${tone}">
      <div class="cli-kpi-label">${label}</div>
      <div class="cli-kpi-value">${value}</div>
    </div>`;
  }
  async function renderKpis(c) {
    const el = container.querySelector('#cli-kpis');
    const badge = container.querySelector('#cli-debt-badge');
    if (!el) return;
    const r2 = x => Math.round(x * 100) / 100;
    try {
      const [bonos, enrollments] = await Promise.all([getBonos(c), getEnrollments(c)]);
      // Deuda de TODA la cuenta (igual que el filtro "Pago pendiente" del CRM):
      // bonos vivos + clases sueltas (sin bono) + alquileres. Así "cuánto debe" es real.
      let totalExpected = 0, totalPending = 0;
      const liveBonos = (bonos || []).filter(b => b.status === 'active' || b.status === 'exhausted');
      for (const b of liveBonos) {
        const expected = bonoExpected(b);
        totalExpected += expected;
        totalPending += Math.max(0, r2(expected - Number(b.total_paid || 0)));
      }
      // Clases sueltas confirmadas/parciales (bono_id null) → precio - pagos
      const loose = (enrollments || []).filter(e => !e.bono_id && (e.status === 'confirmed' || e.status === 'partial'));
      if (loose.length) {
        const paidByEnr = {};
        try {
          const { data } = await supabase.from('payments').select('reference_id, amount')
            .eq('reservation_type', 'enrollment').in('reference_id', loose.map(e => e.id));
          (data || []).forEach(p => { paidByEnr[p.reference_id] = (paidByEnr[p.reference_id] || 0) + Number(p.amount || 0); });
        } catch {}
        for (const e of loose) {
          const price = classPrice(e.surf_class || {});
          totalExpected += price;
          totalPending += Math.max(0, r2(price - (paidByEnr[e.id] || 0)));
        }
      }
      // Alquileres pendientes (total - pagado)
      try {
        const { data: rentals } = await supabase.from('equipment_reservations')
          .select('total_amount, deposit_paid, status').eq('user_id', c.id)
          .in('status', ['pending', 'confirmed', 'active']);
        for (const rt of (rentals || [])) {
          totalExpected += Number(rt.total_amount || 0);
          totalPending += Math.max(0, r2(Number(rt.total_amount || 0) - Number(rt.deposit_paid || 0)));
        }
      } catch {}
      totalExpected = r2(totalExpected); totalPending = r2(totalPending);
      el.innerHTML =
        kpiCard('Total cuenta', formatCurrency(totalExpected)) +
        kpiCard('Pendiente', formatCurrency(totalPending), totalPending > 0 ? 'warn' : 'ok') +
        kpiCard('Bonos', liveBonos.length) +
        kpiCard('Clases', (enrollments || []).length);
      if (badge) {
        if (totalPending > 0) {
          badge.innerHTML = `<span class="l">Debe</span><span class="v">${formatCurrency(totalPending)}</span>`;
          badge.hidden = false;
        } else { badge.hidden = true; }
      }
    } catch (err) {
      el.innerHTML = kpiCard('Cuenta', '—');
      if (badge) badge.hidden = true;
      console.warn('renderKpis:', err.message);
    }
  }

  // ScrollSpy: marca activo en el índice la sección visible más arriba
  function setupScrollSpy() {
    if (_scrollSpyObserver) { _scrollSpyObserver.disconnect(); _scrollSpyObserver = null; }
    const sections = [...container.querySelectorAll('.cli-section[data-toc]')];
    const tocItems = container.querySelectorAll('.cli-toc-item');
    if (!sections.length || !tocItems.length) return;
    _scrollSpyObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (!visible.length) return;
      const id = visible[0].target.id;
      tocItems.forEach(t => t.classList.toggle('active', t.dataset.target === id));
    }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });
    sections.forEach(s => _scrollSpyObserver.observe(s));
  }

  // Recarga coordinada de las secciones de dinero tras cualquier mutación de pago/total.
  // Incluye Surf Camps y Alquileres porque sus filas muestran estado/señal derivados
  // de payments y deben reflejar el cambio sin recargar la ficha entera.
  function refreshMoneySections(c) {
    resetClientCache(c.id);
    loadBonosTab(c);
    loadPagosTab(c);
    loadReservasTab(c);
    loadAlquileresTab(c);
    renderKpis(c);
  }

  // ===================== TABS =====================

  function renderDatosTab(c) {
    return `
      <h3 class="act-detail-section-title">Datos personales</h3>
      <div class="act-form-card">
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">NOMBRE</label>
            <input type="text" class="act-form-input" id="cli-fullname" value="${esc(c.full_name)}" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">APELLIDOS</label>
            <input type="text" class="act-form-input" id="cli-lastname" value="${esc(c.last_name || '')}" placeholder="Apellidos" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">EMAIL</label>
            <input type="email" class="act-form-input" value="${esc(c._email || '')}" readonly style="background:#f9fafb;cursor:default" placeholder="${c._email ? '' : 'No disponible'}" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">TELÉFONO</label>
            <input type="tel" class="act-form-input" id="cli-phone" value="${esc(c.phone)}" placeholder="+34 600 000 000" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">FECHA DE NACIMIENTO</label>
            <input type="date" class="act-form-input" id="cli-birthdate" value="${c.birth_date || ''}" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">ROL</label>
            <select class="act-form-input" id="cli-role" style="cursor:pointer">
              <option value="client" ${c.role === 'client' ? 'selected' : ''}>Cliente</option>
              <option value="admin" ${c.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </div>
        </div>
      </div>

      <h3 class="act-detail-section-title" style="margin-top:24px">Salud y equipamiento</h3>
      <div class="act-form-card">
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">¿SABE NADAR?</label>
            <select class="act-form-input" id="cli-can-swim">
              <option value="" ${c.can_swim == null ? 'selected' : ''}>Sin definir</option>
              <option value="true" ${c.can_swim === true ? 'selected' : ''}>Sí</option>
              <option value="false" ${c.can_swim === false ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="act-form-field">
            <label class="act-form-label">¿TIENE LESIÓN?</label>
            <select class="act-form-input" id="cli-has-injury">
              <option value="false" ${!c.has_injury ? 'selected' : ''}>No</option>
              <option value="true" ${c.has_injury ? 'selected' : ''}>Sí</option>
            </select>
          </div>
        </div>
        <div class="cli-form-row" id="cli-injury-detail-row" style="${c.has_injury ? '' : 'display:none'}">
          <div class="act-form-field">
            <label class="act-form-label">DETALLE LESIÓN</label>
            <input type="text" class="act-form-input" id="cli-injury-detail" value="${esc(c.injury_detail)}" placeholder="Describe la lesión…" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">PESO (KG)</label>
            <input type="number" class="act-form-input" id="cli-weight" min="1" max="299" step="0.5"
                   value="${c.weight_kg ?? ''}" placeholder="Ej: 72">
          </div>
          <div class="act-form-field">
            <label class="act-form-label">ALTURA (CM)</label>
            <input type="number" class="act-form-input" id="cli-height" min="31" max="259" step="1"
                   value="${c.height_cm ?? ''}" placeholder="Ej: 178">
          </div>
        </div>
      </div>

      <h3 class="act-detail-section-title" style="margin-top:24px">Dirección</h3>
      <div class="act-form-card">
        <div class="cli-form-row">
          <div class="act-form-field" style="flex:2">
            <label class="act-form-label">DIRECCIÓN</label>
            <input type="text" class="act-form-input" id="cli-address" value="${esc(c.address)}" placeholder="Calle, número, piso…" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">CIUDAD</label>
            <input type="text" class="act-form-input" id="cli-city" value="${esc(c.city)}" placeholder="Roche, Cádiz" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">CÓDIGO POSTAL</label>
            <input type="text" class="act-form-input" id="cli-postal" value="${esc(c.postal_code)}" placeholder="11149" />
          </div>
        </div>
      </div>`;
  }

  // ===================== FAMILIA TAB =====================
  async function loadFamiliaTab(c) {
    const el = container.querySelector('#sec-familia-body');
    if (!el) return;
    try {
      const members = await fetchClientFamilyMembers(c.id);

      let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <span class="cli-sec-count">${members.length} miembro(s)</span>
          <button class="btn red" id="cli-add-family" style="font-size:.82rem;padding:6px 14px">+ Añadir miembro</button>
        </div>`;

      if (members.length) {
        html += `<div class="cli-family-grid">`;
        for (const m of members) {
          const age = m.birth_date ? calcAge(m.birth_date) : null;
          html += `
            <div class="cli-family-card" data-member-id="${m.id}">
              <div class="cli-family-card-header">
                <div class="cli-family-avatar">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div>
                  <strong class="cli-family-name">${esc(m.full_name)}</strong>
                  <div class="cli-family-meta">
                    ${age !== null ? `<span>${age} años</span>` : ''}
                    ${m.level ? `<span class="cli-family-level">${clientLevelLabel(m.level)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="cli-family-card-body">
                ${m.birth_date ? `<div class="cli-family-field"><span class="cli-family-field-label">Nacimiento</span><span>${formatDate(m.birth_date)}</span></div>` : ''}
                ${m.level ? `<div class="cli-family-field"><span class="cli-family-field-label">Nivel</span><span>${clientLevelLabel(m.level)}</span></div>` : ''}
                ${m.weight_kg ? `<div class="cli-family-field"><span class="cli-family-field-label">Peso</span><span>${m.weight_kg} kg</span></div>` : ''}
                ${m.height_cm ? `<div class="cli-family-field"><span class="cli-family-field-label">Altura</span><span>${m.height_cm} cm</span></div>` : ''}
                ${m.can_swim === false ? `<div class="cli-family-field"><span class="cli-family-field-label" style="color:#b91c1c">⚠ No sabe nadar</span></div>` : ''}
                ${m.has_injury ? `<div class="cli-family-field"><span class="cli-family-field-label" style="color:#b91c1c">⚠ Lesión</span><span>${esc(m.injury_detail) || 'Sí'}</span></div>` : ''}
                ${m.notes ? `<div class="cli-family-field"><span class="cli-family-field-label">Notas</span><span>${esc(m.notes)}</span></div>` : ''}
              </div>
              <div class="cli-family-card-actions">
                <button class="btn line" data-action="view-member" data-id="${m.id}" style="font-size:.78rem;padding:5px 10px">Ver ficha</button>
                <button class="btn line" data-action="edit-member" data-id="${m.id}" style="font-size:.78rem;padding:5px 10px">Editar</button>
                <button class="btn line" data-action="delete-member" data-id="${m.id}" style="font-size:.78rem;padding:5px 10px;color:#b91c1c;border-color:#b91c1c">Eliminar</button>
              </div>
            </div>`;
        }
        html += `</div>`;
      } else {
        html += `<div class="act-form-card">
          <div class="admin-empty">
            <p>Este cliente no tiene miembros familiares registrados.</p>
            <p style="font-size:.85rem;color:var(--color-muted);margin-top:4px">Los hijos y acompañantes se pueden añadir aquí o desde la cuenta del cliente.</p>
          </div>
        </div>`;
      }

      el.innerHTML = html;

      // Add member
      el.querySelector('#cli-add-family')?.addEventListener('click', () => openFamilyMemberModal(c.id, null));

      // Edit member
      el.querySelectorAll('[data-action="edit-member"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const m = members.find(x => x.id === btn.dataset.id);
          if (m) openFamilyMemberModal(c.id, m);
        });
      });

      // View member ficha
      el.querySelectorAll('[data-action="view-member"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const m = members.find(x => x.id === btn.dataset.id);
          if (m) openMemberFicha(c, m);
        });
      });

      // Delete member
      el.querySelectorAll('[data-action="delete-member"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const m = members.find(x => x.id === btn.dataset.id);
          if (!confirm(`¿Eliminar a "${m?.full_name || 'este miembro'}"?`)) return;
          try {
            await deleteFamilyMemberAdmin(btn.dataset.id);
            showToast('Miembro eliminado', 'success');
            loadFamiliaTab(c);
          } catch (err) {
            showToast('Error: ' + err.message, 'error');
          }
        });
      });

    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando familia: ${esc(err.message)}</p></div>`;
    }
  }

  function openFamilyMemberModal(userId, member) {
    const isEdit = !!member;
    openModal(isEdit ? 'Editar miembro' : 'Añadir miembro familiar', `
      <form id="family-member-form" class="fm-modal-form">
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">Nombre</label>
            <input type="text" class="act-form-input" name="full_name" value="${esc(member?.full_name)}" placeholder="Nombre" required />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">Apellidos</label>
            <input type="text" class="act-form-input" name="last_name" value="${esc(member?.last_name || '')}" placeholder="Apellidos" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">Fecha de nacimiento</label>
            <input type="date" class="act-form-input" name="birth_date" value="${member?.birth_date || ''}" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">Nivel</label>
            <select class="act-form-input" name="level">
              <option value="">Sin definir</option>
              <option value="principiante" ${member?.level === 'principiante' ? 'selected' : ''}>Principiante</option>
              <option value="intermedio" ${member?.level === 'intermedio' ? 'selected' : ''}>Intermedio</option>
              <option value="avanzado" ${member?.level === 'avanzado' ? 'selected' : ''}>Avanzado</option>
            </select>
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">¿Sabe nadar?</label>
            <select class="act-form-input" name="can_swim">
              <option value="" ${member?.can_swim == null ? 'selected' : ''}>Sin definir</option>
              <option value="true" ${member?.can_swim === true ? 'selected' : ''}>Sí</option>
              <option value="false" ${member?.can_swim === false ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="act-form-field">
            <label class="act-form-label">Peso (kg)</label>
            <input type="number" class="act-form-input" name="weight_kg" min="1" max="299" step="0.5"
                   value="${member?.weight_kg ?? ''}" placeholder="Ej: 45">
          </div>
          <div class="act-form-field">
            <label class="act-form-label">Altura (cm)</label>
            <input type="number" class="act-form-input" name="height_cm" min="31" max="259" step="1"
                   value="${member?.height_cm ?? ''}" placeholder="Ej: 150">
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">¿Tiene lesión?</label>
            <select class="act-form-input" name="has_injury" id="fm-has-injury">
              <option value="false" ${!member?.has_injury ? 'selected' : ''}>No</option>
              <option value="true" ${member?.has_injury ? 'selected' : ''}>Sí</option>
            </select>
          </div>
          <div class="act-form-field" id="fm-injury-wrap" style="${member?.has_injury ? '' : 'display:none'}">
            <label class="act-form-label">Detalle lesión</label>
            <input type="text" class="act-form-input" name="injury_detail" value="${esc(member?.injury_detail)}" placeholder="Describe la lesión…" />
          </div>
        </div>
        <div class="cli-form-row" style="grid-template-columns:1fr">
          <div class="act-form-field">
            <label class="act-form-label">Notas</label>
            <input type="text" class="act-form-input" name="notes" value="${esc(member?.notes)}" placeholder="Alergias, observaciones…" />
          </div>
        </div>
        <button type="submit" class="btn red" style="margin-top:4px;width:100%">${isEdit ? 'Guardar cambios' : 'Añadir miembro'}</button>
      </form>
    `);

    // Mostrar "Detalle lesión" solo si hay lesión
    const injurySel = document.getElementById('fm-has-injury');
    const injuryWrap = document.getElementById('fm-injury-wrap');
    injurySel?.addEventListener('change', () => {
      injuryWrap.style.display = injurySel.value === 'true' ? '' : 'none';
    });

    document.getElementById('family-member-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const fields = Object.fromEntries(fd);
      if (!fields.last_name?.trim()) fields.last_name = null;
      if (!fields.birth_date) fields.birth_date = null;
      if (!fields.level) fields.level = null;
      if (!fields.notes) fields.notes = null;
      fields.can_swim = fields.can_swim === 'true' ? true : fields.can_swim === 'false' ? false : null;
      fields.has_injury = fields.has_injury === 'true';
      if (!fields.injury_detail) fields.injury_detail = null;
      fields.weight_kg = fields.weight_kg ? Number(fields.weight_kg) : null;
      fields.height_cm = fields.height_cm ? Number(fields.height_cm) : null;
      try {
        if (isEdit) {
          await updateFamilyMemberAdmin(member.id, fields);
        } else {
          await createFamilyMemberAdmin(userId, fields);
        }
        closeModal();
        showToast(isEdit ? 'Miembro actualizado' : 'Miembro añadido', 'success');
        loadFamiliaTab(selectedClient);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  // ---- Member ficha (sub-panel inside Familia tab) ----
  async function openMemberFicha(client, member) {
    const el = container.querySelector('#sec-familia-body');
    if (!el) return;
    const age = member.birth_date ? calcAge(member.birth_date) : null;

    // Fetch enrollments and parent's rentals for this family member
    let enrollments = [];
    let rentals = [];
    try {
      const [enrRes, rentalRes] = await Promise.all([
        fetchFamilyMemberEnrollments(member.id),
        supabase.from('equipment_reservations').select('*, rental_equipment(name, type)').eq('user_id', client.id).order('created_at', { ascending: false }).limit(20).then(r => r.data || []).catch(() => []),
      ]);
      enrollments = enrRes;
      rentals = rentalRes;
    } catch {}

    const memberFullName = `${esc(member.full_name)}${member.last_name ? ' ' + esc(member.last_name) : ''}`;

    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="act-back-btn" id="member-back" style="position:static">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h3 class="act-detail-section-title" style="margin:0">Ficha de ${memberFullName}</h3>
            <div style="font-size:.78rem;color:var(--color-muted);margin-top:2px">Familiar de <strong>${esc(client.full_name)}${client.last_name ? ' ' + esc(client.last_name) : ''}</strong>${age !== null ? ' · ' + age + ' años' : ''}</div>
          </div>
        </div>
        <button class="btn red" id="member-save" style="font-size:.82rem;padding:8px 18px">Guardar cambios</button>
      </div>

      <div class="act-form-card">
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">NOMBRE</label>
            <input type="text" class="act-form-input" id="mf-fullname" value="${esc(member.full_name)}" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">APELLIDOS</label>
            <input type="text" class="act-form-input" id="mf-lastname" value="${esc(member.last_name || '')}" placeholder="Apellidos" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">RESPONSABLE</label>
            <input type="text" class="act-form-input" value="${esc(client.full_name)}${client.last_name ? ' ' + esc(client.last_name) : ''} (titular)" readonly style="background:#f9fafb" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">FECHA DE NACIMIENTO</label>
            <input type="date" class="act-form-input" id="mf-birthdate" value="${member.birth_date || ''}" />
          </div>
          <div class="act-form-field">
            <label class="act-form-label">NIVEL</label>
            <select class="act-form-input" id="mf-level">
              <option value="">Sin definir</option>
              <option value="principiante" ${member.level === 'principiante' ? 'selected' : ''}>Principiante</option>
              <option value="intermedio" ${member.level === 'intermedio' ? 'selected' : ''}>Intermedio</option>
              <option value="avanzado" ${member.level === 'avanzado' ? 'selected' : ''}>Avanzado</option>
            </select>
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">¿SABE NADAR?</label>
            <select class="act-form-input" id="mf-swim">
              <option value="" ${member.can_swim == null ? 'selected' : ''}>Sin definir</option>
              <option value="true" ${member.can_swim === true ? 'selected' : ''}>Sí</option>
              <option value="false" ${member.can_swim === false ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="act-form-field">
            <label class="act-form-label">PESO (KG)</label>
            <input type="number" class="act-form-input" id="mf-weight" min="1" max="299" step="0.5"
                   value="${member.weight_kg ?? ''}" placeholder="Ej: 45">
          </div>
          <div class="act-form-field">
            <label class="act-form-label">ALTURA (CM)</label>
            <input type="number" class="act-form-input" id="mf-height" min="31" max="259" step="1"
                   value="${member.height_cm ?? ''}" placeholder="Ej: 150">
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">¿TIENE LESIÓN?</label>
            <select class="act-form-input" id="mf-injury">
              <option value="false" ${!member.has_injury ? 'selected' : ''}>No</option>
              <option value="true" ${member.has_injury ? 'selected' : ''}>Sí</option>
            </select>
          </div>
          <div class="act-form-field" id="mf-injury-detail-wrap" style="${member.has_injury ? '' : 'display:none'}">
            <label class="act-form-label">DETALLE LESIÓN</label>
            <input type="text" class="act-form-input" id="mf-injury-detail" value="${esc(member.injury_detail)}" placeholder="Describe la lesión…" />
          </div>
        </div>
        <div class="cli-form-row">
          <div class="act-form-field">
            <label class="act-form-label">NOTAS</label>
            <input type="text" class="act-form-input" id="mf-notes" value="${esc(member.notes)}" placeholder="Alergias, observaciones…" />
          </div>
        </div>
      </div>

      <h3 class="act-detail-section-title" style="margin-top:24px">Historial de clases (${enrollments.length})</h3>`;

    if (enrollments.length) {
      const rows = enrollments.map(e => {
        const cls = e.surf_class || {};
        return `<tr>
          <td>${formatDate(cls.date)}</td>
          <td>${TYPE_LABELS[cls.type] || cls.type || '—'}</td>
          <td>${esc(cls.title) || '—'}</td>
          <td>${cls.time_start?.slice(0, 5) || '—'} — ${cls.time_end?.slice(0, 5) || '—'}</td>
          <td>${statusBadge(e.status || 'confirmed')}</td>
        </tr>`;
      }).join('');

      html += `<div class="act-form-card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Clase</th><th>Horario</th><th>Estado</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    } else {
      html += `<div class="act-form-card">
        <div class="admin-empty"><p>No tiene clases registradas</p></div>
      </div>`;
    }

    // Equipment rentals (from parent account)
    if (rentals.length) {
      html += `<h3 class="act-detail-section-title" style="margin-top:24px">Alquiler de material — cuenta de ${esc(client.full_name)} (${rentals.length})</h3>`;
      const rentalRows = rentals.map(r => `<tr>
        <td>${r.rental_equipment?.name || '—'}</td>
        <td>${r.rental_equipment?.type || '—'}</td>
        <td>${r.date_start || '—'} — ${r.date_end || '—'}</td>
        <td>${r.size || '—'}</td>
        <td>${statusBadge(r.status || 'pending')}</td>
      </tr>`).join('');
      html += `<div class="act-form-card" style="padding:0;overflow:hidden">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Material</th><th>Tipo</th><th>Periodo</th><th>Talla</th><th>Estado</th></tr></thead>
            <tbody>${rentalRows}</tbody>
          </table>
        </div>
      </div>`;
    }

    el.innerHTML = html;

    el.querySelector('#member-back')?.addEventListener('click', () => loadFamiliaTab(client));

    // Injury toggle
    el.querySelector('#mf-injury')?.addEventListener('change', (e) => {
      const wrap = el.querySelector('#mf-injury-detail-wrap');
      if (wrap) wrap.style.display = e.target.value === 'true' ? '' : 'none';
    });

    // Save member
    el.querySelector('#member-save')?.addEventListener('click', async () => {
      const fields = {
        full_name: el.querySelector('#mf-fullname')?.value?.trim() || member.full_name,
        last_name: el.querySelector('#mf-lastname')?.value?.trim() || null,
        birth_date: el.querySelector('#mf-birthdate')?.value || null,
        level: el.querySelector('#mf-level')?.value || null,
        can_swim: el.querySelector('#mf-swim')?.value === 'true' ? true : el.querySelector('#mf-swim')?.value === 'false' ? false : null,
        has_injury: el.querySelector('#mf-injury')?.value === 'true',
        injury_detail: el.querySelector('#mf-injury-detail')?.value?.trim() || null,
        weight_kg: el.querySelector('#mf-weight')?.value ? Number(el.querySelector('#mf-weight').value) : null,
        height_cm: el.querySelector('#mf-height')?.value ? Number(el.querySelector('#mf-height').value) : null,
        notes: el.querySelector('#mf-notes')?.value?.trim() || null,
      };
      try {
        await updateFamilyMemberAdmin(member.id, fields);
        Object.assign(member, fields);
        showToast('Miembro actualizado', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  function calcAge(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  async function loadClasesTab(c) {
    const el = container.querySelector('#sec-clases-body');
    if (!el) return;
    try {
      const enrollments = await getEnrollments(c);

      if (!enrollments.length) {
        el.innerHTML = `
          <div class="act-form-card">
            <div class="admin-empty"><p>Este cliente no tiene clases registradas</p></div>
          </div>`;
        return;
      }

      const rows = enrollments.map((e, i) => {
        const cls = e.surf_class || {};
        const memberLbl = memberDisplayName(e.family_member);
        const bonoCell = e.bono
          ? `<span class="cli-bono-pill" style="--pill:${bonoPillColor(e.bono.id)}">${TYPE_LABELS[e.bono.class_type] || e.bono.class_type} · #${e.bono.id.slice(0, 6)}</span>`
          : '<span class="cli-loose-tag">Suelta</span>';
        return `<tr class="cli-row-click" data-idx="${i}" style="cursor:pointer">
          <td>${formatDate(cls.date)}</td>
          <td>${TYPE_LABELS[cls.type] || cls.type || '—'}</td>
          <td>${esc(cls.title) || '—'}</td>
          <td>${cls.time_start?.slice(0, 5) || '—'} — ${cls.time_end?.slice(0, 5) || '—'}</td>
          <td>${esc(memberLbl)}</td>
          <td>${bonoCell}</td>
          <td>${statusBadge(e.status || 'confirmed')}</td>
        </tr>`;
      }).join('');

      el.innerHTML = `
        <div class="cli-sec-count" style="margin-bottom:10px">${enrollments.length} clase(s)</div>
        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Fecha</th><th>Tipo</th><th>Clase</th><th>Horario</th><th>Asistente</th><th>Bono</th><th>Estado</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;

      el.querySelectorAll('.cli-row-click').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx);
          const enr = enrollments[idx];
          if (enr) openEnrollmentDetailModal(c, enr);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando clases: ${esc(err.message)}</p></div>`;
    }
  }

  async function loadBonosTab(c) {
    const el = container.querySelector('#sec-compra-body');
    if (!el) return;
    try {
      const [bonos, enrollments] = await Promise.all([getBonos(c), getEnrollments(c)]);

      const header = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <span class="cli-sec-count">${bonos.length} bono(s)</span>
          <button class="btn red" id="cli-create-bono-btn" style="font-size:.82rem;padding:8px 14px">+ Nuevo bono</button>
        </div>`;

      if (!bonos.length) {
        el.innerHTML = `
          ${header}
          <div class="act-form-card">
            <div class="admin-empty"><p>Este cliente no tiene bonos</p></div>
          </div>`;
        el.querySelector('#cli-create-bono-btn')?.addEventListener('click', () => openCreateBonoModal(c));
        return;
      }

      // Tipos con >1 bono activo → habilita el toggle "aplicar a todos los de este tipo"
      const activeTypeCounts = {};
      bonos.filter(b => b.status === 'active' || b.status === 'exhausted').forEach(b => { activeTypeCounts[b.class_type] = (activeTypeCounts[b.class_type] || 0) + 1; });

      const cards = bonos.map(b => {
        const remaining = b.total_credits - b.used_credits;
        const pct = b.total_credits > 0 ? Math.round((b.used_credits / b.total_credits) * 100) : 0;
        // Total real del bono (descuento/precio a medida si se fijó) y pagado real
        const expectedPrice = bonoExpected(b);
        const paid = Number(b.total_paid || 0);
        const pending = Math.max(0, Math.round((expectedPrice - paid) * 100) / 100);
        const isFullyPaid = pending <= 0;
        const breakdown = computeBonoBreakdown(b, enrollments);
        const hasFamily = breakdown.some(m => m.key !== 'titular');
        const canScopeAll = (activeTypeCounts[b.class_type] || 0) > 1;
        const typeLabel = TYPE_LABELS[b.class_type] || b.class_type;
        return `
          <div class="cli-bono-card" data-bono-id="${b.id}">
            <div class="cli-bono-header">
              <strong>${typeLabel} — ${b.total_credits} clases</strong>
              <div style="display:flex;gap:6px;align-items:center">
                ${statusBadge(b.status)}
                ${isFullyPaid
                  ? '<span style="font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:4px;background:#dcfce7;color:#166534">PAGADO</span>'
                  : '<span style="font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#92400e">DEBE ' + formatCurrency(pending) + '</span>'
                }
              </div>
            </div>
            <div class="cli-bono-credits">
              <span>${b.used_credits} / ${b.total_credits} sesiones usadas</span>
              <span class="cli-bono-remaining">${remaining} restantes</span>
            </div>
            <div class="cli-bono-bar">
              <div class="cli-bono-bar-fill" style="width:${pct}%;background:${isFullyPaid ? '#22c55e' : '#f59e0b'}"></div>
            </div>
            <div class="cli-bono-meta">
              <span>Pagado: ${formatCurrency(paid)} de ${formatCurrency(expectedPrice)}</span>
              <span class="cli-bono-caduca">Caduca: ${formatDate(b.expires_at)}</span>
            </div>
            ${b.order_id != null ? '<div class="cli-bono-online-note">Bono comprado online</div>' : ''}
            ${hasFamily ? `
            <div class="cli-conjunta">
              <div class="cli-conjunta-title">Reserva conjunta · Responsable: ${esc(c.full_name) || '—'}</div>
              <div class="cli-conjunta-members">
                ${breakdown.map(m => `<span class="cli-conjunta-member">${esc(m.name)}: ${m.count} clase${m.count === 1 ? '' : 's'}</span>`).join('')}
              </div>
            </div>` : ''}
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <button class="btn cli-bono-ficha-btn" data-bono-id="${b.id}" style="flex:1;min-width:140px;font-size:.78rem;padding:6px 14px;background:#0f2f39;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Ver / gestionar ficha</button>
            </div>
          </div>`;
      }).join('');

      el.innerHTML = `
        ${header}
        <div class="cli-bonos-grid">${cards}</div>`;

      el.querySelector('#cli-create-bono-btn')?.addEventListener('click', () => openCreateBonoModal(c));

      // La gestión del bono (pagar, ampliar, editar total) vive en la FICHA ÚNICA:
      // tarjeta y botón abren el mismo componente que reserva-clases y calendario.
      el.querySelectorAll('.cli-bono-card, .cli-bono-ficha-btn').forEach(node => {
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = node.dataset.bonoId || node.closest('.cli-bono-card')?.dataset.bonoId;
          if (id) openBonoFicha(id, { onChange: () => refreshMoneySections(c) });
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando bonos: ${esc(err.message)}</p></div>`;
    }
  }


  // ---- Crear bono nuevo ----
  function openCreateBonoModal(c) {
    const typeOptions = Object.entries(TYPE_LABELS)
      .map(([val, label]) => `<option value="${val}">${label}</option>`)
      .join('');

    const defaultType = 'grupal';
    const defaultCredits = 4;
    const defaultPrice = getPackPrice(defaultType, defaultCredits);
    const newExpiresAt = new Date();
    newExpiresAt.setMonth(newExpiresAt.getMonth() + 12);

    openModal('Nuevo bono', `
      <form id="cli-new-bono-form" class="trip-form" style="min-width:min(340px,100%)">
        <label>Tipo de clase</label>
        <select id="cli-nb-type" class="act-form-input" required style="margin-bottom:10px">${typeOptions}</select>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label>Nº de clases</label>
            <input type="number" id="cli-nb-credits" class="act-form-input" min="1" step="1" value="${defaultCredits}" required />
          </div>
          <div>
            <label>Caduca</label>
            <input type="date" id="cli-nb-expires" class="act-form-input" value="${newExpiresAt.toISOString().slice(0,10)}" required />
          </div>
        </div>

        <label style="margin-top:10px">Precio total del bono (€)</label>
        <input type="number" id="cli-nb-total" class="act-form-input" step="0.01" min="0" value="${defaultPrice.toFixed(2)}" required style="margin-bottom:4px" />
        <small style="color:#6b7280;display:block;margin-bottom:10px">Lo que cuesta el bono. Sugerido por catálogo; bájalo para aplicar descuento.</small>

        <label>Cobrar ahora (€)</label>
        <input type="number" id="cli-nb-amount" class="act-form-input" step="0.01" min="0" value="${defaultPrice.toFixed(2)}" style="margin-bottom:4px" />
        <small style="color:#6b7280;display:block;margin-bottom:10px"><strong>0 = dejar todo pendiente</strong> · menos que el total = anticipo (resto a deber).</small>

        <label>Método de pago</label>
        <select id="cli-nb-method" class="act-form-input" style="margin-bottom:16px">
          <option value="efectivo">Efectivo</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="transferencia">Transferencia</option>
          <option value="voucher">Voucher</option>
          <option value="saldo">Saldo a favor</option>
        </select>

        <button type="submit" class="btn red" id="cli-nb-submit" style="width:100%;padding:10px">Crear bono</button>
      </form>
    `);

    const typeSel = document.getElementById('cli-nb-type');
    const credInput = document.getElementById('cli-nb-credits');
    const amountInput = document.getElementById('cli-nb-amount');
    const totalInput = document.getElementById('cli-nb-total');
    let _amountTouched = false, _totalTouched = false;
    amountInput?.addEventListener('input', () => { _amountTouched = true; });
    totalInput?.addEventListener('input', () => { _totalTouched = true; });

    // Sugiere precio total y cobro según tipo/créditos mientras no se toquen a mano
    function recalcSuggested() {
      const t = typeSel.value;
      const credits = parseInt(credInput.value) || 0;
      if (credits > 0) {
        const sug = getPackPrice(t, credits).toFixed(2);
        if (!_totalTouched) totalInput.value = sug;
        if (!_amountTouched) amountInput.value = sug;
      }
    }
    typeSel?.addEventListener('change', recalcSuggested);
    credInput?.addEventListener('input', recalcSuggested);

    document.getElementById('cli-new-bono-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const classType = typeSel.value;
      const credits = parseInt(credInput.value) || 0;
      const total = parseFloat(totalInput.value) || 0;
      let amount = parseFloat(amountInput.value) || 0;        // cobrar ahora (0 = pendiente)
      amount = Math.min(Math.max(0, amount), total);          // no cobrar más que el total
      const method = document.getElementById('cli-nb-method').value;
      const expiresAtStr = document.getElementById('cli-nb-expires').value;
      if (credits <= 0) { showToast('El bono debe tener al menos 1 clase', 'error'); return; }
      if (!expiresAtStr) { showToast('Indica la fecha de caducidad', 'error'); return; }
      if (amount > 0 && !method) { showToast('Elige un método de pago para el cobro', 'error'); return; }

      const btn = document.getElementById('cli-nb-submit');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const bonoId = await createBono({
          user_id: c.id, class_type: classType, total_credits: credits,
          custom_total: total, total_paid: 0,   // precio fijado; total_paid lo deriva el pago
          expires_at: new Date(expiresAtStr + 'T23:59:59').toISOString(),
        });

        if (method === 'saldo' && amount > 0) {
          const currentBalance = Number(c.credit_balance || 0);
          await supabase.from('profiles').update({ credit_balance: Math.max(0, currentBalance - amount) }).eq('id', c.id);
          c.credit_balance = Math.max(0, currentBalance - amount);
        }

        if (amount > 0 && bonoId) {
          await createPayment({
            reservation_type: 'bono',
            reference_id: bonoId,
            amount,
            payment_method: method,
            concept: `Nuevo bono ${TYPE_LABELS[classType] || classType} (${credits} clases)`,
          });
          await recalcBonoPaid(bonoId);  // total_paid = SUM(payments)
        }

        const pendiente = Math.max(0, Math.round((total - amount) * 100) / 100);
        showToast(`Bono creado · cobrado ${formatCurrency(amount)}${pendiente > 0 ? ` · pendiente ${formatCurrency(pendiente)}` : ' · pagado'}`, 'success');
        closeModal();
        refreshMoneySections(c);
      } catch (err) {
        console.error('Error creando bono:', err);
        showToast('Error: ' + (err.message || 'No se pudo crear'), 'error');
        btn.disabled = false; btn.textContent = 'Crear bono';
      }
    });
  }

  // ---- Helpers para fichas de detalle ----
  const METHOD_LBL = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', voucher: 'Voucher', online: 'Online', saldo: 'Saldo a favor' };
  const ENROLL_STATUS_OPTIONS = [
    { v: 'confirmed', l: 'Confirmado' },
    { v: 'partial', l: 'Anticipo pagado' },
    { v: 'paid', l: 'Pagado' },
    { v: 'cancelled', l: 'Cancelado' },
  ];
  const RENTAL_STATUS_OPTIONS = [
    { v: 'pending', l: 'Pendiente' },
    { v: 'confirmed', l: 'Confirmado' },
    { v: 'active', l: 'Activo' },
    { v: 'returned', l: 'Devuelto' },
    { v: 'cancelled', l: 'Cancelado' },
  ];

  function paymentsListHtml(payments, onDeleteId = true) {
    if (!payments.length) return '<p style="font-size:.82rem;color:#6b7280;margin:6px 0 0">Sin pagos registrados</p>';
    return payments.map(p => {
      const d = new Date(p.payment_date || p.created_at);
      const dateLbl = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `
        <div class="cli-pay-item" data-payment-id="${p.id}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;margin-top:6px;background:#fff">
          <div style="font-size:.82rem;color:#0f2f39">
            <strong>${formatCurrency(p.amount)}</strong> · ${METHOD_LBL[p.payment_method] || p.payment_method}
            <div style="font-size:.72rem;color:#6b7280">${dateLbl}${p.concept ? ' · ' + esc(p.concept) : ''}</div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="cli-pay-edit-inline" data-payment-id="${p.id}" title="Editar" style="background:none;border:none;cursor:pointer;color:#1a1a1a;padding:4px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="cli-pay-del-inline" data-payment-id="${p.id}" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#dc2626;padding:4px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  function bindPaymentsListEvents(rootEl, c, payments, reloadFn) {
    rootEl.querySelectorAll('.cli-pay-edit-inline').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = payments.find(pp => pp.id === btn.dataset.paymentId);
        if (p) openPaymentEditModal(p, { onSaved: reloadFn });
      });
    });
    rootEl.querySelectorAll('.cli-pay-del-inline').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = payments.find(pp => pp.id === btn.dataset.paymentId);
        if (!p) return;
        if (!confirm(`¿Eliminar este pago de ${formatCurrency(p.amount)}?`)) return;
        try {
          await deletePayment(p.id);
          await recalcPaymentState(p.reservation_type, p.reference_id);
          showToast('Pago eliminado · estado recalculado', 'success');
          reloadFn();
        } catch (err) { showToast('Error: ' + err.message, 'error'); }
      });
    });
  }

  // ---- Ficha de inscripción (clase individual) ----
  async function openEnrollmentDetailModal(c, enr) {
    const cls = enr.surf_class || {};
    const typeLbl = TYPE_LABELS[cls.type] || cls.type || '—';
    const totalClase = classPrice(cls);
    const payments = await fetchPayments('enrollment', enr.id);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const pending = Math.max(0, Math.round((totalClase - totalPaid) * 100) / 100);

    const statusOptions = ENROLL_STATUS_OPTIONS
      .map(o => `<option value="${o.v}" ${o.v === enr.status ? 'selected' : ''}>${o.l}</option>`).join('');

    openModal('Inscripción a clase', `
      <div style="min-width:min(340px,100%)">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-weight:700;color:#0f2f39">${typeLbl}${cls.title ? ' · ' + esc(cls.title) : ''}</div>
          <div style="font-size:.82rem;color:#6b7280;margin-top:2px">${formatDate(cls.date)} · ${cls.time_start?.slice(0,5) || ''} — ${cls.time_end?.slice(0,5) || ''}</div>
          ${cls.instructor ? `<div style="font-size:.78rem;color:#6b7280">Instructor: ${esc(cls.instructor)}</div>` : ''}
        </div>

        <label>Estado de la inscripción</label>
        <select id="cli-enr-status" class="act-form-input" style="margin-bottom:14px">${statusOptions}</select>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;font-size:.82rem">
          <div style="padding:8px;background:#f0fdf4;border-radius:8px"><div style="color:#065f46;font-size:.7rem;text-transform:uppercase">Precio</div><strong>${formatCurrency(totalClase)}</strong></div>
          <div style="padding:8px;background:#eff6ff;border-radius:8px"><div style="color:#1e40af;font-size:.7rem;text-transform:uppercase">Pagado</div><strong>${formatCurrency(totalPaid)}</strong></div>
          <div style="padding:8px;background:${pending > 0 ? '#fef2f2' : '#f0fdf4'};border-radius:8px"><div style="color:${pending > 0 ? '#b91c1c' : '#065f46'};font-size:.7rem;text-transform:uppercase">Pendiente</div><strong>${formatCurrency(pending)}</strong></div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 4px">
          <label style="margin:0">Pagos</label>
          <button class="btn" id="cli-enr-add-pay" style="font-size:.74rem;padding:4px 10px;background:#22c55e;color:#fff;border:none;border-radius:6px;cursor:pointer">+ Pago</button>
        </div>
        <div id="cli-enr-payments">${paymentsListHtml(payments)}</div>

        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn" id="cli-enr-delete" style="flex:1;background:#fee2e2;color:#b91c1c;border:none;padding:9px;border-radius:8px;cursor:pointer;font-weight:600">Eliminar inscripción</button>
          <button class="btn red" id="cli-enr-close" style="flex:1;padding:9px">Cerrar</button>
        </div>
      </div>
    `);

    const paymentsEl = document.getElementById('cli-enr-payments');
    const reloadPayments = async () => {
      const fresh = await fetchPayments('enrollment', enr.id);
      paymentsEl.innerHTML = paymentsListHtml(fresh);
      bindPaymentsListEvents(paymentsEl, c, fresh, reloadPayments);
    };
    bindPaymentsListEvents(paymentsEl, c, payments, reloadPayments);

    document.getElementById('cli-enr-close')?.addEventListener('click', () => closeModal());

    document.getElementById('cli-enr-status')?.addEventListener('change', async (e) => {
      try {
        await updateEnrollmentStatus(enr.id, e.target.value);
        enr.status = e.target.value;
        showToast('Estado actualizado', 'success');
        // El trigger update_bono_credits recalcula used_credits del bono → refresca
        // compra/pagos/KPIs e histórico (invalida cache) para que cuadren al instante.
        refreshMoneySections(c);
        loadClasesTab(c);
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    document.getElementById('cli-enr-add-pay')?.addEventListener('click', async () => {
      const amount = parseFloat(prompt('Importe a registrar (€):', pending > 0 ? pending.toFixed(2) : ''));
      if (!amount || amount <= 0) return;
      const method = prompt('Método (efectivo / tarjeta / transferencia / voucher):', 'efectivo');
      if (!method) return;
      try {
        await createPayment({
          reservation_type: 'enrollment',
          reference_id: enr.id,
          amount,
          payment_method: method,
          concept: `Pago clase ${typeLbl}`,
        });
        showToast('Pago añadido', 'success');
        reloadPayments();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    document.getElementById('cli-enr-delete')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta inscripción? También se borrarán sus pagos asociados.')) return;
      try {
        for (const p of await fetchPayments('enrollment', enr.id)) {
          await deletePayment(p.id);
        }
        await deleteEnrollment(enr.id);
        showToast('Inscripción eliminada', 'success');
        closeModal();
        // Invalida cache y repinta histórico + compra + pagos + KPIs coordinados
        refreshMoneySections(c);
        loadClasesTab(c);
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  // ---- Ficha de booking (surf camp) ----
  async function openBookingDetailModal(c, bk) {
    const payments = await fetchPayments('booking', bk.id);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const pending = Math.max(0, Math.round((Number(bk.total_amount || 0) - totalPaid) * 100) / 100);

    openModal('Reserva surf camp', `
      <div style="min-width:min(340px,100%)">
        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-weight:700;color:#1a1a1a">${esc(bk.camp_title) || 'Surf Camp'}</div>
          <div style="font-size:.78rem;color:#1a1a1a;margin-top:4px">Reservada: ${formatDate(bk.created_at)}</div>
          ${bk.guest_name ? `<div style="font-size:.78rem;color:#1a1a1a">A nombre de: ${esc(bk.guest_name)}</div>` : ''}
          <div style="margin-top:6px">${statusBadge(bk.status)}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;font-size:.82rem">
          <div style="padding:8px;background:#f0fdf4;border-radius:8px"><div style="color:#065f46;font-size:.7rem;text-transform:uppercase">Total</div><strong>${formatCurrency(bk.total_amount)}</strong></div>
          <div style="padding:8px;background:#eff6ff;border-radius:8px"><div style="color:#1e40af;font-size:.7rem;text-transform:uppercase">Pagado</div><strong>${formatCurrency(totalPaid)}</strong></div>
          <div style="padding:8px;background:${pending > 0 ? '#fef2f2' : '#f0fdf4'};border-radius:8px"><div style="color:${pending > 0 ? '#b91c1c' : '#065f46'};font-size:.7rem;text-transform:uppercase">Pendiente</div><strong>${formatCurrency(pending)}</strong></div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 4px">
          <label style="margin:0">Pagos</label>
          <button class="btn" id="cli-bk-add-pay" style="font-size:.74rem;padding:4px 10px;background:#22c55e;color:#fff;border:none;border-radius:6px;cursor:pointer">+ Pago</button>
        </div>
        <div id="cli-bk-payments">${paymentsListHtml(payments)}</div>

        <button class="btn red" id="cli-bk-close" style="margin-top:16px;width:100%;padding:9px">Cerrar</button>
      </div>
    `);

    const paymentsEl = document.getElementById('cli-bk-payments');
    const reloadPayments = async () => {
      const fresh = await fetchPayments('booking', bk.id);
      paymentsEl.innerHTML = paymentsListHtml(fresh);
      bindPaymentsListEvents(paymentsEl, c, fresh, reloadPayments);
    };
    bindPaymentsListEvents(paymentsEl, c, payments, reloadPayments);

    document.getElementById('cli-bk-close')?.addEventListener('click', () => closeModal());

    document.getElementById('cli-bk-add-pay')?.addEventListener('click', async () => {
      const amount = parseFloat(prompt('Importe a registrar (€):', pending > 0 ? pending.toFixed(2) : ''));
      if (!amount || amount <= 0) return;
      const method = prompt('Método (efectivo / tarjeta / transferencia / voucher):', 'efectivo');
      if (!method) return;
      try {
        await createPayment({
          reservation_type: 'booking',
          reference_id: bk.id,
          amount,
          payment_method: method,
          concept: `Pago surf camp ${bk.camp_title || ''}`,
        });
        // Recalcula deposit_amount/status del booking (igual que al borrar) para que
        // Reservas y el conteo de plazas no queden desincronizados.
        await recalcPaymentState('booking', bk.id);
        showToast('Pago añadido', 'success');
        reloadPayments();
        refreshMoneySections(c);
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  // ---- Ficha de alquiler ----
  async function openRentalDetailModal(c, r) {
    const payments = await fetchPayments('rental', r.id);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalRental = Number(r.total_amount || 0);
    const pending = Math.max(0, Math.round((totalRental - totalPaid) * 100) / 100);
    const equipName = r.equipment?.name || 'Material';

    const statusOptions = RENTAL_STATUS_OPTIONS
      .map(o => `<option value="${o.v}" ${o.v === r.status ? 'selected' : ''}>${o.l}</option>`).join('');

    openModal('Alquiler de material', `
      <div style="min-width:min(340px,100%)">
        <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-weight:700;color:#6d28d9">${esc(equipName)}</div>
          <div style="font-size:.82rem;color:#6d28d9;margin-top:4px">${formatDate(r.date_start)} → ${formatDate(r.date_end)}</div>
          ${r.size ? `<div style="font-size:.78rem;color:#6d28d9">Talla: ${esc(r.size)}</div>` : ''}
          ${r.duration_key ? `<div style="font-size:.78rem;color:#6d28d9">Duración: ${esc(r.duration_key)}</div>` : ''}
        </div>

        <label>Estado</label>
        <select id="cli-rt-status" class="act-form-input" style="margin-bottom:14px">${statusOptions}</select>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px;font-size:.82rem">
          <div style="padding:8px;background:#f0fdf4;border-radius:8px"><div style="color:#065f46;font-size:.7rem;text-transform:uppercase">Total</div><strong>${formatCurrency(totalRental)}</strong></div>
          <div style="padding:8px;background:#eff6ff;border-radius:8px"><div style="color:#1e40af;font-size:.7rem;text-transform:uppercase">Pagado</div><strong>${formatCurrency(totalPaid)}</strong></div>
          <div style="padding:8px;background:${pending > 0 ? '#fef2f2' : '#f0fdf4'};border-radius:8px"><div style="color:${pending > 0 ? '#b91c1c' : '#065f46'};font-size:.7rem;text-transform:uppercase">Pendiente</div><strong>${formatCurrency(pending)}</strong></div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 4px">
          <label style="margin:0">Pagos</label>
          <button class="btn" id="cli-rt-add-pay" style="font-size:.74rem;padding:4px 10px;background:#22c55e;color:#fff;border:none;border-radius:6px;cursor:pointer">+ Pago</button>
        </div>
        <div id="cli-rt-payments">${paymentsListHtml(payments)}</div>

        <button class="btn red" id="cli-rt-close" style="margin-top:16px;width:100%;padding:9px">Cerrar</button>
      </div>
    `);

    const paymentsEl = document.getElementById('cli-rt-payments');
    const reloadPayments = async () => {
      const fresh = await fetchPayments('rental', r.id);
      paymentsEl.innerHTML = paymentsListHtml(fresh);
      bindPaymentsListEvents(paymentsEl, c, fresh, reloadPayments);
    };
    bindPaymentsListEvents(paymentsEl, c, payments, reloadPayments);

    document.getElementById('cli-rt-close')?.addEventListener('click', () => closeModal());

    document.getElementById('cli-rt-status')?.addEventListener('change', async (e) => {
      const val = e.target.value;
      // Cancelar = corrección de error → cancelado + importe a 0 (pagos fuera, unidad liberada)
      if (val === 'cancelled') {
        if (!confirm('¿Cancelar este alquiler? Quedará como CANCELADO y su importe pasará a 0 € (se eliminan los pagos y se libera la unidad). Úsalo para corregir un alquiler creado por error.')) {
          e.target.value = r.status; // revertir el desplegable
          return;
        }
        try {
          await cancelEquipmentReservation(r.id);
          r.status = 'cancelled'; r.total_amount = 0;
          showToast('Alquiler cancelado · importe a 0', 'success');
          closeModal();
        } catch (err) { showToast('Error: ' + err.message, 'error'); e.target.value = r.status; }
        return;
      }
      try {
        await updateEquipmentReservationStatus(r.id, val);
        r.status = val;
        showToast('Estado actualizado', 'success');
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });

    document.getElementById('cli-rt-add-pay')?.addEventListener('click', async () => {
      const amount = parseFloat(prompt('Importe a registrar (€):', pending > 0 ? pending.toFixed(2) : ''));
      if (!amount || amount <= 0) return;
      const method = prompt('Método (efectivo / tarjeta / transferencia / voucher):', 'efectivo');
      if (!method) return;
      try {
        await createPayment({
          reservation_type: 'rental',
          reference_id: r.id,
          amount,
          payment_method: method,
          concept: `Pago alquiler ${equipName}`,
        });
        showToast('Pago añadido', 'success');
        reloadPayments();
      } catch (err) { showToast('Error: ' + err.message, 'error'); }
    });
  }

  async function loadPagosTab(c) {
    const el = container.querySelector('#sec-pagos-body');
    if (!el) return;
    try {
      // El historial se construye SOLO desde la tabla payments, donde cada pago
      // lleva su reservation_type (booking, bono, enrollment, rental, order, custom).
      // Así la categoría es siempre fiel al origen real del pago y no se infiere
      // de la tabla orders (que no sabe si fue camp, bono o producto).
      const payments = await fetchClientPayments(c.id);

      // Merge into unified timeline with domain info
      const timeline = [];

      // Domain colors & labels for type badges
      const DOMAIN_CONFIG = {
        enrollment: { label: 'Clase', color: '#22c55e', bg: '#f0fdf4' },
        rental:     { label: 'Alquiler', color: '#8b5cf6', bg: '#f5f3ff' },
        custom:     { label: 'Saldo a favor', color: '#f59e0b', bg: '#fffbeb' },
        bono:       { label: 'Bono', color: '#16a34a', bg: '#f0fdf4' },
        booking:    { label: 'Surf Camp', color: '#1a1a1a', bg: '#f0f9ff' },
        order:      { label: 'Tienda', color: '#f59e0b', bg: '#fffbeb' },
      };

      for (const p of payments) {
        const domain = p.reservation_type || 'otros';
        // Origen: 'web' (online, no editable) vs 'admin' (manual, editable)
        const isWeb = p.channel === 'web';
        timeline.push({
          paymentId: p.id,
          raw: p,
          date: p.payment_date || p.created_at,
          domain,
          type: DOMAIN_CONFIG[domain]?.label || domain,
          concept: p.concept || (domain === 'enrollment' ? 'Pago clase' : domain === 'custom' ? 'Saldo a favor' : domain === 'booking' ? 'Surf camp' : domain === 'bono' ? 'Bono de clases' : domain === 'order' ? 'Pedido tienda' : 'Pago'),
          amount: Number(p.amount),
          method: p.payment_method || '—',
          source: isWeb ? 'web' : 'admin',
        });
      }

      timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Split totals by domain category
      const servicioTotal = timeline.filter(t => ['enrollment', 'rental', 'bono'].includes(t.domain)).reduce((s, t) => s + t.amount, 0);
      const tiendaTotal = timeline.filter(t => t.domain === 'order').reduce((s, t) => s + t.amount, 0);
      const campTotal = timeline.filter(t => t.domain === 'booking').reduce((s, t) => s + t.amount, 0);
      const totalPaid = timeline.reduce((s, t) => s + t.amount, 0);
      const creditBalance = Number(c.credit_balance || 0);

      const METHOD_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', voucher: 'Voucher', online: 'Online', saldo: 'Saldo' };

      function domainBadge(domain) {
        const cfg = DOMAIN_CONFIG[domain];
        if (!cfg) return `<span style="font-size:.75rem;padding:2px 8px;border-radius:99px;background:#f1f5f9;color:#64748b">${domain}</span>`;
        return `<span style="font-size:.75rem;padding:2px 8px;border-radius:99px;background:${cfg.bg};color:${cfg.color};font-weight:600">${cfg.label}</span>`;
      }

      const rows = timeline.map((t, i) => {
        const isEditable = t.source === 'admin' && t.paymentId;
        const actionCell = isEditable
          ? `<td style="white-space:nowrap;text-align:right">
              <button class="cli-pay-edit-btn" data-idx="${i}" title="Editar" style="background:none;border:none;cursor:pointer;color:#1a1a1a;padding:4px 6px;border-radius:4px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="cli-pay-del-btn" data-idx="${i}" title="Eliminar" style="background:none;border:none;cursor:pointer;color:#dc2626;padding:4px 6px;border-radius:4px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </td>`
          : '<td></td>';
        return `<tr>
          <td>${formatDate(t.date)}</td>
          <td>${domainBadge(t.domain)}</td>
          <td>${esc(t.concept)}</td>
          <td style="font-weight:600;color:#065f46">+${formatCurrency(t.amount)}</td>
          <td>${METHOD_LABELS[t.method] || t.method}</td>
          <td><span class="status-badge ${t.source === 'web' ? 'active' : ''}">${t.source === 'web' ? 'Web' : 'Manual'}</span></td>
          ${actionCell}
        </tr>`;
      }).join('');

      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <span class="cli-sec-count">${timeline.length} pago(s)</span>
          <button class="btn red" id="cli-add-payment" style="font-size:.82rem;padding:6px 14px">+ Añadir pago</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px">
          <div class="act-form-card" style="padding:14px 18px;margin:0;background:#f0fdf4;border-color:#bbf7d0">
            <div style="font-size:.72rem;text-transform:uppercase;color:#065f46;font-weight:600;margin-bottom:2px">Servicios</div>
            <div style="font-size:1.3rem;font-family:'Bebas Neue',sans-serif;color:#065f46">${formatCurrency(servicioTotal)}</div>
            <div style="font-size:.7rem;color:#065f46">Clases, bonos, alquiler</div>
          </div>
          ${campTotal > 0 ? `<div class="act-form-card" style="padding:14px 18px;margin:0;background:#f0f9ff;border-color:#bae6fd">
            <div style="font-size:.72rem;text-transform:uppercase;color:#1a1a1a;font-weight:600;margin-bottom:2px">Surf Camps</div>
            <div style="font-size:1.3rem;font-family:'Bebas Neue',sans-serif;color:#1a1a1a">${formatCurrency(campTotal)}</div>
          </div>` : ''}
          ${tiendaTotal > 0 ? `<div class="act-form-card" style="padding:14px 18px;margin:0;background:#fffbeb;border-color:#fde68a">
            <div style="font-size:.72rem;text-transform:uppercase;color:#92400e;font-weight:600;margin-bottom:2px">Tienda</div>
            <div style="font-size:1.3rem;font-family:'Bebas Neue',sans-serif;color:#92400e">${formatCurrency(tiendaTotal)}</div>
            <div style="font-size:.7rem;color:#92400e">Productos online</div>
          </div>` : ''}
          <div class="act-form-card" style="padding:14px 18px;margin:0;background:${creditBalance > 0 ? '#fffbeb' : '#f8fafc'};border-color:${creditBalance > 0 ? '#fde68a' : '#e2e8f0'}">
            <div style="font-size:.72rem;text-transform:uppercase;color:${creditBalance > 0 ? '#92400e' : 'var(--color-muted)'};font-weight:600;margin-bottom:2px">Saldo a favor</div>
            <div style="font-size:1.3rem;font-family:'Bebas Neue',sans-serif;color:${creditBalance > 0 ? '#92400e' : 'var(--color-muted)'}">${formatCurrency(creditBalance)}</div>
          </div>
        </div>
        ${timeline.length ? `<div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Importe</th><th>Método</th><th>Origen</th><th></th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>` : '<div class="act-form-card"><div class="admin-empty"><p>No hay pagos registrados</p></div></div>'}`;

      // Bind add payment button
      el.querySelector('#cli-add-payment')?.addEventListener('click', () => openAddPaymentModal(c));

      // Edit / delete payment
      el.querySelectorAll('.cli-pay-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const t = timeline[idx];
          if (!t?.raw) return;
          openPaymentEditModal(t.raw, { onSaved: () => refreshMoneySections(c) });
        });
      });
      el.querySelectorAll('.cli-pay-del-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const t = timeline[idx];
          if (!t?.paymentId) return;
          if (!confirm(`¿Eliminar este pago de ${formatCurrency(t.amount)}?`)) return;
          try {
            await deletePayment(t.paymentId);
            if (t.domain === 'custom') {
              // Saldo a favor: borrar el pago debe revertir el credit_balance
              // (crear lo suma, así que borrar lo resta). recalcPaymentState no
              // cubre 'custom', se gestiona aquí.
              const newBal = Math.max(0, Math.round((Number(c.credit_balance || 0) - Number(t.amount || 0)) * 100) / 100);
              await supabase.from('profiles').update({ credit_balance: newBal }).eq('id', c.id);
              c.credit_balance = newBal;
            } else {
              // Recalcula el pagado real de la entidad (bono/clase/camp/alquiler)
              // para que pendiente y KPIs queden coordinados tras el borrado.
              await recalcPaymentState(t.domain, t.raw?.reference_id);
            }
            showToast('Pago eliminado', 'success');
            refreshMoneySections(c);
          } catch (err) {
            showToast('Error al eliminar: ' + (err.message || ''), 'error');
          }
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando pagos: ${esc(err.message)}</p></div>`;
    }
  }

  async function loadReservasTab(c) {
    const el = container.querySelector('#sec-camps-body');
    if (!el) return;
    try {
      const bookings = await fetchClientBookings(c.id);

      if (!bookings.length) {
        el.innerHTML = `
          <div class="act-form-card">
            <div class="admin-empty"><p>Este cliente no tiene reservas de surf camp</p></div>
          </div>`;
        return;
      }

      const rows = bookings.map((b, i) => `<tr class="cli-row-click" data-idx="${i}" style="cursor:pointer">
        <td>${formatDate(b.created_at)}</td>
        <td>${esc(b.camp_title) || '—'}</td>
        <td>${formatCurrency(b.total_amount)}</td>
        <td>${formatCurrency(b.deposit_amount)}</td>
        <td>${statusBadge(b.status)}</td>
      </tr>`).join('');

      el.innerHTML = `
        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Surf Camp</th><th>Total</th><th>Señal</th><th>Estado</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;

      el.querySelectorAll('.cli-row-click').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx);
          const bk = bookings[idx];
          if (bk) openBookingDetailModal(c, bk);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando reservas: ${esc(err.message)}</p></div>`;
    }
  }

  async function loadAlquileresTab(c) {
    const el = container.querySelector('#sec-alquileres-body');
    if (!el) return;
    try {
      const rentals = await fetchClientEquipmentReservations(c.id);

      if (!rentals.length) {
        el.innerHTML = `
          <div class="act-form-card">
            <div class="admin-empty"><p>Este cliente no tiene alquileres registrados</p></div>
          </div>`;
        return;
      }

      const statusLabels = {
        pending: 'Pendiente', confirmed: 'Confirmado', active: 'Activo',
        returned: 'Devuelto', cancelled: 'Cancelado',
      };

      const rows = rentals.map((r, i) => `<tr class="cli-row-click" data-idx="${i}" style="cursor:pointer">
        <td>${esc(r.equipment?.name || '—')}</td>
        <td>${formatDate(r.date_start)} — ${formatDate(r.date_end)}</td>
        <td>${r.size || '—'}</td>
        <td>${r.duration_key || '—'}</td>
        <td>${formatCurrency(r.total_amount)}</td>
        <td>${formatCurrency(r.deposit_paid)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join('');

      el.innerHTML = `
        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>Material</th><th>Periodo</th><th>Talla</th><th>Duración</th><th>Total</th><th>Señal</th><th>Estado</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;

      el.querySelectorAll('.cli-row-click').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.dataset.idx);
          const r = rentals[idx];
          if (r) openRentalDetailModal(c, r);
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando alquileres: ${esc(err.message)}</p></div>`;
    }
  }

  async function loadPedidosTab(c) {
    const el = container.querySelector('#sec-pedidos-body');
    if (!el) return;
    try {
      const orders = await fetchClientOrders(c.id);

      if (!orders.length) {
        el.innerHTML = `
          <div class="act-form-card">
            <div class="admin-empty"><p>Este cliente no tiene pedidos en la tienda</p></div>
          </div>`;
        return;
      }

      const rows = orders.map(o => `<tr>
        <td>${formatDate(o.created_at)}</td>
        <td>${formatCurrency(o.total)}</td>
        <td>${esc(o.shipping_address) || '—'}</td>
        <td>${statusBadge(o.status)}</td>
      </tr>`).join('');

      el.innerHTML = `
        <div class="act-form-card" style="padding:0;overflow:hidden">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Fecha</th><th>Total</th><th>Dirección</th><th>Estado</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="act-form-card"><p style="color:#b91c1c">Error cargando pedidos: ${esc(err.message)}</p></div>`;
    }
  }

  // ===================== SAVE =====================
  async function saveClientData(c) {
    const fullnameEl = container.querySelector('#cli-fullname');
    const lastnameEl = container.querySelector('#cli-lastname');
    const phoneEl = container.querySelector('#cli-phone');
    const roleEl = container.querySelector('#cli-role');
    const addressEl = container.querySelector('#cli-address');
    const cityEl = container.querySelector('#cli-city');
    const postalEl = container.querySelector('#cli-postal');
    const canSwimEl = container.querySelector('#cli-can-swim');
    const hasInjuryEl = container.querySelector('#cli-has-injury');
    const injuryDetailEl = container.querySelector('#cli-injury-detail');
    const weightEl = container.querySelector('#cli-weight');
    const heightEl = container.querySelector('#cli-height');
    const birthdateEl = container.querySelector('#cli-birthdate');

    if (!fullnameEl) {
      showToast('No se pudo leer el formulario de datos', 'error');
      return;
    }

    const fullname = fullnameEl.value.trim();
    const lastname = lastnameEl?.value?.trim() || '';
    const phone = phoneEl?.value?.trim() || null;
    const role = roleEl?.value || 'client';
    const address = addressEl?.value?.trim() || null;
    const city = cityEl?.value?.trim() || null;
    const postal_code = postalEl?.value?.trim() || null;
    const can_swim = canSwimEl?.value === 'true' ? true : canSwimEl?.value === 'false' ? false : null;
    const has_injury = hasInjuryEl?.value === 'true';
    const injury_detail = injuryDetailEl?.value?.trim() || null;
    const weight_kg = weightEl?.value ? Number(weightEl.value) : null;
    const height_cm = heightEl?.value ? Number(heightEl.value) : null;
    const birth_date = birthdateEl?.value || null;

    if (!fullname) {
      showToast('El nombre es obligatorio', 'error');
      return;
    }

    try {
      await updateProfile(c.id, {
        full_name: fullname,
        last_name: lastname,
        phone: phone,
        role: role,
        address: address,
        city: city,
        postal_code: postal_code,
        can_swim,
        has_injury,
        injury_detail,
        weight_kg,
        height_cm,
        birth_date,
      });
      // Update local copy
      c.full_name = fullname;
      c.last_name = lastname;
      c.phone = phone;
      c.role = role;
      c.address = address;
      c.city = city;
      c.postal_code = postal_code;
      c.can_swim = can_swim;
      c.has_injury = has_injury;
      c.injury_detail = injury_detail;
      c.weight_kg = weight_kg;
      c.height_cm = height_cm;
      c.birth_date = birth_date;
      showToast('Cliente actualizado', 'success');
      renderDetail();
    } catch (err) {
      showToast('Error al guardar: ' + err.message, 'error');
    }
  }

  // ===================== ADD PAYMENT MODAL =====================
  async function openAddPaymentModal(c, preselectedType, preselectedId, suggestedAmount) {
    // Fetch bonos & enrollments in parallel for dropdowns
    const [bonos, enrollments] = await Promise.all([
      fetchClientBonos(c.id),
      fetchClientEnrollments(c.id),
    ]);

    // Enrich bonos with pricing info
    const enrichedBonos = bonos.map(b => {
      const expectedPrice = bonoExpected(b);
      const paid = Number(b.total_paid || 0);
      const pending = Math.max(0, Math.round((expectedPrice - paid) * 100) / 100);
      return { ...b, expectedPrice, totalPaidReal: paid, pending, isFullyPaid: pending <= 0 };
    });

    const activeBonos = enrichedBonos.filter(b => (b.status === 'active' || b.status === 'exhausted') && !b.isFullyPaid);
    const activeEnrollments = enrollments.filter(e => ['confirmed', 'partial'].includes(e.status));

    const selectedType = preselectedType || 'bono';

    const bonoOptions = activeBonos.map(b =>
      `<option value="${b.id}" ${preselectedId === b.id ? 'selected' : ''}>${TYPE_LABELS[b.class_type] || b.class_type} — ${b.total_credits} clases (debe ${formatCurrency(b.pending)})</option>`
    ).join('');

    const enrollOptions = activeEnrollments.map(e => {
      const cls = e.surf_class || {};
      const label = `${cls.date || '—'} · ${TYPE_LABELS[cls.type] || cls.type || '—'} · ${esc(cls.title) || 'Clase'}`;
      return `<option value="${e.id}">${label}</option>`;
    }).join('');

    const defaultAmount = suggestedAmount || '';

    openModal('Añadir pago', `
      <form id="add-payment-form" class="trip-form" style="min-width:min(340px,100%)">
        <label style="font-weight:600;margin-bottom:4px">Tipo de pago</label>
        <div id="pay-type-tabs" style="display:flex;gap:6px;margin-bottom:16px">
          <button type="button" class="btn pay-type-tab ${selectedType === 'bono' ? 'red' : 'line'}" data-type="bono" style="flex:1;font-size:.78rem;padding:8px 6px">Pago bono</button>
          <button type="button" class="btn pay-type-tab ${selectedType === 'clase' ? 'red' : 'line'}" data-type="clase" style="flex:1;font-size:.78rem;padding:8px 6px">Pago clase</button>
          <button type="button" class="btn pay-type-tab ${selectedType === 'custom' ? 'red' : 'line'}" data-type="custom" style="flex:1;font-size:.78rem;padding:8px 6px">Personalizado</button>
        </div>

        <div id="pay-section-bono" style="${selectedType === 'bono' ? '' : 'display:none'}">
          <label>Seleccionar bono</label>
          <select id="pay-bono-select" class="act-form-input" style="margin-bottom:10px">
            ${bonoOptions || '<option value="">No hay bonos pendientes</option>'}
          </select>
        </div>

        <div id="pay-section-clase" style="${selectedType === 'clase' ? '' : 'display:none'}">
          <label>Seleccionar clase</label>
          <select id="pay-clase-select" class="act-form-input" style="margin-bottom:10px">
            ${enrollOptions || '<option value="">No hay clases pendientes</option>'}
          </select>
        </div>

        <div id="pay-section-custom" style="${selectedType === 'custom' ? '' : 'display:none'}">
          <label>Concepto</label>
          <input type="text" id="pay-concept" class="act-form-input" placeholder="Ej: Recarga saldo, Devolución…" style="margin-bottom:10px" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label>Importe (€)</label>
            <input type="number" id="pay-amount" class="act-form-input" step="0.01" min="0.01" value="${defaultAmount}" required placeholder="0.00" />
          </div>
          <div>
            <label>Método de pago</label>
            <select id="pay-method" class="act-form-input">
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
              <option value="voucher">Voucher</option>
            </select>
          </div>
        </div>

        <button type="submit" class="btn red" style="margin-top:16px;width:100%;padding:10px;font-size:.9rem" id="pay-submit-btn">Registrar pago</button>
      </form>
    `);

    const form = document.getElementById('add-payment-form');
    let currentType = selectedType;

    // Update suggested amount when bono changes
    const updateBonoAmount = () => {
      const sel = document.getElementById('pay-bono-select');
      if (sel?.value) {
        const b = enrichedBonos.find(x => x.id === sel.value);
        if (b) document.getElementById('pay-amount').value = b.pending.toFixed(2);
      }
    };

    // Tab switching
    form.querySelectorAll('.pay-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentType = tab.dataset.type;
        form.querySelectorAll('.pay-type-tab').forEach(t => {
          t.classList.toggle('red', t.dataset.type === currentType);
          t.classList.toggle('line', t.dataset.type !== currentType);
        });
        document.getElementById('pay-section-bono').style.display = currentType === 'bono' ? '' : 'none';
        document.getElementById('pay-section-clase').style.display = currentType === 'clase' ? '' : 'none';
        document.getElementById('pay-section-custom').style.display = currentType === 'custom' ? '' : 'none';

        // Reset amount based on type
        if (currentType === 'bono') updateBonoAmount();
        else document.getElementById('pay-amount').value = '';
      });
    });

    document.getElementById('pay-bono-select')?.addEventListener('change', updateBonoAmount);

    // If bono preselected, set amount
    if (selectedType === 'bono' && !suggestedAmount) updateBonoAmount();

    // Submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById('pay-amount').value);
      const method = document.getElementById('pay-method').value;

      if (!amount || amount <= 0) {
        showToast('El importe debe ser mayor que 0', 'error');
        return;
      }

      const submitBtn = document.getElementById('pay-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Guardando…';

      try {
        if (currentType === 'bono') {
          const bonoId = document.getElementById('pay-bono-select')?.value;
          if (!bonoId) { showToast('Selecciona un bono', 'error'); submitBtn.disabled = false; submitBtn.textContent = 'Registrar pago'; return; }

          const bono = enrichedBonos.find(b => b.id === bonoId);

          // Pago del bono: referenciado al bono (no a un enrollment), tipo 'bono'
          await createPayment({
            reservation_type: 'bono',
            reference_id: bonoId,
            amount,
            payment_method: method,
            concept: `Pago bono ${TYPE_LABELS[bono?.class_type] || ''} (${bono?.total_credits} clases)`,
          });
          // total_paid = SUM real de payments (evita deriva por incrementos manuales)
          const newTotalPaid = await recalcBonoPaid(bonoId);

          // If fully paid now, update enrollment statuses
          if (newTotalPaid >= (bono?.expectedPrice || 0)) {
            const bonoEnrollments = enrollments.filter(en => en.bono_id === bonoId && en.status === 'partial');
            for (const en of bonoEnrollments) {
              await supabase.from('class_enrollments').update({ status: 'paid' }).eq('id', en.id);
            }
          }

          showToast(`Pago de ${formatCurrency(amount)} registrado en bono`, 'success');

        } else if (currentType === 'clase') {
          const enrollId = document.getElementById('pay-clase-select')?.value;
          if (!enrollId) { showToast('Selecciona una clase', 'error'); submitBtn.disabled = false; submitBtn.textContent = 'Registrar pago'; return; }

          await createPayment({
            reservation_type: 'enrollment',
            reference_id: enrollId,
            amount,
            payment_method: method,
            concept: 'Pago clase',
          });

          showToast(`Pago de ${formatCurrency(amount)} registrado`, 'success');

        } else if (currentType === 'custom') {
          const concept = document.getElementById('pay-concept')?.value?.trim();
          if (!concept) {
            showToast('Escribe un concepto', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Registrar pago';
            return;
          }

          // Add to credit_balance
          const currentBalance = Number(c.credit_balance || 0);
          const newBalance = currentBalance + amount;
          const { error } = await supabase
            .from('profiles')
            .update({ credit_balance: newBalance })
            .eq('id', c.id);
          if (error) throw error;
          c.credit_balance = newBalance;

          // Create payment record so it shows in history
          await createPayment({
            reservation_type: 'custom',
            reference_id: c.id,
            amount,
            payment_method: method,
            concept,
          });

          showToast(`${formatCurrency(amount)} añadido al saldo a favor (total: ${formatCurrency(newBalance)})`, 'success');
        }

        closeModal();

        // Refresca las secciones de dinero (bonos + pagos + KPIs) de forma coordinada
        refreshMoneySections(c);

      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Registrar pago';
      }
    });
  }

  // ===================== HELPERS =====================
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Deep-link desde el calendario: abrir directamente la ficha de un cliente
  const _openId = window.__openClientId;
  if (_openId) {
    window.__openClientId = null;
    try {
      const { data: cli } = await supabase.from('profiles').select('*').eq('id', _openId).single();
      if (cli) { selectedClient = cli; await renderDetail(); return; }
    } catch (e) { console.warn('open client deep-link:', e?.message); }
  }
  await renderList();
}
