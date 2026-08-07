# Chrome Web Store listing

Copy-paste source for the Chrome Web Store Developer Dashboard. Every claim in
this file is verified against the code and the generated manifest
(`apps/extension/build/chrome-mv3-prod/manifest.json`). Update this file first
when permissions or behavior change, then update the dashboard.

Item name (from manifest): **Inspector Lab - DevTools**
Version: 0.1.0
Category: **Developer Tools**
Language: English

---

## Store listing tab

### Summary (max 132 characters, comes from the manifest description)

> A movable in-page DevTools window for any browser, even iPad: DOM Inspector,
> Elements, Console, Network, Sources, Cookies, Storage.

131 characters. Must match the `description` in
`apps/extension/package.json`, which Plasmo writes into the manifest.

### Description

Plain text, the dashboard does not render markdown. Paste as-is:

```
Inspector Lab - DevTools puts a real DevTools window inside the page itself: a movable, resizable, dockable DOM Inspector with Elements, Console, Network, Sources, Cookies, and Storage panels. It works anywhere a browser can run extensions, including browsers that have no built-in DevTools at all, such as Orion on iPad and iPhone.

WHY INSTALL IT

Native DevTools live in a separate panel and simply do not exist on most mobile browsers. Inspector Lab injects the whole toolset into the page you are looking at, so you can debug on an iPad, inspect a site on a machine where you cannot open the browser's own tools, or keep a compact inspector floating over your app while you work. It stays on the page across reloads until you close it, and it never runs anywhere until you click it.

WHAT IT DOES

- Elements: a live DOM Inspector. Pick and highlight elements on the page, inspect the DOM tree, edit HTML attributes and text directly in the tree, edit inline CSS with validation, force element states (hover, active, focus, visited), and read computed styles with a box-model diagram.
- Console: captures the page's console output (log, warn, error, and friends) with values colored by type and file:line source links, and evaluates JavaScript expressions you type, in the page's own context.
- Network: records requests live as the page makes them, with method, status, type, timing, headers, and fetch/XHR request and response bodies in a DevTools-style details pane.
- Sources: lists the page's scripts and stylesheets in a collapsible tree and loads any file's content on demand for reading, with syntax highlighting for HTML, CSS, and JavaScript.
- Cookies: view, edit, add, and delete the cookies for the site you are inspecting.
- Storage: view and edit localStorage and sessionStorage in place.
- Window management: drag it, resize it, dock it to any edge of the viewport, or let it float. Light and dark themes, plus an optional classic Chrome DevTools look.

PRIVATE BY DESIGN

The inspector activates only when you click the extension icon on a tab, using the activeTab permission, so it has no standing access to your browsing. Site access for the cookies panel and for staying attached across reloads is optional and requested per site, only when you ask for it. Everything you inspect stays in your browser: the extension has no server, sends no data anywhere, and collects nothing.

OPEN SOURCE

MIT licensed. Source code, feature tour, and issue tracker: https://github.com/luangjokaj/dev-inspector
```

### Assets to upload in the dashboard (not in the repo)

- Store icon: 128x128 PNG (the build already ships `icon128`, reuse the source
  asset from `apps/extension/assets/`).
- Screenshots: 1 to 5, each 1280x800 or 640x400 PNG/JPEG, no transparency.
  Suggested shots: elements panel with box model, console, network details
  pane, cookies panel, the inspector docked on an iPad.
- Small promo tile (optional): 440x280.
- Marquee promo tile (optional): 1400x560.
- Homepage URL: https://github.com/luangjokaj/dev-inspector
- Support URL: https://github.com/luangjokaj/dev-inspector/issues

---

## Privacy tab

### Single purpose description

> Inspector Lab - DevTools has a single purpose: in-page developer tools. It
> injects a DevTools-style inspector window into the tab the user activates it
> on, so the user can inspect and debug that page (elements and styles,
> console, network requests, sources, cookies, and storage) directly inside
> the page, including on browsers that have no native DevTools.

### Permission justifications

**activeTab**

> The inspector is injected only into the tab where the user clicks the
> extension's toolbar popup and presses the launch button. activeTab grants
> that one tab, on that user gesture, without any standing host access. This
> is the extension's only entry point; it never runs on a page the user did
> not explicitly activate it on.

