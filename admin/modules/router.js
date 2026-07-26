/* ============================================================
   Hash Router — Admin Panel SPA navigation
   ============================================================ */
import { getUser, getProfile } from './auth.js';
import { showToast } from './ui.js';

const routes = {};
let contentEl = null;
let titleEl = null;

export const sectionTitles = {
  dashboard: 'Dashboard',
  estadisticas: 'Estadísticas',
  reservas: 'Reservas Camps',
  actividades: 'Actividades',
  camps: 'Surf Camps',
  calendario: 'Calendario Clases',
  material: 'Material',
  productos: 'Productos',
  pedidos: 'Pedidos Tienda',
  clientes: 'Clientes',
  'reserva-clases': 'Reserva Clases',
  cupones: 'Cupones',
  equipo: 'Equipo',
  'control-horario': 'Control Horario',
  papelera: 'Papelera',
};

// Secciones restringidas: solo role='admin' puede acceder (nunca un encargado)
const ADMIN_ONLY_SECTIONS = new Set(['estadisticas', 'cupones', 'equipo', 'papelera']);

// Secciones que se le pueden conceder a un encargado (todas menos las admin-only)
export const GRANTABLE_SECTIONS = Object.keys(sectionTitles).filter(s => !ADMIN_ONLY_SECTIONS.has(s));

function currentRole() {
  return getProfile()?.role || null;
}

// ¿Puede el usuario actual ver esta sección?
function isSectionAllowed(hash) {
  if (currentRole() === 'admin') return true;
  // encargado: nunca las admin-only
  if (ADMIN_ONLY_SECTIONS.has(hash)) return false;
  if (hash === 'dashboard') return true; // siempre tiene su landing
  const allowed = getProfile()?.allowed_sections;
  // null/sin definir = todas las operativas (comportamiento por defecto)
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(hash);
}

// Muestra/oculta los items del sidebar según el acceso del usuario
export function applyRolePermissions() {
  document.querySelectorAll('a.admin-nav-item[data-section]').forEach(a => {
    a.style.display = isSectionAllowed(a.dataset.section) ? '' : 'none';
  });
}

// Register a route
export function register(hash, renderFn) {
  routes[hash] = renderFn;
}

// Initialize router
export function initRouter() {
  contentEl = document.getElementById('admin-content');
  titleEl = document.getElementById('section-title');

  window.addEventListener('hashchange', () => navigate());
  navigate();
}

// Navigate to current hash
export async function navigate() {
  if (!getUser()) return;

  let hash = (location.hash || '#dashboard').replace('#', '');

  // Bloqueo de acceso: sección admin-only o no concedida al encargado
  if (!isSectionAllowed(hash)) {
    showToast('Sin permisos para esa sección', 'error');
    location.hash = '#dashboard';
    return; // hashchange disparará navigate() de nuevo con #dashboard
  }

  const renderFn = routes[hash];

  // Update topbar title
  if (titleEl) titleEl.textContent = sectionTitles[hash] || hash;

  // Update sidebar active
  document.querySelectorAll('a.admin-nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.section === hash);
  });

  // Close mobile sidebar
  document.getElementById('admin-sidebar')?.classList.remove('open');
  document.getElementById('admin-overlay')?.classList.remove('open');

  if (renderFn && contentEl) {
    contentEl.innerHTML = `<div class="admin-skeleton">
      <div class="admin-skeleton-row"><div class="admin-skeleton-block w-md h-lg"></div><div class="admin-skeleton-block w-sm"></div></div>
      <div class="admin-skeleton-row"><div class="admin-skeleton-block w-full h-card"></div><div class="admin-skeleton-block w-full h-card"></div></div>
      <div class="admin-skeleton-row"><div class="admin-skeleton-block w-full h-card"></div><div class="admin-skeleton-block w-full h-card"></div></div>
    </div>`;
    try {
      await renderFn(contentEl);
    } catch (err) {
      contentEl.innerHTML = `<div class="admin-empty"><p>Error al cargar: ${err.message}</p></div>`;
      console.error(err);
    }
  } else if (contentEl) {
    contentEl.innerHTML = '<div class="admin-empty"><p>Sección no encontrada</p></div>';
  }
}
