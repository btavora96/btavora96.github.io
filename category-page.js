/**
 * Category page unwrap buttons — the page-level CTA (category pages
 * without a real gallery yet) and each gallery item's project-name
 * button both unwrap into a bare title + small subtitle on click (see
 * the .cta-button/.gallery-caption transitions in category-page.css),
 * and wrap back up on a second click. Hover/press bold feedback is
 * handled purely in CSS.
 */
(function () {
  "use strict";

  function wireToggle(button, wrap) {
    if (!button || !wrap) return;
    button.addEventListener("click", function () {
      button.classList.toggle("is-open");
      wrap.classList.toggle("is-open");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireToggle(document.querySelector(".cta-button"), document.querySelector(".cta-wrap"));

    document.querySelectorAll(".gallery-item").forEach(function (item) {
      wireToggle(item.querySelector(".gallery-caption"), item);
    });
  });
})();
