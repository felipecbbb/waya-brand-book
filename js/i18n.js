const defaultLanguage = 'es';
const supportedLanguages = ['es', 'en', 'de'];

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

function getInitialLanguage() {
    const savedLanguage = getStoredLanguage();
    if (savedLanguage && supportedLanguages.includes(savedLanguage)) {
        return savedLanguage;
    }
    const browserLanguage = navigator.language.slice(0, 2);
    return supportedLanguages.includes(browserLanguage) ? browserLanguage : defaultLanguage;
}

function setLanguage(lang) {
    if (!supportedLanguages.includes(lang)) return;
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

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    const initialLang = getInitialLanguage();

    // We need to wait for translations.js to be loaded, usually it's loaded before this script
    if (typeof translations !== 'undefined') {
        setLanguage(initialLang);
    } else {
        console.error('Translations object not found. Make sure translations.js is loaded before i18n.js');
    }

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
    const currentLang = getStoredLanguage() || defaultLanguage;
    updateLanguageSelector(currentLang);
    updateTranslations(currentLang);
});

document.addEventListener('footerLoaded', () => {
    const currentLang = getStoredLanguage() || defaultLanguage;
    updateTranslations(currentLang);
});
