// ========================================
// WAYA SURF SCHOOL - MODERN SCRIPT
// ========================================

// Redirect from non-www to www
if (window.location.hostname === 'escueladesurftelde.es') {
  window.location.href = window.location.href.replace('escueladesurftelde.es', 'www.escueladesurftelde.es');
}

document.addEventListener('DOMContentLoaded', () => {
  // Check if GSAP is loaded
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    initAnimations();
  } else {
    console.warn('GSAP not loaded. Animations disabled.');
  }

  // If we are using components (header/footer injection)
  if (document.getElementById('header-placeholder')) {
    document.addEventListener('headerLoaded', () => {
      initNavigation();
    });
  } else {
    // Fallback for static pages if any
    initNavigation();
  }

  initSmoothScroll();
  initHomeCarousel();
  initHeroSlideshow();
  initAccordion();
  initImmersiveScroll();
  initWaveAnimation();
  initSurfcampWaitlist();
});

// ========================================
// 7. SURFCAMP WAITLIST (SUPABASE)
// ========================================
async function initSurfcampWaitlist() {
  const form = document.getElementById('surfcamp-form');
  if (!form) return;

  const emailInput = form.querySelector('input[type="email"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  if (!emailInput || !submitBtn) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();

    if (!email) return;

    // UI: Loading State
    const originalBtnText = submitBtn.innerText;
    submitBtn.innerText = 'Enviando...';
    submitBtn.disabled = true;

    try {
      // Check if Supabase is loaded
      if (typeof supabase === 'undefined') {
        throw new Error('Supabase client not initialized');
      }

      // Insert into Supabase
      const { error } = await supabase
        .from('surfcamp_waitlist')
        .insert([{ email: email }]);

      if (error) throw error;

      // UI: Success State
      submitBtn.innerText = '¡Apuntado!';
      submitBtn.style.backgroundColor = '#10B981'; // Green
      submitBtn.style.color = '#fff';

      // Clear input
      emailInput.value = '';

      // Show Success Message (Toast or replace form content)
      const oldSuccessMsg = form.querySelector('.surfcamp-success-msg');
      if (oldSuccessMsg) oldSuccessMsg.remove();

      const successMsg = document.createElement('div');
      successMsg.className = 'surfcamp-success-msg';
      successMsg.innerText = '¡Gracias! Te avisaremos cuando abramos plazas.';
      successMsg.style.cssText = 'color: #fff; margin-top: 1rem; font-weight: 600; text-align: center;';
      form.appendChild(successMsg);

      // Reset button after 3s
      setTimeout(() => {
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
        submitBtn.style.backgroundColor = '';
        submitBtn.style.color = '';
        if (successMsg) successMsg.remove();
      }, 5000);

    } catch (err) {
      console.error('Error adding to waitlist:', err);
      // UI: Error State
      submitBtn.innerText = 'Error';
      submitBtn.style.backgroundColor = '#EF4444'; // Red

      setTimeout(() => {
        submitBtn.innerText = originalBtnText;
        submitBtn.disabled = false;
        submitBtn.style.backgroundColor = '';
      }, 3000);

      alert('Hubo un error al guardar tu correo. Por favor, inténtalo de nuevo.');
    }
  });
}

// ========================================
// 5. IMMERSIVE COLOR SCROLL (WAYA KIDS)
// ========================================
// ========================================
// 5. IMMERSIVE COLOR SCROLL (RESIDENTES)
// ========================================
function initImmersiveScroll() {
  // Check if GSAP and ScrollTrigger are loaded
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  const residentesSection = document.getElementById('bono-residentes-home');
  if (!residentesSection) return;

  // Timeline for background color scrubbing
  // We want: White -> Yellow (Enter) -> Yellow (Hold) -> White (Exit)
  // Logic: When #bono-residentes-home enters the viewport, trigger the change.

  ScrollTrigger.create({
    trigger: "#bono-residentes-home",
    start: "top 60%", // Trigger slightly earlier to start fade before full entry
    end: "bottom 60%", // End fade out as it leaves
    onEnter: () => gsap.to("body", { backgroundColor: "#FDD802", duration: 0.8 }),
    onLeave: () => gsap.to("body", { backgroundColor: "#ffffff", duration: 0.8 }),
    onEnterBack: () => gsap.to("body", { backgroundColor: "#FDD802", duration: 0.8 }),
    onLeaveBack: () => gsap.to("body", { backgroundColor: "#ffffff", duration: 0.8 }),
    // Toggle class for logo color if needed
    // toggleClass: { targets: ".header", className: "bg-yellow-active" }
  });
}

