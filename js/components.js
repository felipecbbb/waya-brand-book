// Load Header and Footer components
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('header-placeholder', 'components/header.html');
    loadComponent('footer-placeholder', 'components/footer.html');
});

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
