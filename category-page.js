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
  // cta-wrap) sits in a comfortable reading position — a real top
  // margin, not merely "technically on screen" — rather than jumping
  // until its top edge touches the very top of the viewport.
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
    var wantsTopAt = topBreathingRoom;
    var delta;
    if (hiddenBelow > 0 && rect.height <= vh - topBreathingRoom - bottomBreathingRoom) {
      // Tall enough to fit with room to spare but currently spilling
      // past the bottom — bring the bottom in first, same as the top
      // case below would, without pulling the top past its own margin.
      delta = Math.min(hiddenBelow, rect.top - topBreathingRoom);
    } else {
      delta = rect.top - wantsTopAt;
    }

    if (Math.abs(delta) < 8) return; // already comfortable — a scroll here would just be jitter
    window.scrollBy({ top: delta, behavior: reducedMotion ? "instant" : "smooth" });
  }

  function wireToggle(button, wrap) {
    if (!button || !wrap) return;
    var region = (button.closest && button.closest("figcaption")) || wrap;
    var scrollYBeforeReading = null;

    button.addEventListener("click", function () {
      var opening = !button.classList.contains("is-open");
      button.classList.toggle("is-open");
      wrap.classList.toggle("is-open");

      if (opening) {
        scrollYBeforeReading = window.scrollY;
        document.documentElement.classList.add(READING_CLASS);
        galleryScrollControl.pause();
        window.setTimeout(function () {
          scrollRegionIntoReadingView(region);
        }, INFO_TRANSITION_MS);
      } else {
        // Simply flipping scroll-snap back on here and letting the
        // browser resolve it natively is what used to cause the "sudden
        // jump" back: that correction is instant, not animated, and can
        // easily be 100-200px if reading nudged the page away from
        // wherever it would otherwise have settled. Rather than trying
        // to recompute "the" correct snap point ourselves (fragile —
        // tall items in particular don't have a single one; the user
        // could have opened the info panel from anywhere along a long
        // scroll-through), the simpler and more honest fix is to ease
        // back to the exact spot the page was already at *before* it
        // moved for reading. Native snap, re-enabled a moment later,
        // then has nothing meaningful left to correct.
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

    // Short items (comfortably fit within the viewport) snap centered —
    // scroll-snap-align: center centers the *item's* box by default,
    // which includes the caption below the image, landing the image
    // itself above true center. Shrinking the snap area's bottom edge up
    // to the media's own bottom (a negative scroll-margin-bottom, sized
    // to each item's own caption height) makes the browser center the
    // image instead.
    //
    // Tall items (taller than the viewport, e.g. Aurora, Sandsavers,
    // Crafthouse, Shift Gallery, Zenzoo) can't be "centered" in any
    // meaningful sense — there's always more of them above and below the
    // fold no matter where they rest, so centering just means landing
    // mid-image with neither end in view. Those snap to their own top
    // edge instead: scrolling in lands at the start of the project, the
    // rest scrolls normally like any tall page, and the next snap point
    // only arrives once the user has actually scrolled past its end.
    //
    // Measured via getBoundingClientRect before the rAF loop below has
    // touched any transforms, so this reads each item's true,
    // untransformed layout.
    var banner = document.querySelector(".scroll-banner");
    var bannerHeight = banner ? banner.getBoundingClientRect().height : 0;
    // Same generous top spacing as .project-grid's own margin-top (see
    // category-page.css) — used below as the snap target for tall items.
    // This used to just clear the fixed banner (a bare ~88px), which was
    // nowhere near the page's actual ~192px of top margin: the item sits
    // correctly on first paint (that's plain layout), but the instant
    // scroll-snap re-resolves — on the first scroll, even a small one —
    // it pulls the item up to that much smaller margin instead, reading
    // as suddenly "stuck to the top." Matching the two numbers is what
    // keeps the breathing room consistent whether or not a snap has
    // fired yet.
    var rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var TOP_SPACING_PX = Math.max(12 * rootFontSize, bannerHeight + 24);

    function applySnapAlignment() {
      var vh = window.innerHeight;
      entries.forEach(function (entry, index) {
        var itemRect = entry.item.getBoundingClientRect();
        var mediaRect = entry.media.getBoundingClientRect();
        var isTall = mediaRect.height > vh;
        // The very first item is always top-aligned at TOP_SPACING_PX,
        // even when it's short enough to otherwise qualify for center
        // snapping — a short first project centering itself lands at
        // whatever scroll position its own height happens to need,
        // which is a *different* position on every page. Pinning it to
        // the same fixed top edge as a tall first item is what makes
        // every category page's gallery start at identically the same
        // spot, which center-snapping can't guarantee on its own.
        var isFirst = index === 0;

        if (isTall || isFirst) {
          entry.item.style.scrollSnapAlign = "start";
          entry.item.style.scrollMarginTop = TOP_SPACING_PX + "px";
          entry.item.style.scrollMarginBottom = "0px";
        } else {
          entry.item.style.scrollSnapAlign = "center";
          entry.item.style.scrollMarginTop = "0px";
          var belowMedia = itemRect.bottom - mediaRect.bottom;
          entry.item.style.scrollMarginBottom = (-belowMedia) + "px";
        }
      });
    }
    applySnapAlignment();
    window.addEventListener("resize", applySnapAlignment);

    // Most gallery images load lazily (and gallery videos use preload=
    // "none"), so at the point the calls above first run, anything not
    // yet on screen still has no known intrinsic size — its media box
    // reports 0 height, which reads as "short" no matter how tall the
    // image actually is. Re-running the classification once each one's
    // real dimensions are in is what lets Crafthouse, Sandsavers, Shift
    // Gallery, and Zenzoo (all lazy, all off past the first screen) get
    // picked up as tall too, not just Aurora (the only eager one).
    entries.forEach(function (entry) {
      var media = entry.media;
      var pending =
        (media.tagName === "IMG" && !media.complete) ||
        (media.tagName === "VIDEO" && media.readyState < 1);
      if (!pending) return;
      var eventName = media.tagName === "VIDEO" ? "loadedmetadata" : "load";
      media.addEventListener(eventName, function () {
        applySnapAlignment();
        applyEdgeSpacing();
      }, { once: true });
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
      var lastHeight = entries[entries.length - 1].media.getBoundingClientRect().height;
      var bottomNeeded = Math.max(0, (vh - lastHeight) / 2) + 24;
      grid.style.marginTop = TOP_SPACING_PX + "px";
      grid.style.paddingBottom = "max(14rem, " + bottomNeeded + "px)";
    }
    applyEdgeSpacing();
    window.addEventListener("resize", applyEdgeSpacing);

    // Scroll-snap can auto-resolve an initial scroll offset from layout
    // alone, as soon as the browser has enough of the page parsed to do
    // so — which can happen before this script has replaced
    // .gallery-item's CSS default (center-align, no top margin) with
    // the correct per-item values set above. For a tall first item like
    // Aurora, "center" against a box far taller than the viewport lands
    // the page already scrolled down, image filling the screen edge to
    // edge with no margin visible — even though nothing has been
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
    // How much of the caption/buttons needs to have scrolled into view
    // (in px) before a tall item counts as fully "released". Tying
    // release to the image's own bottom edge crossing the *entire*
    // viewport height (as enter does, in reverse) would keep it scaled
    // up and glowing long after the caption has already scrolled into
    // view — the "fighting the image for attention" this exists to
    // avoid — but too short a distance is its own problem: the bottom
    // of a tall piece barely gets seen before the handoff starts,
    // reading as the gallery rushing to the next project. 650 (up from
    // 420, then 480) gives real, deliberate scroll distance to actually
    // look at the lower section of the artwork before it lets go.
    var EXIT_RELEASE_PX = 650;

    function tick() {
      if (galleryPaused) {
        requestAnimationFrame(tick);
        return;
      }

      var vh = window.innerHeight;
      var vCenter = vh / 2;

      entries.forEach(function (entry, index) {
        // The media's own rect, not the item's (which also includes the
        // caption below it) — this is what scroll-snap now actually
        // centers (see applySnapAlignment above), so "in focus" should
        // peak at the same point "centered" means to the browser.
        var rect = entry.media.getBoundingClientRect();
        var isTall = rect.height > vh;
        var isFirst = index === 0;
        var focus, yTarget;

        if (isTall || isFirst) {
          // Taller-than-viewport items (Aurora, Sandsavers, Crafthouse,
          // Shift Gallery, Zenzoo…) are never resized to fit and never
          // centered — there's no single "centered" position that makes
          // sense for something bigger than the screen. Instead focus
          // ramps up as the image's own top edge scrolls up through the
          // viewport (enterFocus), holds at full focus for as long as
          // the image still fills the whole screen (both ramps clamped
          // at 1), and only ramps back down as its bottom edge scrolls
          // through and off the top (exitFocus) — so the piece reads as
          // sharp for the entire time it's actually being read, and the
          // soft blur/dim is only ever an entrance/exit transition, not
          // something fought against mid-scroll.
          // Reaches full focus exactly when the item settles into its
          // own actual resting position (TOP_SPACING_PX from the top —
          // see applySnapAlignment), not an arbitrary "all the way to
          // the very top of the viewport" that a start-aligned item
          // never fully reaches anyway.
          var enterFocus = clamp((vh - rect.top) / Math.max(vh - TOP_SPACING_PX, 100), 0, 1);
          var afterVisible = vh - rect.bottom; // px of caption/gap already scrolled into view
          var exitFocus = clamp(1 - afterVisible / EXIT_RELEASE_PX, 0, 1);
          focus = smoothstep(Math.min(enterFocus, exitFocus));
          yTarget = 0; // no centering nudge — it isn't being pulled toward a center point
        } else {
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