// ========================================
// 1. NAVIGATION & MOBILE MENU
// ========================================
function initNavigation() {
  const header = document.querySelector('.header');
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navMenu = document.querySelector('.nav-menu');
  const updateHeaderState = () => {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 50);
  };

  // Sticky Header
  if (header) {
    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });
  }

  // Mobile Menu Toggle
  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      const isMenuOpen = navMenu.classList.contains('active');

      navMenu.classList.toggle('active');
      mobileToggle.classList.toggle('active');
      document.body.classList.toggle('menu-open'); // For styling toggle button color

      // Enhanced scroll lock for mobile
      if (!isMenuOpen) {
        // Menu is being opened - lock scroll
        lockScroll();
      } else {
        // Menu is being closed - unlock scroll
        unlockScroll();
      }
    });
  }

  // Close menu when clicking a link
  if (navMenu && mobileToggle) {
    const allNavLinks = document.querySelectorAll('.nav-link, .dropdown-item, .btn');
    allNavLinks.forEach(link => {
      link.addEventListener('click', () => {
        if (navMenu.classList.contains('active')) {
          navMenu.classList.remove('active');
          mobileToggle.classList.remove('active');
          document.body.classList.remove('menu-open');
          unlockScroll();
        }
      });
    });
  }
}

// ========================================
// SCROLL LOCK UTILITIES
// ========================================
let scrollPosition = 0;

