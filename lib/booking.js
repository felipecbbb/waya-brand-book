import { supabase } from '/lib/supabase.js';
import { ADMIN_EMAIL } from '/lib/shared-constants.js';
import { TYPE_LABELS } from '/lib/utils.js';

function fmtClassDate(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return d || ''; }
}

// Datos del usuario logueado (para los emails). null si no hay sesión.
async function currentUserInfo() {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data?.user; if (!u) return null;
    let name = u.user_metadata?.full_name || '';
    try { const { data: p } = await supabase.from('profiles').select('full_name').eq('id', u.id).single(); if (p?.full_name) name = p.full_name; } catch {}
    return { id: u.id, email: u.email, name };
  } catch { return null; }
}

// Avisos de reserva/cancelación de clase: al cliente (confirmación) y a la escuela.
// Fire-and-forget: nunca bloquea ni rompe la reserva si el email falla.
export async function notifyClass(kind, cls, who, { notifyAdmin = true } = {}) {
  const data = {
    customerName: who?.name || '',
    className: cls?.title || TYPE_LABELS[cls?.type] || cls?.type || 'Clase',
    classDate: fmtClassDate(cls?.date),
    classTime: (cls?.time_start || '').slice(0, 5),
    instructor: cls?.instructor || '',
  };
  const clientType = kind === 'booked' ? 'class_booked' : 'class_cancelled';
  const adminType = kind === 'booked' ? 'admin_class_booked' : 'admin_class_cancelled';
  try { if (who?.email) await supabase.functions.invoke('send-email', { body: { to: who.email, type: clientType, data } }); } catch {}
  if (notifyAdmin) {
    try { await supabase.functions.invoke('send-email', { body: { to: ADMIN_EMAIL, type: adminType, data: { ...data, customerEmail: who?.email || '' } } }); } catch {}
  }
}

export async function bookClass(classId, bonoId, familyMemberId = null) {
  const { data, error } = await supabase.rpc('book_class', {
    p_class_id: classId,
    p_bono_id: bonoId,
    p_family_member_id: familyMemberId,
  });
  if (error) throw error;
  // Aviso: confirmación al cliente + aviso de nueva reserva a la escuela
  try {
    const { data: cls } = await supabase.from('surf_classes').select('title,type,date,time_start,instructor').eq('id', classId).single();
    await notifyClass('booked', cls, await currentUserInfo());
  } catch {}
  return data;
}

export async function cancelEnrollment(enrollmentId, cancelledBy = 'client') {
  // Capturar la clase ANTES de cancelar (para el email)
  let cls = null;
  try {
    const { data: en } = await supabase.from('class_enrollments')
      .select('surf_classes:class_id(title,type,date,time_start,instructor)').eq('id', enrollmentId).single();
    cls = en?.surf_classes || null;
  } catch {}
  const { error } = await supabase.rpc('cancel_enrollment', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw error;
  // Set cancelled_by after RPC (RPC doesn't know about this field yet)
  const { error: updateError } = await supabase
    .from('class_enrollments')
    .update({ cancelled_by: cancelledBy })
    .eq('id', enrollmentId);
  if (updateError) console.warn('cancelEnrollment: could not set cancelled_by', updateError.message);
  // Aviso: solo si lo cancela el CLIENTE (si lo hace la escuela, ya avisa el panel admin)
  if (cancelledBy === 'client') {
    try { await notifyClass('cancelled', cls, await currentUserInfo(), { notifyAdmin: true }); } catch {}
  }
}

export async function fetchPublishedClasses(filters = {}) {
  let query = supabase
    .from('surf_classes')
    .select('*')
    .eq('published', true)
    .eq('status', 'scheduled')
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date', { ascending: true })
    .order('time_start', { ascending: true });

  if (filters.type) query = query.eq('type', filters.type);
  if (filters.level && filters.level !== 'todos') query = query.or(`level.eq.${filters.level},level.eq.todos`);
  if (filters.date) query = query.eq('date', filters.date);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchUserEnrollments() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return [];
  const { data, error } = await supabase
    .from('class_enrollments')
    .select('*, surf_classes(*), family_members(full_name), bonos(class_type)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
