/**
 * Scroll-linked navigation between category pages.
 *
 * The site reads as one continuous surface: Branding, Social and Web
 * Design are stacked vertically, with Home closing the loop at either
 * end. Over-scrolling past the last project drags the next category up
 * from underneath; over-scrolling above the first drags the previous one
 * down from above. The reveal is tied to the gesture rather than fired
 * off as an animation, so it can be pushed, held, and pulled back.
 *
 * This is *added alongside* the existing navigation, not in place of it.
 * The back button ("×") keeps its own markup, position, styling and
 * click handling untouched — it simply rides inside the page shell this
 * file wraps around the content, which carries no transform at rest.
 *
 * What rises is the destination's banner over its own background, and
 * the hand-off at the end is an ordinary navigation. An earlier version
 * tried to be cleverer than that — fetching the next page, warming its
 * images, and swapping the live nodes in so nothing reloaded, with
 * iframes stood up as a fallback for file:// where fetch is blocked.
 * It worked, and it was not worth it: three routes through the same
 * movement, each with its own failure, for a difference the reader
 * never sees. One route, taken every time, is steadier than three.
 *
 * The one thing carried across the navigation is a flag on the URL —
 * see arrivalFlag — telling the destination not to fade in over
 * something already on screen, and, coming back up the chain, to open
 * at its end rather than its beginning.
 */
