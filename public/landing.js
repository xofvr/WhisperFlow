(function () {
  "use strict";

  // Respect reduced motion preferences
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  gsap.registerPlugin(ScrollTrigger);

  // --- Hero: split text reveal ---
  gsap.from(".hero .word", {
    y: 60,
    opacity: 0,
    duration: 1,
    ease: "power3.out",
    stagger: 0.08,
    delay: 0.3,
  });

  // --- Hero: subtitle + buttons fade in ---
  gsap.from(".hero .body-large, .hero .btn", {
    y: 30,
    opacity: 0,
    duration: 0.8,
    ease: "power2.out",
    stagger: 0.12,
    delay: 0.9,
  });

  // --- Hero: label fade in ---
  gsap.from(".hero .label", {
    opacity: 0,
    duration: 0.6,
    ease: "power2.out",
    delay: 0.1,
  });

  // --- Hero: gradient parallax on scroll ---
  gsap.to(".hero-gradient", {
    yPercent: 30,
    ease: "none",
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: true,
    },
  });

  // --- Reveal elements: animate once when entering viewport ---
  // Elements stay visible by default. onEnter fires once, does a
  // quick gsap.from() that briefly hides then animates in.
  gsap.utils.toArray(".reveal").forEach(function (el) {
    ScrollTrigger.create({
      trigger: el,
      start: "top 85%",
      once: true,
      onEnter: function () {
        gsap.from(el, {
          y: 40,
          opacity: 0,
          duration: 0.8,
          ease: "power2.out",
        });
      },
    });
  });

  // --- Step cards: staggered entrance (once only) ---
  ScrollTrigger.batch(".step-card", {
    once: true,
    start: "top 85%",
    onEnter: function (batch) {
      gsap.from(batch, {
        y: 50,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        stagger: 0.15,
      });
    },
  });

  // --- Feature cards: staggered entrance (once only) ---
  ScrollTrigger.batch(".feature-card", {
    once: true,
    start: "top 85%",
    onEnter: function (batch) {
      gsap.from(batch, {
        y: 50,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
        stagger: 0.12,
      });
    },
  });
})();
