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

  function markReady() {
    document.body.classList.add("page-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markReady);
  } else {
    markReady();
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