function lockScroll() {
  // Save current scroll position
  scrollPosition = window.pageYOffset || document.documentElement.scrollTop;

  // Lock body scroll
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollPosition}px`;
  document.body.style.width = '100%';

  // Prevent touch events on background
  document.addEventListener('touchmove', preventScroll, { passive: false });
}

function unlockScroll() {
  // Restore body scroll
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('position');
  document.body.style.removeProperty('top');
  document.body.style.removeProperty('width');

  // Restore scroll position
  window.scrollTo(0, scrollPosition);

  // Remove touch event prevention
  document.removeEventListener('touchmove', preventScroll, { passive: false });
}

function preventScroll(e) {
  // Allow scrolling inside the menu
  const navMenu = document.querySelector('.nav-menu');
  let target = e.target;

  // Check if the touch is inside the nav menu or its children
  while (target && target !== document.body) {
    if (target === navMenu) {
      // Touch is inside menu, allow it
      return;
    }
    target = target.parentElement;
  }

  // Touch is outside menu, prevent it
  e.preventDefault();
}

// ========================================
// 2. SMOOTH SCROLLING
// ========================================
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const hash = this.getAttribute('href');
      if (!hash || hash === '#') return;

      let target = null;
      try {
        target = document.querySelector(hash);
      } catch (error) {
        console.warn('Invalid hash selector:', hash, error);
        return;
      }

      if (target) {
        e.preventDefault();
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

// ========================================
// HOME CAROUSEL
// ========================================
function initHomeCarousel() {
  const carousel = document.querySelector('[data-home-carousel]');
  if (!carousel) return;

  const track = carousel.querySelector('.home-carousel-track');
  const slides = Array.from(carousel.querySelectorAll('.home-carousel-slide'));
  const prevBtn = carousel.querySelector('[data-carousel-prev]');
  const nextBtn = carousel.querySelector('[data-carousel-next]');
  const dotsContainer = carousel.querySelector('[data-carousel-dots]');

  if (!track || slides.length === 0 || !prevBtn || !nextBtn || !dotsContainer) return;

  let currentIndex = 0;
  let touchStartX = 0;

  const dots = slides.map((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'home-carousel-dot';
    dot.setAttribute('aria-label', `Ir al slide ${index + 1}`);
    dot.addEventListener('click', () => goToSlide(index));
    dotsContainer.appendChild(dot);
    return dot;
  });

  function render() {
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === currentIndex);
    });
  }

  function goToSlide(index) {
    const total = slides.length;
    currentIndex = ((index % total) + total) % total;
    render();
  }

  prevBtn.addEventListener('click', () => goToSlide(currentIndex - 1));
  nextBtn.addEventListener('click', () => goToSlide(currentIndex + 1));

  track.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0].clientX;
  }, { passive: true });

  track.addEventListener('touchend', (event) => {
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(deltaX) < 40) return;
    if (deltaX < 0) {
      goToSlide(currentIndex + 1);
    } else {
      goToSlide(currentIndex - 1);
    }
  }, { passive: true });

  render();
}

// ========================================
// 4. ACCORDION (LEVELS)
// ========================================
function initAccordion() {
  const levelItems = document.querySelectorAll('.level-item');

  levelItems.forEach(item => {
    const header = item.querySelector('.level-header');
    if (!header) return;

    header.addEventListener('click', () => {
      // Toggle current item
      item.classList.toggle('active');

      // Optional: Close other items (Accordian style)
      // levelItems.forEach(otherItem => {
      //   if (otherItem !== item) {
      //     otherItem.classList.remove('active');
      //   }
      // });
    });
  });
}

// ========================================
// 3. GSAP ANIMATIONS
// ========================================
function initAnimations() {
  // --- Hero Section ---
  if (document.querySelector('.hero-title-modern')) {
    const tl = gsap.timeline();
    tl.fromTo('.hero-title-modern',
      { y: 100, opacity: 0, autoAlpha: 0 },
      { y: 0, opacity: 1, autoAlpha: 1, duration: 1.2, ease: 'power3.out' }
    )
      .fromTo('.hero-subtitle',
        { y: 30, opacity: 0, autoAlpha: 0 },
        { y: 0, opacity: 1, autoAlpha: 1, duration: 1, ease: 'power3.out' }, '-=0.8'
      )
      .fromTo('.hero-buttons',
        { y: 20, opacity: 0, autoAlpha: 0 },
        { y: 0, opacity: 1, autoAlpha: 1, duration: 0.8, ease: 'power3.out' }, '-=0.8'
      )
      .fromTo('.scroll-indicator',
        { opacity: 0, autoAlpha: 0 },
        { opacity: 0.8, autoAlpha: 1, duration: 1, ease: 'power2.in' }, '-=0.5'
      );
  }

  // --- Scroll Trigger Animations ---

  // Section Titles Reveal
  const titles = gsap.utils.toArray('.section-title');
  if (titles.length > 0) {
    titles.forEach(title => {
      gsap.fromTo(title,
        { y: 50, opacity: 0 },
        {
          scrollTrigger: {
            trigger: title,
            start: 'top 85%',
            toggleActions: 'play none none reverse'
          },
          y: 0,
          opacity: 1,
          duration: 1,
          ease: 'power3.out'
        }
      );
    });
  }

  // About Section Parallax
  if (document.querySelector('.about-img')) {
    gsap.to('.about-img', {
      scrollTrigger: {
        trigger: '.about',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1
      },
      y: -50,
      ease: 'none'
    });
  }

  // Experience Section Reveal
  if (document.querySelector('.collage-main')) {
    gsap.from('.collage-main', {
      scrollTrigger: {
        trigger: '.experience',
        start: 'top 80%',
      },
      scale: 0.9,
      opacity: 0,
      duration: 1.2,
      ease: 'power3.out'
    });
  }

  // Services Cards Stagger
  if (document.querySelector('.service-card')) {
    gsap.fromTo('.service-card',
      { y: 50, opacity: 0 },
      {
        scrollTrigger: {
          trigger: '.services-grid',
          start: 'top 85%',
        },
        y: 0,
        opacity: 1,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power2.out',
        clearProps: 'opacity,transform'
      }
    );
  }

  // Testimonials Stagger
  if (document.querySelector('.testimonial-card')) {
    gsap.from('.testimonial-card', {
      scrollTrigger: {
        trigger: '.testimonials-slider',
        start: 'top 85%',
      },
      x: 100,
      opacity: 0,
      duration: 1,
      stagger: 0.3,
      ease: 'power3.out'
    });
  }
}

// ========================================
// 6. WAVE TIMELINE ANIMATION (METODOLOGIA)
// ========================================
function initWaveAnimation() {
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;

  const wavePath = document.querySelector('.wave-path');
  const timelineSection = document.querySelector('.wave-timeline');

  if (!wavePath || !timelineSection) return;

  // 1. Draw the wave path as you scroll down the timeline
  gsap.fromTo(wavePath,
    { strokeDashoffset: 2000 }, // Matches CSS dasharray
    {
      strokeDashoffset: 0,
      ease: "none",
      scrollTrigger: {
        trigger: timelineSection,
        start: "top 60%",
        end: "bottom 80%",
        scrub: 1 // Link animation progress strictly to scroll bar
      }
    }
  );

  // 2. Reveal timeline items one by one
  const items = document.querySelectorAll('.timeline-item');
  items.forEach((item, index) => {
    // Alternate direction for entrance
    const xOffset = index % 2 === 0 ? -50 : 50;

    gsap.fromTo(item,
      { opacity: 0, x: xOffset },
      {
        opacity: 1,
        x: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: item,
          start: "top 80%", // Reveal when top of item hits 80% viewport height
          toggleActions: "play none none reverse"
        }
      }
    );
  });
}

// ========================================
// HERO SLIDESHOW
// ========================================
function initHeroSlideshow() {
  const container = document.querySelector('.hero-slideshow');
  if (!container) return;

  const slides = Array.from(container.querySelectorAll('.hero-slide'));
  const dotsContainer = container.querySelector('.hero-slideshow-dots');
  const prevBtn = container.querySelector('.hero-prev');
  const nextBtn = container.querySelector('.hero-next');
  const progressBar = container.querySelector('.hero-slideshow-progress-bar');

  if (slides.length === 0) return;

  let current = 0;
  let interval = null;
  const DURATION = 6000;

  // Create dots
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'hero-slideshow-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', 'Slide ' + (i + 1));
    dot.addEventListener('click', () => goTo(i));
    dotsContainer.appendChild(dot);
  });

  const dots = Array.from(dotsContainer.querySelectorAll('.hero-slideshow-dot'));

  function goTo(index) {
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');

    current = ((index % slides.length) + slides.length) % slides.length;

    slides[current].classList.add('active');
    dots[current].classList.add('active');

    restartProgress();
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function restartProgress() {
    if (progressBar) {
      progressBar.classList.remove('running');
      void progressBar.offsetWidth; // force reflow
      progressBar.classList.add('running');
    }
    clearInterval(interval);
    interval = setInterval(next, DURATION);
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  // Touch / swipe support
  let touchStartX = 0;
  container.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) < 50) return;
    if (delta < 0) next(); else prev();
  }, { passive: true });

  // Start autoplay
  restartProgress();
}
