/**
 * Constantes compartidas de negocio — Waya Surf School.
 * Enums, ordenaciones y helpers de formulario reutilizados por todas las páginas
 * (público, mi-cuenta/, admin/). Sin dependencias internas.
 *
 * Al portar: los `value`/keys de aquí son CONTRATO de datos y deben coincidir
 * carácter a carácter con lo que la BD almacena (ver docs/reservas/SQL_CONTRACT.md).
 */

// ---- Email de la escuela (fuente única) ----
export const ADMIN_EMAIL = 'info@wayasurf.com';

// ---- Los 6 tipos de clase Waya (type_key canónico) ----
// Debe coincidir CARÁCTER a CARÁCTER con activities.type_key · surf_classes.type ·
// bonos.class_type · data-class-type del HTML · TYPE_LABELS/COLORS del JS.
export const CLASS_TYPES = ['grupal', 'privada', 'semiprivada', 'familiar', 'residente', 'kids'];

// Orden único de tallas: niño (numérico, ascendente) → adulto por letra.
// Dentro de cada letra: S (small) < normal < T (tall). Ej: S < MS < M < MT.
export const WETSUIT_SIZES = [
  '6 años','8 años','10 años','12 años','14','16',
  'XXS','XS','S','MS','M','MT','LS','L','LT','XL','XXL'
];

// Rango por letra (mismo criterio en toda la app)
const LETTER_SIZE_RANK = { XXS:1, XS:2, S:3, MS:4, M:5, MT:6, LS:7, L:8, LT:9, XL:10, XXL:11, XXXL:12 };

// Clave de ordenación para una talla cualquiera (niño numérico, letra, o pies de tabla).
// Grupos: 0 = numérica (niño/cm) asc · 1 = letra (rango) · 2 = pies de tabla (7'0) · 3 = otra (alfabética)
export function sizeSortKey(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const age = /^(\d+)\s*años?$/i.exec(s);
  if (age) return [0, parseInt(age[1], 10), ''];
  const feet = /^(\d+)'(\d+)$/.exec(s);
  if (feet) return [2, parseInt(feet[1], 10) * 10 + parseInt(feet[2], 10), ''];
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return [0, parseFloat(s.replace(',', '.')), ''];
  const up = s.toUpperCase();
  if (LETTER_SIZE_RANK[up] != null) return [1, LETTER_SIZE_RANK[up], ''];
  return [3, 0, up];
}

export function compareSizes(a, b) {
  const ka = sizeSortKey(a), kb = sizeSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2], 'es');
}

// Niveles de surf — contrato con columnas surf_classes.level / family_members.level.
// 'todos' incluido (⚠ Waya: Entreolas no lo tenía en el enum).
export const LEVEL_OPTIONS = [
  { value: 'principiante', label: 'Principiante', desc: 'No sé nada o he dado muy pocas clases' },
  { value: 'intermedio', label: 'Intermedio', desc: 'Controlo lo básico y quiero mejorar' },
  { value: 'avanzado', label: 'Avanzado', desc: 'Tengo experiencia y busco perfeccionar' },
  { value: 'todos', label: 'Todos los niveles', desc: 'Apto para cualquier nivel' },
];

// Niveles de una PERSONA (cliente o familiar) — la escala real de Waya, la
// misma que explica niveles.html. Distinta de LEVEL_OPTIONS, que describe a
// qué público va dirigida una CLASE ("clase para principiantes") y es contrato
// con surf_classes.level.
// Contrato con profiles.level y family_members.level (ver migración 0032).
export const CLIENT_LEVEL_OPTIONS = [
  { value: 'nivel_0', label: 'Nivel 0 — Tus Primeros Pasos', group: 'Principiante' },
  { value: 'nivel_1', label: 'Nivel 1 — Consolidando Básicos', group: 'Principiante' },
  { value: 'nivel_2', label: 'Nivel 2 — Hacia la Ola Verde', group: 'Intermedio' },
  { value: 'nivel_3', label: 'Nivel 3 — Autonomía en el Pico', group: 'Intermedio' },
  { value: 'nivel_4', label: 'Nivel 4 — Maniobras y Velocidad', group: 'Avanzado' },
  { value: 'nivel_5', label: 'Nivel 5+ — Alto Rendimiento', group: 'Avanzado' },
];

// Valores de la escala antigua que siguen guardados en fichas ya creadas.
// Se muestran como opción solo si el cliente ya los tiene, para no perder el
// dato ni forzar a reetiquetar a todo el mundo de golpe.
const LEGACY_CLIENT_LEVELS = {
  principiante: 'Principiante (escala antigua)',
  intermedio: 'Intermedio (escala antigua)',
  avanzado: 'Avanzado (escala antigua)',
  todos: 'Todos los niveles (escala antigua)',
};

