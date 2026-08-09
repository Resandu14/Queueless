const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function animateWithFallback(selector, keyframes, options) {
  const elements = document.querySelectorAll(selector);
  if (!elements.length || reduceMotion) return;

  if (window.gsap) {
    gsap.from(elements, {
      ...keyframes,
      stagger: keyframes.stagger ?? 0.08,
      ease: keyframes.ease ?? "power3.out"
    });
    return;
  }

  elements.forEach((element, index) => {
    element.animate(
      [
        {
          opacity: keyframes.autoAlpha === 0 ? 0 : keyframes.opacity ?? 0,
          transform: `translateY(${keyframes.y ?? 0}px) scale(${keyframes.scale ?? 1})`
        },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ],
      {
        duration: (options?.duration ?? keyframes.duration ?? 0.7) * 1000,
        delay: index * 80,
        easing: "cubic-bezier(.16, 1, .3, 1)",
        fill: "both"
      }
    );
  });
}

function smoothScrollTo(target) {
  const targetElement = document.querySelector(target);
  if (!targetElement) return false;

  const top = targetElement.getBoundingClientRect().top + window.scrollY - 24;
  window.scrollTo({
    top,
    behavior: reduceMotion ? "auto" : "smooth"
  });
  return true;
}

function setupSmoothLinks() {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const hash = link.getAttribute("href");
      if (!hash || hash === "#") return;
      if (!smoothScrollTo(hash)) return;
      event.preventDefault();
      history.pushState(null, "", hash);
    });
  });
}

function setupActiveNavSections() {
  const hashLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  if (!hashLinks.length) return;

  const sectionMap = hashLinks
    .map((link) => ({ link, section: document.querySelector(link.getAttribute("href")) }))
    .filter((item) => item.section);

  if (!sectionMap.length) return;

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;

    hashLinks.forEach((link) => link.removeAttribute("aria-current"));
    const active = sectionMap.find((item) => item.section === visible.target);
    if (active) active.link.setAttribute("aria-current", "page");
  }, {
    rootMargin: "-25% 0px -55% 0px",
    threshold: [0.1, 0.25, 0.5]
  });

  sectionMap.forEach((item) => observer.observe(item.section));
}

function setupNavAnimation() {
  const header = document.querySelector(".header");
  const navbar = document.querySelector(".navbar");
  const navItems = document.querySelectorAll(".logo, .nav-links a, .navbar .btn, .customer-link, .logout-button");
  if (!header || !navbar) return;

  const updateHeader = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  if (window.gsap && !reduceMotion) {
    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .from(navbar, { autoAlpha: 0, y: -26, scale: 0.98, duration: 0.75 })
      .from(navItems, { autoAlpha: 0, y: -8, duration: 0.42, stagger: 0.045 }, "-=0.38");
  } else {
    navbar.classList.add("nav-ready");
  }

  navbar.addEventListener("pointermove", (event) => {
    if (reduceMotion || window.innerWidth < 760) return;
    const rect = navbar.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2) / rect.width;
    const y = (event.clientY - rect.top - rect.height / 2) / rect.height;
    navbar.style.transform = `translate3d(${x * 5}px, ${y * 3}px, 0)`;
  });

  navbar.addEventListener("pointerleave", () => {
    navbar.style.transform = "";
  });
}

function setupScrollReveals() {
  const revealSelectors = [
    ".hero-card",
    ".hero-copy > *",
    ".marquee-band",
    ".section-heading > *",
    ".store-card",
    ".flow-heading > *",
    ".flow-panel",
    ".cta-section > *",
    ".flow-shell > *",
    ".queue-layout > *",
    ".complete-card",
    ".login-copy > *",
    ".login-card",
    ".dashboard-intro > *",
    ".metric-card",
    ".orders-layout",
    ".history-card"
  ].join(",");

  if (window.gsap && window.ScrollTrigger && !reduceMotion) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.defaults({ ease: "power3.out" });

    ScrollTrigger.batch(revealSelectors, {
      start: "top 86%",
      once: true,
      onEnter: (batch) => {
        gsap.fromTo(
          batch,
          { autoAlpha: 0, y: 28, scale: 0.98 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.78, stagger: 0.07, overwrite: true }
        );
      }
    });

    const scrollRoot = document.querySelector(".page-shell, .dashboard-main, .flow-main");
    const backgroundTargets = document.querySelectorAll(".title-image, .store-image, .flow-panel");
    if (scrollRoot && backgroundTargets.length) {
      gsap.to(backgroundTargets, {
        scrollTrigger: {
          trigger: scrollRoot,
          start: "top top",
          end: "bottom bottom",
          scrub: 1
        },
        backgroundPosition: "50% 62%",
        ease: "none"
      });
    }

    window.addEventListener("load", () => ScrollTrigger.refresh());
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14 });

  document.querySelectorAll(revealSelectors).forEach((element) => {
    element.classList.add("reveal-item");
    observer.observe(element);
  });
}

function setupTouchEffects() {
  document.querySelectorAll(".store-card, .metric-card, .incoming-order, .history-card, .panel, .login-card, .queue-actions, .complete-card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      if (reduceMotion || window.innerWidth < 760) return;
      const rect = card.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * -8;
      card.style.transform = `perspective(900px) rotateX(${y}deg) rotateY(${x}deg) translateY(-4px)`;
    });

    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
}

function setupPageEntry() {
  document.body.classList.add("is-loaded");
  animateWithFallback(".flow-copy > *, .complete-card > *, .login-copy > *, .dashboard-intro > *", {
    autoAlpha: 0,
    y: 22,
    duration: 0.7,
    stagger: 0.09
  });
  animateWithFallback(".panel, .login-card, .ticket-panel, .queue-actions, .today-card", {
    autoAlpha: 0,
    y: 32,
    scale: 0.97,
    duration: 0.76,
    stagger: 0.08
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupSmoothLinks();
  setupActiveNavSections();
  setupNavAnimation();
  setupScrollReveals();
  setupTouchEffects();
  setupPageEntry();
});
