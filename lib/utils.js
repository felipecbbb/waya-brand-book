/**
 * Utilidades compartidas — Waya Surf School.
 * Helpers de formato/escape + labels de display de los 6 tipos de clase Waya.
 * Sin dependencias internas.
 */

// ---- HTML escape ----
export function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Alias explícito (algunas superficies importan escapeHtml)
export const escapeHtml = esc;

// ---- Price formatting (locale español: coma decimal + €) ----
export function formatPrice(n) {
  return Number(n).toFixed(2).replace('.', ',') + '€';
}

// ---- Date formatting (locale español) ----
export function formatDate(d) {
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- Labels de display de los 6 tipos de clase Waya ----
// CONTRATO: las keys deben coincidir con activities.type_key / surf_classes.type /
// bonos.class_type de la BD (ver SQL_CONTRACT §1).
export const TYPE_LABELS = {
  grupal: 'Grupal',
  privada: 'Privada',
  semiprivada: 'Semiprivada',
  familiar: 'Familiar',
  residente: 'Bono Residente',
  kids: 'Waya Kids',
};

// ---- Color por tipo de clase (paleta Waya) ----
// Se usa para pastillas/badges y puntos de calendario. grupal = amarillo de marca.
export const TYPE_COLORS = {
  grupal: 'var(--color-primary)', // #FDD802
  privada: '#1a1a1a',
  semiprivada: '#0ea5e9',
  familiar: '#f97316',
  residente: '#10b981',
  kids: '#ec4899',
};

// ---- Labels de método de pago ----
// CONTRATO: keys = payments.payment_method de la BD (6 métodos).
export const METHOD_LABELS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  voucher: 'Voucher',
  saldo: 'Saldo',
  online: 'Online',
};

// ---- Toast notification ----
export function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}
