/* ============================================================
   Admin Entry Point — Entre Olas Surf
   ============================================================ */
import { checkSession, signIn, signOut, getProfile, onAuthChange } from './modules/auth.js';
import { register, initRouter, applyRolePermissions } from './modules/router.js';
import { initModal, showToast } from './modules/ui.js';
import { loadPricing } from '/lib/domain/pricing.js';

// Import sections
import { renderDashboard } from './sections/dashboard.js';
import { renderReservas } from './sections/reservas.js';
import { renderCamps } from './sections/camps.js';
import { renderProductos } from './sections/productos.js';
import { renderPedidos } from './sections/pedidos.js';
import { renderClientes } from './sections/clientes.js';
import { renderCalendario } from './sections/calendario.js';
import { renderActividades } from './sections/actividades.js';

import { renderMaterial } from './sections/material.js';
import { renderEstadisticas } from './sections/estadisticas.js';
import { renderReservaClases } from './sections/reserva-clases.js';
import { renderCupones } from './sections/cupones.js';
import { renderEquipo } from './sections/equipo.js';
import { renderControlHorario } from './sections/control-horario.js';
import { renderPapelera } from './sections/papelera.js';

// DOM refs
const loginView = document.getElementById('login-view');
const adminApp = document.getElementById('admin-app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');
const hamburgerBtn = document.getElementById('hamburger-btn');
const sidebar = document.getElementById('admin-sidebar');
const overlay = document.getElementById('admin-overlay');

// ---- Show / Hide views ----
function showLogin() {
  loginView.style.display = '';
  adminApp.style.display = 'none';
  loginError.classList.remove('visible');
  loginForm.reset();
}

function showAdmin() {
  loginView.style.display = 'none';
  adminApp.style.display = '';
  const profile = getProfile();
  if (profile) {
    const roleLabel = profile.role === 'encargado' ? ' · Encargado' : '';
    userDisplay.textContent = (profile.full_name || profile.id.substring(0, 8)) + roleLabel;
  }
  applyRolePermissions();
}

// ---- Register routes ----
register('dashboard', renderDashboard);
register('reservas', renderReservas);
register('camps', renderCamps);
register('productos', renderProductos);
register('pedidos', renderPedidos);
register('clientes', renderClientes);
register('calendario', renderCalendario);
register('actividades', renderActividades);

register('material', renderMaterial);
register('estadisticas', renderEstadisticas);
register('reserva-clases', renderReservaClases);
register('cupones', renderCupones);
register('equipo', renderEquipo);
register('control-horario', renderControlHorario);
register('papelera', renderPapelera);

// ---- Login form ----
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  loginError.classList.remove('visible');
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando…';

  try {
    await signIn(email, password);
    await loadPricing();
    showAdmin();
    if (!location.hash || location.hash === '#') location.hash = '#dashboard';
    initRouter();
    showToast('Sesión iniciada', 'success');
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.add('visible');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Iniciar Sesión';
  }
});

// ---- Logout ----
logoutBtn.addEventListener('click', async () => {
  await signOut();
  showLogin();
  location.hash = '';
  showToast('Sesión cerrada');
});

// ---- Mobile sidebar toggle ----
hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
});

// ---- Auth state change listener ----
onAuthChange((isValid) => {
  if (!isValid) {
    showLogin();
    location.hash = '';
  }
});

// ---- Init modal close handlers ----
initModal();

// ---- Boot: check existing session ----
(async () => {
  const isAdmin = await checkSession();
  if (isAdmin) {
    await loadPricing();
    showAdmin();
    if (!location.hash || location.hash === '#') location.hash = '#dashboard';
    initRouter();
  } else {
    showLogin();
  }
})();
