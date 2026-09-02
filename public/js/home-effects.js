/* ============================================================
   home-effects.js — Movimiento fino en la home (autocontenido):
   · inyecta su propio CSS (reveals + parallax)
   · reveals suaves al entrar (fade + slide up, con stagger)
   · parallax ligero en las fotos a sangre
   Respeta prefers-reduced-motion. El hero-slideshow no se toca.
   ============================================================ */
(function () {
  /* ---------- CSS inyectado ---------- */
  var css = [
    '.reveal-up{opacity:0;transform:translateY(30px);',
    'transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);',
    'will-change:opacity,transform;}',
    '.reveal-up.is-in{opacity:1;transform:none;}',
    '.home-surfcamp-bg{transition:transform 9s ease,background-position .12s linear;}',
    '@media (prefers-reduced-motion:reduce){.reveal-up{opacity:1!important;transform:none!important;transition:none!important;}}'
  ].join('');
  var style = document.createElement('style');
  style.setAttribute('data-home-effects', '');
  style.textContent = css;
  document.head.appendChild(style);

  function init() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Reveals ---------- */
    var targets = document.querySelectorAll(
      '.service-card-home, .review-card, .bono-v2-card, .niveles-level-item, ' +
      '.home-surfcamp-inner, .blog-cta-home, .home-carousel-card, .home-about-brand, .home-about-content'
    );

    ['.services-grid-home', '.reviews-grid', '.bono-v2-cards'].forEach(function (sel) {
      var grid = document.querySelector(sel);
      if (!grid) return;
      Array.prototype.forEach.call(grid.children, function (child, i) {
        child.style.transitionDelay = (i * 70) + 'ms';
      });
    });

    if (reduce || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      targets.forEach(function (el) { el.classList.add('reveal-up'); });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
      targets.forEach(function (el) { io.observe(el); });
    }

    /* ---------- Parallax ligero en la foto a sangre ---------- */
    if (!reduce) {
      var bg = document.querySelector('.home-surfcamp-bg');
      var section = bg && bg.closest('.home-surfcamp');
      if (bg && section) {
        var ticking = false;
        function update() {
          ticking = false;
          var vh = window.innerHeight;
          var r = section.getBoundingClientRect();
          if (r.bottom < -60 || r.top > vh + 60) return;
          var progress = (vh - r.top) / (vh + r.height); // 0..1
          var pos = 50 + (progress - 0.5) * 16; // 42%..58%
          bg.style.backgroundPositionY = pos + '%';
        }
        window.addEventListener('scroll', function () {
          if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
        }, { passive: true });
        update();
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
