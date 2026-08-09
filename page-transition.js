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

  // How much over-scroll fully reveals the next page. Long enough that
  // arriving there is unmistakably deliberate — a flick past the end of
  // the gallery shouldn't tip you into another category.
  var REVEAL_DISTANCE = 640;
  // Release past this and it completes; below it, it falls back.
  var COMMIT_AT = 0.42;
  // Wheel has no "finger lifted" event, so a lull stands in for one.
  var WHEEL_IDLE_MS = 140;
  var SETTLE_MS = 620;

  function pageKey(pathname) {
    var last = pathname.split("/").pop();
    return last || "home.html";
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Expo-out: leaves the tail long, so a completing transition decelerates
  // into place instead of stopping dead.
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

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

  var layer = document.createElement("div");
  layer.className = "pt-layer";
  layer.setAttribute("aria-hidden", "true");
  var layerInner = document.createElement("div");
  layerInner.className = "pt-layer-inner";
  layer.appendChild(layerInner);
  body.appendChild(layer);

  // ------------------------------------------------------------ prefetch

  var cache = {};

  function fetchPage(href) {
    if (cache[href]) return cache[href];
    cache[href] = fetch(href, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        return new DOMParser().parseFromString(html, "text/html");
      })
      .catch(function (err) {
        delete cache[href]; // let a later attempt try again
        throw err;
      });
    return cache[href];
  }

  // Warm both neighbours once the page itself is settled, so reaching an
  // edge doesn't wait on the network.
  function prefetchNeighbours() {
    [neighbours.prev, neighbours.next].forEach(function (href) {
      if (href && href !== "home.html") fetchPage(href).catch(function () {});
    });
  }
  if ("requestIdleCallback" in window) window.requestIdleCallback(prefetchNeighbours, { timeout: 3000 });
  else window.setTimeout(prefetchNeighbours, 1500);

  // --------------------------------------------------------------- state

  var direction = null;   // "next" | "prev"
  var target = null;      // href being revealed
  var travelled = 0;      // px of over-scroll accumulated
  var progress = 0;
  var busy = false;       // a settle animation owns the layer
  var armed = false;      // layer is populated and visible
  var wheelIdleTimer = null;

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

  function homePreview() {
    var wrap = document.createElement("div");
    wrap.className = "pt-home-preview";
    var label = document.createElement("span");
    label.className = "pt-home-label";
    label.textContent = LABELS["home.html"];
    wrap.appendChild(label);
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

    if (target === "home.html") {
      layerInner.appendChild(homePreview());
      layer.classList.add("is-home");
    } else {
      layer.classList.remove("is-home");
      var doc = null;
      // Only a resolved fetch can be used synchronously; otherwise fill
      // it in when it lands, mid-drag.
      fetchPage(target).then(function (parsed) {
        if (!armed || target !== targetHref()) return;
        if (layerInner.childNodes.length) return;
        layerInner.appendChild(fillLayerFrom(parsed));
        alignLayerContent();
      }).catch(function () {});
      void doc;
    }

    layer.classList.add("is-active");
    layer.classList.toggle("from-below", direction === "next");
    layer.classList.toggle("from-above", direction === "prev");
    document.documentElement.classList.add("pt-transitioning");
    if (window.galleryScrollControl) window.galleryScrollControl.pause();
    armed = true;
    return true;
  }

  // Coming from above, the reader is travelling backwards, so the edge
  // that meets them is the previous page's *end*, not its beginning.
  function alignLayerContent() {
    if (direction !== "prev") {
      layerInner.style.transform = "";
      return;
    }
    var overflow = layerInner.scrollHeight - window.innerHeight;
    layerInner.style.transform = overflow > 0
      ? "translate3d(0," + -overflow + "px,0)"
      : "";
  }

  function render() {
    var p = progress;
    var sign = direction === "next" ? 1 : -1;
    var eased = easeOut(p);

    // The incoming page covers the full distance; the outgoing one moves
    // a fraction of it and shrinks very slightly. The difference in
    // speed is what reads as depth — one layer sliding over another
    // rather than two things moving together.
    layer.style.transform =
      "translate3d(0," + (sign * (1 - eased) * 100) + "%,0)";
    layer.style.setProperty("--pt-progress", p.toFixed(4));

    shell.style.transform =
      "translate3d(0," + (-sign * eased * 14) + "vh,0) scale(" + (1 - eased * 0.05).toFixed(4) + ")";
    shell.style.filter = "brightness(" + (1 - eased * 0.18).toFixed(3) + ")";
  }

  function clearVisuals() {
    // Removed outright rather than zeroed: an identity transform still
    // makes the shell a containing block for the page's fixed elements.
    shell.style.transform = "";
    shell.style.filter = "";
    layer.style.transform = "";
    layer.classList.remove("is-active", "from-below", "from-above", "is-home");
    layerInner.innerHTML = "";
    layerInner.style.transform = "";
    document.documentElement.classList.remove("pt-transitioning");
  }

  function reset() {
    direction = null;
    target = null;
    travelled = 0;
    progress = 0;
    armed = false;
    busy = false;
  }

  // ------------------------------------------------------------- settling

  function animateTo(destination, done) {
    busy = true;
    var from = progress;
    var start = performance.now();
    var span = Math.max(160, SETTLE_MS * Math.abs(destination - from));

    (function step(now) {
      var t = clamp((now - start) / span, 0, 1);
      progress = from + (destination - from) * easeOut(t);
      render();
      if (t < 1) requestAnimationFrame(step);
      else done();
    })(start);
  }

  function revert() {
    animateTo(0, function () {
      clearVisuals();
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
      reset();
    });
  }

  function commit() {
    var href = target;
    var wasDirection = direction;

    animateTo(1, function () {
      if (href === "home.html") {
        // Home isn't injected here (see the note at the top); the layer
        // has covered the viewport, so handing off to the ordinary fade
        // navigation continues the same movement rather than cutting.
        if (window.navigateWithFade) window.navigateWithFade(href);
        else window.location.href = href;
        return;
      }

      fetchPage(href).then(function (doc) {
        swapTo(href, doc, wasDirection);
      }).catch(function () {
        window.location.href = href; // network gave out — fall back to a plain load
      });
    });
  }

  function swapTo(href, doc, wasDirection) {
    // The layer is already showing this page full-screen, so the moment
    // of exchange is hidden behind it.
    history.pushState({ pageTransition: true }, "", href);
    document.title = doc.title;
    document.body.className = doc.body.className;

    shell.innerHTML = "";
    var incoming = fillLayerFrom(doc);
    // Undo the eager hint on the copy that becomes the real page —
    // beyond the first screen these should stay lazy, as authored.
    shell.appendChild(incoming);

    current = href;
    neighbours = CHAIN[current];

    clearVisuals();
    reset();

    window.initCategoryPage({
      landing: wasDirection === "prev" ? "bottom" : "top",
      softSwap: true
    });
    if (window.galleryScrollControl) window.galleryScrollControl.resume();

    prefetchNeighbours();
  }

  function release() {
    if (!armed || busy) return;
    if (progress >= COMMIT_AT) commit();
    else revert();
  }

  // --------------------------------------------------------------- input

  function push(amount) {
    if (busy) return false;

    if (!armed) {
      if (amount > 0 && atBottom() && neighbours.next) direction = "next";
      else if (amount < 0 && atTop() && neighbours.prev) direction = "prev";
      else return false;
      if (!beginTransition()) { direction = null; return false; }
      travelled = 0;
    }

    var forward = direction === "next" ? amount : -amount;
    travelled = clamp(travelled + forward, 0, REVEAL_DISTANCE);

    // Pulled all the way back: hand the page its scrolling back rather
    // than sitting in a zero-progress transition.
    if (travelled <= 0) {
      clearVisuals();
      if (window.galleryScrollControl) window.galleryScrollControl.resume();
      reset();
      return false;
    }

    progress = travelled / REVEAL_DISTANCE;
    render();

    if (progress >= 1) commit();
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