export function clientLevelOptionsHtml(selected = '') {
  const sel = String(selected || '');
  let html = '<option value="">Sin definir</option>';
  let grupoActual = null;
  for (const l of CLIENT_LEVEL_OPTIONS) {
    if (l.group !== grupoActual) {
      if (grupoActual !== null) html += '</optgroup>';
      html += `<optgroup label="${l.group}">`;
      grupoActual = l.group;
    }
    html += `<option value="${l.value}"${sel === l.value ? ' selected' : ''}>${l.label}</option>`;
  }
  if (grupoActual !== null) html += '</optgroup>';

  if (LEGACY_CLIENT_LEVELS[sel]) {
    html += `<optgroup label="Anterior"><option value="${sel}" selected>${LEGACY_CLIENT_LEVELS[sel]}</option></optgroup>`;
  }
  return html;
}

// Etiqueta legible de un nivel de persona, venga de la escala nueva o la vieja.
export function clientLevelLabel(value) {
  if (!value) return '';
  const l = CLIENT_LEVEL_OPTIONS.find(x => x.value === value);
  if (l) return l.label;
  return LEGACY_CLIENT_LEVELS[value] || value;
}

export const AUDIENCE_OPTIONS = [
  { value: 'adultos', label: 'Adultos' },
  { value: 'ninos', label: 'Niños' },
  { value: 'mixto', label: 'Mixto' },
];

export function wetsuitOptionsHtml(selected = '') {
  return '<option value="">Sin definir</option>' +
    WETSUIT_SIZES.map(s => `<option value="${s}" ${selected === s ? 'selected' : ''}>${s}</option>`).join('');
}

export function levelOptionsHtml(selected = '', withDesc = false) {
  return '<option value="">Sin definir</option>' +
    LEVEL_OPTIONS.map(l => {
      const label = withDesc ? `${l.label} (${l.desc})` : l.label;
      return `<option value="${l.value}" ${selected === l.value ? 'selected' : ''}>${label}</option>`;
    }).join('');
}

// ---- Prefijos de teléfono por país (P7) ----
export const PHONE_PREFIXES = [
  { code: 'ES', flag: '🇪🇸', dial: '+34',  name: 'España' },
  { code: 'PT', flag: '🇵🇹', dial: '+351', name: 'Portugal' },
  { code: 'FR', flag: '🇫🇷', dial: '+33',  name: 'Francia' },
  { code: 'GB', flag: '🇬🇧', dial: '+44',  name: 'Reino Unido' },
  { code: 'DE', flag: '🇩🇪', dial: '+49',  name: 'Alemania' },
  { code: 'IT', flag: '🇮🇹', dial: '+39',  name: 'Italia' },
  { code: 'NL', flag: '🇳🇱', dial: '+31',  name: 'Países Bajos' },
  { code: 'BE', flag: '🇧🇪', dial: '+32',  name: 'Bélgica' },
  { code: 'CH', flag: '🇨🇭', dial: '+41',  name: 'Suiza' },
  { code: 'IE', flag: '🇮🇪', dial: '+353', name: 'Irlanda' },
  { code: 'US', flag: '🇺🇸', dial: '+1',   name: 'EE. UU.' },
];

// Prefijo a partir del código de país usado en el panel (ES/FR/DE/UK/PT/IT…)
export function dialForCountry(code) {
  const c = String(code || '').toUpperCase();
  const map = { ES: '+34', PT: '+351', FR: '+33', UK: '+44', GB: '+44', DE: '+49', IT: '+39', NL: '+31', BE: '+32', CH: '+41', IE: '+353', US: '+1' };
  return map[c] || '';
}

// <select> de prefijos para poner junto a un input de teléfono.
export function phonePrefixSelectHtml(id, selectedDial = '+34', attrs = '') {
  return `<select id="${id}" class="phone-prefix-select" ${attrs}>` +
    PHONE_PREFIXES.map(p => `<option value="${p.dial}" ${p.dial === selectedDial ? 'selected' : ''}>${p.flag} ${p.dial}</option>`).join('') +
    `</select>`;
}

// Enlaza un <select> de prefijo con un input de teléfono: al cambiar país,
// sustituye el prefijo inicial del número (lo que escriba el usuario se respeta).
export function wirePhonePrefix(selectEl, telEl) {
  if (!selectEl || !telEl) return;
  selectEl.addEventListener('change', () => {
    const dial = selectEl.value || '';
    const rest = String(telEl.value || '').replace(/^\s*\+\d{1,4}[\s-]*/, '').trim();
    telEl.value = (dial + ' ' + rest).trim();
    telEl.focus();
  });
}

export function audienceOptionsHtml(selected = '') {
  return '<option value="">Sin definir</option>' +
    AUDIENCE_OPTIONS.map(a => `<option value="${a.value}" ${selected === a.value ? 'selected' : ''}>${a.label}</option>`).join('');
}
