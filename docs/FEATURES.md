# Inspector Lab — Features

Inspector Lab is a movable, resizable devtools window that lives directly on the page you are inspecting, built as a Manifest V3 Chrome extension. It renders inside an isolated Shadow DOM with React and the Cherry design system, and follows Chrome DevTools conventions closely enough that your muscle memory just works.

## Launching and window management

- **One-click launch** from the toolbar popup. Access uses `activeTab`, granted by your click — no standing permission to read every site.
- **Single instance**: relaunching on a page reveals the existing inspector instead of duplicating it; closing hides it, keeping your state.
- **Survives reloads**: once open, the inspector comes back automatically after every reload (and navigation, where permissions allow) until you close it with X — the same "stays open until dismissed" behavior as DevTools itself. Fully reliable on sites where the per-site permission was granted; same-origin reloads generally work even without it.
- **Per-site panel memory**: the inspector reopens on the panel you last used on that site — Console on one site, Network on another — remembered for the browser session, never mixed across sites.
- **Floating or docked**: drag the window anywhere from its toolbar, resize from any edge or corner, or dock it to the bottom, left, or right of the viewport with a draggable split — the same dock modes DevTools offers.
- **Keyboard-resizable** dock splits and a picker you can cancel with Escape.

## Elements

- Live DOM tree of the host page with hover highlighting painted over the real elements.
- **Element picker**: point at anything on the page to select it; the tree expands and scrolls to the picked element, and the inspector's own UI is never pickable.
- **Styles pane**: matched stylesheet rules with the winning rules on top, plus inline CSS editing — apply validated property/value pairs to the selected element or remove them.
- **Force element state**, like DevTools' `:hov` panel: check `:active`, `:hover`, `:focus`, `:focus-visible`, or `:focus-within` and the page's own rules for that state apply to the selected element immediately (same-origin stylesheets; cross-origin sheets are counted but unreadable).
- **Per-state CSS authoring**: add and remove your own declarations for any of those states. They apply while the state is forced and on real interaction, without ever touching the page's own stylesheets or DOM attributes.
- **Source links**: every matched rule names its stylesheet, and clicking it jumps to that file in the Sources panel.
- **Computed pane** with a DevTools-style box-model diagram (margin / border / padding / content) and a filterable list of common computed styles.
- Breadcrumb trail of the selected element's ancestry in the status bar.
- The page's `<body>` is selected at launch so no panel ever starts empty.

## Console

- **Captures page logs** — `console.log`, `info`, `warn`, `error`, and `debug` — by wrapping the console in the page's main world. Entries stream over an unguessable per-launch event channel that page scripts cannot spoof or eavesdrop.
- **Capture from time zero**: on sites where the per-site permission was granted, the wrapper installs at `document_start` before any page script runs, so after a reload the feed includes everything from page boot — early logs are buffered and replayed the moment the inspector opens. Elsewhere, capture starts when the inspector launches.
- **Evaluate expressions** in the page's own JavaScript context from the prompt, with DevTools-style `›` input and `‹` result rows.
- Filter by text or level, clear the feed, and rely on the same 1,000-entry cap DevTools uses.
- Honest about limits: sites whose Content Security Policy blocks `eval` will say so instead of failing silently.

## Sources

- **Collapsible file tree** of the page's document, stylesheets, and scripts, organized by host and URL folder like DevTools' navigator.
- Inline `<style>`/`<script>` content renders in a read-only editor pane.
- **External files load on click**: opening a stylesheet or script fetches its text — never before, and never with credentials. The fetch runs with the page's own authority first (usually straight from the HTTP cache), falling back to the extension's host grants for hosts that block cross-origin reads.
- Clicking a rule's stylesheet name in the Elements panel opens the file here, expanding and scrolling the tree to it.
- Guardrails against pathological pages (60 KB / 2,000-line caps per file, truncation flagged in the status bar).

## Network

- Request table built from the browser's Performance timeline: name, status, type, transfer size, and duration for the document and every resource it loaded.
- Type filters matching DevTools' toolbar: Fetch/XHR, Doc, CSS, JS, Font, Img, Other.
- Cached responses are marked, and failed statuses are colored like DevTools.

## Cookies

- Full cookie table for the current site — or every domain in the profile, behind an explicit all-sites permission you can decline.
- **Edit in place, like DevTools**: double-click to change name, value, domain, path, expiry (ISO date or "Session"), or SameSite; double-click the HttpOnly / Secure flags to toggle them. `HttpOnly` cookies are editable because the extension operates at browser level, exactly like DevTools.
- **Add cookies** with a draft row (host-only, path `/`, session by default) and **delete** per row, or **clear** everything the site can see in one click — never the whole browser profile.
- Writes are validated before they happen: RFC 6265 name characters, the 4 KB size limit, `SameSite=None` requiring `Secure`, and the `__Host-` / `__Secure-` prefix rules all produce clear messages instead of silent failures. Renames are transactional — if writing the replacement fails, the original cookie is restored.
- Permission model: reading and editing this site's cookies needs a one-time per-site grant; anything beyond the current site requires the explicit all-sites grant.

## Storage

- Local Storage and Session Storage tables for the page's origin, with filtering and per-entry size totals.
- **Edit keys and values inline** (double-click), **add entries** with a draft row, **delete** per row, or **clear** an area — all instant, since the inspector shares the page's origin.
- Quota and access failures surface in an error bar instead of disappearing.

## Theming

- The inspector mirrors Chrome DevTools' own look by default — light and dark, following your OS preference live.
- Prefer the extension's own branding? Flip **"Use custom inspector theme"** in the popup and the inspector reskins to Inspector Lab's teal-and-amber palette, derived entirely from the same design tokens as the popup. The switch applies live to an open inspector and is remembered.
- The popup itself has its own light/dark toggle.

## Privacy and security posture

- No standing host permissions: page access rides on `activeTab`, cookie access is granted per site (or explicitly for all sites), and both are requested only when you act.
- The UI lives in a Shadow DOM and never modifies the host page's storage, classes, or theme state.
- Every cookie write round-trips through the background service worker, which independently re-validates the sender, payload shape, and permission scope — the panel's checks are UX, not the security boundary.
- Console capture and evaluation run with the same authority page scripts already have; no extension APIs leak into the page.

## Current boundaries

- Console capture from page boot requires the per-site grant and kicks in from the first reload after launch; without the grant, history starts when the inspector opens.
- Network rows come from the Performance timeline, so request/response headers and bodies are not captured.
- Cross-origin iframe contents and protected pages (`chrome://`, the Web Store) are out of reach.
- Pages whose CSP blocks `eval` disable console evaluation (browser DevTools can bypass CSP; an in-page inspector cannot).
- Forcing an element state re-applies rules from same-origin stylesheets only; cross-origin sheets cannot be read, so their `:hover`/`:focus` styling is skipped.
