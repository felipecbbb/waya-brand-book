/* ============================================================
   Auth Client — helpers de auth público (sin check admin)
   Portado de Entreolas. API pública idéntica.
   ============================================================ */
import { supabase } from '/lib/supabase.js';

export async function getSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  } catch (e) {
    console.warn('getSession failed:', e);
    return null;
  }
}

export async function getProfile() {
  try {
    const session = await getSession();
    if (!session) return null;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    return data;
  } catch (e) {
    console.warn('getProfile failed:', e);
    return null;
  }
}

export async function signUp(email, password, fullName, extraMeta = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Todos los datos van en el metadata: el trigger handle_new_user los
      // persiste al crear el perfil (no depende de que haya sesión activa).
      // Campos soportados por handle_new_user (contrato §3.3): full_name,
      // last_name, phone, email, birth_date, address, city, postal_code,
      // level, wetsuit_size, can_swim, has_injury, injury_detail,
      // terms_accepted_at, waiver_accepted_at.
      data: { full_name: fullName, ...extraMeta },
      emailRedirectTo: window.location.origin + '/mi-cuenta/',
    },
  });
  if (error) throw new Error(error.message);

  // Email de bienvenida (no bloqueante)
  try {
    supabase.functions.invoke('send-email', {
      body: { to: email, type: 'welcome', data: { customerName: fullName } },
    });
  } catch {}

  // Si la confirmación de email está desactivada, el usuario ya tiene sesión.
  // Si no, intentamos auto-login inmediato.
  if (!data.session) {
    try {
      const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
      if (!loginErr) return loginData;
    } catch {}
  }

  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function updateProfile(fields) {
  const session = await getSession();
  if (!session) throw new Error('No hay sesión activa');
  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', session.user.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
