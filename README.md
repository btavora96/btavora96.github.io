# Bárbara Távora — Portfolio

Static site. No framework, no build step, no dependencies: the files in
this repository *are* the site.

## Running it locally

Double-click **`abrir-site.command`**.

This matters, and is not the same as opening `home.html` directly. A page
opened from the filesystem is treated by Chrome as its own isolated
origin, and is not allowed to read the next page's document — which is
what the scroll transition between categories depends on. Opened that
way the transition still works, but falls back to a full page load and
feels markedly slower. Served, it swaps the page in with no reload at
all. Published, the site is served anyway.

## Structure

```
home.html              keychain cluster navigation
branding.html          10 projects
social.html             5 projects
webdesign.html          6 projects
other.html              placeholder, no projects yet

page.css               home only
category-page.css      the four category pages
transition.css / .js   page-to-page fade, shared by all five

category-page.js       gallery: scroll focus effect, snap alignment,
                       floating description panel, carousels
page-transition.js     scroll-linked navigation between categories
components/keychains/  the home page's keychain simulation
```

Each project's description is stored **twice** — in the figure's
`data-description` attribute, which the desktop panel reads, and in the
`<p class="gallery-subtitle">` inside the figcaption, which is what a
phone shows. Only one is visible at a time, so they drift apart easily:
change both. Paragraph breaks are written as `&#10;&#10;` rather than as
real line breaks, so the file's indentation can't leak into the rendered
text.

## Before publishing

- **`favicon.svg`** is a solid circle in `#D85888`, the pink sampled
  from the Branding keychain on the home page.
- **Canonical URLs and the sitemap assume `https://barbaratavora.com`.**
  If the domain differs, update `sitemap.xml`, `robots.txt` and the
  `canonical`/`og:url`/`og:image` tags in the five HTML files.
- **Filenames with accents must stay NFC-normalised.** macOS stores them
  decomposed by default, and Linux servers do not treat the two as the
  same file — three images were already unreachable this way. If you add
  an asset whose name has an accent, confirm the page still finds it once
  served, not just locally.
- **`.git` is large** (~245 MB) because the image history is in it. A
  fresh repository, or a history rewrite, will push far more comfortably.

## Videos

Three MP4s total roughly 20 MB and are set to `preload="none"`; they
start downloading only when scrolled into view. There is no poster
frame, so a slow connection shows the space before the first frame
arrives.
