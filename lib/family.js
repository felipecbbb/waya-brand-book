import { supabase } from '/lib/supabase.js';

// ── Miembros de familia (CRUD) ──────────────────────────────────────────────
// Tabla `family_members` (contrato §2.5): user_id → profiles(id).
// Columnas: full_name, last_name, birth_date, level, notes, can_swim,
//           has_injury, injury_detail, wetsuit_size, created_at, updated_at.
// `level` acepta: principiante | intermedio | avanzado | todos (CHECK Waya).

export async function fetchFamilyMembers() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createFamilyMember({ full_name, last_name, birth_date, level, notes, can_swim, has_injury, injury_detail, wetsuit_size }) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) throw new Error('No autenticado');
  const { data, error } = await supabase
    .from('family_members')
    .insert({
      user_id: user.id,
      full_name,
      last_name: last_name || '',
      birth_date: birth_date || null,
      level: level || null,
      notes: notes || null,
      can_swim: can_swim ?? null,
      has_injury: has_injury ?? null,
      injury_detail: injury_detail || null,
      wetsuit_size: wetsuit_size || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFamilyMember(id, fields) {
  const { data, error } = await supabase
    .from('family_members')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFamilyMember(id) {
  const { error } = await supabase
    .from('family_members')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
