const defaultLanguage = 'es';
const supportedLanguages = ['es', 'en', 'de'];

/* ------------------------------------------------------------
   Páginas con URL propia por idioma (SEO): /surf.html, /en/surf.html,
   /de/surf.html. El build (scripts/i18n-pages.mjs) LEE ESTA LISTA para
   generar las versiones /en/ y /de/ con el texto ya escrito en el HTML.
   En estas páginas el idioma lo manda la URL, nunca el navegador ni
   lo guardado, y el selector ES | EN | DE navega a la URL equivalente.

   Las demás (mi-cuenta, carrito, pago, legales…) siguen como siempre:
   una sola URL y el texto se cambia por JS con el idioma guardado.
   ------------------------------------------------------------ */
const LOCALIZED_PAGES = [
    'index.html', 'surf.html', 'informacion-general.html',
    'clases-grupales.html', 'clases-privadas.html', 'clases-semiprivadas.html', 'clases-familiares.html',
    'bono-residente.html', 'waya-kids.html', 'alquileres.html', 'surfcamps.html', 'tienda.html',
    'metodologia.html', 'nosotros.html', 'niveles.html', 'blog.html', 'noticia.html', 'reservar.html',
];

// Idioma y página a partir de una ruta: /en/surf.html → { lang: 'en', page: 'surf.html' }
function pathInfo(pathname) {
    const m = pathname.match(/^\/(en|de)(\/.*)?$/);
    const lang = m ? m[1] : 'es';
    let page = (m ? (m[2] || '/') : pathname).replace(/^\//, '');
    if (page === '' || page.endsWith('/')) page += 'index.html';
    return { lang, page };
}

function localizedPath(lang, page) {
    const p = page === 'index.html' ? '' : page;
    return (lang === 'es' ? '/' : `/${lang}/`) + p;
}

const PAGE = pathInfo(window.location.pathname);
const IS_LOCALIZED_PAGE = LOCALIZED_PAGES.includes(PAGE.page);

function getStoredLanguage() {
    try {
        return localStorage.getItem('siteLanguage');
    } catch (error) {
        console.warn('Could not read language from localStorage:', error);
        return null;
    }
}

function storeLanguage(lang) {
    try {
        localStorage.setItem('siteLanguage', lang);
    } catch (error) {
        console.warn('Could not persist language in localStorage:', error);
    }
}

// En una página localizada se guarda YA (antes de que corran los módulos):
// el contenido dinámico (calendario, surfcamps, carrito…) lee este valor.
if (IS_LOCALIZED_PAGE) storeLanguage(PAGE.lang);

function getInitialLanguage() {
    if (IS_LOCALIZED_PAGE) return PAGE.lang;
    const savedLanguage = getStoredLanguage();
    if (savedLanguage && supportedLanguages.includes(savedLanguage)) {
        return savedLanguage;
    }
    const browserLanguage = navigator.language.slice(0, 2);
    return supportedLanguages.includes(browserLanguage) ? browserLanguage : defaultLanguage;
}

function currentLanguage() {
    return IS_LOCALIZED_PAGE ? PAGE.lang : (getStoredLanguage() || defaultLanguage);
}

function setLanguage(lang) {
    if (!supportedLanguages.includes(lang)) return;

    // Página con URL por idioma: se navega a la versión equivalente.
    if (IS_LOCALIZED_PAGE) {
        try { localStorage.setItem('waya_lang_chosen', '1'); } catch (e) {}
        if (lang !== PAGE.lang) {
            storeLanguage(lang);
            window.location.href = localizedPath(lang, PAGE.page) + window.location.search + window.location.hash;
        }
        return;
    }

    if (document.documentElement.lang === lang) {
        updateLanguageSelector(lang);
        return;
    }

    // Save preference
    storeLanguage(lang);
    document.documentElement.lang = lang;

    // Update translations
    updateTranslations(lang);

    // Update selector UI
    updateLanguageSelector(lang);

    // Aviso para el contenido que NO viene de data-i18n sino de la base de
    // datos (surfcamps, tienda…): esas páginas se pintan por JS y no se
    // enterarían del cambio, porque aquí no se recarga la página.
    document.dispatchEvent(new CustomEvent('wayaLanguageChange', { detail: { lang } }));
}

function updateTranslations(lang) {
    if (typeof translations === 'undefined' || !translations[lang]) {
        console.error(`Translations not available for language: ${lang}`);
        return;
    }

    const elements = document.querySelectorAll('[data-i18n]');

    elements.forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = getNestedTranslation(translations[lang], key);

        if (translation !== null && translation !== undefined) {
            const text = typeof translation === 'string' ? translation : String(translation);

            // Special handling for form inputs/textareas (placeholders)
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = text;
            }
            // Handle HTML content if the translation contains HTML tags
            else if (typeof translation === 'string' && translation.includes('<')) {
                element.innerHTML = translation;
            } else {
                element.textContent = text;
            }
        } else {
            console.warn(`Missing translation for key: ${key} in language: ${lang}`);
        }
    });

    // Dispatch event for other components that might need to react
    document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

