# Changelog

All notable changes to Inspector Lab - DevTools are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-09

### Added

- **Diagnostics log, viewable from the popup.** Uncaught extension errors from
  the background worker, the popup, and the injected inspector are recorded in
  a local ring buffer (last 100 entries, `chrome.storage.local`, never
  transmitted anywhere), with copy and clear buttons in a new popup section —
  a readable crash trail on devices with no console, like Orion on iPad.
- **Session tombstones.** Inspector sessions that end without a clean close
  (browser exit, page crash, or an OS memory kill) are detected at the next
  service-worker start and logged to the diagnostics log with their origin.
- **Standalone SVG document support.** The inspector now launches on SVG files
  opened directly in a tab (previously it failed with "injected but did not
  start"). On non-HTML documents the UI mounts inside a viewport-aligned
  `<foreignObject>` overlay and renders in its own iframe, sidestepping
  WebKit's foreignObject repaint bugs (observed on Orion for iPad).
- **SVG elements are first-class in the Elements panel**: selectable from the
  tree and the picker, with attribute editing, inline-style editing, matched
  rules, and forced states working on them like on HTML elements.
- **Disabled tabs for unavailable panels.** Panels that cannot work on the
  current page render as greyed-out tabs with a "Not available on this page"
  tooltip instead of opening empty: Cookies on non-http(s) pages, Storage
  where the document blocks storage access.
- **Copy element from the tree.** Hovering the selected row in the Elements
  panel reveals a copy button (styled like the Styles pane's row actions) that
  copies the element's complete outerHTML to the clipboard, with the
  inspector's own nodes stripped and a checkmark confirmation.
- **Report an issue and Docs links in the popup.** Two labeled icon links on
  the Diagnostics row open the GitHub new-issue page and the documentation
  site in a new tab — rendered as real anchors so they open reliably from
  the popup on every browser.

## [0.1.0] - 2026-08-08

Initial public release, live on the
[Chrome Web Store](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle).

### Added

- **In-page inspector window**: movable, resizable from any edge or corner,
  dockable to the bottom, left, or right with a draggable split, launched from
  the toolbar popup with `activeTab` (no standing permission to read every
  site). Single instance per page, survives reloads until closed, and
  remembers the last panel per site.
- **Elements panel**: live DOM tree with hover highlighting, element picker,
  in-place DOM editing (attributes, tag text), DevTools-style Styles pane with
  matched rules, CSS authoring and validation, forced element states
  (`:hover`, `:focus`, ...) with per-state authored CSS, Computed pane with
  box-model diagram, DOM search, and breadcrumbs.
- **Console panel**: page log capture (`log`, `info`, `warn`, `error`,
  `debug`) over an unguessable per-launch channel, capture from
  `document_start` on granted origins, expression evaluation in the page
  context, type-colored values, `file:line` source links, filtering, and
  iOS Smart Punctuation straightening for iPad keyboards.
- **Sources panel**: collapsible file tree of the document, stylesheets, and
  scripts with syntax highlighting; external files fetched on demand; source
  links from the Styles pane jump straight to the owning file.
- **Network panel**: live fetch/XHR capture with headers, bodies, status, and
  timing; webRequest-backed headers for documents, styles, images, and fonts;
  Performance-timeline backfill; DevTools-style type filters.
- **Cookies panel**: full cookie table with in-place editing (including
  `HttpOnly` and `Secure`), add, delete, and clear, scoped per site or, behind
  an explicit opt-in, all sites.
- **Storage panel**: localStorage and sessionStorage viewing and editing.
- **Theming**: branded and Chrome-native looks, light and dark, following the
  OS or an explicit choice from the popup.
- **Reduced-API browser support** (Orion on iOS/iPadOS): page-bridge fallbacks
  for evaluation and capture, graceful degradation when extension APIs or the
  background are unavailable, and an error boundary so a single missing API
  cannot take the whole window down.
