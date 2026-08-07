/**
 * Keychain cluster — isolated component
 * Builds the BG + 4 tag overlays inside a `.keychain-cluster` host and wires
 * up the hover tilt / glare / shadow, each tag linking to its own project
 * page (Branding, Social, Web Design, Other).
 *
 * The 4 tags are real <a href> elements sharing the same inset:0 canvas, so
 * their transparent areas overlap. A single pointer hit-layer on top
 * resolves hover/click against a cached per-tag alpha mask (read once from
 * an offscreen canvas) so only the tag whose actual (non-transparent)
 * artwork sits under the pointer reacts, and clicking it navigates to its
 * page (modifier keys still open a new tab). Keyboard users Tab through the
 * 4 real <a> elements directly, which stay focusable/activatable on their
 * own via the browser's native link handling.
 *
 * Pure vanilla JS, no dependencies.
 */
(function () {
  "use strict";

  var ASSET_BASE = "assets/keychains/";
  var MASK_W = 120;
  var MASK_H = 180;
  var ALPHA_THRESHOLD = 10;

  var TAGS = [
    { key: "web", file: "WEB-KC.webp", label: "Web Design — ver projetos", href: "webdesign.html" },
    { key: "star", file: "STAR-KC.webp", label: "Others — ver projetos", href: "other.html" },
    { key: "branding", file: "BRANDING-KC.webp", label: "Branding — ver projetos", href: "branding.html" },
    { key: "social", file: "SOCIAL-KC.webp", label: "Social Media — ver projetos", href: "social.html" }
  ];

  // Approximate bounding box (canvas-relative 0..1) for each tag's own
  // artwork, used only when the browser refuses to read pixel data back
  // from the canvas (some Chrome security configurations taint canvases
  // drawn from file:// images even same-origin, unlike the environment
  // this was authored/tested in) — without this, a failed alpha read
  // silently means that tag can never be hovered/clicked at all.
  var FALLBACK_BOXES = {
    star: { x0: 0.03, x1: 0.40, y0: 0.38, y1: 0.68 },
    branding: { x0: 0.24, x1: 0.44, y0: 0.45, y1: 0.90 },
    social: { x0: 0.42, x1: 0.63, y0: 0.30, y1: 0.90 },
    web: { x0: 0.54, x1: 0.83, y0: 0.36, y1: 0.75 }
  };

  var BASE_VARS = {
    "--rx": "0deg",
    "--ry": "0deg",
    "--tz": "0px",
    "--sx": "0px",
    "--sy": "14px",
    "--sb": "20px",
    "--sa": "0.28"
  };

  function isCoarsePointer() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * Ambient motion for the whole cluster (as opposed to a single tag's
   * own hover tilt, handled separately below): a gentle idle float so it
   * never reads as perfectly inert, a heavily-damped cursor-follow
   * parallax so it feels like it has weight, and — only once the phone
   * layout puts it in normal document flow (see keychain-cluster.css) —
   * a scroll parallax as it scrolls past, so the first scroll into the
   * intro text feels like a deliberate transition rather than the hero
   * just vanishing. One continuous rAF loop recomputes and lerps toward
   * fresh targets every frame; skipped entirely under reduced motion.
   */
  function wireHeroMotion(cluster) {
    if (prefersReducedMotion()) return;

    var coarse = isCoarsePointer();
    var mobileLayout = window.matchMedia && window.matchMedia("(max-width: 600px)");

    var targetX = 0;
    var targetY = 0;
    var curX = 0;
    var curY = 0;

    if (!coarse) {
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        targetX = (e.clientX / window.innerWidth) * 2 - 1;
        targetY = (e.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
    }

    var start = performance.now();

    function tick(now) {
      var t = (now - start) / 1000;

      // idle float — slow, independent of the pointer; two different
      // periods (6s / 9s) for x/y so the drift doesn't look mechanically
      // synced or repeat in an obvious loop
      var floatY = Math.sin((t * Math.PI * 2) / 6) * 5;
      var floatRy = Math.sin((t * Math.PI * 2) / 9) * 0.5;

      // cursor-follow — heavily damped so it trails the pointer rather
      // than tracking it directly, reading as inertia/weight
      curX += (targetX - curX) * 0.035;
      curY += (targetY - curY) * 0.035;

      // scroll parallax — only meaningful once the cluster is actually
      // in flow (the phone layout); position:fixed on desktop never
      // scrolls, so this stays at rest (0 / full opacity) there
      var scrollY = 0;
      var scrollOpacity = 1;
      if (mobileLayout && mobileLayout.matches) {
        var rect = cluster.getBoundingClientRect();
        var progress = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));
        scrollY = progress * -40;
        scrollOpacity = 1 - progress * 0.6;
      }

      var style = cluster.style;
      style.setProperty("--kc-x", (curX * 8).toFixed(2) + "px");
      style.setProperty("--kc-y", (curY * 6 + floatY + scrollY).toFixed(2) + "px");
      style.setProperty("--kc-rx", (-curY * 1.6).toFixed(3) + "deg");
      style.setProperty("--kc-ry", (curX * 2.2 + floatRy).toFixed(3) + "deg");
      style.opacity = scrollOpacity.toFixed(3);

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function buildAlphaMask(img) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = MASK_W;
      canvas.height = MASK_H;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, MASK_W, MASK_H);
      return ctx.getImageData(0, 0, MASK_W, MASK_H).data;
    } catch (e) {
      return null;
    }
  }

  function initKeychainCluster(host) {
    if (!host || host.dataset.kcInitialized) return;
    host.dataset.kcInitialized = "true";

    // A page that cares about first-paint speed (home.html) can hand-write
    // the full markup up front — real <img> tags the browser's own parser/
    // preload scanner discovers immediately, instead of waiting on this
    // script to run after DOMContentLoaded to create them. When that
    // markup is already there this just wires it up; otherwise it falls
    // back to building everything from scratch, so a bare
    // `<div class="keychain-cluster"></div>` still works as documented.
    var canvas = host.querySelector(".keychain-canvas");
    var prebuilt = !!canvas;
    if (!prebuilt) {
      canvas = document.createElement("div");
      canvas.className = "keychain-canvas";
      host.appendChild(canvas);
    }

    var bg = canvas.querySelector(".kc-bg");
    if (!bg) {
      bg = document.createElement("img");
      bg.className = "kc-bg";
      bg.fetchPriority = "high";
      bg.decoding = "async";
      bg.src = ASSET_BASE + "BG.webp";
      bg.alt = "";
      bg.setAttribute("aria-hidden", "true");
      bg.draggable = false;
      canvas.appendChild(bg);
    }

    var items = TAGS.map(function (tag) {
      var button = prebuilt ? canvas.querySelector('.kc-item[data-key="' + tag.key + '"]') : null;
      var img, glare;

      if (button) {
        img = button.querySelector(".kc-img");
        glare = button.querySelector(".kc-glare");
      } else {
        button = document.createElement("a");
        button.href = tag.href;
        button.className = "kc-item";
        button.dataset.key = tag.key;
        button.setAttribute("aria-label", tag.label);

        img = document.createElement("img");
        img.className = "kc-img";
        img.fetchPriority = "high";
        img.decoding = "async";
        img.src = ASSET_BASE + tag.file;
        img.alt = "";
        img.draggable = false;

        glare = document.createElement("span");
        glare.className = "kc-glare";
        glare.setAttribute("aria-hidden", "true");

        button.appendChild(img);
        button.appendChild(glare);
        canvas.appendChild(button);
      }

      // absolute URL: relative url()s inside a custom property resolve
      // against the stylesheet that consumes var(), not the one (or the
      // inline style) that set it — so a relative path here would 404.
      glare.style.setProperty("--mask-src", "url(\"" + new URL(ASSET_BASE + tag.file, document.baseURI).href + "\")");

      var entry = { key: tag.key, href: tag.href, button: button, img: img, glare: glare, alphaMask: null };

      function tryBuildMask() {
        entry.alphaMask = buildAlphaMask(img);
      }
      if (img.complete && img.naturalWidth) {
        tryBuildMask();
      } else {
        img.addEventListener("load", tryBuildMask, { once: true });
      }

      return entry;
    });

    // Reveal BG + all 4 tags together, once every one of them has actually
    // decoded — async decoding (deliberate, so it never blocks first
    // paint) means each image becomes paintable at its own moment, which
    // without this looked like the tags popping in one by one instead of
    // the cluster appearing as a single piece.
    var allImgs = [bg].concat(items.map(function (entry) { return entry.img; }));
    Promise.all(allImgs.map(function (img) {
      if (img.decode) return img.decode().catch(function () {});
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    })).then(function () {
      canvas.classList.add("kc-ready");
    });

    wireHeroMotion(host);

    // optional "you are here": set data-current-key="branding" (etc) on the
    // host when this component is embedded on one of the category pages,
    // and that tag keeps the persistent selection glow permanently.
    var currentKey = host.dataset.currentKey;
    if (currentKey) {
      var currentEntry = items.filter(function (entry) { return entry.key === currentKey; })[0];
      if (currentEntry) currentEntry.button.classList.add("is-selected");
    }

    // topmost (last in DOM / highest base z-index) checked first
    var hitOrder = items.slice().reverse();

    var hitLayer = canvas.querySelector(".kc-hitlayer");
    if (!hitLayer) {
      hitLayer = document.createElement("div");
      hitLayer.className = "kc-hitlayer";
      canvas.appendChild(hitLayer);
    }

    items.forEach(function (entry) {
      entry.button.style.pointerEvents = "none";
    });

    var maxTilt = isCoarsePointer() ? 6 : 9;
    // kept small: translateZ (combined with perspective) pushes every point
    // away from the canvas's vanishing point, not just visually "closer" —
    // too large a value drags the top attachment point/ring away from its
    // resting spot on the BG carabiner. This stays subtle so the anchor
    // barely moves.
    var translateZ = isCoarsePointer() ? 8 : 14;
    // constant forward lean: the top edge tips back (away from the viewer)
    // and the bottom edge tips forward, so perspective foreshortening makes
    // the bottom corners read as slightly wider — a subtle keystone/distort
    // rather than a flat tilt. Pointer Y only nudges this within a narrow
    // band that never crosses back to a "wider top" reading.
    var baseTiltX = isCoarsePointer() ? 6 : 10;
    var tiltXRange = isCoarsePointer() ? 1.5 : 3;
    var reducedMotion = prefersReducedMotion();
    var activeEntry = null;

    function setVars(el, vars) {
      Object.keys(vars).forEach(function (key) {
        el.style.setProperty(key, vars[key]);
      });
    }

    function applyTilt(entry, relX, relY) {
      if (reducedMotion) return;
      var nx = relX - 0.5;
      var ny = relY - 0.5;
      var ry = (nx * maxTilt * 2).toFixed(2) + "deg";
      var rx = (baseTiltX - ny * tiltXRange).toFixed(2) + "deg";
      var sx = (-nx * 22).toFixed(1) + "px";
      var sy = (16 - ny * 6).toFixed(1) + "px";

      setVars(entry.img, {
        "--rx": rx,
        "--ry": ry,
        "--tz": translateZ + "px",
        "--sx": sx,
        "--sy": sy,
        "--sb": "24px",
        "--sa": "0.42"
      });
      entry.glare.style.setProperty("--mx", (relX * 100).toFixed(1) + "%");
      entry.glare.style.setProperty("--my", (relY * 100).toFixed(1) + "%");
    }

    function resetTilt(entry) {
      setVars(entry.img, BASE_VARS);
    }

    function setActive(entry) {
      if (activeEntry === entry) return;
      if (activeEntry) {
        activeEntry.button.classList.remove("is-active");
        resetTilt(activeEntry);
      }
      activeEntry = entry;
      if (activeEntry) {
        activeEntry.button.classList.add("is-active");
      }
    }

    // Real navigation, not a synthetic click on the <a> — the hit-layer
    // sits on top of it for the alpha-precise hit test, so the browser
    // never sees the anchor itself as the click target. Modifier keys are
    // honored by hand so cmd/ctrl-click and middle-click still open a new
    // tab like a normal link would.
    function navigate(entry, e) {
      if (!entry || !entry.href) return;
      var newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
      if (newTab) {
        window.open(entry.href, "_blank", "noopener");
      } else if (window.navigateWithFade) {
        window.navigateWithFade(entry.href);
      } else {
        window.location.href = entry.href;
      }
    }

    function inFallbackBox(key, relX, relY) {
      var b = FALLBACK_BOXES[key];
      return !!b && relX >= b.x0 && relX <= b.x1 && relY >= b.y0 && relY <= b.y1;
    }

    function hitTest(relX, relY) {
      var mx = Math.min(MASK_W - 1, Math.max(0, Math.floor(relX * MASK_W)));
      var my = Math.min(MASK_H - 1, Math.max(0, Math.floor(relY * MASK_H)));
      var idx = (my * MASK_W + mx) * 4 + 3;
      for (var i = 0; i < hitOrder.length; i++) {
        var entry = hitOrder[i];
        if (entry.alphaMask) {
          if (entry.alphaMask[idx] > ALPHA_THRESHOLD) return entry;
        } else if (inFallbackBox(entry.key, relX, relY)) {
          return entry;
        }
      }
      return null;
    }

    function relativePoint(clientX, clientY) {
      var rect = hitLayer.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0.5, y: 0.5 };
      var x = (clientX - rect.left) / rect.width;
      var y = (clientY - rect.top) / rect.height;
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }

    // A physical mouse can fire pointermove far faster than the screen
    // actually redraws (up to 1000Hz on gaming mice vs. a 60/120Hz
    // display), and each call sets several CSS custom properties that
    // feed an animated filter/transform — so extra events arriving
    // within the same rendered frame get coalesced to one update. The
    // very first event of a frame is still applied immediately (not
    // queued for the next rAF tick), so the tilt starts reacting the
    // instant the pointer arrives instead of a frame later.
    var pendingPoint = null;
    var rafId = null;

    function applyPoint(point) {
      var hit = hitTest(point.x, point.y);
      if (hit) {
        setActive(hit);
        applyTilt(hit, point.x, point.y);
      } else {
        setActive(null);
      }
    }

    function flushPendingPoint() {
      rafId = null;
      if (!pendingPoint) return;
      var point = pendingPoint;
      pendingPoint = null;
      applyPoint(point);
    }

    function handlePointerMove(e) {
      var point = relativePoint(e.clientX, e.clientY);
      if (rafId === null) {
        applyPoint(point);
        rafId = requestAnimationFrame(flushPendingPoint);
      } else {
        pendingPoint = point;
      }
    }

    function handlePointerLeave() {
      pendingPoint = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      setActive(null);
    }

    hitLayer.addEventListener("pointerenter", handlePointerMove);
    hitLayer.addEventListener("pointermove", handlePointerMove);
    hitLayer.addEventListener("pointerdown", handlePointerMove);
    hitLayer.addEventListener("pointerleave", handlePointerLeave);
    hitLayer.addEventListener("pointercancel", handlePointerLeave);

    hitLayer.addEventListener("pointerup", function (e) {
      if (e.pointerType === "touch") {
        window.setTimeout(handlePointerLeave, 140);
      }
    });

    hitLayer.addEventListener("click", function (e) {
      var point = relativePoint(e.clientX, e.clientY);
      var hit = hitTest(point.x, point.y);
      if (hit) navigate(hit, e);
    });

    // middle-click fires "auxclick", not "click"
    hitLayer.addEventListener("auxclick", function (e) {
      if (e.button !== 1) return;
      var point = relativePoint(e.clientX, e.clientY);
      var hit = hitTest(point.x, point.y);
      if (hit) navigate(hit, e);
    });

    items.forEach(function (entry) {
      var button = entry.button;

      // No click listener needed here: pointer-events:none means mouse/
      // touch clicks never reach the anchor (the hit-layer above handles
      // those), and keyboard activation (Enter/Space on a focused <a
      // href>) is left to the browser's native default so modifier-key
      // combos for opening a new tab keep working as expected.

      button.addEventListener("focus", function () {
        if (button.matches(":focus-visible")) {
          setActive(entry);
          applyTilt(entry, 0.72, 0.28);
        }
      });

      button.addEventListener("blur", function () {
        if (activeEntry === entry) setActive(null);
      });
    });

    // Returning from a backgrounded tab/app switch: some browsers drop the
    // GPU compositor layer for elements in hidden tabs to save memory and
    // don't reliably repaint it on their own once the tab is visible again,
    // which otherwise leaves the hover transform/filter looking frozen
    // until something else forces a repaint. Clear any stale hover state
    // and nudge every tag's layer back into existence.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      setActive(null);
      items.forEach(function (entry) {
        resetTilt(entry);
        var el = entry.img;
        var prevWillChange = el.style.willChange;
        el.style.willChange = "auto";
        void el.offsetHeight; // eslint-disable-line no-void
        el.style.willChange = prevWillChange || "transform, filter";
        entry.alphaMask = buildAlphaMask(el);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var hosts = document.querySelectorAll(".keychain-cluster");
    hosts.forEach(function (host) {
      initKeychainCluster(host);
    });
  });

  window.initKeychainCluster = initKeychainCluster;
})();
