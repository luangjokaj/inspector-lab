# Privacy Policy

**Inspector Lab - DevTools**
Effective 8 August 2026

## The short version

Inspector Lab - DevTools collects nothing, transmits nothing, and has no
servers. There is no analytics, no telemetry, no advertising, and no account to
create. Everything the inspector shows you is read from the page in front of
you, rendered on your device, and forgotten when you close it.

The one thing resembling crash reporting is a diagnostics log that never
leaves your device: the extension's own errors (never the page's) and sessions
that ended without a clean close are kept in a small local ring buffer, shown
only in the popup's Diagnostics section, where you can also clear it. Nothing
in it is transmitted, to the developer or anyone else.

This is a deliberate design constraint, not a current state of affairs that
might quietly change. The extension is open source under the MIT license, so
every claim below can be checked against the code, and any change to it is
visible in the commit history.

## What the extension can see

To do its job, the inspector reads the page you activate it on. Depending on
which panel you open, that includes:

- the page's DOM, its elements, attributes, text, and computed styles
- console output the page produces, and expressions you type into the console
- network requests the page makes, including headers, timing, and request and
  response bodies for `fetch`/`XHR` calls
- cookies for the site you are inspecting, if you granted access to that site
- `localStorage` and `sessionStorage` values for that site
- the page's own scripts and stylesheets, when you open one in the Sources panel

Some of this is sensitive: cookies can contain session tokens, and request
bodies can contain anything the site sends. That data is read into the panel on
your device and nowhere else. It is never sent to the developer, never sent to a
third party, and never written to any remote service.

Google's Chrome Web Store policies treat this as "handling user data" even
though nothing is transmitted, which is why this policy exists and describes it
plainly.

## What the extension stores

Almost nothing, and nothing that describes you:

| What                                                                             | Where                      | Cleared when                                                         |
| -------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| Theme choice (light/dark/system) and the custom-theme toggle                     | `chrome.storage.local`     | you uninstall the extension                                          |
| Which tabs have an inspector open, and on which origin                           | `chrome.storage.session`   | the browser session ends                                             |
| The panel you last used on a given site                                          | `chrome.storage.session`   | the browser session ends                                             |
| Headers-only log of requests for a tab, for the Network panel                    | memory only, never on disk | the tab closes, or the extension restarts                            |
| Open-session records (tab id and origin), so unclean ends can be detected        | `chrome.storage.local`     | the session closes cleanly, or the record is swept at the next start |
| Diagnostics log: extension errors and unclean session ends (origin + timestamps) | `chrome.storage.local`     | you press Clear in the popup; oldest entries rotate out past 100     |

Everything else — the DOM, console output, request and response bodies, cookie
values, storage values, source file contents — exists only for as long as the
panel is showing it. None of it is persisted by the extension.

## Network connections the extension makes

The extension has no backend, so it never contacts a server belonging to the
developer. It makes exactly one kind of outbound request, and only when you ask
for it: when you open a script or stylesheet in the Sources panel, it fetches
that file so it can display the text. That request goes to the site's own
server, is sent without credentials, and prefers the browser cache the page has
already filled. The fetched text is displayed and never executed.

Links in the About card (the developer's site and email address) open only when
you click them, like any other link.

## Permissions, and why each one exists

- **activeTab** — the inspector is injected only into the tab where you click
  the toolbar button. No standing access to your browsing.
- **scripting** — injects the packaged inspector interface into that tab, keeps
  it attached across reloads on sites you granted, and runs the console
  expressions you type in the page's context. All injected code ships inside the
  extension package; nothing is downloaded and run.
- **storage** — saves the preferences, session state, and local-only
  diagnostics listed in the table above. Nothing else.
- **cookies** — powers the Cookies panel. Only usable on sites where you
  explicitly granted access, and only to display and edit those cookies in the
  panel.
- **webRequest** — observes requests of the inspected tab so the Network panel
  can show method, status, timing, and headers. Observation is passive: the
  extension never blocks, redirects, or modifies a request.
- **Optional site access** — requested one site at a time, when you ask for it,
  never at install time. It enables the Cookies panel and lets the inspector
  survive page reloads on that site. Decline it and everything else still works.

## Data sharing

None. There is no third party to share with. Your data is not sold, rented,
transferred, or used for advertising, profiling, or model training. The
developer cannot see what you inspect.

## Children's privacy

The extension collects no personal data from anyone, of any age.

## Changes to this policy

If the extension's data handling ever changes, this policy will be updated
before that change ships, and the change will be described in the release notes
and visible in the repository's commit history. The effective date at the top of
this page always reflects the current version.

## Contact

Questions, or something here that does not match what you observe:

- Issues: https://github.com/luangjokaj/inspector-lab/issues
- Email: luan@riangle.com
