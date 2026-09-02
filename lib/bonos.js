import { supabase } from '/lib/supabase.js';

// Capa "cliente" de bonos (mi-cuenta): consulta de bonos del usuario, packs para
// upgrade, ampliación de créditos y pago online del saldo pendiente.
// La lógica canónica de ciclo de vida del bono vive en /lib/domain/bonos.js.

// Inicia el pago ONLINE del saldo pendiente de un bono. Es opcional: el cliente
// puede pagarlo aquí o en la escuela. Invoca la edge function `create-checkout`
// (la pasarela SumUp se implementa en F4). El webhook actualiza total_paid y
// marca las inscripciones como pagadas tras el cobro.
/**
 * Pagar el saldo pendiente de un bono.
 *
 * Llamaba a la Edge Function 'create-checkout', que nunca se desplegó: daba
 * 404 y el botón fallaba siempre con un error incomprensible.
 *
 * Hoy queda sin uso real: con la pasarela, el pack se cobra ENTERO al
 * comprarlo, así que no se generan saldos pendientes. Solo pueden tenerlo los
 * bonos creados antes, o los que da de alta la escuela a mano.
 *
 * Para esos casos se manda a WhatsApp en vez de a una pasarela que no sabe
 * cobrar este concepto: el tipo 'bono_balance' no existe en
 * calcular_importe_carrito, y cobrar sin saber a qué imputarlo sería peor.
 */
export async function startBonoBalanceCheckout(bonoId, amount, label = '') {
  const texto = `Hola! Quiero pagar el saldo pendiente de mi bono${label ? ' de ' + label : ''}` +
                `${amount ? ` (${Number(amount).toLocaleString('es-ES')}€)` : ''}.`;
  window.open(`https://wa.me/34636562448?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

export async function fetchUserBonos() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return [];
  const { data, error } = await supabase
    .from('bonos')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Bonos utilizables para reservar: activos, no caducados y con créditos libres.
// Opcionalmente filtrados por uno de los 6 tipos Waya
// (grupal | privada | semiprivada | familiar | residente | kids).
export async function fetchActiveBonos(classType) {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return [];
  let query = supabase
    .from('bonos')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  if (classType) query = query.eq('class_type', classType);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter(b => b.used_credits < b.total_credits);
}

// Packs de la actividad de un tipo de clase (para el pricing de upgrade).
// Devuelve { packs, deposit, extraClassPrice }; fallbacks si no hay actividad.
export async function fetchPacksForType(classType) {
  const { data: activity } = await supabase
    .from('activities')
    .select('id, deposit, extra_class_price')
    .eq('type_key', classType)
    .eq('activo', true)
    .single();
  if (!activity) return { packs: [], deposit: 15, extraClassPrice: 0 };

  const deposit = Number(activity.deposit) || 15;
  const extraClassPrice = Number(activity.extra_class_price) || 0;

  const { data, error } = await supabase
    .from('activity_packs')
    .select('sessions, price, public, featured')
    .eq('activity_id', activity.id)
    .order('sessions', { ascending: true });
  if (error) { console.warn('fetchPacksForType:', error.message); return { packs: [], deposit, extraClassPrice }; }
  return { packs: data || [], deposit, extraClassPrice };
}

// Amplía un bono: sube total_credits vía RPC upgrade_bono (valida ownership +
// status en la BD). amountPaid = importe que el cliente paga por esta ampliación.
export async function upgradeBono(bonoId, newTotalCredits, amountPaid = 0) {
  const { error } = await supabase.rpc('upgrade_bono', {
    p_bono_id: bonoId,
    p_new_total_credits: newTotalCredits,
  });
  if (error) throw error;

  if (amountPaid > 0) {
    const { data: bono } = await supabase.from('bonos').select('total_paid').eq('id', bonoId).single();
    const currentPaid = Number(bono?.total_paid || 0);
    await supabase.from('bonos').update({
      total_paid: currentPaid + amountPaid,
      updated_at: new Date().toISOString(),
    }).eq('id', bonoId);
  }
}
