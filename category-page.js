/**
 * Category page CTA — the pill button unwraps into a bare title + small
 * subtitle on click (see the .cta-button/.cta-subtitle transitions in
 * category-page.css), and wraps back up on a second click. Hover/press
 * bold feedback on the button (and the back button) is handled purely
 * in CSS.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.querySelector(".cta-button");
    var wrap = document.querySelector(".cta-wrap");
    if (!button || !wrap) return;

    button.addEventListener("click", function () {
      button.classList.toggle("is-open");
      wrap.classList.toggle("is-open");
    });
  });
})();