**scripting**

> Used with the access granted by activeTab (or an optional per-site grant) to
> do three things: inject the packaged inspector UI bundle into the active
> tab, re-register that injection as a content script on origins the user has
> explicitly granted so the inspector survives page reloads until closed, and
> run console-expression evaluation and page-side helpers in the page context.
> All injected code ships inside the extension package.

**storage**

> chrome.storage.local stores the user's UI settings only: theme choice
> (light/dark/system) and the classic-DevTools-style toggle, so the popup and
> the injected inspector share them. chrome.storage.session keeps per-tab
> runtime state (which tabs have an open inspector and their headers-only
> network log) so the inspector and its network panel survive a page reload.
> No browsing history or page content is persisted.

**cookies**

> Powers the Cookies panel: listing, editing, adding, and deleting the cookies
> of the site currently being inspected, the same workflow as the Application
> panel in native DevTools. chrome.cookies is only usable after the user
> grants the optional per-site host permission from inside the inspector, and
> cookie data is only displayed in the panel on that page; it is never
> transmitted or stored by the extension.

**webRequest**

> Powers the Network panel: observing requests of the inspected tab to record
> method, URL, status, timing, and request/response headers, exactly what the
> Network panel displays. Observation is passive (no blocking, no
> modification), scoped to tabs where the inspector is open, and the log lives
> in session storage only, cleared when the tab closes or the inspector is
> dismissed.

**Optional host permissions (`http://*/*`, `https://*/*`)**

> Requested at runtime, per origin, on a user gesture inside the inspector,
> never at install time. A per-site grant enables exactly two features on that
> site: the Cookies panel (chrome.cookies requires host permission for the
> cookie's URL) and persistence across reloads (re-injecting the inspector
> after navigation, plus a background fetch fallback so the Sources panel can
> display a file's text when the page's CORS policy blocks reading it from the
> page). Users who never grant a site still get the full inspector for the
> current page load via activeTab.

### Are you using remote code?

**No.** Justification, if the form asks for one:

> All executable code ships inside the extension package. The extension never
> downloads, evaluates, or injects code from a server. Two features are
> adjacent but are not remote code: (1) the Console panel evaluates
> expressions the user types, in the inspected page's own JavaScript context,
> equivalent to the native DevTools console; the input is authored by the
> user, not fetched from anywhere. (2) The Sources panel fetches a page's own
> script/stylesheet files as plain text, exclusively to display them
> read-only; the fetched text is never executed.

### Data usage disclosures

Check **none** of the data-type boxes. The extension collects no data:

- No data leaves the browser. There is no backend, no analytics, no telemetry,
  no error reporting, and no network calls except the user-initiated,
  display-only source-file fetches described above.
- Everything the inspector shows (DOM, console output, network headers and
  bodies, cookies, storage) is read locally and rendered in-page only.
- The only persisted values are UI preferences (theme toggles) in
  chrome.storage.local and ephemeral per-tab state in chrome.storage.session.

Certifications at the bottom of the tab, all three apply, check them:

- [x] I do not sell or transfer user data to third parties, outside of the
      approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to
      my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for
      lending purposes

### Privacy policy URL

Not strictly required while no user data is collected, but the field is
recommended and some reviews ask for it since the extension can read sensitive
page data (cookies, request bodies) locally. Easiest path: add a short
`PRIVACY.md` to the repo stating the above ("all inspection is local, nothing
is collected or transmitted") and link its GitHub URL here.

---

## Other dashboard requirements (verify before submitting)

- **Account tab**: developer contact email must be set and verified, and 2FA
  enabled on the Google account.
- **Distribution tab**: visibility (Public), regions (all), free of charge.
- **Content rating / mature content**: none, the item contains no mature
  content.
- **Manifest sanity** (verified against the current prod build): MV3,
  permissions are exactly `activeTab`, `cookies`, `scripting`, `storage`,
  `webRequest`, plus `optional_host_permissions` for http/https. No
  `host_permissions`, no content scripts declared at install time, no
  `remotely hosted code`, service worker + popup only.
- Rebuild before packaging so the manifest picks up the current description:
  `pnpm build`, then `pnpm --filter @inspector-lab/extension package` (or zip
  `apps/extension/build/chrome-mv3-prod`).
