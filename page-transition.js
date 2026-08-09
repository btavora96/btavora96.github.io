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
 * Between the three category pages the swap is real: same stylesheet,
 * same script, so the incoming markup replaces the outgoing markup in
 * place and history.pushState updates the URL. Nothing reloads.
 *
 * The Home boundaries work differently on purpose. Home is a separate
 * document with its own stylesheet that restyles body wholesale, plus a
 * keychain simulation of its own; injecting it here would mean loading
 * that CSS into a category page and hoping the two don't collide. So
 * those two edges get the same gesture-driven reveal against a preview
 * layer, and hand off to the ordinary fade navigation on commit.
 */
(function () {
  "use strict";

  var CHAIN = {
    "branding.html":  { prev: "home.html",      next: "social.html" },
    "social.html":    { prev: "branding.html",  next: "webdesign.html" },
    "webdesign.html": { prev: "social.html",    next: "home.html" }
  };

  var LABELS = {
    "home.html": "Home",
    "branding.html": "Branding",
    "social.html": "Social Media",
    "webdesign.html": "Web Design"
  };

  // Each category's own banner, so the strip that docks can be built
  // without having fetched the page it belongs to. Kept in step with the
  // inline style on each page's .scroll-banner-track.
  var BANNERS = {
    "branding.html":  { src: "assets/branding/banner/banner-branding.svg", tile: 442.117 },
    "social.html":    { src: "assets/social/banner/social.svg",            tile: 547.07 },
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
  // travels to the top, where a category banner belongs, and the work
  // follows it into view.
  //
  // Both acts are the same underlying quantity — how much of the next
  // page is showing — so the docked state is simply a detent partway
  // along it, rather than a separate mechanism.
  //
  // The distances below are what the gesture is mapped onto; the two
  // thresholds are how much of one counts as meaning it. Both are set so
  // that a single ordinary scroll — one notch of a wheel, one flick of a
  // trackpad — carries a whole act. Asking for more than that turns a
  // deliberate movement into something the reader has to repeat, which
  // reads as the page ignoring them.
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
  // Body classes owned by the running document rather than by any one
  // page's markup, and so carried across a swap rather than replaced by
  // it. See swapTo.
  var RUNTIME_BODY_CLASSES = ["page-ready", "page-leaving"];

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

  // This file also runs inside the preview frames it creates below. In
  // there it must do nothing but render the page — a preview that ran
  // its own transition system would be a gallery inside a gallery.
  var PREVIEW_FLAG = "pt-preview";
  var previewMode = location.search.indexOf(PREVIEW_FLAG) !== -1;
  if (previewMode) {
    // Travelling backwards, the frame is standing in for the *end* of
    // the previous page, which is where the reader left off.
    if (location.search.indexOf(PREVIEW_FLAG + "=end") !== -1) {
      window.addEventListener("load", function () {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      });
    }
    return;
  }

  // Opened straight from disk, a browser refuses to let a page read
  // another one with fetch — same-origin doesn't apply to file:// URLs,
  // every file is its own opaque origin. Without the next page's markup
  // there is nothing to swap in, so that route is closed and the layer
  // shows the real page in a frame instead. It costs the seamless
  // hand-off at the end (a frame's document can't be adopted into this
  // one), but everything up to it — the docked banner, the whole page
  // rising as one block — is the genuine article rather than a stand-in.
  var CAN_READ_PAGES = location.protocol !== "file:";

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
  layer.setAttribute("aria-hidden", "true");
  var layerInner = document.createElement("div");
  layerInner.className = "pt-layer-inner";
  layer.appendChild(layerInner);

  // Kept apart from layerInner, which gets emptied on every transition —
  // these frames are loaded once and reused, and reinserting an iframe
  // makes it reload from scratch.
  var frameHolder = document.createElement("div");
  frameHolder.className = "pt-frames";
  layer.appendChild(frameHolder);

  body.appendChild(layer);

  var frames = {};

  function frameFor(href, forEnd) {
    if (!href || href === "home.html") return null;
    var key = href + (forEnd ? "#end" : "");
    if (frames[key]) return frames[key];
    var frame = document.createElement("iframe");
    frame.className = "pt-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    // Deliberately scrollable: the backwards preview positions itself at
    // the previous page's end, and scrolling="no" would stop it doing
    // that. The reader can't scroll it by hand anyway — .pt-frames takes
    // no pointer events.
    frame.src = href + "?" + PREVIEW_FLAG + (forEnd ? "=end" : "");
    frameHolder.appendChild(frame);
    frames[key] = frame;
    return frame;
  }

  function showFrame(frame) {
    Object.keys(frames).forEach(function (k) {
      frames[k].classList.toggle("is-showing", frames[k] === frame);
    });
  }

  // ------------------------------------------------------------ prefetch

  var cache = {};
  // Parsed and ready to show. The gesture checks this rather than the
  // promise: a transition must never begin against a page that hasn't
  // arrived, or the reader spends the drag hauling up an empty panel.
  var ready = {};

  // Fetching the markup early is only half of it: the pictures are what
  // the reader actually sees, and an <img> only starts downloading once
  // it's in a live document. Warming the ones that will be on screen
  // during the pull means they're already decoded when the layer
  // appears, instead of popping in one after another as it rises —
  // which reads as the new page assembling itself rather than arriving.
  var FIRST_SCREEN_PROJECTS = 3;

  function warmFirstImages(doc) {
    var items = doc.querySelectorAll(".gallery-item");
    Array.prototype.slice.call(items, 0, FIRST_SCREEN_PROJECTS).forEach(function (item) {
      // One picture per project, not the first few pictures on the page.
      // A Web Design project is a stack of screenshots with only the
      // active one displayed, so counting images would spend the whole
      // budget inside the first carousel — on slides sitting behind its
      // arrows that nobody is about to see — and leave the next two
      // projects cold.
      var img = item.querySelector("img.is-active") || item.querySelector("img");
      var src = img && img.getAttribute("src");
      if (!src) return;
      var warm = new Image();
      warm.src = src;
    });
  }

  function fetchPage(href) {
    if (cache[href]) return cache[href];
    cache[href] = fetch(href, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        var parsed = new DOMParser().parseFromString(html, "text/html");
        warmFirstImages(parsed);
        ready[href] = parsed;
        return parsed;
      })
      .catch(function (err) {
        delete cache[href]; // let a later attempt try again
        throw err;
      });
    return cache[href];
  }

  // Warm both neighbours once the page itself is settled, so reaching an
  // edge doesn't wait on the network. The frames are built here too, not
  // when the gesture starts: an iframe has a whole page to load, and
  // building it on demand would mean watching it arrive.
  function prefetchNeighbours() {
    if (!CAN_READ_PAGES) {
      frameFor(neighbours.next, false);
      frameFor(neighbours.prev, true);
      return;
    }
    [neighbours.prev, neighbours.next].forEach(function (href) {
      if (href && href !== "home.html") fetchPage(href).catch(function () {});
    });
  }
  if ("requestIdleCallback" in window) window.requestIdleCallback(prefetchNeighbours, { timeout: 3000 });
  else window.setTimeout(prefetchNeighbours, 1500);

  // --------------------------------------------------------------- state

  var direction = null;   // "next" | "prev"
  var target = null;      // href being revealed
  var travel = 0;         // px of gesture accumulated within the current act
  var reveal = 0;         // 0 = hidden, 1 = the next page fills the viewport
  var docked = false;     // the banner has taken its place at the bottom edge
  var bannerHeight = 64;  // measured from the incoming page's own banner
  var prevAlignOffset = 0;// holds the previous page's end against the edge
  var busy = false;       // a settle animation owns the layer
  var armed = false;      // layer is populated and visible
  var wheelIdleTimer = null;
  var previewOnly = false; // layer holds a stand-in, not the real page
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

  // Home gets a banner strip of its own so it docks the same way the
  // categories do — it isn't injected (see the note at the top), but the
  // gesture shouldn't behave differently just because of that.
  function homePreview() {
    var wrap = document.createElement("div");
    wrap.className = "pt-home-preview";

    var strip = document.createElement("div");
    strip.className = "pt-home-banner";
    var label = document.createElement("span");
    label.className = "pt-home-label";
    label.textContent = LABELS["home.html"];
    strip.appendChild(label);

    wrap.appendChild(strip);
    return wrap;
  }

  // Stand-in for a category whose markup isn't available — most often
  // because the site is being opened straight off disk, where browsers
  // refuse fetch() on file:// URLs, but equally if the network drops.
  // It carries that category's real banner, so the gesture looks and
  // behaves exactly the same; only the hand-off at the end differs,
  // falling back to the ordinary fade instead of swapping in place.
  // Without this the transition simply declined to start, which is
  // indistinguishable from the feature not existing.
  function bannerPreview(href) {
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

  function fillLayerFrom(doc) {
    var frag = document.createDocumentFragment();
    Array.prototype.forEach.call(doc.body.children, function (child) {
      if (child.tagName === "SCRIPT") return;
      var clone = child.cloneNode(true);
      frag.appendChild(clone);
    });
    // Lazy images inside an off-screen fixed layer may never be asked
    // for, which would reveal an empty frame. The first few are what the
    // reader actually sees during the drag, so those load eagerly.
    var eager = frag.querySelectorAll ? frag.querySelectorAll("img[loading='lazy']") : [];
    Array.prototype.slice.call(eager, 0, 3).forEach(function (img) {
      img.setAttribute("loading", "eager");
    });
    return frag;
  }

  function beginTransition() {
    target = targetHref();
    if (!target) return false;

    layerInner.innerHTML = "";
    layerInner.style.transform = "";

    var frame = null;
    showFrame(null);

    if (target === "home.html") {
      previewOnly = true;
      layerInner.appendChild(homePreview());
      layer.classList.add("is-home");
    } else if (ready[target]) {
      previewOnly = false;
      layer.classList.remove("is-home");
      layerInner.appendChild(fillLayerFrom(ready[target]));
    } else if (!CAN_READ_PAGES) {
      // Opened from disk. The page can't be read, but it can be shown:
      // the frame renders the genuine next category, running its own
      // stylesheet and its own focus effect, so what rises is the real
      // thing rather than a stand-in. Only the hand-off at the very end
      // has to fall back to an ordinary navigation.
      previewOnly = true;
      layer.classList.remove("is-home");
      frame = frameFor(target, direction === "prev");
      showFrame(frame);
    } else {
      // Show the category's banner rather than declining the gesture,
      // and keep trying for the real page in the background — if it
      // lands before the reader commits, the next attempt is seamless.
      previewOnly = true;
      layer.classList.remove("is-home");
      layerInner.appendChild(bannerPreview(target));
      fetchPage(target).catch(function () {});
    }

    layer.classList.add("is-active");
    layer.classList.toggle("from-below", direction === "next");
    layer.classList.toggle("from-above", direction === "prev");
    layer.classList.toggle("has-frame", !!frame);

    // Read the real strip rather than assuming 4rem — it is what decides
    // where the detent sits, so a guess would leave the banner floating
    // shy of the edge or bleeding past it. A frame's contents are a
    // separate document and can't be measured through, but it is running
    // this same stylesheet, so this page's own banner is the same strip.
    var strip = frame
      ? document.querySelector(".pt-shell .scroll-banner")
      : layerInner.querySelector(".scroll-banner, .pt-home-banner");
    bannerHeight = strip ? Math.round(strip.getBoundingClientRect().height) || 64 : 64;

    // Dress the copy as it will look once it lands, so the layer is
    // already a finished page rather than a flat one that has to
    // resolve into it. This has to come *after* the layer is displayed:
    // it measures the contents, and a display:none box reports every
    // rect as zero, which quietly yields a focus value computed from
    // nothing at all.
    if (!previewOnly && window.applySettledFocus) window.applySettledFocus(layerInner);

    // Backwards there is no banner to announce, so it goes straight to
    // the pulling act rather than pausing at a detent of zero height.
    docked = direction === "prev";

    alignLayerContent();
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

  // Coming from above, the reader is travelling backwards, so the edge
  // that meets them is the previous page's *end*, not its beginning.
  function alignLayerContent() {
    if (direction === "prev") {
      // A frame can't be offset from out here — it was asked to open at
      // its own end instead (see PREVIEW_FLAG).
      var overflow = layer.classList.contains("has-frame")
        ? 0
        : layerInner.scrollHeight - window.innerHeight;
      prevAlignOffset = overflow > 0 ? -overflow : 0;
      return;
    }

    // Going forward the incoming page is left exactly as authored: its
    // banner and its work keep the spacing they have on the page itself,
    // and the whole thing travels as one slab. An earlier version rode
    // the work up closer behind the banner and let that spacing open out
    // during the pull — which meant the two moved at different rates and
    // read as the banner arriving first and the page following it, when
    // the whole point is that they arrive together.
    prevAlignOffset = 0;
  }

  function render() {
    var vh = window.innerHeight;
    var sign = direction === "next" ? 1 : -1;

    // Driven in pixels, not percent, so the banner lands exactly on the
    // viewport edge rather than a rounding of it. The banner sits at the
    // top of the incoming page, so offsetting the layer by
    // (viewport − banner height) is what parks it flush against the
    // bottom.
    var offset = (1 - reveal) * vh;
    layer.style.transform = "translate3d(0," + (sign * offset).toFixed(2) + "px,0)";
    layer.style.setProperty("--pt-progress", reveal.toFixed(4));

    // Nothing inside the layer moves independently of it: the banner and
    // the work are one surface, and the layer's own transform is what
    // carries both. The only exception is travelling backwards, where
    // the layer has to be showing the previous page's *end* rather than
    // its beginning — a fixed offset, set once, not something that
    // shifts during the gesture.
    if (direction === "prev") {
      layerInner.style.transform = prevAlignOffset
        ? "translate3d(0," + prevAlignOffset + "px,0)"
        : "";
    }

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
    layer.classList.remove("is-active", "from-below", "from-above", "is-home", "has-frame");
    showFrame(null);
    layerInner.innerHTML = "";
    layerInner.style.transform = "";
    document.documentElement.classList.remove("pt-transitioning");
  }

  function reset() {
    direction = null;
    target = null;
    travel = 0;
    reveal = 0;
    docked = false;
    prevAlignOffset = 0;
    armed = false;
    busy = false;
    previewOnly = false;
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
  // want it back, but a commit must stay locked until the swap has
  // actually happened — the page is fetched in between, and a scroll
  // arriving in that window would otherwise arm a second transition on
  // top of the one still completing, leaving its transforms applied to a
  // page that had already moved on.

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

  // Marks the destination of a hand-off that had to go through a real
  // navigation, so it knows two things the transition can't tell it any
  // other way: don't fade in, and — travelling backwards — open at your
  // end rather than your beginning, because the end is what the reader
  // was just looking at. Read by transition.js and category-page.js, and
  // stripped from the URL once the page has settled.
  function arrivalFlag(dir) {
    return dir === "prev" ? "#pt-in=bottom" : "#pt-in";
  }

  function commit() {
    var href = target;
    var wasDirection = direction;
    // Whether the swap can happen in place comes down to what the layer
    // is actually holding. If it holds a stand-in — Home, or a category
    // that couldn't be fetched — then handing those nodes to the page
    // would install the stand-in as the page. The document arriving
    // late doesn't help: it isn't what's on screen.
    var seamless = !previewOnly && !!ready[href];

    animateTo(1, function () {
      if (!seamless) {
        // Straight there, with no fade. The layer is covering the
        // viewport with the destination itself by this point, so fading
        // out would dissolve the finished page to white and then have
        // the real one build back from white behind it — the one visible
        // seam in the whole movement. Navigating outright instead lets
        // the browser hold these pixels until the new document can
        // paint, and the flag tells that document not to fade in over
        // something the reader is already looking at.
        window.location.href = href + arrivalFlag(wasDirection);
        return;
      }
      // Synchronous: the document is already parsed and its nodes are
      // already on screen, so there is no reason to go back through a
      // promise and risk a frame landing in between.
      swapTo(href, ready[href], wasDirection);
    });
  }

  function swapTo(href, doc, wasDirection) {
    history.pushState({ pageTransition: true }, "", href);
    document.title = doc.title;

    // The fetched document's body carries the classes that page was
    // *authored* with, and nothing else. The running document has since
    // added its own — page-ready above all, which transition.css uses to
    // fade a page in and without which `body { opacity: 0 }` still
    // applies. Copying the class list wholesale therefore drops it and
    // hands the reader a perfectly laid out, completely invisible page.
    // (Nothing in the geometry gives this away, which is why it survived
    // so long: getBoundingClientRect reports the same numbers either
    // way.)
    var runtimeClasses = RUNTIME_BODY_CLASSES.filter(function (name) {
      return document.body.classList.contains(name);
    });
    document.body.className = doc.body.className;
    runtimeClasses.forEach(function (name) {
      document.body.classList.add(name);
    });

    // Hand over the very nodes the layer has been showing, rather than
    // building a second copy from the parsed document. A fresh clone
    // means fresh <img> elements, and those have to be decoded again
    // before they can paint — which is precisely where a blank frame
    // comes from at the moment of exchange. These are already on screen
    // and already decoded, so moving them is visually a no-op.
    shell.innerHTML = "";
    while (layerInner.firstChild) shell.appendChild(layerInner.firstChild);

    current = href;
    neighbours = CHAIN[current];

    // All of this — emptying the layer, uncovering it, and putting the
    // page at its final scroll position — happens inside one task, so
    // the browser paints it once, whole. Split across frames, the
    // now-empty layer would flash its own background first.
    clearVisuals();
    reset();

    window.initCategoryPage({
      landing: wasDirection === "prev" ? "bottom" : "top",
      softSwap: true
    });
    if (window.galleryScrollControl) window.galleryScrollControl.resume();

    prefetchNeighbours();
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
  window.addEventListener("popstate", function () {
    // The URL has already moved; re-rendering that page properly is a
    // load. Seamless in one direction is worth more than clever here.
    window.location.reload();
  });

  window.addEventListener("pagehide", function () {
    if (armed) clearVisuals();
  });
})();
