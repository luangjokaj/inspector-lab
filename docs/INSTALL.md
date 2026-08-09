# Installing Inspector Lab - DevTools

The primary way to install Inspector Lab is the **Chrome Web Store**:

**[Inspector Lab - DevTools on the Chrome Web Store →](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle)**

That one listing covers every supported browser. Desktop Chrome and Chromium
browsers install it natively, and [Orion by Kagi](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html)
installs Chrome Web Store extensions directly on iPadOS, iOS, and macOS — so
the store is the install path on the iPad too, with no cables, zips, or file
transfers involved. Store installs also update automatically, which sideloaded
builds never do.

Running from a local build still works on all of those browsers and is covered
[at the end of this page](#installing-from-a-file-local-builds) — that is the
path for development and for trying changes that have not shipped to the store
yet.

---

## 1. Orion on iPadOS and iOS

[Orion by Kagi](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html)
is [free for iPhone and iPad](https://orionbrowser.com/) and is the only iPad
browser that runs Chrome extensions. Install Orion first if you have not
already — [the App Store link](https://apps.apple.com/app/id1484498200) opens
Orion directly when tapped on the iPad.

### Step 1 — Enable Chrome extensions (once)

1. Open **Orion**.
2. Tap the **three dots** (**⋯**) in the toolbar and choose **Settings**.
3. Scroll to the **Extensions** group and turn on **Chrome extensions**.

### Step 2 — Install from the Chrome Web Store

1. Tap **⋯ → Extensions**.
2. Tap the **+** button in the **bottom right**.
3. Install from the **Chrome Web Store**: search for
   **Inspector Lab - DevTools**, or open
   [the listing](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle)
   directly.
4. Confirm. **Inspector Lab - DevTools** appears in the extensions list.

Orion may warn about compatibility during install — the warning is
informational and expected here; see [Troubleshooting](#troubleshooting).

### Step 3 — Use it

1. Check that the extension is **enabled** in that same Extensions list.
2. Open any normal website (`http://` or `https://`).
3. Open the extension from the toolbar and tap **Inspector Lab - DevTools**.
4. Tap **Open page inspector**.
5. **Allow site access** when Orion asks. The Cookies panel stays empty without
   it, and console capture from page load needs it too.

The inspector docks to the bottom of the page. Drag the toolbar to tear it off
into a floating window, or use the dock buttons to pin it to another edge. It
survives page reloads until you close it with the **X**.

### What to expect on iOS

Kagi documents iOS and iPadOS extension support as **beta with a reduced API
surface**, because Apple caps what any iOS browser may expose. The inspector is
built for that: wherever the extension background cannot be reached, the panels
that need it switch to in-page fallbacks instead of going dark, and each one
says on screen which source it is using.

**Verified on a real iPad**: Elements, Console, Sources, Cookies, and Storage
all work; Network works partially. Panel by panel:

- **Elements, Sources, and Storage** work entirely in the page and need no
  extension APIs.
- **Console** captures page logs and evaluates expressions — through the
  extension when it answers, and through an in-page script when it does not.
  It also straightens iOS Smart Punctuation: type `console.log("log")` and the
  keyboard's curly `“ ”` quotes (and the `—` it makes of `--`) are corrected
  automatically when they are what stopped the expression from parsing. Sites
  whose Content Security Policy forbids inline scripts or `eval` block the
  fallback — the error says so when it happens.
- **Cookies** lists, adds, edits, and deletes cookies. It reads the browser's
  cookie store when the extension answers, and falls back to `document.cookie`
  when it does not. The fallback cannot see HttpOnly cookies, and it only
  knows each cookie's name and value — the other columns show a dash instead
  of a guess, and a status line names the source in use.
- **Network** captures the page's own fetch/XHR traffic live, with headers and
  bodies. The partial part: the headers-only log of static resources
  (documents, stylesheets, images, fonts) needs `chrome.webRequest`, which iOS
  does not offer — those rows come from the Performance timeline instead,
  without header details.

If a panel reports a specific error instead of data, that message is the
ground truth for what this browser build supports — it names the API or policy
that refused, rather than a generic connection failure.

---

## 2. Desktop Chrome, Edge, Brave, and other Chromium browsers

Open
[the Chrome Web Store listing](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle)
and click **Add to Chrome** (other Chromium browsers word the same button their
own way). That is the whole install.

---

## 3. Orion on macOS

Orion on macOS installs Chrome Web Store extensions directly and exposes the
fuller desktop API surface, so the same
[store listing](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle)
works there: open it in Orion and install.

---

## Installing from a file (local builds)

No store involved — for development, or for running changes that have not
shipped to the store yet. Sideloaded builds never auto-update.

### Build it

```bash
git clone git@github.com:luangjokaj/inspector-lab.git
cd inspector-lab
pnpm install
pnpm build
```

That writes the unpacked extension to:

```
apps/extension/build/chrome-mv3-prod/
```

That folder **is** the extension. `manifest.json` sits at its top level, which
is what every installer below looks for.

For an iPad or iPhone, make a zip as well — 1.2 MB to move instead of 6.9 MB:

```bash
pnpm package
# -> apps/extension/build/chrome-mv3-prod.zip
```

### Orion on iPadOS and iOS, from a file

The iPad flow is the one worth reading closely — it is not a download-and-tap
install, because Orion installs a sideloaded extension from a folder that has
to be sitting in its own Files location first.

#### Get the folder onto the iPad

Orion's installer only lists folders that are already in its own Extensions
directory, so this has to happen before you open Orion's extension screen.

1. **Transfer `chrome-mv3-prod.zip` to the iPad.** AirDrop from a Mac, iCloud
   Drive, or just download it in a browser. Anything that lands in the Files app
   works.
2. Open the **Files** app.
3. Find the zip. AirDrop and browser downloads normally land in **Downloads**.
4. **Long-press the zip → Uncompress.** You get a folder named
   `chrome-mv3-prod` next to it.
5. Navigate to **Browse → On My iPad → Orion → Extensions**.
   - No **Orion** folder? Open the Orion app once, then look again — Orion
     creates it on first launch.
   - Orion's own file picker calls this same location **On This iPad**. Same
     place, different label.
6. **Move the `chrome-mv3-prod` folder into `Extensions`.** Long-press the
   folder → **Move** → pick `Orion/Extensions`. Dragging it across in Split View
   works too.

At this point `On My iPad → Orion → Extensions → chrome-mv3-prod` exists and
contains `manifest.json`. Nothing is installed yet.

#### Install it in Orion

1. Open **Orion**.
2. Tap the **three dots** (**⋯**) in the toolbar.
3. Tap **Extensions**.
4. Tap the **+** button in the **bottom right**.
5. Choose **Install from File**.
6. The folder picker opens. Select the **`chrome-mv3-prod`** folder you moved
   in the previous step — pick the _folder itself_, do not open it and pick a
   file inside.
7. Confirm. Orion installs it, and **Inspector Lab - DevTools** appears in the
   extensions list.

#### Updating a sideloaded build

Sideloaded extensions never auto-update. To move to a newer build:

1. Delete the old `chrome-mv3-prod` folder from
   **On My iPad → Orion → Extensions**.
2. Drop the new one in its place.
3. Install it again from the **+ → Install from File** flow above.

Removing the old folder first matters: two folders with the same manifest name
make the picker ambiguous.

### Desktop Chrome and Chromium, load unpacked

1. Build it (above).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select **`apps/extension/build/chrome-mv3-prod`**.

For development, `pnpm dev` writes `apps/extension/build/chrome-mv3-dev`
instead and reloads as you edit. Load that folder the same way.

### Orion on macOS, from a file

Orion on macOS also accepts a local build through its own extension settings;
see
[Kagi's extension documentation](https://help.kagi.com/orion/browser-extensions/browser-extensions.html)
for the current menu path, which moves between Orion releases.

---

## Troubleshooting

**The picker does not show my folder.** It only browses Orion's own Extensions
directory. The folder has to be at **On My iPad → Orion → Extensions**, not in
Downloads or iCloud Drive.

**I moved the zip instead of the folder.** Orion needs the unpacked folder.
Long-press the zip → **Uncompress** first, then move the resulting folder.

**I picked a file and it failed.** Select the `chrome-mv3-prod` folder itself.
The installer reads `manifest.json` from inside it.

**No Orion folder in Files.** Launch Orion once. The folder is created on first
run.

**Nothing happens when I tap Open page inspector.** The inspector only runs on
`http://`, `https://`, and `file://` pages. Browser settings pages and other
internal URLs are protected and out of reach for any extension.

**The Cookies panel is empty.** Site access was not granted. Relaunch from the
popup and allow it when asked.

**Orion warned about compatibility at install.** Orion compares the APIs an
extension uses against the ones its beta iOS surface implements and warns
about the gap. The warning is informational and expected here — the inspector
deliberately uses APIs Orion does not have yet (like `chrome.webRequest`'s
completion events) and degrades visibly, per panel, when one is missing.
Moving permissions around does not remove it (verified on-device), so install
past it: what each panel can and cannot do on iOS is listed above.

**It crashed and there are no logs to check.** There are now: open the toolbar
popup and tap **Diagnostics**. Extension errors and sessions that ended without
a clean close (a browser exit, page crash, or iOS memory kill) are recorded in
a local log that survives restarts, with a Copy button for pasting into an
issue. If the inspector died mid-session, relaunching it after a browser
restart is normal — that is iOS reclaiming memory, and the log entry names the
site it happened on.

**It opened, flashed on the page, and disappeared.** That was a bug in earlier
builds: a missing `chrome.storage.session` namespace took the background service
worker down at startup, and an unguarded extension API call inside a React
effect unmounted the inspector immediately after it painted. Pull `main` and
rebuild.
