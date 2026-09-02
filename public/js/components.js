// Load Header and Footer components
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('headerLoaded', initAccountNav);
    loadComponent('header-placeholder', '/components/header.html');
    loadComponent('footer-placeholder', '/components/footer.html');
    injectGlobalStyles();
    initCookieBanner();
});

/* ---------- Estilos globales inyectados (footer legal + banner cookies) ---------- */
function injectGlobalStyles() {
    if (document.getElementById('waya-global-fx')) return;
    var css = ''
        + '.footer-bottom{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.7rem 1.5rem;}'
        + '.footer-legal{list-style:none;display:flex;flex-wrap:wrap;gap:.35rem 1.2rem;padding:0;margin:0;}'
        + '.footer-legal a{color:rgba(255,255,255,.55);font-size:.85rem;text-decoration:none;transition:color .2s;}'
        + '.footer-legal a:hover{color:#FDD802;}'
        + '.waya-cookies{position:fixed;left:16px;right:16px;bottom:16px;z-index:4000;max-width:540px;margin:0 auto;background:#1a1a1a;color:#fff;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:1.2rem 1.3rem;box-shadow:0 20px 54px rgba(0,0,0,.4);font-family:"Inter",sans-serif;transform:translateY(160%);transition:transform .5s cubic-bezier(.16,1,.3,1);}'
        + '.waya-cookies.show{transform:translateY(0);}'
        + '.waya-cookies p{margin:0 0 .9rem;font-size:.88rem;line-height:1.5;color:rgba(255,255,255,.85);}'
        + '.waya-cookies a{color:#FDD802;text-decoration:underline;}'
        + '.waya-cookies-actions{display:flex;gap:.6rem;}'
        + '.waya-cookies button{flex:1;padding:.7rem 1rem;border-radius:50px;font-family:"Outfit",sans-serif;font-weight:700;font-size:.82rem;cursor:pointer;border:none;transition:all .2s;text-transform:uppercase;letter-spacing:.03em;}'
        + '.wc-accept{background:#FDD802;color:#1a1a1a;}.wc-accept:hover{background:#E8C702;}'
        + '.wc-reject{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.3);}.wc-reject:hover{background:rgba(255,255,255,.1);}'
        + '@media(max-width:480px){.waya-cookies-actions{flex-direction:column;}}';
    var s = document.createElement('style');
    s.id = 'waya-global-fx';
    s.textContent = css;
    document.head.appendChild(s);
}

/* ---------- Banner de cookies (RGPD): aceptar / rechazar ---------- */
function initCookieBanner() {
    var KEY = 'waya_cookie_consent';
    try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
    if (location.pathname.indexOf('politica-cookies') !== -1) return;

    var el = document.createElement('div');
    el.className = 'waya-cookies';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Aviso de cookies');
    el.innerHTML =
        '<p>Usamos cookies propias y de terceros para el funcionamiento del sitio y para analizar su uso. ' +
        'Consulta nuestra <a href="/politica-cookies.html">Política de Cookies</a>.</p>' +
        '<div class="waya-cookies-actions">' +
        '<button class="wc-reject" type="button">Rechazar</button>' +
        '<button class="wc-accept" type="button">Aceptar</button></div>';
    document.body.appendChild(el);
    // Forzar reflow para que la transición de entrada dispare de forma fiable
    void el.offsetWidth;
    requestAnimationFrame(function () { el.classList.add('show'); });

    function close(v) {
        try { localStorage.setItem(KEY, v); } catch (e) {}
        el.classList.remove('show');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 520);
    }
    el.querySelector('.wc-accept').addEventListener('click', function () { close('accepted'); });
    el.querySelector('.wc-reject').addEventListener('click', function () { close('rejected'); });
}

/* ============================================================
   CONTROL DE CUENTA (header) — corre en TODAS las páginas con header.
   El ESTADO (logueado/invitado) se lee directo de localStorage (robusto,
   sin depender de cargar un cliente Supabase). El cliente es un extra
   best-effort para el nombre del perfil, el signOut y onAuthStateChange.
   ============================================================ */
