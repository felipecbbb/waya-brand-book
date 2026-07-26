/* ============================================================
   Shared Constants — Admin Panel (Waya Surf)
   6 tipos de clase Waya. Pricing/validez: fuente única en BD
   (activities.pack_validity/deposit) + /lib/domain/pricing.js.
   ============================================================ */

export const TYPE_LABELS = {
  grupal: 'Clases Grupales',
  privada: 'Clases Privadas',
  semiprivada: 'Clases Semi-Privadas',
  familiar: 'Surf en Familia',
  residente: 'Bono Residentes',
  kids: 'Waya Kids',
};

export const TYPE_COLORS = {
  grupal: '#1a1a1a',
  privada: '#0369a1',
  semiprivada: '#0ea5e9',
  familiar: '#f97316',
  residente: '#10b981',
  kids: '#ec4899',
};

// Validez de bonos por tipo (días). Espejo del seed; la verdad viva está en
// activities.pack_validity (editable en la sección Actividades).
export const PACK_VALIDITY = {
  grupal: 180,
  privada: 180,
  semiprivada: 180,
  familiar: 180,
  residente: 365,
  kids: 60,
};

export const DEPOSIT = {
  grupal: 15,
  privada: 15,
  semiprivada: 15,
  familiar: 15,
  residente: 15,
  kids: 15,
};

// Rental duration keys and labels
export const RENTAL_DURATIONS = {
  '1h': '1 hora',
  '2h': '2 horas',
  '1d': '1 día',
  '1w': '1 semana',
};

export const RENTAL_DEPOSIT = 5;
