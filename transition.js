/**
 * Universal page-fade transition — plain opacity crossfade driven entirely
 * by this script, so it works the same in every browser instead of relying
 * on the Chromium-only View Transitions API. Fades the current page in on
 * load, and fades it out before following any same-origin link (including
 * the keychain cluster's own navigation, via window.navigateWithFade).
 */
(function () {
  "use strict";

  var FADE_OUT_MS = 160;
  var MAX_READY_WAIT_MS = 2000;

  // page-transition.js hands off to a real navigation when it can't swap
  // a page in place, and marks the destination so it knows this is the
  // end of a movement rather than the start of a visit. Read
  // synchronously — the flag has to be in place before the first paint,
  // and stripped from the URL only once the page has settled, so
  // anything else reading it still can.
  var ARRIVAL_FLAG = "pt-in";
  var arrival = new RegExp("(^|#)" + ARRIVAL_FLAG + "(=|$)").test(location.hash);
  if (arrival) document.documentElement.classList.add("pt-arrival");

  function markReady() {
    document.body.classList.add("page-ready");
  }

  function domReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  // Reveal only once body's own CSS background-image (the full-bleed page
  // photo on home.html; most pages don't set one) has actually decoded —
  // otherwise DOMContentLoaded fires first, the page fades in over a
  // plain background-color, and the photo pops in separately a moment
  // later instead of the page appearing whole.
  function bodyBackgroundReady() {
    var bg = getComputedStyle(document.body).backgroundImage;
    var match = /url\(["']?(.*?)["']?\)/.exec(bg);
    if (!match || !match[1]) return Promise.resolve();
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = match[1];
    });
  }

  // Deferred scripts run early enough that everything above can resolve
  // before the browser has painted even once — and a transition applied
  // to a document that hasn't been drawn yet has already finished by the
  // time it is. Which is precisely how a fade turns back into a cut.
  // Waiting out a frame puts the reveal after the first paint, so there
  // is something on screen for it to happen to.
  function afterFirstPaint() {
    if (!arrival) return Promise.resolve();
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }

  Promise.race([
    Promise.all([domReady(), bodyBackgroundReady()]).then(afterFirstPaint),
    new Promise(function (resolve) { window.setTimeout(resolve, MAX_READY_WAIT_MS); })
  ]).then(markReady);

  // The flag has done its job by now; leaving it behind would put it in
  // the address bar and in any link the reader copies from it.
  if (arrival) {
    window.addEventListener("load", function () {
      history.replaceState(history.state, "", location.pathname + location.search);
    });
  }

  // bfcache restore (native browser back/forward, as opposed to clicking
  // our own links): the page can come back exactly as it was left,
  // mid-fade-out with the body still invisible — put it back to visible.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      document.body.classList.remove("page-leaving");
      markReady();
    }
  });

  function isPlainLeftClick(e) {
    return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  }

  function sameOriginNavigableHref(a) {
    if (!a || !a.getAttribute("href")) return null;
    if (a.target && a.target !== "" && a.target !== "_self") return null;
    if (a.hasAttribute("download")) return null;
    var url;
    try {
      url = new URL(a.href, document.baseURI);
    } catch (e) {
      return null;
    }
    if (url.origin !== location.origin) return null;
    if (url.pathname === location.pathname && url.hash) return null; // same-page anchor
    return url.href;
  }

  function navigateWithFade(href) {
    document.body.classList.remove("page-ready");
    document.body.classList.add("page-leaving");

    var done = false;
    function go() {
      if (done) return;
      done = true;
      window.location.href = href;
    }

    document.body.addEventListener("transitionend", go, { once: true });
    // belt-and-suspenders: never leaves the click hanging if the
    // transition doesn't fire (reduced motion, a dropped frame, etc.)
    window.setTimeout(go, FADE_OUT_MS + 100);
  }

  document.addEventListener("click", function (e) {
    if (!isPlainLeftClick(e) || e.defaultPrevented) return;
    var a = e.target.closest && e.target.closest("a[href]");
    var href = sameOriginNavigableHref(a);
    if (!href) return;
    e.preventDefault();
    navigateWithFade(href);
  });

  window.navigateWithFade = navigateWithFade;
})();
