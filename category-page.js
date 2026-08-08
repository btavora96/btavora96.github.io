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

  // Reading mode: while a project's info panel is open, the gallery's
  // scroll-snap (mandatory, on <html> — see category-page.css) is
  // switched off via this class, and wireScrollFocus's own rAF loop is
  // told to freeze wherever it currently is, so neither one can pull
  // the page (or keep animating an image's scale/blur) out from under
  // someone mid-read. wireScrollFocus fills in real pause/resume
  // implementations once it's set up its own state; these no-op
  // defaults just mean a page with no scroll-snapped gallery at all
  // (nothing to pause) never has to special-case calling them.
  var READING_CLASS = "gallery-reading-mode";
  var galleryScrollControl = {
    pause: function () {},
    resume: function () {}
  };

  // How long the caption/subtitle's own CSS transition (see
  // .gallery-subtitle / .cta-subtitle in category-page.css — opacity/
  // transform/max-height, up to a 0.15s delay + 0.5s duration) takes to
  // finish, so the box we measure below is settled at its real, final
  // size rather than a still-animating intermediate one.
  var INFO_TRANSITION_MS = 680;

  // Scrolls just enough that `region` (the just-opened figcaption or
  // cta-wrap) isn't clipped by the viewport's top or bottom edge. Only
  // moves the page when something would actually be cut off — a region
  // that already fits comfortably on screen is left exactly where it
  // is, rather than being forced up to some fixed "reading" offset it
  // never needed in the first place.
  function scrollRegionIntoReadingView(region) {
    if (!region) return;
    var reducedMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var banner = document.querySelector(".scroll-banner");
    var bannerHeight = banner ? banner.getBoundingClientRect().height : 0;
    var topBreathingRoom = Math.max(bannerHeight + 32, 140);
    var bottomBreathingRoom = 32;

    var rect = region.getBoundingClientRect();
    var vh = window.innerHeight;
    var hiddenBelow = rect.bottom - (vh - bottomBreathingRoom);
    var hiddenAbove = topBreathingRoom - rect.top;

    var delta = 0;
    if (hiddenBelow > 0) {
      // Pull up just enough to bring the clipped part in, but never
      // further than the point where the top would crowd the banner.
      delta = Math.min(hiddenBelow, Math.max(0, rect.top - topBreathingRoom));
    } else if (hiddenAbove > 0) {
      delta = -hiddenAbove;
    }

    if (Math.abs(delta) < 8) return; // already comfortable — a scroll here would just be jitter
    window.scrollBy({ top: delta, behavior: reducedMotion ? "instant" : "smooth" });
  }

  function wireToggle(button, wrap) {
    if (!button || !wrap) return;
    var region = (button.closest && button.closest("figcaption")) || wrap;
    var scrollYBeforeReading = null;
    var repositionTimer = null;
    var detachScrollIntent = null;

    function setOpen(isOpen) {
      button.classList.toggle("is-open", isOpen);
      wrap.classList.toggle("is-open", isOpen);
    }

    function cancelPendingReposition() {
      if (repositionTimer !== null) {
        window.clearTimeout(repositionTimer);
        repositionTimer = null;
      }
    }

    // While reading, any real scroll input from the user (wheel, touch
    // drag, arrow/space/page keys) means they're done reading and are
    // actively trying to move the page — not that they want to be
    // pulled back to where they started. Closing immediately and hand-
    // ing control straight back to native snap lets that same gesture
    // carry them on to the next project instead of fighting it.
    function attachScrollIntent() {
      function onIntent() {
        if (detachScrollIntent) detachScrollIntent();
        cancelPendingReposition();
        setOpen(false);
        document.documentElement.classList.remove(READING_CLASS);
        galleryScrollControl.resume();
      }
      function onKey(e) {
        var keys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Spacebar"];
        if (keys.indexOf(e.key) !== -1) onIntent();
      }
      window.addEventListener("wheel", onIntent, { passive: true, once: true });
      window.addEventListener("touchmove", onIntent, { passive: true, once: true });
      window.addEventListener("keydown", onKey);
      detachScrollIntent = function () {
        window.removeEventListener("wheel", onIntent);
        window.removeEventListener("touchmove", onIntent);
        window.removeEventListener("keydown", onKey);
        detachScrollIntent = null;
      };
    }

    button.addEventListener("click", function () {
      var opening = !button.classList.contains("is-open");
      setOpen(opening);

      if (opening) {
        scrollYBeforeReading = window.scrollY;
        document.documentElement.classList.add(READING_CLASS);
        galleryScrollControl.pause();
        attachScrollIntent();
        // A tall item's figcaption is already snap-aligned "end" (see
        // applySnapAlignment) — its own resting position already puts
        // it right at the bottom of the viewport with the artwork
        // above it, so it never needs the explicit reposition below.
        if (!wrap.classList.contains("gallery-item--tall")) {
          repositionTimer = window.setTimeout(function () {
            repositionTimer = null;
            scrollRegionIntoReadingView(region);
          }, INFO_TRANSITION_MS);
        }
      } else {
        if (detachScrollIntent) detachScrollIntent();
        cancelPendingReposition();
        // Simply flipping scroll-snap back on here and letting the
        // browser resolve it natively is what used to cause the "sudden
        // jump" back: that correction is instant, not animated, and can
        // easily be 100-200px if reading nudged the page away from
        // wherever it would otherwise have settled. Rather than trying
        // to recompute "the" correct snap point ourselves, the simpler
        // and more honest fix is to ease back to the exact spot the
        // page was already at *before* it moved for reading. Native
        // snap, re-enabled a moment later, then has nothing meaningful
        // left to correct.
        window.setTimeout(function () {
          var reducedMotion = window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (scrollYBeforeReading !== null && Math.abs(window.scrollY - scrollYBeforeReading) >= 8) {
            window.scrollTo({ top: scrollYBeforeReading, behavior: reducedMotion ? "instant" : "smooth" });
          }
          window.setTimeout(function () {
            document.documentElement.classList.remove(READING_CLASS);
            galleryScrollControl.resume();
          }, 650);
        }, INFO_TRANSITION_MS);
      }
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

    // While a project's info panel is open (see wireToggle), freezes the
    // rAF loop below exactly where it is — no item keeps sharpening,
    // dimming, or nudging while someone's mid-read. Real pause/resume
    // now replace the module-level no-ops.
    var galleryPaused = false;
    galleryScrollControl.pause = function () { galleryPaused = true; };
    galleryScrollControl.resume = function () { galleryPaused = false; };

    // Most items snap centered as one whole section — image and
    // caption/button together (see .gallery-item in category-page.css).
    // Two things override that default:
    //
    // - The very first item always gets a fixed top edge instead —
    //   centering it would land at whatever scroll position its own
    //   height happens to need, which is a *different* position on
    //   every page. Pinning it to the same margin .project-grid itself
    //   opens with is what makes every category page's gallery start
    //   at identically the same spot.
    //
    // - Portrait pieces too tall for their own image+caption section to
    //   share one screen (Aurora, Crafthouse, Sandsavers, Shift
    //   Gallery, Zenzoo…) render at full original scale rather than
    //   being shrunk to fit, and instead get a second stop of their
    //   own: the item's own top is still the first (as above), and the
    //   figcaption separately snap-aligns "end" (see .gallery-item--tall
    //   in category-page.css) so the lower part of the artwork and the
    //   caption arrive together as a second, deliberate stage — the
    //   piece is seen in two stops rather than needing to fit whole or
    //   scrolling through it freely.
    var banner = document.querySelector(".scroll-banner");
    var bannerHeight = banner ? banner.getBoundingClientRect().height : 0;
    var rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var TOP_SPACING_PX = Math.max(12 * rootFontSize, bannerHeight + 24);
    // How much taller than the viewport a piece needs to be before it's
    // worth splitting into two stops rather than sharing one screen
    // with its own caption — a little slack above 1.0 so items that
    // only barely exceed the viewport (and would fit fine with a
    // little focus falloff) aren't needlessly split.
    var TALL_RATIO = 1.15;

    function applySnapAlignment() {
      var vh = window.innerHeight;
      entries.forEach(function (entry, index) {
        var isFirst = index === 0;
        var isTall = entry.media.getBoundingClientRect().height > vh * TALL_RATIO;
        entry.item.classList.toggle("gallery-item--tall", isTall);

        if (isFirst) {
          entry.item.style.scrollSnapAlign = "start";
          entry.item.style.scrollMarginTop = TOP_SPACING_PX + "px";
        } else if (isTall) {
          entry.item.style.scrollSnapAlign = "start";
          entry.item.style.scrollMarginTop = "0px";
        } else {
          entry.item.style.scrollSnapAlign = "center";
          entry.item.style.scrollMarginTop = "0px";
        }
      });
    }
    applySnapAlignment();
    window.addEventListener("resize", applySnapAlignment);

    // Lazy images/videos (most of them) report 0 height until loaded,
    // which would misclassify a genuinely tall piece as short. Nothing
    // else here depends on measured height, so this is the only thing
    // that needs a re-run once each one's real size is in.
    entries.forEach(function (entry) {
      var media = entry.media;
      var pending =
        (media.tagName === "IMG" && !media.complete) ||
        (media.tagName === "VIDEO" && media.readyState < 1);
      if (!pending) return;
      var eventName = media.tagName === "VIDEO" ? "loadedmetadata" : "load";
      media.addEventListener(eventName, applySnapAlignment, { once: true });
    });

    // The top edge is a fixed, page-independent constant (TOP_SPACING_PX
    // — the same value applySnapAlignment uses as a tall first item's own
    // snap target) so every project page's first image starts at exactly
    // the same distance below the banner/back-button, regardless of that
    // item's own height. On every project currently in the galleries
    // this floor is already taller than a first item would ever need for
    // centering on its own, so this doesn't reintroduce the old
    // can't-quite-reach-center problem — but it does mean a *future*
    // first item short enough to need more than TOP_SPACING_PX to center
    // itself would take priority on consistency over perfect centering.
    //
    // The bottom edge still tops up dynamically per page: unlike the
    // top, staying consistent across pages was never the ask there, and
    // last items vary enough in height that a fixed floor would either
    // undershoot a short one (back to the original off-center bug) or
    // pad every other page out to match its worst case.
    function applyEdgeSpacing() {
      var grid = document.querySelector(".project-grid");
      if (!grid) return;
      var vh = window.innerHeight;
      // The whole item now (image + caption), matching what's actually
      // being centered — using just the media's height here would
      // undershoot the buffer the caption itself also needs room for.
      var lastHeight = entries[entries.length - 1].item.getBoundingClientRect().height;
      var bottomNeeded = Math.max(0, (vh - lastHeight) / 2) + 24;
      grid.style.marginTop = TOP_SPACING_PX + "px";
      grid.style.paddingBottom = "max(14rem, " + bottomNeeded + "px)";
    }
    applyEdgeSpacing();
    window.addEventListener("resize", applyEdgeSpacing);

    // The last item's own height feeds directly into the bottom buffer
    // above — if it's a lazy-loaded image (most are), it still reports
    // 0 height at this point, so this recomputes once it's actually
    // sized. applySnapAlignment no longer depends on any image's
    // measured height (see above), so it doesn't need the same re-run.
    (function () {
      var lastMedia = entries[entries.length - 1].media;
      var pending =
        (lastMedia.tagName === "IMG" && !lastMedia.complete) ||
        (lastMedia.tagName === "VIDEO" && lastMedia.readyState < 1);
      if (!pending) return;
      var eventName = lastMedia.tagName === "VIDEO" ? "loadedmetadata" : "load";
      lastMedia.addEventListener(eventName, applyEdgeSpacing, { once: true });
    })();

    // Scroll-snap can auto-resolve an initial scroll offset from layout
    // alone, as soon as the browser has enough of the page parsed to do
    // so — which can happen before this script has replaced
    // .gallery-item's CSS default (center-align, no top margin) with
    // the correct per-item values set above. For the first item, that
    // means the page can land already centered on it — scrolled well
    // past the intended top margin — even though nothing has been
    // scrolled yet. A first scroll re-resolves snapping against the by-
    // then-correct alignment and looks right, which is why only
    // scrolling seemed to fix it. Explicitly returning to the top now,
    // after the correct alignment is already in place, corrects that
    // directly instead of racing the browser's own timing. Safe to do
    // unconditionally: this only ever runs on a genuine fresh load —
    // a bfcache-restored page (native back/forward) doesn't re-run
    // scripts at all, so a real preserved scroll position is never here
    // to clobber.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    // On some pages that forced reset still isn't the final word: the
    // browser can re-resolve mandatory snap a second time shortly after
    // load (observed ~200-300ms in, likely triggered by a late layout
    // shift — e.g. a @font-face swap changing the caption's measured
    // height) and land somewhere that matches neither the old default
    // nor the alignment set above. Since there's no reliable signal for
    // *why* it moved, this instead watches for the effect: any scroll
    // event in the first second after load that fires before the user
    // has actually touched the page is that browser-driven correction,
    // not a real one, and gets undone once. A genuine user scroll
    // (flagged the moment any input starts) is never touched.
    var userInteracted = false;
    ["pointerdown", "wheel", "touchstart", "keydown"].forEach(function (type) {
      window.addEventListener(type, function () { userInteracted = true; }, { once: true, passive: true });
    });
    var loadStamp = performance.now();
    var undidAutoScroll = false;
    window.addEventListener("scroll", function onEarlyAutoScroll() {
      if (undidAutoScroll || userInteracted) {
        window.removeEventListener("scroll", onEarlyAutoScroll);
        return;
      }
      if (performance.now() - loadStamp > 1000) {
        window.removeEventListener("scroll", onEarlyAutoScroll);
        return;
      }
      if (window.scrollY === 0) return; // nothing to undo yet
      undidAutoScroll = true;
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.removeEventListener("scroll", onEarlyAutoScroll);
    }, { passive: true });

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

    var EASE = 0.19; // how quickly the applied values chase their target each frame
    // Shrinks the falloff zone so an item reaches full focus well before it
    // reaches dead-center — with scroll-snap now locking each section to
    // center, the goal is for the project to already read as sharp/focused
    // by the time it's settling into place, not just once it's dead still.
    var FOCUS_SPAN_FACTOR = 0.6;
    // For the tall, two-stop pieces (see applySnapAlignment): how much
    // of stage two (bottom of the artwork + caption) needs to have
    // scrolled into view before the piece counts as "released" —
    // deliberately short, so it's already calm by the time there's
    // room to read the caption and reach the button, rather than still
    // scaled up and glowing underneath them.
    var EXIT_RELEASE_PX = 420;

    function tick() {
      if (galleryPaused) {
        requestAnimationFrame(tick);
        return;
      }

      var vh = window.innerHeight;
      var vCenter = vh / 2;

      entries.forEach(function (entry) {
        var rect = entry.media.getBoundingClientRect();
        var isTall = rect.height > vh * 1.15;
        var focus, yTarget;

        if (isTall) {
          // Two-stop pieces: focus ramps up as the artwork's own top
          // edge scrolls up through the viewport — reaching full focus
          // once it's fully entered — holds there for as long as any
          // part of it still fills the screen, and only ramps back
          // down once stage two (bottom of the artwork + caption) has
          // had a chance to actually be seen. No centering nudge: it
          // was never being pulled toward a center point.
          var enterFocus = clamp((vh - rect.top) / vh, 0, 1);
          var afterVisible = vh - rect.bottom; // px of caption/gap already scrolled into view
          var exitFocus = clamp(1 - afterVisible / EXIT_RELEASE_PX, 0, 1);
          focus = smoothstep(Math.min(enterFocus, exitFocus));
          yTarget = 0;
        } else {
          // The media's own rect — short/normal items are already well
          // under the viewport height, so this distance-from-center
          // falloff works cleanly for all of them, including the first
          // (start-aligned for cross-page consistency rather than
          // centered, but still short enough it settles very close to
          // its own peak focus anyway).
          var itemCenter = rect.top + rect.height / 2;
          var span = (vh / 2 + rect.height / 2) * FOCUS_SPAN_FACTOR;
          var dist = span > 0 ? clamp((itemCenter - vCenter) / span, -1, 1) : 0;
          focus = smoothstep(clamp(1 - Math.abs(dist), 0, 1));
          yTarget = dist * -18;
        }

        var cur = entry.cur;
        cur.scale = lerp(cur.scale, lerp(0.96, 1.06, focus), EASE);
        cur.y = lerp(cur.y, yTarget, EASE);
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
