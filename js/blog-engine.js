/**
 * Waya Surf - Blog Engine
 * Handles dynamic loading of news grid and single article rendering.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check for new engine root
    const isBlogEngine = document.getElementById('blog-engine-root');
    const isArticle = document.querySelector('.article-hero');

    if (isBlogEngine) {
        loadBlogGrid();
    } else if (isArticle) {
        loadArticle();
    }
});

const FALLBACK_IMAGE = 'images/stock-hero-main.png';
const DEFAULT_LANGUAGE = 'es';
let lastNewsFetchError = '';
const ALLOWED_CONTENT_TAGS = new Set([
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'blockquote',
    'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'img', 'hr'
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function plainTextToParagraphs(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    return text
        .split(/\n\s*\n/)
        .map(chunk => `<p>${escapeHtml(chunk.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

function sanitizeImageUrl(rawValue) {
    const raw = String(rawValue ?? '').trim();
    if (!raw) return FALLBACK_IMAGE;

    // Keep local assets as-is.
    if (raw.startsWith('images/')) return raw;

    try {
        const parsed = new URL(raw, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (error) {
        console.warn('Invalid image URL, falling back:', error);
    }

    return FALLBACK_IMAGE;
}

function sanitizeRichHtml(input) {
    const dirty = String(input ?? '');
    if (!dirty.trim()) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(dirty, 'text/html');

    // Remove dangerous nodes first.
    doc.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, meta, link, style')
        .forEach(node => node.remove());

    const nodes = Array.from(doc.body.querySelectorAll('*'));
    nodes.forEach(node => {
        const tag = node.tagName.toLowerCase();

        if (!ALLOWED_CONTENT_TAGS.has(tag)) {
            const text = doc.createTextNode(node.textContent || '');
            node.replaceWith(text);
            return;
        }

        Array.from(node.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim();

            if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
                node.removeAttribute(attr.name);
                return;
            }

            if (tag === 'a' && name === 'href') {
                const safeHref = value.startsWith('#') || value.startsWith('/') || /^(https?:|mailto:|tel:)/i.test(value);
                if (!safeHref) node.removeAttribute('href');
                return;
            }

            if (tag === 'img' && name === 'src') {
                node.setAttribute('src', sanitizeImageUrl(value));
                return;
            }

            const allowedForTag = (tag === 'a' && ['href', 'target', 'rel', 'title'].includes(name))
                || (tag === 'img' && ['src', 'alt', 'title', 'loading'].includes(name));
            if (!allowedForTag) {
                node.removeAttribute(attr.name);
            }
        });

        if (tag === 'a') {
            node.setAttribute('rel', 'noopener noreferrer');
        }
        if (tag === 'img' && !node.getAttribute('loading')) {
            node.setAttribute('loading', 'lazy');
        }
    });

    // If content is plain text (no block tags), normalize it to editorial paragraphs.
    if (!doc.body.querySelector('*')) {
        return plainTextToParagraphs(doc.body.textContent || '');
    }

    return doc.body.innerHTML;
}

function getCurrentLanguage() {
    try {
        return localStorage.getItem('siteLanguage') || DEFAULT_LANGUAGE;
    } catch (error) {
        console.warn('Could not read language from localStorage:', error);
        return DEFAULT_LANGUAGE;
    }
}

function getSupabaseClient() {
    if (typeof supabase === 'undefined') {
        console.error('Supabase client is not available on this page.');
        return null;
    }
    return supabase;
}

function formatPost(post) {
    return {
        ...post,
        id: Number.parseInt(post.id, 10),
        title: String(post.title || ''),
        excerpt: String(post.excerpt || ''),
        image: sanitizeImageUrl(post.image),
        isTextOnly: Boolean(post.is_text_only),
        date: new Date(post.created_at).toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        })
    };
}

async function fetchNews() {
    const client = getSupabaseClient();
    if (!client) return [];
    lastNewsFetchError = '';

    try {
        const { data, error } = await client
            .from('posts')
            .select('id,title,excerpt,content,image,category,is_text_only,created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return (data || []).map(formatPost);
    } catch (error) {
        lastNewsFetchError = error?.message || 'Error desconocido de lectura';
        console.error('Error loading news from Supabase:', error);
        return [];
    }
}

async function fetchPostById(id) {
    const client = getSupabaseClient();
    if (!client) return null;

    try {
        const { data, error } = await client
            .from('posts')
            .select('id,title,excerpt,content,image,category,is_text_only,created_at')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data ? formatPost(data) : null;
    } catch (error) {
        console.error(`Error loading article ${id} from Supabase:`, error);
        return null;
    }
}

async function loadBlogGrid() {
    const news = await fetchNews();

    const root = document.getElementById('blog-engine-root');
    if (!root) return;

    // Clear loading state
    root.innerHTML = '';

    if (news.length === 0) {
        if (lastNewsFetchError) {
            root.innerHTML = `<div class="container" style="padding-top: 10rem; text-align: center;">
                <h3>No se pudieron cargar las noticias.</h3>
                <p style="margin-top:0.75rem;color:#666;">${escapeHtml(lastNewsFetchError)}</p>
            </div>`;
        } else {
            root.innerHTML = '<div class="container" style="padding-top: 10rem; text-align: center;"><h3>No hay noticias aún.</h3></div>';
        }
        return;
    }

    // --- 1. HERO SECTION (First Post) ---
    const heroPost = news[0];
    const heroImage = sanitizeImageUrl(heroPost.image);
    const heroTitle = escapeHtml(heroPost.title);
    const heroExcerpt = escapeHtml(heroPost.excerpt || '...');
    const heroId = Number.isInteger(heroPost.id) ? heroPost.id : 0;
    const heroDate = escapeHtml(heroPost.date);
    const heroHTML = `
        <section class="blog-hero-immersive">
            <div class="blog-hero-bg" style="background-image: url('${heroImage}');">
                <img src="${heroImage}" style="display:none;" onerror="this.parentElement.style.backgroundImage = 'url(\'${FALLBACK_IMAGE}\')'">
            </div>
            <div class="blog-hero-overlay"></div>
            <div class="blog-hero-content">
                <div class="hero-meta">
                    <span class="hero-tag" data-i18n="news.latest">LATEST DROP</span>
                    <span>${heroDate}</span>
                </div>
                <h1 class="hero-title-large">${heroTitle}</h1>
                <p class="hero-excerpt">${heroExcerpt}</p>
                <a href="noticia.html?id=${heroId}" class="btn mag-btn-primary" style="background: #FDD802; color: #000; padding: 1rem 2rem; border-radius: 50px; text-decoration: none; font-weight: 700; text-transform: uppercase;" data-i18n="news.read_article">Leer Artículo</a>
            </div>
        </section>
    `;

    // --- 2. MAGAZINE GRID (Rest of posts) ---
    const rest = news.slice(1);
    let gridHTML = '';

    if (rest.length > 0) {
        gridHTML = `
            <div class="magazine-container">
                <div class="section-label">
                    <span data-i18n="news.more_stories">MÁS HISTORIAS</span>
                </div>
                <div class="magazine-grid">
                    ${rest.map((post, index) => {
            // Determine sizing logic
            let sizeClass = 'standard';
            if (index < 2) sizeClass = 'medium';
            const postTitle = escapeHtml(post.title);
            const postExcerpt = escapeHtml(post.excerpt || '...');
            const postImage = sanitizeImageUrl(post.image);
            const postDate = escapeHtml(post.date);
            const postId = Number.isInteger(post.id) ? post.id : 0;

            return `
                        <a href="noticia.html?id=${postId}" class="mag-card ${sizeClass}">
                            <div class="mag-card-img">
                                <img src="${postImage}" 
                                     alt="${postTitle}" 
                                     loading="lazy"
                                     onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}';">
                                <span class="mag-tag">BLOG</span>
                            </div>
                            <div class="mag-card-content">
                                <div>
                                    <span class="mag-date">${postDate}</span>
                                    <h3 class="mag-title">${postTitle}</h3>
                                    <p class="mag-excerpt">${postExcerpt}</p>
                                </div>
                                <span style="margin-top: 1rem; font-size: 0.85rem; font-weight: 600; text-decoration: underline;" data-i18n="news.read_more">LEER MÁS</span>
                            </div>
                        </a>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    // Inject Everything
    root.innerHTML = heroHTML + gridHTML;

    // Apply translations now that content is in DOM
    if (typeof updateTranslations === 'function') {
        updateTranslations(getCurrentLanguage());
    }

    // --- 3. ANIMATIONS (GSAP) ---
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        gsap.registerPlugin(ScrollTrigger);

        // Content Entry
        gsap.from('.blog-hero-content > *', {
            y: 50,
            opacity: 0,
            duration: 1,
            stagger: 0.1,
            ease: 'power3.out',
            delay: 0.2
        });

        // Grid Entry
        gsap.fromTo('.mag-card',
            { y: 50, opacity: 0, autoAlpha: 0 },
            {
                y: 0,
                opacity: 1,
                autoAlpha: 1,
                duration: 0.8,
                stagger: 0.1,
                ease: 'power2.out',
                scrollTrigger: {
                    trigger: '.magazine-grid',
                    start: 'top 95%', // Trigger earlier to ensure visibility
                    toggleActions: 'play none none none'
                },
                onComplete: () => {
                    gsap.set('.mag-card', { clearProps: 'all' });
                }
            }
        );
    }
}

async function loadArticle() {
    const params = new URLSearchParams(window.location.search);
    const id = Number.parseInt(params.get('id') || '', 10);

    if (!Number.isInteger(id) || id <= 0) {
        window.location.href = 'blog.html';
        return;
    }

    const article = await fetchPostById(id);

    if (!article) {
        document.body.innerHTML = '<div class="container" style="padding: 10rem 0; text-align: center;"><h1 data-i18n="news.not_found">Noticia no encontrada</h1><a href="blog.html" data-i18n="news.back">Volver</a></div>';
        if (typeof updateTranslations === 'function') {
            updateTranslations(getCurrentLanguage());
        }
        return;
    }

    // Populate Data
    document.title = `${article.title} | Waya Noticias`;

    // Hero
    const heroBg = document.querySelector('.article-hero-bg');
    if (heroBg) {
        heroBg.style.backgroundImage = `url('${sanitizeImageUrl(article.image || FALLBACK_IMAGE)}')`;
        if (article.isTextOnly) heroBg.style.filter = "grayscale(100%) opacity(0.3)";
    }

    const articleDate = document.querySelector('.article-date');
    if (articleDate) articleDate.textContent = article.date || '';

    const articleCategory = document.querySelector('.article-category');
    if (articleCategory) articleCategory.textContent = article.category || '';

    const articleTitle = document.querySelector('.article-title');
    if (articleTitle) articleTitle.textContent = article.title || '';

    // Content
    const articleBody = document.querySelector('.article-body');
    if (articleBody) articleBody.innerHTML = sanitizeRichHtml(article.content || '');

    // Apply translations now that content is in DOM
    if (typeof updateTranslations === 'function') {
        updateTranslations(getCurrentLanguage());
    }

    // "Estilo Guapo" Entry Animations
    animateArticleEntry();
}

function animateArticleEntry() {
    // Check if GSAP is loaded
    if (typeof gsap !== 'undefined') {
        const tl = gsap.timeline();

        // Hero Init State
        gsap.set('.article-hero-bg', { scale: 1.1, opacity: 0 });
        gsap.set('.article-meta', { y: 20, opacity: 0 });
        gsap.set('.article-title', { y: 30, opacity: 0 });
        gsap.set('.article-body-container', { y: 50, opacity: 0 });

        // Sequence
        tl.to('.article-hero-bg', { duration: 1.5, scale: 1, opacity: 1, ease: 'power2.out' })
            .to('.article-meta', { duration: 0.8, y: 0, opacity: 1, ease: 'power2.out' }, '-=1')
            .to('.article-title', { duration: 1, y: 0, opacity: 1, ease: 'power3.out' }, '-=0.8')
            .to('.article-body-container', { duration: 1, y: 0, opacity: 1, ease: 'power2.out' }, '-=0.6');
    }
}
