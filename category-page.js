/**
 * Category page unwrap buttons — the page-level CTA (category pages
 * without a real gallery yet) and each gallery item's project-name
 * button both unwrap into a bare title + small subtitle on click (see
 * the .cta-button/.gallery-caption transitions in category-page.css),
 * and wrap back up on a second click. Hover/press bold feedback is
 * handled purely in CSS.
 *
 * Gallery videos (.gallery-video, preload="none") only start
 * downloading/playing once their project scrolls into view, and pause
 * again once it scrolls out — keeps a page with several video projects
 * from trying to load them all at once.
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

  function wireVideoAutoplay() {
    var videos = document.querySelectorAll(".gallery-video");
    if (!videos.length) return;

    if (!("IntersectionObserver" in window)) {
      // no observer support: just let them play once loaded
      videos.forEach(function (video) {
        video.setAttribute("preload", "metadata");
        video.play().catch(function () {});
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var video = entry.target;
          if (entry.isIntersecting) {
            video.play().catch(function () {});
          } else {
            video.pause();
          }
        });
      },
      { rootMargin: "200px 0px", threshold: 0.25 }
    );

    videos.forEach(function (video) {
      observer.observe(video);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireToggle(document.querySelector(".cta-button"), document.querySelector(".cta-wrap"));

    document.querySelectorAll(".gallery-item").forEach(function (item) {
      wireToggle(item.querySelector(".gallery-caption"), item);
    });

    wireVideoAutoplay();
  });
})();
