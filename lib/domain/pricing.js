/* ============================================================
   Dominio · Precios (fuente única de verdad) — Waya Surf School
   ============================================================
   UNA sola implementación de "cuánto cuesta / cuánto debe" que todas las
   superficies importan (admin, mi-cuenta, checkout). Antes estaba copiada en
   varios sitios con matices distintos → incongruencias.

   Los precios viven SOLO en la BD (activity_packs.price + activities.extra_class_price),
   cargados y cacheados por loadPricing(). No hay catálogo de precios hardcodeado:
   si la BD no está disponible, getPackPrice usa la pista del llamador (precio propio
   de la clase) en vez de inventar precios que podrían cobrarse en silencio.

   defaultBonoExpiry usa activities.pack_validity (días) por tipo:
   180 clases (grupal/privada/semiprivada/familiar) · 365 residente · 30 kids.
   ============================================================ */

import { supabase } from '/lib/supabase.js';

// Redondeo a céntimo (usar SIEMPRE este, para no divergir entre superficies)
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Fallback de validez de bono por tipo (días), si la BD no está cargada.
// Coincide con el seed 0023 (activities.pack_validity).
const PACK_VALIDITY_FALLBACK = {
  grupal: 180, privada: 180, semiprivada: 180, familiar: 180,
  residente: 365, kids: 30,
};

// Tarifas + validez REALES desde la BD (activities + activity_packs), cacheadas 60s.
// getPackPrice y defaultBonoExpiry las usan. Si la BD no está disponible, NO se
// inventan precios (sin catálogo hardcodeado). Llamar loadPricing() al arrancar
// admin y mi-cuenta para que TODAS las superficies usen el MISMO precio.
let _dbTiers = null, _dbTs = 0;
export async function loadPricing(force = false) {
  if (!force && _dbTiers && (Date.now() - _dbTs) < 60000) return _dbTiers;
  try {
    const [actsRes, packsRes] = await Promise.all([
      supabase.from('activities').select('id, type_key, extra_class_price, pack_validity'),
      supabase.from('activity_packs').select('activity_id, sessions, price'),
    ]);
    const byId = {}; (actsRes.data || []).forEach(a => { byId[a.id] = a; });
    const map = {};
    (actsRes.data || []).forEach(a => {
      map[a.type_key] = {
        byN: {}, extra: Number(a.extra_class_price) || 0, maxN: 0, maxPrice: 0,
        validity: Number(a.pack_validity) || PACK_VALIDITY_FALLBACK[a.type_key] || 180,
      };
    });
    (packsRes.data || []).forEach(p => {
      const a = byId[p.activity_id]; if (!a) return;
      const m = map[a.type_key]; if (!m) return;
      m.byN[p.sessions] = Number(p.price);
      if (p.sessions > m.maxN) { m.maxN = p.sessions; m.maxPrice = Number(p.price); }
    });
    _dbTiers = map; _dbTs = Date.now();
  } catch { /* mantiene la cache previa; getPackPrice cae a la pista del llamador */ }
  return _dbTiers;
}

// Precio de pack para N sesiones de un tipo. Usa las tarifas de BD si están cargadas
// (loadPricing). Si N supera el tramo máximo, extrapola con el precio de clase extra;
// tramo intermedio → prorrateo lineal. Si la BD no está cargada, usa fallbackPrice * N.
export function getPackPrice(type, sessionCount, fallbackPrice = 0) {
  const n = Number(sessionCount) || 0;
  if (n <= 0) return 0;
  const m = _dbTiers && _dbTiers[type];
  if (m && m.maxN > 0) {
    if (m.byN[n] != null) return m.byN[n];                              // tarifa exacta de BD
    if (n > m.maxN) return round2(m.maxPrice + (n - m.maxN) * m.extra); // + precio clase extra
    return round2((m.maxPrice / m.maxN) * n);                          // tramo intermedio
  }
  // BD no cargada/caída: no inventamos precios; usamos la pista del llamador.
  return round2((Number(fallbackPrice) || 0) * n);
}

// Precio TOTAL esperado de un bono: el precio a medida (custom_total, p.ej. familiar
// o con descuento) si está fijado; si no, el del catálogo según sus créditos.
export function bonoExpected(bono) {
  if (!bono) return 0;
  return bono.custom_total != null
    ? Number(bono.custom_total)
    : getPackPrice(bono.class_type, bono.total_credits, 0);
}

// Importe pagado real de un bono (campo total_paid, que el dominio mantiene == SUM(payments)).
export function bonoPaid(bono) {
  return Number(bono?.total_paid || 0);
}

// Pendiente de cobro de un bono (nunca negativo, redondeado a céntimo).
export function bonoPending(bono) {
  return Math.max(0, round2(bonoExpected(bono) - bonoPaid(bono)));
}

// ¿Bono saldado? Pendiente (redondeado a céntimo) <= 0.
export function bonoFullyPaid(bono) {
  return bonoPending(bono) <= 0;
}

// Precio efectivo de una clase suelta: el propio de la clase si lo tiene (>0),
// si no el del catálogo de 1 sesión de su tipo.
export function classPrice(cls) {
  const p = Number(cls?.price) || 0;
  return p > 0 ? p : getPackPrice(cls?.type, 1, 0);
}

// Caducidad por defecto de un bono según su tipo: now() + pack_validity días.
// Usa la validez de BD si loadPricing() ya corrió; si no, el fallback por tipo.
// Devuelve ISOString (mismo contrato que el webhook: expires_at = now + validez).
export function defaultBonoExpiry(type) {
  const m = _dbTiers && _dbTiers[type];
  const days = (m && m.validity) || PACK_VALIDITY_FALLBACK[type] || 180;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
