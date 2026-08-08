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

- Elements: a live DOM Inspector. Pick and highlight elements on the page, inspect the DOM tree, edit HTML attributes and text directly in the tree, author inline CSS the DevTools way (tap a property or value to edit in place, tap empty space to add a declaration, switch declarations off without deleting them — all validated), force element states (hover, active, focus, visited), and read computed styles with a box-model diagram.
- Console: captures the page's console output (log, warn, error, and friends) with values colored by type and file:line source links, and evaluates JavaScript expressions you type, in the page's own context.
- Network: records requests live as the page makes them, with method, status, type, timing, headers, and fetch/XHR request and response bodies in a DevTools-style details pane.
- Sources: lists the page's scripts and stylesheets in a collapsible tree and loads any file's content on demand for reading, with syntax highlighting for HTML, CSS, and JavaScript.
- Cookies: view, edit, add, and delete the cookies for the site you are inspecting.
- Storage: view and edit localStorage and sessionStorage in place.
- Window management: drag it, resize it, dock it to any edge of the viewport, or let it float. Light and dark themes, plus an optional classic Chrome DevTools look.

INSTALLING ON IPAD AND IPHONE

Orion by Kagi (free on the App Store) is the browser that makes this work on iOS and iPadOS: it installs Chrome Web Store extensions directly, so this listing is the install. Once:

1. Open the ••• menu and choose Settings.
2. Scroll to the Extensions group and turn on Chrome extensions.
3. Reopen the ••• menu, tap Extensions, tap the + button, and install Inspector Lab - DevTools from the Chrome Web Store.

Orion's extension support on iOS and iPadOS is still in beta, and Apple limits which extension APIs any browser may offer there. The inspector is built for that gap: panels fall back to in-page sources when an extension API is missing, and say so on screen. Verified on a real iPad: Elements, Console, Sources, Cookies, and Storage all work; Network captures the page's fetch/XHR traffic live, while the headers of static resources (a desktop webRequest feature) stay out of reach. Orion on macOS installs this extension the same way, with the fuller desktop API surface.

MOBILE AND TABLET, MORE BROADLY

Chrome for Android does not support extensions at all, and Kiwi Browser, the long-standing workaround, was discontinued and archived in 2025. Its extension engine lives on in Microsoft Edge Canary for Android, which installs add-ons from the Edge Add-ons store, and a few smaller Chromium forks now ship similar support. Safari's own extension format is a different package that has to be distributed as an App Store app, not from here. That is the whole landscape today: on a tablet or phone, an extension-capable browser is the only way to get real in-page DevTools, and Orion is the shortest path to it.

PRIVATE BY DESIGN

The inspector activates only when you click the extension icon on a tab, using the activeTab permission, so it has no standing access to your browsing. Site access for the cookies panel and for staying attached across reloads is optional and requested per site, only when you ask for it. Everything you inspect stays in your browser: the extension has no server, sends no data anywhere, and collects nothing. There is no analytics, no telemetry, and no crash reporting, and because the whole thing is open source you can verify that rather than take it on trust. Full policy: https://github.com/luangjokaj/inspector-lab/blob/main/PRIVACY.md

OPEN SOURCE

MIT licensed. Source code, feature tour, and issue tracker: https://github.com/luangjokaj/inspector-lab
```

### Assets to upload in the dashboard (not in the repo)

- Store icon: 128x128 PNG (the build already ships `icon128`, reuse the source
  asset from `apps/extension/assets/`).
- Screenshots: 1 to 5, each 1280x800 or 640x400 PNG/JPEG, no transparency.
  Suggested shots: elements panel with box model, console, network details
  pane, cookies panel, the inspector docked on an iPad.
- Small promo tile (optional): 440x280.
- Marquee promo tile (optional): 1400x560.

### Links the dashboard asks for

Four URL fields, across two tabs. Only the privacy policy is strictly required
for this extension, but the listing looks abandoned without the other two.

| Field              | Tab     | Status for us                     | Value                                                              |
| ------------------ | ------- | --------------------------------- | ------------------------------------------------------------------ |
| **Privacy policy** | Privacy | **Required** (see below)          | `https://github.com/luangjokaj/inspector-lab/blob/main/PRIVACY.md` |
| Homepage URL       | Listing | Recommended                       | `https://github.com/luangjokaj/inspector-lab`                      |
| Support URL        | Listing | Recommended                       | `https://github.com/luangjokaj/inspector-lab/issues`               |
| Official URL       | Listing | Optional, needs a verified domain | none today — see the privacy policy note about `riangle.com`       |

"Official URL" is the one that earns the verified badge on the listing: it can
only be chosen from domains verified as yours in Google Search Console, so a
GitHub URL cannot fill it. Skipping it costs the badge and nothing else.

Beyond URLs, the account itself must be publishable: a **verified developer
contact email** on the Account tab (Google emails compliance notices there and
an unverified address can block review), and 2FA on the Google account.

---

## Mobile and tablet install paths

Background for the "INSTALLING ON IPAD AND IPHONE" copy above, and the list of
what is actually claimable. The extension is MV3 with a `service_worker`
background and uses `scripting`, `cookies`, `webRequest`, `storage`,
`permissions`, and `tabs` — that combination is what each browser below has to
satisfy.

