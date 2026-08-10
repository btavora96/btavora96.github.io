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

  // What each strip says. Set as plain text rather than borrowing the
  // category's own scrolling banner: the strip is here to name where the
  // reader is going, and a word does that quietly, where the marquee
  // arrives already in motion and competes with the movement it is
  // riding on.
  var LABELS = {
    "branding.html":  "Branding",
    "social.html":    "Social Media",
    "webdesign.html": "Web Design"
  };

  // The pictures each page opens with, in order. Warmed while the strip
  // is docked — a gesture's worth of time before they are needed — so
  // the destination arrives with its first screen already decoded
  // instead of assembling itself while the reader watches. Nothing waits
  // on these: if one hasn't landed by the time the page does, the page
  // goes ahead without it. Should this ever fall out of step with the
  // markup the request simply misses and nothing else changes.
  var FIRST_IMAGES = {
    "branding.html": [
      "assets/branding/aurora-skincare.webp",
      "assets/branding/cascais-ópera.webp",
      "assets/branding/crafthouse-coffee.webp"
    ],
    "social.html": [
      "assets/social/estoril-riviera.webp",
      "assets/social/rud-jewelry.webp"
    ],
    "webdesign.html": [
      "assets/webdesign/361-retail.webp"
    ]
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
  // Every millisecond of it is spent waiting to find out something the
  // reader has already decided, so it is only as long as it has to be to
  // not mistake the gap between two notches for the end of a gesture.
  var WHEEL_IDLE_MS = 100;
  // Past this much of an act, while the gesture is still going, the step
  // is taken there and then rather than at the lull. A push this far is
  // not ambiguous, and waiting to be told twice is what makes a page
  // feel like it is thinking about it.
  var AUTO_STEP_AT = 0.62;
  var SETTLE_MS = 760;
  var COMMIT_MS = 420;      // the final rise, kept short — see commit()
  var LAYER_DISSOLVE_MS = 260; // must match .pt-layer.is-dissolving
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

  // For the last movement, where expo is the wrong shape. Expo is 97%
  // resolved at the halfway mark, so the rest of its span is motion too
  // small to see — and since the page is only asked for once the span
  // ends, that invisible tail is spent as waiting. Cubic covers its
  // distance more evenly and finishes when it looks finished.
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Body classes owned by the running document rather than by any one
  // page's markup, and so carried across a swap rather than replaced by
  // it. page-ready above all: transition.css hides body until it is set,
  // so copying the incoming class list wholesale hands the reader a
  // perfectly laid out, completely invisible page.
  var RUNTIME_BODY_CLASSES = ["page-ready", "page-leaving"];

  // This file also runs inside the source frames it creates below. In
  // there it must do nothing — a page standing by to be adopted has no
  // business running a transition system of its own.
  var PREVIEW_FLAG = "pt-preview";
  if (location.search.indexOf(PREVIEW_FLAG) !== -1) return;

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

  // ---------------------------------------------------------- the source
  //
  // Where the next page comes from. Not fetched — a browser refuses to
  // let one file:// document read another that way, every local file
  // being its own opaque origin — but an iframe is allowed to load it,
  // and its contentDocument is readable. That distinction is the whole
  // reason this can be seamless from disk as well as from a server.
  //
  // The frame is never shown. What rises is still the strip; this only
  // exists so that at the end there is a live, laid-out, already-decoded
  // page to hand over, instead of a navigation and the second or so it
  // takes a browser to build a document from nothing.
  var frames = {};

  function frameFor(href) {
    if (!href || href === "home.html" || frames[href]) return;
    var frame = document.createElement("iframe");
    frame.className = "pt-source";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.src = href + "?" + PREVIEW_FLAG;
    frame.addEventListener("load", function () {
      // visibility:hidden lays out but doesn't paint, and an image that
      // is never painted may never be decoded — which would put the
      // decode back at the moment of the swap, exactly where a blank
      // frame comes from. Asking for it explicitly settles that.
      var doc = frameDoc(href);
      if (!doc) return;
      Array.prototype.slice.call(doc.querySelectorAll("img"), 0, 4)
        .forEach(function (img) {
          if (img.decode) img.decode().catch(function () {});
        });
    });
    document.body.appendChild(frame);
    frames[href] = frame;
  }

  // Readable only once it holds the page it was pointed at. A frame that
  // is still loading reports about:blank, and adopting that would swap
  // in an empty document.
  function frameDoc(href) {
    var frame = frames[href];
    if (!frame) return null;
    var doc;
    try { doc = frame.contentDocument; } catch (e) { return null; }
    if (!doc || !doc.body) return null;
    if (!doc.querySelector(".project-grid")) return null;
    return doc;
  }

  function prepareNeighbours() {
    frameFor(neighbours.next);
    frameFor(neighbours.prev);
  }

  // As soon as this page has finished loading, and not a moment later.
  // Everything downstream depends on the neighbour being ready by the
  // time the reader reaches the end of a category: a frame that isn't
  // ready means falling back to a real navigation, and a real navigation
  // is the only thing here that can show a white screen. Waiting for an
  // idle callback was leaving that to chance.
  if (document.readyState === "complete") prepareNeighbours();
  else window.addEventListener("load", prepareNeighbours, { once: true });

  // Standing at the top or the bottom of a category is the last warning
  // before a transition; anything still missing is asked for now.
  function ensureNeighbour(href) {
    if (href && !frames[href]) frameFor(href);
  }

  // A frame that hasn't finished loading is worth a short wait. What the
  // reader is looking at meanwhile is the layer, covering the viewport
  // in the destination's own ground — still, continuous, and the right
  // colour. Navigating instead would replace that with the browser's
  // blank. Waiting is the lesser evil; in practice neither happens,
  // because the frame has been loading since this page finished.
  var FRAME_WAIT_MS = 1200;

  function whenFrameReady(href, cb) {
    var doc = frameDoc(href);
    if (doc) return cb(doc);
    var frame = frames[href];
    if (!frame) return cb(null);
    var settled = false;
    function done() {
      if (settled) return;
      settled = true;
      cb(frameDoc(href));
    }
    frame.addEventListener("load", done, { once: true });
    window.setTimeout(done, FRAME_WAIT_MS);
  }

  // --------------------------------------------------------------- state

  var direction = null;   // "next" | "prev"
  var target = null;      // href being revealed
  var travel = 0;         // px of gesture accumulated within the current act
  var reveal = 0;         // 0 = hidden, 1 = the next page fills the viewport
  var revealTarget = 0;   // where the gesture says reveal should be
  var smoothing = false;  // the follow loop is running
  var retracting = false; // pulled back out; sliding away rather than cut
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

  // Every destination rises the same way: one strip, naming where the
  // reader is going, over the background the page will arrive on. It is
  // a stand-in and it is meant to be — the movement is about leaving one
  // category for the next, and a line of text is what says which.
  function strip(className) {
    var wrap = document.createElement("div");
    wrap.className = "pt-page-preview " + className;

    var bar = document.createElement("div");
    bar.className = "pt-strip";
    var label = document.createElement("p");
    label.className = "pt-strip-label";
    bar.appendChild(label);
    wrap.appendChild(bar);

    wrap.label = label;
    return wrap;
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  function downArrow() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pt-strip-arrow");
    svg.setAttribute("viewBox", "0 0 12 18");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M6 2.2 V15.2 M1.8 10.8 L6 15.4 L10.2 10.8");
    svg.appendChild(path);
    return svg;
  }

  function categoryPreview(href) {
    var wrap = strip("pt-preview-category");
    wrap.label.textContent = LABELS[href] || "";
    wrap.label.appendChild(downArrow());
    return wrap;
  }

  // Home closes the loop, and there is no category left to announce —
  // so its strip says the thing the whole gallery has been building
  // towards instead, and carries the address to answer it.
  function homePreview() {
    var wrap = strip("pt-preview-home");
    var label = wrap.label;
    label.classList.add("pt-strip-label--message");

    label.appendChild(document.createTextNode("Enjoying so far? :-) "));

    var link = document.createElement("a");
    link.className = "pt-strip-link";
    link.href = "mailto:btavora96@gmail.com";
    link.textContent = "Get in touch";
    label.appendChild(link);

    label.appendChild(document.createTextNode(" and let’s work!"));
    return wrap;
  }

  function beginTransition() {
    target = targetHref();
    if (!target) return false;

    // Last call. If this one was never built — or was thrown away by an
    // earlier swap — it starts loading now, while the strip has two acts
    // to travel before anyone needs it.
    ensureNeighbour(target);

    // A previous reveal may still be sliding away — or dissolving off a
    // page that has already been swapped in — when this one arms.
    stopFollowing();
    layer.classList.remove("is-dissolving");
    retracting = false;
    reveal = 0;
    revealTarget = 0;

    var isHome = target === "home.html";

    layerInner.innerHTML = "";
    layerInner.appendChild(isHome ? homePreview() : categoryPreview(target));
    // Hidden from assistive technology while it is only scenery, but not
    // when it is carrying a real address the reader is invited to use.
    layer.setAttribute("aria-hidden", isHome ? "false" : "true");

    layer.classList.add("is-active");
    layer.classList.toggle("from-below", direction === "next");
    layer.classList.toggle("from-above", direction === "prev");

    // Measure the strip rather than assuming 4rem — it is what decides
    // where the detent sits, so a guess would leave it floating shy of
    // the edge or bleeding past it. This has to come after the layer is
    // displayed: a display:none box reports every rect as zero.
    var bar = layerInner.querySelector(".pt-strip");
    bannerHeight = bar ? Math.round(bar.getBoundingClientRect().height) || 64 : 64;

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
    // Put the layer at its starting edge before anything can be painted.
    // Left to the stylesheet it would begin below the fold whichever way
    // it is travelling, which is the wrong side coming down from above.
    render();
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

  // ------------------------------------------------------------ following
  //
  // The gesture sets where the reveal should be; this brings it there.
  //
  // Rendering the gesture straight through looks right on paper — one to
  // one, nothing between hand and page — but a mouse wheel doesn't
  // deliver a gesture, it delivers 120 pixels at a time with nothing in
  // between. Drawn literally that is a series of steps, and no amount of
  // easing on the settle afterwards hides that the movement itself was
  // staccato. Following the target instead fills in what the wheel
  // leaves out, while still going exactly where the hand says and no
  // further. A trackpad, which sends a continuous stream, barely notices
  // this is here at all.
  var FOLLOW_PER_FRAME = 0.22; // fraction of the gap closed per frame at 60fps
  var SETTLED = 0.0008;        // close enough to stop drawing

  function startFollowing() {
    if (smoothing) return;
    smoothing = true;
    var last = performance.now();

    (function step(now) {
      if (!smoothing) return;
      // Re-derived from real elapsed time so a 120Hz display doesn't
      // converge twice as fast as a 60Hz one.
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      reveal += (revealTarget - reveal) * (1 - Math.pow(1 - FOLLOW_PER_FRAME, dt * 60));

      if (Math.abs(revealTarget - reveal) < SETTLED) {
        reveal = revealTarget;
        render();
        if (retracting) {
          smoothing = false;
          clearVisuals();
          reset();
          return;
        }
      } else {
        render();
      }
      requestAnimationFrame(step);
    })(last);
  }

  function stopFollowing() {
    smoothing = false;
  }

  function clearVisuals() {
    // Removed outright rather than zeroed: an identity transform still
    // makes the shell a containing block for the page's fixed elements.
    shell.style.transform = "";
    shell.style.willChange = "";
    scrim.classList.remove("is-active");
    scrim.style.opacity = "";
    layer.style.transform = "";
    layer.classList.remove("is-active", "from-below", "from-above");
    layer.setAttribute("aria-hidden", "true");
    layerInner.innerHTML = "";
    document.documentElement.classList.remove("pt-transitioning");
  }

  function reset() {
    stopFollowing();
    direction = null;
    target = null;
    travel = 0;
    reveal = 0;
    revealTarget = 0;
    retracting = false;
    docked = false;
    armed = false;
    busy = false;
    gestureSpent = false;
    recent.length = 0;
  }

  // ------------------------------------------------------------- settling

  function animateTo(destination, done, spanMs, ease) {
    busy = true;
    // The machine is playing this one, on its own curve. Two easings
    // stacked on the same value would drag the tail out and make the
    // ending feel soft rather than resolved.
    stopFollowing();
    revealTarget = destination;
    var from = reveal;
    var start = performance.now();
    // Scaled to the distance left, but with a floor: completing from
    // nearly-there should still read as a movement rather than a cut.
    var span = spanMs || Math.max(280, SETTLE_MS * Math.abs(destination - from));
    var curve = ease || easeOutExpo;

    (function step(now) {
      var t = clamp((now - start) / span, 0, 1);
      reveal = from + (destination - from) * curve(t);
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

      // Resting here is the one unhurried moment in the whole movement,
      // and it is immediately before the moment that can least afford to
      // wait. Spend it on the pictures the destination opens with.
      (FIRST_IMAGES[target] || []).forEach(function (src) {
        var warm = new Image();
        warm.src = src;
      });
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

    // Deliberately short, and on a curve that resolves rather than
    // trails off: the label fades out across the same stretch, so what
    // lands at the top is clean ground with nothing to replace.
    animateTo(1, function () {
      whenFrameReady(href, function (doc) {
        if (doc) {
          swapTo(href, doc, wasDirection);
          return;
        }
        // Nothing standing by at all — the destination is Home, which
        // has its own stylesheet and its own simulation and is not
        // something to graft into a category page. The layer is covering
        // the viewport, so navigating outright lets the browser hold
        // these pixels for as long as it will.
        window.location.href = href + arrivalFlag(wasDirection);
      });
    }, COMMIT_MS, easeOutCubic);
  }

  // Becoming the next page without reloading. The nodes come out of the
  // frame alive — laid out, styled, their images already decoded — so
  // moving them here is close to a no-op visually, where rebuilding them
  // from markup would mean decoding everything again and showing a blank
  // frame while that happened.
  function swapTo(href, doc, wasDirection) {
    history.pushState({ pageTransition: true }, "", href);
    document.title = doc.title;

    var runtimeClasses = RUNTIME_BODY_CLASSES.filter(function (name) {
      return document.body.classList.contains(name);
    });
    document.body.className = doc.body.className;
    runtimeClasses.forEach(function (name) {
      document.body.classList.add(name);
    });

    shell.innerHTML = "";
    // Explicit adoption: these nodes belong to the frame's document
    // until they are told otherwise.
    Array.prototype.slice.call(doc.body.children).forEach(function (child) {
      if (child.tagName === "SCRIPT") return;
      shell.appendChild(document.adoptNode(child));
    });

    current = href;
    neighbours = CHAIN[current];

    // The frame this page came out of has been emptied of everything
    // worth having. The others are kept if they are still neighbours of
    // where we have landed — travelling down the chain, the category
    // just left is the one behind the new one, and rebuilding a frame
    // that is already loaded would put a real navigation back in reach
    // for no reason at all.
    if (frames[href]) {
      frames[href].remove();
      delete frames[href];
    }
    Object.keys(frames).forEach(function (key) {
      if (key === neighbours.prev || key === neighbours.next) return;
      frames[key].remove();
      delete frames[key];
    });

    // Everything that was dressing the *outgoing* page stops now: the
    // shell is the new page, and must not be left scaled, shifted, or
    // with snapping still switched off.
    shell.style.transform = "";
    shell.style.willChange = "";
    scrim.classList.remove("is-active");
    scrim.style.opacity = "";
    document.documentElement.classList.remove("pt-transitioning");

    // The gesture is live again immediately — the reader shouldn't have
    // to wait out a fade to keep scrolling — while the layer dissolves
    // off the page it is now merely covering.
    reset();
    layer.classList.add("is-dissolving");

    // Belt and braces, because the failure here is not cosmetic: a layer
    // left dissolved is invisible but still covering the viewport, and
    // would swallow every click on the page behind it. transitionend
    // doesn't fire at all when the transition is suppressed — which is
    // exactly what prefers-reduced-motion does to this rule. Whichever
    // arrives first wins; both do the same thing.
    var finished = false;
    function finishDissolve() {
      if (finished) return;
      finished = true;
      layer.classList.remove("is-dissolving");
      clearVisuals();
    }
    layer.addEventListener("transitionend", finishDissolve, { once: true });
    window.setTimeout(finishDissolve, LAYER_DISSOLVE_MS + 120);

    window.initCategoryPage({
      landing: wasDirection === "prev" ? "bottom" : "top",
      softSwap: true
    });
    if (window.galleryScrollControl) window.galleryScrollControl.resume();

    prepareNeighbours();
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
    // Pulled back out of the transition entirely. The layer slides away
    // under the follow loop rather than being cut, and the page is
    // handed back its scroll immediately — the reader is already on
    // their way somewhere else, and shouldn't have to wait out an
    // animation to get there.
    if (travel <= 0) {
      revealTarget = 0;
      retracting = true;
      armed = false;
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
      startFollowing();
      return false;
    }

    revealTarget = computeReveal();
    startFollowing();

    // The act has been dragged well past the point of doubt while the
    // gesture is still going. Take the step now rather than waiting for
    // the wheel to fall quiet: the reader has already made their meaning
    // plain, and holding out for a lull is what makes the page feel like
    // it needs to be scrolled at twice.
    if (actProgress() >= AUTO_STEP_AT) {
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

  // Coming back to this page from the browser's own history, it can be
  // restored exactly as it was left — which, if it was left mid-gesture,
  // means a transition layer still covering the screen with nowhere to
  // go. Undone on restore rather than on the way out.
  //
  // On the way out is precisely where it must *not* be undone. The layer
  // covering the viewport is the last thing the browser paints before it
  // navigates, and it holds those pixels until the incoming document can
  // paint its own. Tearing the layer down as the page leaves hands that
  // final frame back to the page being left — so the reader watches the
  // category they just walked out of reappear for an instant, looking
  // for all the world like it reloaded, before the new one arrives.
  // Everything inside body goes with the page anyway; there is nothing
  // here that needs cleaning up on the way out.
  // A swap moved the URL without a load, so the browser's own back
  // button now has somewhere to go that this document can't render.
  // Reloading is honest: seamless in the direction the reader is
  // actually travelling is worth more than clever in reverse.
  window.addEventListener("popstate", function () {
    window.location.reload();
  });

  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      clearVisuals();
      reset();
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
    }
  });
})();
