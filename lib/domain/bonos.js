/* ============================================================
   Dominio · Bonos (ciclo de vida: buscar / crear / ampliar)
   ============================================================
   Bloques canónicos del ciclo de vida del bono (buscar el del dueño, crear,
   ampliar, corregir campos). Reparto de responsabilidad:
   - total_paid  → lo gobierna /lib/domain/payments.js (= SUM(payments)).
   - used_credits/status → los gobierna el trigger DB update_bono_credits.
   - expires_at por defecto → defaultBonoExpiry(type), atado a activity.pack_validity
     (fallback por tipo). Vive en /lib/domain/pricing.js; se re-exporta aquí para
     no romper a quien lo importa de este módulo.
   Esquema: bonos.class_type ∈ {grupal,privada,semiprivada,familiar,residente,kids};
   bonos.status ∈ {active,expired,exhausted,cancelled}.
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { round2, defaultBonoExpiry } from '/lib/domain/pricing.js';

// Re-export: la caducidad por defecto vive en pricing.js (atada a pack_validity),
// pero se mantiene disponible desde este módulo por compatibilidad de API.
export { defaultBonoExpiry };

// Créditos libres de un bono.
export function bonoAvailable(bono) {
  if (!bono) return 0;
  return Math.max(0, (bono.total_credits || 0) - (bono.used_credits || 0));
}

// Bono "vivo" del dueño para un tipo: activo o agotado, no caducado. Prefiere uno
// con créditos libres (no malgastar prepago) antes que el más reciente.
export async function findOwnerBono(ownerId, classType) {
  if (!ownerId) return null;
  const { data } = await supabase.from('bonos')
    .select('*').eq('user_id', ownerId).eq('class_type', classType)
    .in('status', ['active', 'exhausted']).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  const list = data || [];
  return list.find(b => bonoAvailable(b) > 0) || list[0] || null;
}

// Crea un bono. total_paid lo deja en 0 por defecto (regístralo como payment y usa
// recalcBonoPaid). expires_at por defecto = defaultBonoExpiry(class_type). Devuelve el id.
export async function createBono({ user_id, class_type, total_credits, custom_total, total_paid = 0, expires_at, activity_id, order_id } = {}) {
  const row = {
    user_id,
    class_type,
    total_credits: Math.max(1, Number(total_credits) || 0),
    used_credits: 0,
    status: 'active',
    total_paid: round2(total_paid),
    custom_total: custom_total != null ? round2(custom_total) : null,
    expires_at: expires_at || defaultBonoExpiry(class_type),
  };
  if (activity_id !== undefined) row.activity_id = activity_id;
  if (order_id !== undefined) row.order_id = order_id;
  const { data, error } = await supabase.from('bonos').insert(row).select('id').single();
  if (error) throw error;
  return data?.id || null;
}

// Edita campos de un bono para CORREGIR errores (tipo, nº de créditos arriba/abajo,
// titular, caducidad, total). El status se recalcula según used vs total (salvo
// cancelado/caducado). No toca total_paid (eso lo gobierna recalcBonoPaid).
export async function updateBonoFields(bonoId, fields = {}) {
  const upd = { updated_at: new Date().toISOString() };
  for (const k of ['class_type', 'total_credits', 'custom_total', 'expires_at', 'user_id', 'status', 'activity_id', 'order_id']) {
    if (fields[k] !== undefined) upd[k] = (k === 'custom_total' && fields[k] != null) ? round2(fields[k]) : fields[k];
  }
  const { error } = await supabase.from('bonos').update(upd).eq('id', bonoId);
  if (error) throw error;
}

// Amplía un bono existente (créditos y/o precio a medida). No toca total_paid.
export async function extendBono(bonoId, { newTotalCredits, newCustomTotal, status, expires_at } = {}) {
  const upd = { updated_at: new Date().toISOString() };
  if (newTotalCredits != null) upd.total_credits = newTotalCredits;
  if (newCustomTotal != null) upd.custom_total = round2(newCustomTotal);
  if (status) upd.status = status;
  if (expires_at) upd.expires_at = expires_at;
  const { error } = await supabase.from('bonos').update(upd).eq('id', bonoId);
  if (error) throw error;
}