(function () {
  "use strict";

  var CHAIN = {
    "branding.html":  { prev: "home.html",      next: "social.html" },
    "social.html":    { prev: "branding.html",  next: "webdesign.html" },
    "webdesign.html": { prev: "social.html",    next: "home.html" }
  };

  // Each category's own banner, so the strip that rises can be built
  // without having loaded the page it belongs to. Kept in step with the
  // inline style on each page's .scroll-banner-track.
  var BANNERS = {
    "branding.html":  { src: "assets/branding/banner/banner-branding.svg",   tile: 442.117 },
    "social.html":    { src: "assets/social/banner/social.svg",              tile: 547.07 },
    "webdesign.html": { src: "assets/webdesign/banner/webdesign-banner.svg", tile: 616.11 }
  };

  // The reveal happens in two acts rather than one long drag.
  //
  // First, over-scrolling past the last project lifts the next
  // category's banner up from below until it sits docked against the
  // bottom edge — a stable place to stop, with that page announced but
  // not yet entered. Two banners on screen, one at each edge.
  //
  // Then a second gesture pulls the page itself up: the docked banner
  // travels to the top, where a category banner belongs, and the page
  // follows it into view.
  //
  // Both acts are the same underlying quantity — how much of the next
  // page is showing — so the docked state is simply a detent partway
  // along it, rather than a separate mechanism.
  //
  // The distances are what the gesture is mapped onto; the thresholds
  // are how much of one counts as meaning it. Both are set so a single
  // ordinary scroll — one notch of a wheel, one flick of a trackpad —
  // carries a whole act. Asking for more turns a deliberate movement
  // into something the reader has to repeat, which reads as the page
  // ignoring them.
  var DOCK_DISTANCE = 140;  // over-scroll to raise the banner into place
  var PULL_DISTANCE = 560;  // further gesture to pull the page up
  var DOCK_AT = 0.45;       // release past this while lifting and it docks
  var COMMIT_AT = 0.16;     // release past this while pulling and it completes
  // Wheel has no "finger lifted" event, so a lull stands in for one.
  var WHEEL_IDLE_MS = 140;
  var SETTLE_MS = 760;
  // px/ms of sustained push that completes regardless of distance.
  var FLICK_VELOCITY = 1.1;
  var VELOCITY_WINDOW_MS = 110;

  function pageKey(pathname) {
    var last = pathname.split("/").pop();
    return last || "home.html";
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // For the settle only — never for the drag. A curve like this on
  // gesture-linked motion inverts the whole feel: it is steepest at the
  // start, so the first flick of the wheel throws half the next page up
  // and the rest of the gesture has almost nothing left to do. What the
  // hand is driving has to move with the hand, one to one; easing
  // belongs to the part the machine plays once the hand lets go.
  function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  var current = pageKey(location.pathname);
  var neighbours = CHAIN[current];
  if (!neighbours) return; // other.html and home.html sit outside the chain

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return; // leave ordinary link navigation to it
  }

  // ---------------------------------------------------------------- shell

  // Everything the current page draws goes inside one wrapper so the
  // whole thing — banner, back button, gallery — can be moved as a
  // single object. A plain div with no styles is layout-neutral, and
  // crucially carries no transform unless a transition is actually
  // running: a transformed ancestor would otherwise become the
  // containing block for the page's position:fixed children, quietly
  // changing where the banner and the back button sit.
  var shell = document.createElement("div");
  shell.className = "pt-shell";
  var body = document.body;
  var node = body.firstChild;
  while (node) {
    var nextNode = node.nextSibling;
    if (node.nodeType === 1 && node.tagName === "SCRIPT") {
      // scripts stay put; moving them would re-run nothing but confuse things
    } else {
      shell.appendChild(node);
    }
    node = nextNode;
  }
  body.insertBefore(shell, body.firstChild);

  // Sits between the outgoing page and the incoming one, and is the only
  // thing that darkens the page being left behind.
  var scrim = document.createElement("div");
  scrim.className = "pt-scrim";
  scrim.setAttribute("aria-hidden", "true");
  body.appendChild(scrim);

  var layer = document.createElement("div");
  layer.className = "pt-layer";
  var layerInner = document.createElement("div");
  layerInner.className = "pt-layer-inner";
  layer.appendChild(layerInner);
  body.appendChild(layer);

  // The strip is the whole picture during the gesture, so it shouldn't
  // be arriving while the reader is watching it. Decoding both
  // neighbours' banners once the page is quiet costs two small SVGs.
  function warmBanners() {
    [neighbours.prev, neighbours.next].forEach(function (href) {
      var meta = BANNERS[href];
      if (!meta) return;
      var warm = new Image();
      warm.src = meta.src;
    });
  }
  if ("requestIdleCallback" in window) window.requestIdleCallback(warmBanners, { timeout: 3000 });
  else window.setTimeout(warmBanners, 1500);

  // --------------------------------------------------------------- state

  var direction = null;   // "next" | "prev"
  var target = null;      // href being revealed
  var travel = 0;         // px of gesture accumulated within the current act
  var reveal = 0;         // 0 = hidden, 1 = the next page fills the viewport
  var docked = false;     // the banner has taken its place at the bottom edge
  var bannerHeight = 64;  // measured from the incoming page's own banner
  var busy = false;       // a settle animation owns the layer
  var armed = false;      // layer is populated and visible
  var wheelIdleTimer = null;
  var recent = [];        // recent gesture deltas, for the flick test
  // Set when a gesture has already carried an act through to its end.
  // A trackpad flick is one movement of the hand but hundreds of events,
  // and it keeps arriving long after the banner has docked; without this
  // the tail of a single swipe would run straight on into pulling the
  // page up. One push, one step — the rest of that push is absorbed.
  var gestureSpent = false;

  // How much of the viewport the docked banner occupies — the detent
  // partway along the reveal. Going backwards there is no banner to
  // announce (the reader is returning to a page's end, not its start),
  // so that direction has no detent and pulls straight through.
  function dockFraction() {
    if (direction === "prev") return 0;
    return bannerHeight / window.innerHeight;
  }

  function actProgress() {
    return docked
      ? clamp(travel / PULL_DISTANCE, 0, 1)
      : clamp(travel / DOCK_DISTANCE, 0, 1);
  }

  function computeReveal() {
    var d = dockFraction();
    return docked ? d + (1 - d) * actProgress() : d * actProgress();
  }

  function recordDelta(d) {
    var now = performance.now();
    recent.push({ t: now, d: d });
    // Only the tail of the gesture says anything about intent; anything
    // older is where the reader had already changed their mind.
    while (recent.length && now - recent[0].t > VELOCITY_WINDOW_MS) recent.shift();
  }

  function targetHref() {
    return direction === "next" ? neighbours.next : neighbours.prev;
  }

  // Mandatory scroll-snap means the true end of the document is never a
  // resting position: the last snap point sits a footer margin short of
  // it, so "scrollY === maxScroll" is a test that can never pass. What
  // actually marks the edge is the page having come to rest with nothing
  // further to snap to — so rest is tracked directly, and the distance
  // check only has to be loose enough to cover that final gap. Being at
  // rest is what makes a loose threshold safe: mid-scroll the page is
  // moving, so it can't be mistaken for the end.
  var STILL_FRAMES_FOR_REST = 4;
  var BOTTOM_SLACK = 340;
  var TOP_SLACK = 60;

  var lastScrollY = window.scrollY;
  var stillFrames = 0;

  (function watchRest() {
    var y = window.scrollY;
    if (Math.abs(y - lastScrollY) < 0.5) stillFrames++;
    else { stillFrames = 0; lastScrollY = y; }
    requestAnimationFrame(watchRest);
  })();

  function atRest() {
    return stillFrames >= STILL_FRAMES_FOR_REST;
  }

  function atBottom() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return atRest() && window.scrollY >= max - BOTTOM_SLACK;
  }

  function atTop() {
    return atRest() && window.scrollY <= TOP_SLACK;
  }

  // ---------------------------------------------------------- layer setup

  // What rises is the destination announced by its own banner, over its
  // own background — not the page itself. It is a stand-in, and it is
  // meant to be: the movement is about leaving one category for another,
  // and the banner is what says which.
  function categoryPreview(href) {
    var wrap = document.createElement("div");
    wrap.className = "pt-page-preview";

    var banner = document.createElement("div");
    banner.className = "scroll-banner";
    var track = document.createElement("div");
    track.className = "scroll-banner-track";
    var meta = BANNERS[href];
    if (meta) {
      track.style.backgroundImage = "url('" + meta.src + "')";
      track.style.setProperty("--tile-vb-w", String(meta.tile));
    }
    banner.appendChild(track);
    wrap.appendChild(banner);
    return wrap;
  }

  // Home closes the loop, and there is no category left to announce —
  // so its strip says the thing the whole gallery has been building
  // towards instead, and carries the address to answer it.
  function homePreview() {
    var wrap = document.createElement("div");
    wrap.className = "pt-home-preview";

    var strip = document.createElement("div");
    strip.className = "pt-home-banner";

    var label = document.createElement("p");
    label.className = "pt-home-label";
    label.appendChild(document.createTextNode("Enjoying so far? :-) "));

    var link = document.createElement("a");
    link.className = "pt-home-link";
    link.href = "mailto:btavora96@gmail.com";
    link.textContent = "Get in touch";
    label.appendChild(link);

    label.appendChild(document.createTextNode(" and let’s work!"));

    strip.appendChild(label);
    wrap.appendChild(strip);
    return wrap;
  }

  function beginTransition() {
    target = targetHref();
    if (!target) return false;

    var isHome = target === "home.html";

    layerInner.innerHTML = "";
    layerInner.appendChild(isHome ? homePreview() : categoryPreview(target));
    layer.classList.toggle("is-home", isHome);
    // Hidden from assistive technology while it is only scenery, but not
    // when it is carrying a real address the reader is invited to use.
    layer.setAttribute("aria-hidden", isHome ? "false" : "true");

    layer.classList.add("is-active");
    layer.classList.toggle("from-below", direction === "next");
    layer.classList.toggle("from-above", direction === "prev");

    // Read the real strip rather than assuming 4rem — it is what decides
    // where the detent sits, so a guess would leave the banner floating
    // shy of the edge or bleeding past it. This has to come after the
    // layer is displayed: a display:none box reports every rect as zero.
    var strip = layerInner.querySelector(".scroll-banner, .pt-home-banner");
    bannerHeight = strip ? Math.round(strip.getBoundingClientRect().height) || 64 : 64;

    // Backwards there is no banner to announce, so it goes straight to
    // the pulling act rather than pausing at a detent of zero height.
    docked = direction === "prev";

    document.documentElement.classList.add("pt-transitioning");
    // Promote both moving surfaces for the duration only. Left on
    // permanently this pins two full-page layers in memory for a page
    // that spends nearly all its time not transitioning at all.
    shell.style.willChange = "transform";
    scrim.classList.add("is-active");
    if (window.galleryScrollControl) window.galleryScrollControl.pause();
    armed = true;
    return true;
  }

  function render() {
    var vh = window.innerHeight;
    var sign = direction === "next" ? 1 : -1;

    // Driven in pixels, not percent, so the banner lands exactly on the
    // viewport edge rather than a rounding of it. The banner sits at the
    // top of the incoming surface, so offsetting the layer by
    // (viewport − banner height) is what parks it flush against the
    // bottom.
    var offset = (1 - reveal) * vh;
    layer.style.transform = "translate3d(0," + (sign * offset).toFixed(2) + "px,0)";
    layer.style.setProperty("--pt-progress", reveal.toFixed(4));

    // The page underneath barely stirs while the banner is only being
    // announced, then gives way in earnest once it's actually being
    // pulled up. Because both are read off the same reveal, one runs
    // into the other with no seam at the detent.
    shell.style.transform =
      "translate3d(0," + (-sign * reveal * 18).toFixed(3) + "vh,0) scale(" +
      (1 - reveal * 0.06).toFixed(4) + ")";
    // Darkened by a scrim over the top rather than a filter on the page
    // itself: brightness() forces the whole gallery — every image — to
    // be repainted on every frame of the drag, which is the one thing
    // here expensive enough to cost frames. Opacity on a separate layer
    // costs nothing.
    scrim.style.opacity = (reveal * 0.28).toFixed(3);
  }

  function clearVisuals() {
    // Removed outright rather than zeroed: an identity transform still
    // makes the shell a containing block for the page's fixed elements.
    shell.style.transform = "";
    shell.style.willChange = "";
    scrim.classList.remove("is-active");
    scrim.style.opacity = "";
    layer.style.transform = "";
    layer.classList.remove("is-active", "from-below", "from-above", "is-home");
    layer.setAttribute("aria-hidden", "true");
    layerInner.innerHTML = "";
    document.documentElement.classList.remove("pt-transitioning");
  }

  function reset() {
    direction = null;
    target = null;
    travel = 0;
    reveal = 0;
    docked = false;
    armed = false;
    busy = false;
    gestureSpent = false;
    recent.length = 0;
  }

  // ------------------------------------------------------------- settling

  function animateTo(destination, done) {
    busy = true;
    var from = reveal;
    var start = performance.now();
    // Scaled to the distance left, but with a floor: completing from
    // nearly-there should still read as a movement rather than a cut.
    var span = Math.max(280, SETTLE_MS * Math.abs(destination - from));

    (function step(now) {
      var t = clamp((now - start) / span, 0, 1);
      reveal = from + (destination - from) * easeOutExpo(t);
      render();
      if (t < 1) requestAnimationFrame(step);
      else done();
    })(start);
  }
  // Note that `busy` deliberately stays set when this finishes. Only the
  // caller knows whether the gesture should be live again: the dock does
  // want it back, but a commit must stay locked until the page has
  // actually gone.

  // The banner comes to rest against the bottom edge and stays there.
  // This is a real stopping place, not a waypoint: the reader can leave
  // it sitting, and only a further gesture takes it any further.
  function settleToDock() {
    animateTo(dockFraction(), function () {
      docked = true;
      travel = 0;
      recent.length = 0;
      busy = false; // resting, but still very much in play
    });
  }

  function revert() {
    animateTo(0, function () {
      clearVisuals();
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
      reset();
    });
  }

  // Marks the destination so it knows two things this navigation can't
  // tell it any other way: don't fade in, because the reader is already
  // looking at a full-screen surface belonging to you; and — travelling
  // backwards — open at your end rather than your beginning, because
  // the end is where they left off. Read by transition.js and
  // category-page.js, and stripped from the URL once the page settles.
  function arrivalFlag(dir) {
    return dir === "prev" ? "#pt-in=bottom" : "#pt-in";
  }

  function commit() {
    var href = target;
    var wasDirection = direction;

    animateTo(1, function () {
      // Straight there, with no fade. The layer is covering the viewport
      // by this point, so fading out would dissolve it to white and have
      // the real page build back from white behind it — the one visible
      // seam in the whole movement. Navigating outright instead lets the
      // browser hold these pixels until the new document can paint.
      window.location.href = href + arrivalFlag(wasDirection);
    });
  }

  // A decisive flick should carry through even if it didn't get far in
  // distance — that's the difference between a gesture with weight
  // behind it and one the reader thought better of. Without this the
  // only way through is to grind out the full threshold, which reads as
  // the page resisting rather than responding.
  function velocity() {
    if (recent.length < 2) return 0;
    var span = recent[recent.length - 1].t - recent[0].t;
    if (span <= 0) return 0;
    var sum = 0;
    for (var i = 0; i < recent.length; i++) sum += recent[i].d;
    return sum / span; // px per ms, positive == pushing onward
  }

  function release() {
    // The gesture already spent itself on an act that ran to its stop.
    // Letting go is what ends it, and what makes the next push a
    // separate one.
    if (gestureSpent) {
      gestureSpent = false;
      recent.length = 0;
      return;
    }
    if (!armed || busy) return;
    var decisive = velocity() >= FLICK_VELOCITY;

    if (docked) {
      if (actProgress() >= COMMIT_AT || decisive) commit();
      else settleToDock(); // fall back to the banner's resting place
      return;
    }

    if (actProgress() >= DOCK_AT || decisive) settleToDock();
    else revert();
  }

  // --------------------------------------------------------------- input

  function push(amount) {
    // Both of these consume the gesture rather than declining it. A
    // settle is playing, or this push has already done what it came to
    // do — either way the layer is covering the viewport, and letting
    // the scroll fall through to the page underneath would slide the
    // page out from behind it.
    if (busy || gestureSpent) return armed;

    if (!armed) {
      if (amount > 0 && atBottom() && neighbours.next) direction = "next";
      else if (amount < 0 && atTop() && neighbours.prev) direction = "prev";
      else return false;
      if (!beginTransition()) { direction = null; return false; }
      travel = 0;
    }

    var forward = direction === "next" ? amount : -amount;
    recordDelta(forward);

    var limit = docked ? PULL_DISTANCE : DOCK_DISTANCE;
    travel = Math.min(travel + forward, limit);

    // Pulled back past the start of the current act. Stepping down from
    // the docked state has to carry whatever is left of the gesture into
    // the act below rather than swallowing it — otherwise a decisive
    // scroll back up stalls at the dock instead of retracting, having
    // spent its whole distance crossing a boundary.
    if (travel <= 0 && docked) {
      travel += DOCK_DISTANCE;
      docked = false;
    }
    if (travel <= 0) {
      clearVisuals();
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
      reset();
      return false;
    }

    reveal = computeReveal();
    render();

    // The act has been dragged all the way to its stop while the gesture
    // is still going. Take the step now rather than sitting against the
    // stop waiting for the wheel to fall quiet: the reader has already
    // made their meaning plain, and holding out for a lull is what makes
    // the page feel like it needs to be scrolled at twice.
    if (actProgress() >= 1) {
      gestureSpent = true;
      if (docked) commit();
      else settleToDock();
    }
    return true;
  }

  window.addEventListener("wheel", function (e) {
    if (push(e.deltaY)) {
      e.preventDefault(); // hold the page still; the gesture drives the layer now
      window.clearTimeout(wheelIdleTimer);
      wheelIdleTimer = window.setTimeout(release, WHEEL_IDLE_MS);
    }
  }, { passive: false });

  var touchY = null;

  window.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) touchY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchmove", function (e) {
    if (touchY === null || e.touches.length !== 1) return;
    var y = e.touches[0].clientY;
    var delta = touchY - y; // dragging up == scrolling down
    touchY = y;
    if (push(delta)) e.preventDefault();
  }, { passive: false });

  ["touchend", "touchcancel"].forEach(function (type) {
    window.addEventListener(type, function () {
      touchY = null;
      release();
    }, { passive: true });
  });

  // Anything that navigates for real — the back button, a keychain link,
  // the browser's own back — should not find a half-drawn transition
  // still on screen.
  window.addEventListener("pagehide", function () {
    if (armed) clearVisuals();
  });
})();