let _sbHeaderPromise = null;
function _loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
        if ([].slice.call(document.scripts).some(function (s) { return s.src && s.src.indexOf(src) !== -1; })) return resolve();
        const el = document.createElement('script');
        el.src = src; el.async = false;
        el.onload = function () { resolve(); };
        el.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
        document.head.appendChild(el);
    });
}
// Espera al cliente único que publica /lib/supabase-global.js.
//
// Antes esto cargaba supabase-js del CDN + /js/config.js, creando una SEGUNDA
// instancia del cliente además de la del bundle. Dos instancias = dos gestores
// de sesión refrescando el mismo token, con reintentos duplicados.
//
// El módulo global corre antes de DOMContentLoaded y esto se llama dentro de
// ese evento, así que normalmente ya está. El sondeo cubre el caso raro de que
// el módulo tarde, y se rinde en 3s en vez de colgarse.
async function ensureSupabase() {
    if (window.supabase && window.supabase.auth) return window.supabase;
    if (_sbHeaderPromise) return _sbHeaderPromise;
    _sbHeaderPromise = (async function () {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            if (window.supabase && window.supabase.auth) return window.supabase;
            await new Promise(r => setTimeout(r, 50));
        }
        console.warn('ensureSupabase: el cliente no está disponible en esta página');
        return null;
    })();
    return _sbHeaderPromise;
}

async function initAccountNav() {
    const root = document.getElementById('account-nav');
    if (!root) return;
    const menu = root.querySelector('.account-menu');
    const trigger = root.querySelector('.account-trigger');
    const nameEl = root.querySelector('[data-account-name]');
    const initialEl = root.querySelector('[data-account-initial]');
    const logoutBtn = root.querySelector('[data-account-logout]');

    function setName(display) {
        const firstName = (display || '').trim().split(/\s+/)[0] || 'Mi cuenta';
        const cap = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        if (nameEl) nameEl.textContent = cap;
        if (initialEl) initialEl.textContent = (firstName[0] || 'W').toUpperCase();
    }
    function authKey() {
        return Object.keys(localStorage).find(function (k) { return k.indexOf('sb-') === 0 && /-auth-token$/.test(k); });
    }
    function localUser() {
        try {
            const key = authKey();
            if (!key) return null;
            const obj = JSON.parse(localStorage.getItem(key));
            const sess = obj && (obj.currentSession || obj);
            const user = sess && sess.user;
            if (!user) return null;
            if (sess.expires_at && Math.floor(Date.now() / 1000) > sess.expires_at) return null;
            return user;
        } catch (e) { return null; }
    }
    function applyUser(user) {
        if (!user) { root.setAttribute('data-state', 'guest'); if (menu) menu.classList.remove('open'); return; }
        root.setAttribute('data-state', 'user');
        let display = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) || '').trim();
        if (!display && user.email) display = user.email.split('@')[0];
        setName(display);
    }

    // 1) Estado inmediato desde localStorage (robusto en TODAS las páginas)
    const user0 = localUser();
    applyUser(user0);

    if (trigger) {
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            const open = menu.classList.toggle('open');
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }
    document.addEventListener('click', function (e) {
        if (menu && !menu.contains(e.target)) {
            menu.classList.remove('open');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
    });
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function (e) {
            e.preventDefault();
            try {
                const sb = await ensureSupabase();
                if (sb) { await sb.auth.signOut(); }
                else { const key = authKey(); if (key) localStorage.removeItem(key); }
            } catch (_) {}
            window.location.href = '/';
        });
    }

    // 2) Best-effort con cliente: nombre bonito del perfil + reaccionar a login/logout
    try {
        const sb = await ensureSupabase();
        if (sb) {
            try {
                const res = await sb.auth.getSession();
                const session = res && res.data ? res.data.session : null;
                const user = (session && session.user) || user0;
                if (user) {
                    applyUser(user);
                    if (!(user.user_metadata && user.user_metadata.full_name) && user.id) {
                        const r = await sb.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
                        if (r && r.data && r.data.full_name) setName(r.data.full_name);
                    }
                }
            } catch (_) {}
            // Solo gestiona el ESTADO (login/logout); no re-pisa el nombre ya afinado del perfil.
            sb.auth.onAuthStateChange(function (_e, session) {
                const u = (session && session.user) || localUser();
                if (u) { root.setAttribute('data-state', 'user'); }
                else { applyUser(null); }
            });
        }
    } catch (_) {}
}

const componentCache = new Map();

async function getComponentHtml(filePath) {
    if (componentCache.has(filePath)) {
        return componentCache.get(filePath);
    }

    const response = await fetch(filePath + '?v=' + Date.now(), { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    componentCache.set(filePath, html);
    return html;
}

function dispatchComponentEvent(elementId) {
    if (elementId === 'header-placeholder') {
        document.dispatchEvent(new Event('headerLoaded'));
    } else if (elementId === 'footer-placeholder') {
        document.dispatchEvent(new Event('footerLoaded'));
    }
}

async function loadComponent(elementId, filePath) {
    const element = document.getElementById(elementId);
    if (!element) return;

    try {
        const html = await getComponentHtml(filePath);
        element.innerHTML = html;
    } catch (error) {
        console.error(`Error loading ${filePath}:`, error);
    } finally {
        // Keep downstream hooks running even when component fetch fails.
        dispatchComponentEvent(elementId);
    }
}
