/* ============================================================
   Dominio · Pagos (payments = única verdad del dinero)
   ============================================================
   total_paid de un bono (y deposit_paid de alquiler, deposit_amount/status de
   booking, status de inscripción) deben derivarse SIEMPRE de la suma real de
   payments, no de incrementos manuales que pueden derivar. Aquí vive esa lógica,
   antes duplicada en clientes.recalcPaymentState, calendario.syncBonoPaid y varios
   updates manuales (+= amount).

   Contrato de datos (ver docs/reservas/SQL_CONTRACT.md):
   - payments.reservation_type ∈ 'enrollment' | 'rental' | 'custom' | 'bono' | 'booking' | 'order'
   - la verdad del dinero de una entidad = SUM(payments.amount) por (reservation_type, reference_id)
   ============================================================ */
import { supabase } from '/lib/supabase.js';
import { classPrice, round2 } from '/lib/domain/pricing.js';

// Suma de pagos de una entidad (reservation_type + reference_id).
export async function sumPayments(type, refId) {
  if (!refId) return 0;
  const { data } = await supabase.from('payments').select('amount')
    .eq('reservation_type', type).eq('reference_id', refId);
  return round2((data || []).reduce((s, p) => s + Number(p.amount || 0), 0));
}

// Fija bonos.total_paid = SUM(payments del bono). Devuelve la suma.
export async function recalcBonoPaid(bonoId) {
  if (!bonoId) return 0;
  const sum = await sumPayments('bono', bonoId);
  await supabase.from('bonos').update({ total_paid: sum, updated_at: new Date().toISOString() }).eq('id', bonoId);
  return sum;
}

// Recalcula el estado/importe pagado de una entidad desde la suma real de sus pagos.
// Tipos: 'bono' | 'rental' | 'booking' | 'enrollment'. ('custom'/'order' = no-op aquí.)
export async function recalcPaidState(type, refId) {
  if (!refId) return;
  if (type === 'bono') {
    await recalcBonoPaid(refId);
  } else if (type === 'rental') {
    await supabase.from('equipment_reservations')
      .update({ deposit_paid: await sumPayments('rental', refId), updated_at: new Date().toISOString() })
      .eq('id', refId);
  } else if (type === 'booking') {
    const sum = await sumPayments('booking', refId);
    const { data: bk } = await supabase.from('bookings').select('total_amount').eq('id', refId).single();
    const total = Number(bk?.total_amount || 0);
    const status = sum <= 0 ? 'pending' : (total > 0 && sum >= total ? 'fully_paid' : 'deposit_paid');
    await supabase.from('bookings').update({ deposit_amount: sum, status, updated_at: new Date().toISOString() }).eq('id', refId);
  } else if (type === 'enrollment') {
    const sum = await sumPayments('enrollment', refId);
    const { data: enr } = await supabase.from('class_enrollments')
      .select('status, surf_classes:class_id(price, type)').eq('id', refId).single();
    if (enr && enr.status !== 'cancelled') {
      const price = classPrice(enr.surf_classes || {});
      const status = sum <= 0 ? 'confirmed' : (price > 0 && sum >= price ? 'paid' : 'partial');
      await supabase.from('class_enrollments').update({ status, updated_at: new Date().toISOString() }).eq('id', refId);
    }
  }
}
