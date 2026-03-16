(function () {
  "use strict";

  // Respect reduced motion — skip all scroll reveals
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Make all elements visible immediately
    document.querySelectorAll(".scroll-reveal").forEach(function (el) {
      el.classList.add("visible");
    });
    return;
  }

  // --- Scroll reveal via IntersectionObserver ---
  // Elements with .scroll-reveal start hidden (CSS), get .visible when
  // they enter the viewport, and stay visible permanently.
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -60px 0px" }
  );

  document.querySelectorAll(".scroll-reveal").forEach(function (el) {
    observer.observe(el);
  });
})();