function getNestedTranslation(obj, keyPath) {
    if (!obj || !keyPath) return null;
    return keyPath.split('.').reduce((prev, curr) => {
        if (prev && Object.prototype.hasOwnProperty.call(prev, curr)) {
            return prev[curr];
        }
        return null;
    }, obj);
}

function updateLanguageSelector(currentLang) {
    const esBtn = document.getElementById('lang-btn-es');
    const enBtn = document.getElementById('lang-btn-en');
    const deBtn = document.getElementById('lang-btn-de');

    [esBtn, enBtn, deBtn].forEach(btn => {
        if (btn) btn.classList.remove('active');
    });

    const activeBtn = document.getElementById('lang-btn-' + currentLang);
    if (activeBtn) activeBtn.classList.add('active');
}

/* ---------- Enlaces internos en el idioma actual ----------
   El header/footer y el contenido pintado por JS enlazan a "/surf.html".
   En inglés o alemán, ese enlace debe llevar a "/en/surf.html". */
function localizeAnchor(a) {
    const lang = currentLanguage();
    if (lang === 'es' || !a || !a.getAttribute('href')) return;
    let url;
    try { url = new URL(a.href, window.location.href); } catch (e) { return; }
    if (url.origin !== window.location.origin) return;
    const info = pathInfo(url.pathname);
    if (info.lang !== 'es' || !LOCALIZED_PAGES.includes(info.page)) return;
    a.href = localizedPath(lang, info.page) + url.search + url.hash;
}

function localizeLinksIn(root) {
    (root || document).querySelectorAll('a[href]').forEach(localizeAnchor);
}

['click', 'auxclick', 'contextmenu', 'focusin'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (a) localizeAnchor(a);
    }, true);
});

/* ---------- Aviso suave de idioma (sin redirigir) ----------
   Si el navegador está en otro idioma que tenemos, se SUGIERE la versión
   en ese idioma. Nunca se redirige: Google y quien elija un idioma ven
   siempre la URL que han pedido. */
const LANG_HINT = {
    es: { text: 'Esta página también está en español.', cta: 'Ver en español' },
    en: { text: 'This page is also available in English.', cta: 'View in English' },
    de: { text: 'Diese Seite gibt es auch auf Deutsch.', cta: 'Auf Deutsch ansehen' },
};

function showLanguageHint() {
    if (!IS_LOCALIZED_PAGE) return;
    try { if (localStorage.getItem('waya_lang_chosen')) return; } catch (e) { return; }
    const browserLang = (navigator.language || '').slice(0, 2);
    if (!supportedLanguages.includes(browserLang) || browserLang === PAGE.lang) return;

    const hint = LANG_HINT[browserLang];
    const el = document.createElement('div');
    el.setAttribute('role', 'note');
    el.style.cssText = 'position:fixed;top:92px;right:16px;z-index:3500;max-width:320px;background:#1a1a1a;color:#fff;border-radius:14px;padding:12px 40px 12px 14px;font:500 .85rem/1.4 Inter,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.3)';
    el.innerHTML = `${hint.text} <a href="${localizedPath(browserLang, PAGE.page)}${window.location.search}${window.location.hash}" style="color:#FDD802;font-weight:700;text-decoration:underline;white-space:nowrap">${hint.cta} →</a>
        <button type="button" aria-label="Cerrar" style="position:absolute;top:6px;right:8px;background:none;border:0;color:#fff;font-size:1.3rem;line-height:1;cursor:pointer;opacity:.7">&times;</button>`;
    const remember = () => { try { localStorage.setItem('waya_lang_chosen', '1'); } catch (e) {} };
    el.querySelector('a').addEventListener('click', remember);
    el.querySelector('button').addEventListener('click', () => { remember(); el.remove(); });
    document.body.appendChild(el);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // En una página localizada el HTML ya viene en su idioma: no se repinta,
    // solo se marca el botón activo.
    if (IS_LOCALIZED_PAGE) {
        updateLanguageSelector(PAGE.lang);
    } else if (typeof translations !== 'undefined') {
        setLanguage(getInitialLanguage());
    } else {
        console.error('Translations object not found. Make sure translations.js is loaded before i18n.js');
    }
    localizeLinksIn(document);
    showLanguageHint();

    // Event delegation for language selector
    document.addEventListener('click', (e) => {
        if (e.target.matches('#lang-btn-es')) {
            setLanguage('es');
        } else if (e.target.matches('#lang-btn-en')) {
            setLanguage('en');
        } else if (e.target.matches('#lang-btn-de')) {
            setLanguage('de');
        }
    });
});

// Since header/footer are loaded dynamically, we need to update translations when they arrive
document.addEventListener('headerLoaded', () => {
    const currentLang = currentLanguage();
    updateLanguageSelector(currentLang);
    updateTranslations(currentLang);
    localizeLinksIn(document.getElementById('header-placeholder') || document);
});

document.addEventListener('footerLoaded', () => {
    const currentLang = currentLanguage();
    updateTranslations(currentLang);
    localizeLinksIn(document.getElementById('footer-placeholder') || document);
});
