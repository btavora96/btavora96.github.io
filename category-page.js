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
 *
 * Gallery frames (.gallery-frame-wrap, Web Design) can hold several
 * stacked page screenshots; the prev/next arrows swap which one has
 * .is-active (and is therefore visible/scrollable) and reset the
 * frame's scroll position back to the top.
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

  function wireGalleryFrames() {
    document.querySelectorAll(".gallery-frame-wrap").forEach(function (wrap) {
      var frame = wrap.querySelector(".gallery-frame");
      var prev = wrap.querySelector(".gallery-frame-arrow--prev");
      var next = wrap.querySelector(".gallery-frame-arrow--next");
      if (!frame || (!prev && !next)) return;

      var slides = Array.prototype.slice.call(frame.querySelectorAll("img, .gallery-video"));
      if (slides.length < 2) return;

      var index = slides.findIndex(function (slide) {
        return slide.classList.contains("is-active");
      });
      if (index < 0) index = 0;

      function show(newIndex) {
        slides[index].classList.remove("is-active");
        index = (newIndex + slides.length) % slides.length;
        slides[index].classList.add("is-active");
        frame.scrollTop = 0;
      }

      if (prev) prev.addEventListener("click", function () { show(index - 1); });
      if (next) next.addEventListener("click", function () { show(index + 1); });
    });
  }

  /**
   * Scroll-driven focus effect: the gallery item nearest the viewport's
   * vertical center reads as "in focus" — sharp, slightly larger, fully
   * opaque, a stronger shadow — while items further away recede (smaller,
   * dimmer, a faint blur), like physical prints hanging in space and
   * catching the light as they drift past center.
   *
   * Every frame (not just on intersection-enter) each item's target
   * values are recomputed from its live position, then the currently-
   * applied values are eased a step closer to that target — that
   * lerp is what gives the motion weight/inertia instead of it feeling
   * like a mechanical snap-to-value. Only CSS custom properties feeding
   * transform/opacity/filter are touched (see category-page.css), so
   * this stays entirely on the compositor.
   */
  function wireScrollFocus() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return; // static gallery — the CSS defaults already render correctly
    }

    var items = Array.prototype.slice.call(document.querySelectorAll(".gallery-item"));
    var entries = items.map(function (item) {
      var media = item.querySelector(":scope > img, :scope > .gallery-video, :scope > .gallery-frame-wrap");
      if (!media) return null;
      return {
        item: item,
        media: media,
        cur: {
          scale: 1, y: 0, opacity: 1, brightness: 1, contrast: 1,
          blur: 0, shadowBlur: 16, shadowAlpha: 0.1
        }
      };
    }).filter(Boolean);

    if (!entries.length) return;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    // eases the falloff from center rather than a linear ramp, so focus
    // holds a little near the middle instead of dropping off immediately
    function smoothstep(t) {
      return t * t * (3 - 2 * t);
    }

    var EASE = 0.12; // how quickly the applied values chase their target each frame

    function tick() {
      var vh = window.innerHeight;
      var vCenter = vh / 2;

      entries.forEach(function (entry) {
        var rect = entry.item.getBoundingClientRect();
        var itemCenter = rect.top + rect.height / 2;
        var span = vh / 2 + rect.height / 2;
        var dist = span > 0 ? clamp((itemCenter - vCenter) / span, -1, 1) : 0;
        var focus = smoothstep(clamp(1 - Math.abs(dist), 0, 1));

        var cur = entry.cur;
        cur.scale = lerp(cur.scale, lerp(0.96, 1.06, focus), EASE);
        cur.y = lerp(cur.y, dist * -18, EASE);
        cur.opacity = lerp(cur.opacity, lerp(0.6, 1, focus), EASE);
        cur.brightness = lerp(cur.brightness, lerp(0.93, 1.04, focus), EASE);
        cur.contrast = lerp(cur.contrast, lerp(0.95, 1.06, focus), EASE);
        cur.blur = lerp(cur.blur, lerp(2.5, 0, focus), EASE);
        cur.shadowBlur = lerp(cur.shadowBlur, lerp(12, 34, focus), EASE);
        cur.shadowAlpha = lerp(cur.shadowAlpha, lerp(0.06, 0.2, focus), EASE);

        var style = entry.media.style;
        style.setProperty("--gf-scale", cur.scale.toFixed(4));
        style.setProperty("--gf-y", cur.y.toFixed(2) + "px");
        style.setProperty("--gf-opacity", cur.opacity.toFixed(3));
        style.setProperty("--gf-brightness", cur.brightness.toFixed(3));
        style.setProperty("--gf-contrast", cur.contrast.toFixed(3));
        style.setProperty("--gf-blur", cur.blur.toFixed(2) + "px");
        style.setProperty("--gf-shadow-blur", cur.shadowBlur.toFixed(1) + "px");
        style.setProperty("--gf-shadow-alpha", cur.shadowAlpha.toFixed(3));
      });

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  document.addEventListener("DOMContentLoaded", function () {
    wireToggle(document.querySelector(".cta-button"), document.querySelector(".cta-wrap"));

    document.querySelectorAll(".gallery-item").forEach(function (item) {
      wireToggle(item.querySelector(".gallery-caption"), item);
    });

    wireVideoAutoplay();
    wireGalleryFrames();
    wireScrollFocus();
  });
})();