**Orion by Kagi — iOS, iPadOS, macOS. The supported path, and the reason the
listing mentions a non-Chrome browser at all.** Orion installs Chrome Web Store
extensions directly, so the Chrome Web Store listing doubles as the iPad and
iPhone distribution channel with no separate package. Install flow, current as
of August 2026: ••• menu → Settings → Extensions group → enable Chrome
extensions → ••• menu → Extensions → **+** → install from the Chrome Web Store.
Kagi documents iOS/iPadOS extension support as **beta with a reduced API
surface**, because Apple caps what any iOS browser may expose; macOS Orion has
the fuller set. **Verified on a real iPad (August 2026)**: Elements, Console,
Sources, Cookies, and Storage all work, and Network works partially — live
fetch/XHR capture yes, the `chrome.webRequest` headers-only log of static
resources no. The extension carries in-page fallbacks (console evaluation via
an injected page script, cookies via `document.cookie`) precisely so a missing
extension API degrades a panel visibly instead of killing it, which is what
makes those per-panel claims safe to keep in the store copy even as Orion's
beta surface shifts between releases.
Docs: https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html
Orion: https://orionbrowser.com/

**Microsoft Edge Canary — Android. Plausible second channel, needs a second
store submission.** Edge Canary absorbed Kiwi Browser's extension engine and is
now the mainstream way to run desktop extensions on Android. It installs **by
extension ID from the Edge Add-ons store, not the Chrome Web Store**, behind
Developer Options (Settings → About Microsoft Edge → tap the build number five
times → "Extension install by id"). So Android support is not a listing change,
it is a **separate publish to Edge Add-ons**; the same MV3 package should carry
over unmodified since Edge is Chromium. Canary-only today, so treat any Android
claim as provisional.

**Kiwi Browser — dead, do not reference.** Discontinued and the repository
archived in 2025. Any guide still recommending it is stale; the store copy names
it only to explain where the Android answer went.

**Other Chromium forks on Android** (Quetta and similar) advertise Chrome/Edge
extension support and are positioned as Kiwi successors. Untested here — fine to
acknowledge generically ("a few smaller Chromium forks"), not to name in the
listing until someone has actually installed this extension in one.

**Firefox for Android — does not work today, and it is a code change, not a
packaging one.** Extensions from addons.mozilla.org have been open to Firefox
for Android since December 2023, but Firefox's MV3 runs background logic as an
**event page (`background.scripts`)** and does not support
`background.service_worker`. Supporting it means declaring both keys in the
manifest, checking every `chrome.*` call against Firefox's API surface, and
submitting to AMO. Do not imply Firefox support in the listing.

**Safari proper — a different product, not this listing.** Shipping to Safari on
iOS/iPadOS/macOS means converting to a Safari Web Extension
(`xcrun safari-web-extension-converter`) and distributing it as an App Store app
wrapper, which needs Xcode and a paid Apple Developer account. Orion exists
precisely to avoid that, which is why it is the recommended path.

One listing caution: naming other browsers in a Chrome Web Store description is
fine as factual compatibility information, which is how the copy above reads.
Keep it that way — do not let it turn into a pitch to leave Chrome.

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
> the injected inspector share them. chrome.storage.session keeps two pieces of
> per-session state: which tabs have an inspector open (tab id to origin), so it
> can be reattached after a reload, and the panel last used on a given origin.
> The Network panel's headers-only request log is held in memory in the service
> worker and never written to storage. No browsing history or page content is
> persisted.

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

**Required for this extension. Not optional.** An earlier draft of this file
said otherwise; that was wrong. Google's User Data FAQ is explicit that
extensions must disclose how they handle user data "even when data is processed
or stored locally on a user's device and is not transmitted to external servers
or third parties." This extension reads page content, cookies, request bodies,
and storage locally, so it handles user data under that definition, and a
publicly accessible privacy policy URL is required. Enforcement of the updated
2026 policies began **1 August 2026**, so this is live, not upcoming.

The policy lives in the repo at `PRIVACY.md`. Paste this into the field:

    https://github.com/luangjokaj/inspector-lab/blob/main/PRIVACY.md

It must stay reachable without a login and must keep matching the code. If the
data handling ever changes, update `PRIVACY.md` in the same commit as the code
change — the 2026 policy also requires proactively disclosing changes to data
handling after install.

Optional upgrade: serving the policy from a domain you own (for example
`riangle.com`) lets the same domain be verified in Google Search Console and
used as the listing's **Official URL**, which shows a verified badge. GitHub
works fine without that.

Sources:
https://developer.chrome.com/docs/webstore/program-policies/user-data-faq and
https://developer.chrome.com/blog/cws-policy-updates-2026

---

## Other dashboard requirements (verify before submitting)

- **Account tab**: developer contact email must be set and verified, and 2FA
  enabled on the Google account.
- **Privacy tab complete**: single purpose, a justification for every permission
  including the optional host permissions, the data-usage answers, all three
  certifications, and the privacy policy URL. Leaving this tab incomplete gets
  the item flagged, then suspended after a 30-day warning window.
- **`PRIVACY.md` still matches the code**: it is a public promise, so re-read it
  whenever permissions or data flows change.
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
