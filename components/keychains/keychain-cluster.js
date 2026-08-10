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
    // href: null switches a tag off — it still hangs and swings, but the
    // click handler below returns early on a tag with nowhere to go.
    // Others is off until it has projects; put "other.html" back to
    // restore it (see the note in index.html).
    { key: "star", file: "STAR-KC.webp", label: "Others — em breve", href: null },
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

  // Per-tag spring "personality" — mass/stiffness/damping give each
  // keychain its own natural frequency and settle time (heavier =
  // slower + less swingy, lighter = faster + livelier); sensitivity is
  // how much of the shared cursor-follow "backpack sway" each one
  // picks up; idle* seeds a small continuous drift so nothing ever
  // looks perfectly frozen; kick is the entrance swing's initial
  // velocity (deg/s) and its sign, so the four don't swing out in
  // unison. Damping sits a little under critical for each one (see the
  // integration in wireHeroMotion) — enough for one small, natural
  // overshoot while settling, not a repeating bounce.
  //
  // Stiffness/damping run roughly 2x/1.4x their original values (same
  // damping *ratio*, just a higher natural frequency) — at the old,
  // gentler numbers each tag took long enough to catch up to the
  // cluster's own cursor-follow signal that the hero read as several
  // independently-lagging pieces instead of one object responding to
  // the cursor together. Tightening the response is what brings that
  // "everything shifts together" feel back while keeping each tag's
  // own relative character (still four different speeds/weights).
  var SPRINGS = {
    web: { mass: 1.05, stiffness: 60, damping: 10.5, sensitivity: 2.1, idleAmp: 0.4, idlePeriod: 5.4, idlePhase: 0.6, kick: 6, entryDelayMs: 50 },
    star: { mass: 0.9, stiffness: 68, damping: 9.3, sensitivity: 2.5, idleAmp: 0.45, idlePeriod: 4.7, idlePhase: 2.1, kick: -7, entryDelayMs: 160 },
    branding: { mass: 1.4, stiffness: 42, damping: 11, sensitivity: 1.5, idleAmp: 0.3, idlePeriod: 6.6, idlePhase: 3.4, kick: 4.5, entryDelayMs: 270 },
    social: { mass: 0.72, stiffness: 84, damping: 8.5, sensitivity: 2.9, idleAmp: 0.5, idlePeriod: 3.9, idlePhase: 1.2, kick: -8.5, entryDelayMs: 380 }
  };

  /**
   * Ambient motion for the whole cluster and hinge physics for each
   * individual tag.
   *
   * The cluster itself gets a gentle idle float (never reads as
   * perfectly inert) and a spring-driven cursor-follow reaction — the
   * "carabiner" being nudged by the mouse, with real inertia (it
   * accelerates in, carries a touch past the target, eases back) rather
   * than a flat lerp that only ever trails the pointer. Each tag is
   * then its OWN damped spring hanging off that same carabiner signal,
   * rotating around its own ring (see the per-tag transform-origin in
   * keychain-cluster.css) rather than in lockstep — the hover force
   * propagates carabiner → each tag, so the whole assembly reacts as
   * one connected system, just not identically (each tag's own
   * mass/stiffness/damping still gives it a different lag, overshoot,
   * and settle time). On the phone layout (in normal flow, unlike
   * desktop's fixed position) the cluster also gets a scroll parallax
   * as it scrolls past.
   *
   * One continuous rAF loop drives all of it, recomputing and
   * integrating every frame — that per-frame physics is what gives the
   * motion weight/inertia instead of a mechanical snap to target.
   * Skipped entirely under reduced motion.
   */
  function wireHeroMotion(cluster, items) {
    if (prefersReducedMotion()) {
      return { kick: function () {} };
    }

    var coarse = isCoarsePointer();
    var mobileLayout = window.matchMedia && window.matchMedia("(max-width: 600px)");

    var targetX = 0;
    var targetY = 0;
    // The carabiner's own reaction to the cursor — a real damped spring
    // (mass 1), not a flat exponential lerp. A lerp always eases
    // monotonically toward its target and can never overshoot, so the
    // "whole assembly" responding to the cursor never actually had any
    // momentum of its own — it just trailed the pointer a beat late.
    // A spring gives it genuine inertia instead: it accelerates into
    // the motion, carries slightly past the target, and eases back —
    // "someone nudged the bag" rather than "this value chases the
    // mouse." Every tag's own sway (below) is driven off this same
    // signal, so its livelier motion propagates through the whole
    // group instead of staying isolated to the cluster shell.
    var CARABINER_STIFFNESS = 36;
    var CARABINER_DAMPING = 8.2;
    var carX = { pos: 0, vel: 0 };
    var carY = { pos: 0, vel: 0 };

    if (!coarse) {
      window.addEventListener("pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        targetX = (e.clientX / window.innerWidth) * 2 - 1;
        targetY = (e.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
    }

    var tags = items.map(function (entry) {
      var cfg = SPRINGS[entry.key] || SPRINGS.web;
      return {
        key: entry.key,
        el: entry.button,
        mass: cfg.mass,
        stiffness: cfg.stiffness,
        damping: cfg.damping,
        sensitivity: cfg.sensitivity,
        idleAmp: cfg.idleAmp,
        idlePeriod: cfg.idlePeriod,
        idlePhase: cfg.idlePhase,
        kick: cfg.kick,
        entryDelayMs: cfg.entryDelayMs,
        angle: 0,
        velocity: 0
      };
    });

    var start = performance.now();
    var last = start;

    function tick(now) {
      var t = (now - start) / 1000;
      // clamp so a dropped frame (tab backgrounded, etc.) can't jolt
      // the spring integration with a huge one-off dt
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // idle float — slow, independent of the pointer; two different
      // periods (6s / 9s) for x/y so the drift doesn't look mechanically
      // synced or repeat in an obvious loop. On the phone layout the
      // cluster sits in normal flow right above the intro text (not off
      // in a fixed corner), so the same amplitude reads as more
      // noticeable there — toned down a bit for mobile only.
      var mobileMotion = mobileLayout && mobileLayout.matches;
      var idleScale = mobileMotion ? 0.6 : 1;
      var floatY = Math.sin((t * Math.PI * 2) / 6) * 5 * idleScale;
      var floatRy = Math.sin((t * Math.PI * 2) / 9) * 0.5 * idleScale;

      // carabiner spring integration (semi-implicit Euler, same pattern
      // as each tag's own spring below) — this is the "backpack" sway
      // the individual keychains react to in turn
      var carAccelX = (-CARABINER_STIFFNESS * (carX.pos - targetX) - CARABINER_DAMPING * carX.vel);
      carX.vel += carAccelX * dt;
      carX.pos += carX.vel * dt;
      var carAccelY = (-CARABINER_STIFFNESS * (carY.pos - targetY) - CARABINER_DAMPING * carY.vel);
      carY.vel += carAccelY * dt;
      carY.pos += carY.vel * dt;
      var curX = carX.pos;
      var curY = carY.pos;

      // scroll parallax — only meaningful once the cluster is actually
      // in flow (the phone layout); position:fixed on desktop never
      // scrolls, so this stays at rest (0 / full opacity) there
      var scrollY = 0;
      var scrollOpacity = 1;
      if (mobileMotion) {
        var rect = cluster.getBoundingClientRect();
        var progress = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));
        scrollY = progress * -40 * idleScale;
        scrollOpacity = 1 - progress * 0.6;
      }

      // Multipliers scaled up from the original lerp-driven values now
      // that curX/curY have real spring dynamics behind them — clearly
      // noticeable movement across the whole shell without tipping into
      // exaggerated territory.
      var style = cluster.style;
      style.setProperty("--kc-x", (curX * 13).toFixed(2) + "px");
      style.setProperty("--kc-y", (curY * 9 + floatY + scrollY).toFixed(2) + "px");
      style.setProperty("--kc-rx", (-curY * 2.3).toFixed(3) + "deg");
      style.setProperty("--kc-ry", (curX * 3.2 + floatRy).toFixed(3) + "deg");
      style.opacity = scrollOpacity.toFixed(3);

      // each keychain: a damped spring (semi-implicit Euler) chasing a
      // target that's the shared backpack sway plus its own tiny idle
      // drift — never a flat 0, so nothing ever looks perfectly frozen
      for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        var idle = Math.sin((t * Math.PI * 2) / tag.idlePeriod + tag.idlePhase) * tag.idleAmp;
        var target = curX * tag.sensitivity + idle;
        var force = -tag.stiffness * (tag.angle - target) - tag.damping * tag.velocity;
        var accel = force / tag.mass;
        tag.velocity += accel * dt;
        tag.angle += tag.velocity * dt;
        tag.el.style.setProperty("--kc-sway", tag.angle.toFixed(3) + "deg");
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

    return {
      // Entrance swing: a small initial velocity per tag (opposing
      // signs and staggered to roughly match each one's own opacity
      // entrance delay in CSS, so the swing is visible as it appears
      // rather than half-finished by the time it fades in) — the same
      // spring integration above then carries it into a natural,
      // one-and-done swing that settles on its own.
      kick: function () {
        tags.forEach(function (tag) {
          window.setTimeout(function () {
            tag.angle = 0;
            tag.velocity = tag.kick;
          }, tag.entryDelayMs);
        });
      }
    };
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

    // A page that cares about first-paint speed (index.html) can hand-write
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

    var heroMotion = wireHeroMotion(host, items);

    // Reveal sequence, once every image has actually decoded — async
    // decoding (deliberate, so it never blocks first paint) means each
    // one becomes paintable at its own moment, which without a shared
    // "everything is ready" gate looked like a random pop-in race.
    // kc-ready fades the carabiner in first, then each tag "attached"
    // shortly after with its own stagger (see keychain-cluster.css);
    // kick() sets off each tag's entrance swing on that same stagger.
    // The intro text used to wait out a long settle timer before
    // fading in on its own, well after the keychain — now it's cleared
    // to fade in at the very same moment, so the two entrances read as
    // one single arrival instead of the hero appearing and the text
    // catching up a beat later. Its own CSS transition (see .info-box
    // in page.css) still carries the actual fade/rise, so it isn't
    // instant, just no longer delayed.
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
      heroMotion.kick();
      document.body.classList.add("kc-settled");
    });

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
