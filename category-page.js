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

  // Everything below assumed it ran exactly once, against markup that
  // then stayed put. page-transition.js breaks that assumption: it
  // swaps one category's markup for the next without a page load, and
  // has to re-run this afterwards against the new DOM. So every
  // listener, observer and animation loop registers how to undo itself,
  // and initCategoryPage() tears the previous run down before starting
  // a new one — otherwise each transition would leave another rAF loop
  // and another set of resize handlers running over dead nodes.
  var cleanups = [];

  function onCleanup(fn) {
    cleanups.push(fn);
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    onCleanup(function () {
      target.removeEventListener(type, handler, options);
    });
  }

  function runCleanups() {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch (e) { /* a dead node is not worth failing over */ }
    }
  }

  // Bumped on every teardown; the focus loop checks it each frame and
  // simply stops rather than animating a gallery that no longer exists.
  var loopToken = 0;

  // The one media unit inside a project that the focus effect drives.
  // Gallery pages wrap it in .gallery-media (which is what the floating
  // controls measure from, and what carries a tall piece's second snap
  // stop); the placeholder pages still have it as a direct child.
  var MEDIA_SELECTOR =
    ":scope > img, :scope > .gallery-video, :scope > .gallery-frame-wrap, " +
    ":scope > .gallery-media > img, :scope > .gallery-media > .gallery-video, " +
    ":scope > .gallery-media > .gallery-frame-wrap";

  // Where this run should settle.
  var pendingLanding = "top";

  // Scrolling *up* out of the top of a category walks back into the
  // previous one, and what the reader was shown during that gesture was
  // that page's end. This is how that lands here: read once,
  // synchronously, because transition.js strips the flag off the URL as
  // soon as the page has settled.
  var arrivalLanding =
    /(^|#)pt-in=bottom(&|$)/.test(location.hash) ? "bottom" : null;

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

  // Gallery pages carry both interactions in their markup and swap
  // between them by viewport (the CSS at the end of category-page.css
  // is what shows one and hides the other):
  //
  // - Wide enough, and a single floating "+"/"×" button follows whichever
  //   project is in focus, sliding that project's image left to reveal a
  //   text panel in the space beside it.
  // - Narrower than that there's no room beside the artwork for a panel,
  //   so each project falls back to its own pill underneath, opening the
  //   description inline.
  //
  // This has to be a live query rather than a value read once: a window
  // resized across the breakpoint has to switch behaviour with the CSS,
  // not stay on whichever mode happened to be right at load.
  var REVEAL_PAGE = document.body.classList.contains("project-reveal");
  var revealQuery = window.matchMedia("(min-width: 701px)");
  function revealActive() {
    return REVEAL_PAGE && revealQuery.matches;
  }

  // matchMedia's listener API was renamed; older Safari only has the
  // deprecated form.
  function onRevealBreakpointChange(handler) {
    if (revealQuery.addEventListener) {
      revealQuery.addEventListener("change", handler);
      onCleanup(function () { revealQuery.removeEventListener("change", handler); });
    } else if (revealQuery.addListener) {
      revealQuery.addListener(handler);
      onCleanup(function () { revealQuery.removeListener(handler); });
    }
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
    onCleanup(function () { observer.disconnect(); });
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
   * Swipe sideways to go back, for the layouts that hide the back button
   * itself (see the mobile rules at the end of category-page.css).
   *
   * Rather than repeating that media query here, this reads the button's
   * own computed style at the start of each gesture: the swipe is armed
   * precisely when the button is hidden, so the two can't fall out of
   * step, and a window resized across the breakpoint needs no handling
   * of its own. It also means the gesture never competes with a back
   * button the reader can already see.
   *
   * Rightward, matching the platform-standard back gesture, and only
   * when the movement is clearly more horizontal than vertical — this
   * page's whole interaction is vertical scrolling, so a drifting scroll
   * must never navigate away.
   */
  function wireSwipeBack() {
    var link = document.querySelector(".back-button");
    if (!link || !link.getAttribute("href")) return;

    var MIN_DISTANCE_PX = 70; // far enough that a tap or a nudge can't trigger it
    var MAX_OFF_AXIS_RATIO = 0.6;
    var startX = 0;
    var startY = 0;
    var tracking = false;

    listen(document, "touchstart", function (e) {
      // Single finger only — a pinch or two-finger gesture isn't a swipe.
      tracking = e.touches.length === 1 &&
        window.getComputedStyle(link).display === "none";
      if (!tracking) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    listen(document, "touchcancel", function () {
      tracking = false;
    }, { passive: true });

    listen(document, "touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      var touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;

      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (dx < MIN_DISTANCE_PX) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS_RATIO) return;

      // Same fade every other link on the site uses (see transition.js),
      // so arriving home looks identical however you got there.
      if (window.navigateWithFade) window.navigateWithFade(link.href);
      else window.location.href = link.href;
    }, { passive: true });
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
      // Gallery pages wrap their media in .gallery-media (it's what the
      // floating controls measure their horizontal anchor from, and what
      // carries a tall piece's second snap stop); the placeholder pages
      // still have it as .gallery-item's own direct child.
      var media = item.querySelector(MEDIA_SELECTOR);
      if (!media) return null;
      return {
        item: item,
        media: media,
        // data-title rather than the media's own alt text: a Web Design
        // item's media is a frame wrapper holding several screenshots,
        // and a video has no alt at all, so neither reliably carries the
        // project's name.
        label: item.getAttribute("data-title") ||
          media.getAttribute("alt") || media.getAttribute("aria-label") || "",
        description: item.getAttribute("data-description") || "",
        cur: {
          scale: 1, y: 0, slideX: 0, opacity: 1, brightness: 1, contrast: 1,
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
    var backButton = document.querySelector(".back-button");

    // Where the top edge of a tall piece (and of the first item on every
    // page) comes to rest: level with the bottom of the back button.
    // Read off the button itself rather than hard-coded, so the two
    // can't drift apart if its padding, border or glyph size ever
    // changes — including when the web font swaps in and changes its
    // height, which is why this is re-read rather than measured once.
    // .back-button is position:fixed, so its rect is viewport-relative
    // and unaffected by scroll position.
    function computeTopSpacing() {
      if (backButton) {
        var rect = backButton.getBoundingClientRect();
        if (rect.height) return Math.round(rect.bottom);
      }
      return Math.max(bannerHeight + 24, 6 * rootFontSize);
    }
    var TOP_SPACING_PX = computeTopSpacing();
    // How much taller than the viewport a piece needs to be before it's
    // worth splitting into two stops rather than sharing one screen
    // with its own caption — a little slack above 1.0 so items that
    // only barely exceed the viewport (and would fit fine with a
    // little focus falloff) aren't needlessly split.
    var TALL_RATIO = 1.15;
    // Must stay in step with the scroll-margin-bottom on
    // .gallery-item--tall's stage-two stop in category-page.css — the
    // visible gap left under a tall piece when it rests at its lower
    // stage, and the bottom padding the last project needs for that
    // stop to exist within the page at all.
    var STAGE_TWO_GAP_PX = 6 * rootFontSize;

    function applySnapAlignment() {
      var vh = window.innerHeight;
      TOP_SPACING_PX = computeTopSpacing();
      entries.forEach(function (entry, index) {
        var isFirst = index === 0;
        // offsetHeight, not getBoundingClientRect: the focus effect
        // scales the media by up to ~3.5%, which a rect measurement
        // includes and layout does not. Snapping works off the layout
        // box, so measuring the visual one both misjudges borderline
        // items and quietly disagrees with where the browser will
        // actually stop.
        var isTall = entry.media.offsetHeight > vh * TALL_RATIO;
        entry.item.classList.toggle("gallery-item--tall", isTall);
        // Recorded for the focus effect, which has to measure each item
        // against the position it actually comes to rest at — see
        // focusAnchor in tick().
        entry.startAligned = isFirst || isTall;

        if (isFirst || isTall) {
          // Both stop with their top edge a fixed distance below the
          // banner — the same distance, every time. Tall pieces used to
          // get scrollMarginTop 0 here, which parked each one hard
          // against the banner and, because their heights differ, at a
          // visibly different offset from one to the next. Sharing the
          // first item's spacing is what makes every tall piece open
          // identically.
          entry.item.style.scrollSnapAlign = "start";
          entry.item.style.scrollMarginTop = TOP_SPACING_PX + "px";
        } else {
          // Short pieces have room to sit whole on screen, so they come
          // to rest centred — but centred in the space actually
          // available to look at, not in the raw viewport. The banner is
          // fixed and paints over the top of the scrollport, so a
          // geometrically perfect centre still leaves visibly less room
          // above the artwork than below it. Padding the snap area's top
          // edge by the banner's own height shifts the resting position
          // down by exactly half of it, which is what evens the two gaps
          // out. Pages without a banner get 0 here and are unaffected.
          entry.item.style.scrollSnapAlign = "center";
          entry.item.style.scrollMarginTop = bannerHeight + "px";
        }
      });
    }
    applySnapAlignment();
    listen(window, "resize", applySnapAlignment);

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

    // The top edge is the same page-independent constant every tall
    // piece snaps to (TOP_SPACING_PX — the back button's own bottom
    // edge, see computeTopSpacing), so every project page's first image
    // starts at exactly the same distance below the banner regardless of
    // that item's own height.
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
      TOP_SPACING_PX = computeTopSpacing();
      var lastItem = entries[entries.length - 1].item;
      // Layout height, not the transform-scaled visual one — see the
      // same note in applySnapAlignment.
      var lastHeight = lastItem.offsetHeight;
      var isTall = lastItem.classList.contains("gallery-item--tall");

      // Room the last project needs below itself purely to be able to
      // *reach* its own resting position — without it the page runs out
      // of scroll first and the item settles short of its snap point.
      // Which position that is depends on how it aligns (see
      // applySnapAlignment): tall pieces stop with their top below the
      // banner, short ones stop centred.
      // For a tall last project that also has to be at least the
      // stage-two gap (the scroll-margin-bottom on .gallery-item--tall's
      // second stop in category-page.css): that stop sits that far past
      // the artwork's own bottom edge, so without the matching padding
      // here it falls outside the page's maximum scroll and simply
      // can't be reached.
      var reachNeeded = isTall
        ? Math.max(STAGE_TWO_GAP_PX, vh - TOP_SPACING_PX - lastHeight)
        : Math.max(0, (vh - lastHeight) / 2);

      // …and on top of that, a deliberate margin so the final project
      // has room to breathe rather than ending flush with the page.
      var breathingRoom = Math.max(7 * rootFontSize, Math.round(vh * 0.16));

      grid.style.marginTop = TOP_SPACING_PX + "px";
      grid.style.paddingBottom = Math.round(reachNeeded + breathingRoom) + "px";
    }
    applyEdgeSpacing();
    listen(window, "resize", applyEdgeSpacing);

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
    // Where this run should come to rest. Normally the top; a scroll-up
    // transition into the previous category lands at its bottom instead,
    // which is where the reader physically left off (see
    // page-transition.js).
    window.scrollTo({
      top: pendingLanding === "bottom"
        ? document.documentElement.scrollHeight - window.innerHeight
        : 0,
      left: 0,
      behavior: "instant"
    });

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
    //
    // Skipped when a landing position was chosen for us — arriving at a
    // page's end from the one below it. The quirk this corrects belongs
    // to parsing a fresh document at the top; anywhere else the watcher
    // would just fight the deliberate position the transition set, since
    // "not at zero" is precisely what it treats as the fault.
    if (pendingLanding !== "bottom") {
      var userInteracted = false;
      ["pointerdown", "wheel", "touchstart", "keydown"].forEach(function (type) {
        listen(window, type, function () { userInteracted = true; }, { once: true, passive: true });
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
    }

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

    // How quickly the applied values chase their target, expressed as
    // the fraction closed per frame *at 60fps*. The actual per-frame
    // amount is re-derived from real elapsed time below (see easeAmount)
    // so a 120Hz display doesn't converge twice as fast as a 60Hz one —
    // which is exactly the kind of thing that makes the same motion feel
    // snappy on one machine and sluggish on another. Eased down from
    // 0.19: a longer tail is what reads as gliding rather than tracking.
    var EASE = 0.12;

    var lastFrameAt = performance.now();
    var easeStep = EASE;
    var slideEaseStep;

    // Converts a per-frame-at-60fps easing figure into the equivalent
    // fraction for however long this frame actually took.
    function easeAmount(perFrameAt60, dtSeconds) {
      return 1 - Math.pow(1 - perFrameAt60, dtSeconds * 60);
    }
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

    // The shape of the focus effect, in one place: tick() eases toward
    // these values frame by frame.
    function focusTargetsFor(top, height, vh, isTall, startAligned) {
      if (isTall) {
        // Two-stop pieces: focus ramps up as the artwork's own top edge
        // scrolls up through the viewport — reaching full focus once
        // it's fully entered — holds there for as long as any part of
        // it still fills the screen, and only ramps back down once
        // stage two has had a chance to actually be seen. No centering
        // nudge: it was never pulled toward a centre point.
        var enterFocus = clamp((vh - top) / vh, 0, 1);
        var afterVisible = vh - (top + height);
        var exitFocus = clamp(1 - afterVisible / EXIT_RELEASE_PX, 0, 1);
        return { focus: smoothstep(Math.min(enterFocus, exitFocus)), y: 0 };
      }
      // Focus falls off with distance from where this project actually
      // comes to rest — not the same point for every item, so it has to
      // match applySnapAlignment rather than assume the viewport centre.
      // A centred item rests half a banner below centre; the first item
      // on a page doesn't centre at all, it parks at the top margin.
      var centre = top + height / 2;
      var anchor = startAligned
        ? TOP_SPACING_PX + height / 2
        : vh / 2 + bannerHeight / 2;
      var span = (vh / 2 + height / 2) * FOCUS_SPAN_FACTOR;
      var dist = span > 0 ? clamp((centre - anchor) / span, -1, 1) : 0;
      return { focus: smoothstep(clamp(1 - Math.abs(dist), 0, 1)), y: dist * -18 };
    }

    // What a given focus value looks like. Kept beside the formula so
    // the two can't drift apart.
    function focusStyleFor(focus, y) {
      return {
        scale: lerp(0.975, 1.035, focus),
        y: y,
        opacity: lerp(0.78, 1, focus),
        brightness: lerp(0.96, 1.02, focus),
        contrast: lerp(0.97, 1.03, focus),
        blur: lerp(1.6, 0, focus),
        shadowBlur: lerp(14, 30, focus),
        shadowAlpha: lerp(0.07, 0.17, focus)
      };
    }

    function writeFocus(media, v, slideX) {
      var s = media.style;
      s.setProperty("--gf-scale", v.scale.toFixed(4));
      s.setProperty("--gf-y", v.y.toFixed(2) + "px");
      s.setProperty("--gf-slide-x", (slideX || 0).toFixed(2) + "px");
      s.setProperty("--gf-opacity", v.opacity.toFixed(3));
      s.setProperty("--gf-brightness", v.brightness.toFixed(3));
      s.setProperty("--gf-contrast", v.contrast.toFixed(3));
      s.setProperty("--gf-blur", v.blur.toFixed(2) + "px");
      s.setProperty("--gf-shadow-blur", v.shadowBlur.toFixed(1) + "px");
      s.setProperty("--gf-shadow-alpha", v.shadowAlpha.toFixed(3));
    }

    // How far an open project's image slides left in reveal mode (see
    // revealActive) to make room for its text panel.
    var SLIDE_PX = 120;
    // A slower, distinct ease from EASE above — the slide is meant to
    // read as a deliberate, gliding motion rather than the snappier
    // catch-up used for the scroll-driven scale/blur/shadow.
    var SLIDE_EASE = 0.085;
    // How long to wait after focus moves to a new project before
    // swapping content and fading the new button in. Must be at least
    // the button's own fade-out duration (0.34s — see the transition on
    // .gallery-caption--floating in category-page.css); anything
    // shorter starts the arrival while the exit is still mid-flight,
    // which is what made the swap read as a jump rather than a
    // hand-off.
    var REVEAL_SWAP_MS = 360;

    // The single floating "+"/"×" button and text panel (see
    // revealActive): rather than living inside each project like the
    // per-item pill, both are single shared elements repositioned to sit
    // right at the current project's own right edge (see
    // updateFloatingHorizontal) and swapped — with a brief fade out/in,
    // so each project visibly reads as having its own button and panel —
    // as focus moves between projects. Opening one always starts
    // fresh/closed for whichever project is now active; open/closed
    // itself is otherwise untouched by scrolling — only clicking the
    // button changes it, matching "closes only by clicking."
    var floatingBtn = REVEAL_PAGE ? document.querySelector(".gallery-caption--floating") : null;
    var floatingPanel = REVEAL_PAGE ? document.querySelector(".gallery-textpanel--floating") : null;
    var floatingPanelTitle = floatingPanel ? floatingPanel.querySelector(".gallery-textpanel-title") : null;
    var floatingPanelText = floatingPanel ? floatingPanel.querySelector(".gallery-subtitle") : null;
    var activeEntry = null;
    var panelOpen = false;
    var revealToken = 0;

    // While closed, the button rests just outside the artwork's own right
    // edge — clearly its own control rather than something laid over the
    // work, and tied to the image so it doesn't drift off into empty page
    // margin on a wide screen.
    //
    // Open, the panel takes its position from the window instead. Anchored
    // to the image it stayed tucked in against the artwork, covering a
    // good part of it and reading as sitting *over* the work rather than
    // beside it; on a wide screen that also left a stretch of unused page
    // to its right. Clamped so it can never cross back over the image's
    // own edge once the window is too narrow to give it that room.
    var BUTTON_OUTSIDE_GAP = 84;
    var PANEL_VIEWPORT_MARGIN = 56;
    var BUTTON_DOCK_MARGIN = 14;

    function updateFloatingHorizontal() {
      if (!floatingBtn && !floatingPanel) return;
      var media = document.querySelector(".gallery-media");
      if (!media) return;
      var edgeGap = window.innerWidth - media.getBoundingClientRect().right;
      var dockedInset = Math.min(edgeGap, PANEL_VIEWPORT_MARGIN);
      if (floatingPanel) floatingPanel.style.right = dockedInset + "px";
      if (floatingBtn) {
        var btnWidth = floatingBtn.getBoundingClientRect().width || 40;
        // Floor at a small viewport margin, not 0: on narrow screens the
        // page margin is thinner than BUTTON_OUTSIDE_GAP, and without
        // this the button would end up flush against the screen edge.
        var outsideInset = Math.max(12, edgeGap - BUTTON_OUTSIDE_GAP - btnWidth);
        // Docked, it nests inside the panel's own edge with a margin of
        // its own rather than flush against it, so it reads as framed by
        // the card instead of hung off its corner.
        var dockedBtnInset = dockedInset + BUTTON_DOCK_MARGIN;
        floatingBtn.style.right = (panelOpen ? dockedBtnInset : outsideInset) + "px";
      }
    }
    if (REVEAL_PAGE) {
      updateFloatingHorizontal();
      listen(window, "resize", updateFloatingHorizontal);
    }

    // Vertically the control belongs to whichever project is active, so
    // it lines up with that project's own middle — and therefore with a
    // Web Design carousel's arrows, which sit at that same middle.
    //
    // A fixed point on screen isn't good enough: it happens to coincide
    // for a project that rests centred, but the first project on every
    // page rests aligned to the top instead (see applySnapAlignment),
    // which left the button sitting well below its own arrows.
    var FLOATING_EDGE_MARGIN = 90;

    function updateFloatingVertical(rect) {
      if (!rect || (!floatingBtn && !floatingPanel)) return;
      var vh = window.innerHeight;
      var room = vh - bannerHeight;
      var centre = rect.height > room
        // Taller than the space it has, so its real middle is off screen;
        // the middle of what can actually be seen is the honest answer.
        ? bannerHeight + room / 2
        : rect.top + rect.height / 2;

      // Keep it clear of both edges, and — while the card is open — far
      // enough in that the card itself still fits.
      var margin = FLOATING_EDGE_MARGIN;
      if (panelOpen && floatingPanel) {
        margin = Math.max(margin, floatingPanel.getBoundingClientRect().height / 2 + 16);
      }
      centre = clamp(centre, bannerHeight + margin, vh - margin);

      if (floatingBtn) floatingBtn.style.top = centre.toFixed(1) + "px";
      if (floatingPanel) floatingPanel.style.top = centre.toFixed(1) + "px";
    }

    function updateFloatingLabel() {
      if (!floatingBtn) return;
      var label = activeEntry && activeEntry.label ? activeEntry.label : "";
      floatingBtn.setAttribute(
        "aria-label",
        label ? label + (panelOpen ? " — fechar" : " — ver projeto") : "Ver projeto"
      );
    }

    function setActiveEntry(nextEntry) {
      if (nextEntry === activeEntry) return;
      var hadPrevious = !!activeEntry;
      revealToken++;
      var myToken = revealToken;

      // Fade the current project's button/panel out (and reset open —
      // each project starts fresh) immediately; the *next* one only
      // fades in once that's had time to finish, so the two never
      // cross-fade into a confusing double-visible state.
      if (floatingBtn) floatingBtn.classList.remove("is-visible", "is-open");
      if (floatingPanel) floatingPanel.classList.remove("is-open");
      panelOpen = false;
      activeEntry = nextEntry;

      window.setTimeout(function () {
        if (myToken !== revealToken) return; // superseded by a later scroll
        if (activeEntry) {
          if (floatingPanelTitle) floatingPanelTitle.textContent = activeEntry.label || "";
          if (floatingPanelText) floatingPanelText.textContent = activeEntry.description || "";
          updateFloatingHorizontal();
        }
        if (floatingBtn) floatingBtn.classList.toggle("is-visible", !!activeEntry);
        updateFloatingLabel();
      }, hadPrevious ? REVEAL_SWAP_MS : 0);
    }

    if (floatingBtn) {
      floatingBtn.addEventListener("click", function () {
        if (!activeEntry) return;
        panelOpen = !panelOpen;
        floatingBtn.classList.toggle("is-open", panelOpen);
        if (floatingPanel) floatingPanel.classList.toggle("is-open", panelOpen);
        updateFloatingLabel();
        updateFloatingHorizontal(); // glide the button between its outside rest spot and the panel's edge
      });

      // Crossing the breakpoint hides the panel by CSS but wouldn't
      // otherwise clear the flag behind it — leaving the active
      // project's image stuck in its slid-left position with nothing on
      // screen to explain why, and the button reappearing already "open"
      // if the window came back.
      onRevealBreakpointChange(function () {
        if (!panelOpen) return;
        panelOpen = false;
        floatingBtn.classList.remove("is-open");
        if (floatingPanel) floatingPanel.classList.remove("is-open");
        updateFloatingLabel();
        updateFloatingHorizontal();
      });
    }

    // Claim the loop: any frame still queued from a previous run of
    // this function (i.e. from the markup that has since been swapped
    // out) sees a stale token on its next tick and stops there.
    var myLoopToken = ++loopToken;
    onCleanup(function () { loopToken++; });

    function tick() {
      if (myLoopToken !== loopToken) return;
      var frameNow = performance.now();
      // Clamped so a backgrounded tab returning after seconds away
      // doesn't resolve everything in a single jarring frame.
      var dt = Math.min((frameNow - lastFrameAt) / 1000, 0.05);
      lastFrameAt = frameNow;
      easeStep = easeAmount(EASE, dt);
      slideEaseStep = easeAmount(SLIDE_EASE, dt);

      if (galleryPaused) {
        requestAnimationFrame(tick);
        return;
      }

      var vh = window.innerHeight;
      var vCenter = vh / 2;
      var bestEntry = null;
      var bestRect = null;
      var bestFocus = -1;

      entries.forEach(function (entry) {
        var rect = entry.media.getBoundingClientRect();
        // The class applySnapAlignment already set, rather than
        // re-deriving it here from a rect that includes this very
        // effect's own scale transform — measured that way an item
        // sitting right on the threshold could be classed differently
        // by the two, and then animate to a rest position it was never
        // snapped to.
        var isTall = entry.item.classList.contains("gallery-item--tall");
        var targets = focusTargetsFor(rect.top, rect.height, vh, isTall, entry.startAligned);
        var focus = targets.focus;
        var yTarget = targets.y;

        if (focus > bestFocus) {
          bestFocus = focus;
          bestEntry = entry;
          bestRect = rect;
        }

        // Reveal-mode's slide-left-on-open, folded into the same
        // per-frame lerp as everything else here so it never fights the
        // JS-driven scale/blur transform for control of `transform`
        // (see --gf-slide-x in category-page.css). Only the currently
        // active project slides — as focus moves on, this eases back to
        // 0 on its own, and whichever project becomes active next picks
        // up the slide if the panel is still open.
        var slideTarget = (revealActive() && panelOpen && entry === activeEntry) ? -SLIDE_PX : 0;

        // Softer extremes than before (scale 0.96→1.06, opacity 0.6→1,
        // blur 2.5px): those ranges made an out-of-focus project read as
        // dimmed-out rather than simply further away, and the swing
        // between the two was doing most of the work of making scrolling
        // feel busy. Pulling them in leaves the same depth cue with far
        // less visual noise.
        var want = focusStyleFor(focus, yTarget);
        var cur = entry.cur;
        cur.scale = lerp(cur.scale, want.scale, easeStep);
        cur.y = lerp(cur.y, want.y, easeStep);
        cur.slideX = lerp(cur.slideX, slideTarget, slideEaseStep);
        cur.opacity = lerp(cur.opacity, want.opacity, easeStep);
        cur.brightness = lerp(cur.brightness, want.brightness, easeStep);
        cur.contrast = lerp(cur.contrast, want.contrast, easeStep);
        cur.blur = lerp(cur.blur, want.blur, easeStep);
        cur.shadowBlur = lerp(cur.shadowBlur, want.shadowBlur, easeStep);
        cur.shadowAlpha = lerp(cur.shadowAlpha, want.shadowAlpha, easeStep);

        writeFocus(entry.media, cur, cur.slideX);
      });

      // A momentarily-null bestEntry (e.g. a frame caught mid-reflow,
      // before any rect has a sane height yet) must never itself count
      // as "focus moved elsewhere" — that would silently close whatever
      // was open. Only a real, positively-focused entry can take over.
      if (floatingBtn && bestEntry) {
        setActiveEntry(bestEntry);
        // Tracked every frame rather than set once: the arrows move
        // with the artwork as it scrolls, so the button has to as well
        // to stay level with them.
        updateFloatingVertical(bestRect);
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function initCategoryPage() {
    // Undo whatever a previous run left behind. On an ordinary page load
    // there is nothing to undo — this is what makes the whole setup safe
    // to run more than once, rather than something that assumes it owns
    // a fresh document.
    runCleanups();

    pendingLanding = arrivalLanding === "bottom" ? "bottom" : "top";
    arrivalLanding = null;

    REVEAL_PAGE = document.body.classList.contains("project-reveal");

    wireToggle(document.querySelector(".cta-button"), document.querySelector(".cta-wrap"));

    // Both interactions get wired unconditionally — whichever one the
    // current viewport isn't using is display:none and so can't be
    // clicked or focused anyway (the floating button is wired inside
    // wireScrollFocus, where the per-frame focus tracking it depends on
    // already lives). That's simpler and more robust than trying to
    // tear down and re-wire handlers every time the window crosses the
    // breakpoint.
    document.querySelectorAll(".gallery-item").forEach(function (item) {
      wireToggle(item.querySelector(".gallery-caption"), item);
    });

    // A project left open in one mode would otherwise still be open,
    // and the gallery still paused, after switching to the other.
    onRevealBreakpointChange(function () {
      document.querySelectorAll(".is-open").forEach(function (el) {
        el.classList.remove("is-open");
      });
      document.documentElement.classList.remove(READING_CLASS);
      galleryScrollControl.resume();
    });

    wireVideoAutoplay();
    wireGalleryFrames();
    wireSwipeBack();
    wireScrollFocus();
  }

  document.addEventListener("DOMContentLoaded", initCategoryPage);

  // page-transition.js quiets the focus loop while a transition is in
  // flight, so the gallery isn't tracking a scroll position the reader
  // has already left behind.
  window.galleryScrollControl = galleryScrollControl;
})();
