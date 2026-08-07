<p align="center">
  <a href="https://github.com/luangjokaj/inspector-lab"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title=Inspector+Lab&amp;subtitle=DevTools+anywhere.+Even+on+iPad.&amp;logo=https%3A%2F%2Ffiles.riangle.com%2Finspector-lab%2Ficon.png&amp;size=wide&amp;mode=dark&amp;font=geist" /><img alt="Doccupine" src="https://shieldcn.dev/header/grid.svg?title=Inspector+Lab&amp;subtitle=DevTools+anywhere.+Even+on+iPad.&amp;logo=https%3A%2F%2Ffiles.riangle.com%2Finspector-lab%2Ficon.png&amp;size=wide&amp;mode=light&amp;font=geist" /></picture></a>
</p>

<p align="center">
  <a href="https://github.com/luangjokaj/inspector-lab"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/luangjokaj/inspector-lab/stars.svg" /><img alt="badge" src="https://shieldcn.dev/github/luangjokaj/inspector-lab/stars.svg?mode=light" /></picture></a>
  <a href="#"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Chrome Web Store.svg" /><img alt="badge" src="https://shieldcn.dev/badge/Chrome Web Store.svg?mode=light" /></picture></a>
</p>

# Inspector Lab - DevTools

A movable, resizable in-page inspector built as a Manifest V3 Chrome extension. Open source under the MIT license.

![Inspector Lab - DevTools](https://files.riangle.com/inspector-lab/inspector-lab-devtools.png)

**[What is Inspector Lab - DevTools, and why I built it →](docs/ABOUT.md)** — devtools for the agent-orchestration era: full inspection on any device that runs a browser extension, iPad included.

## Features

Inspector Lab - DevTools drops a DevTools-style window directly onto the page: an Elements panel with live styles, in-place DOM editing, forced element states, and computed values, console capture and evaluation, sources and network views, and fully editable cookies and storage — floating or docked, themed light and dark, and persistent across reloads until you close it.

**[Read the full feature tour →](docs/FEATURES.md)**

Highlights:

- Launches from the extension popup with a user gesture and temporary `activeTab` access — no standing permission to every site.
- Injects a React + Cherry UI into an isolated Shadow DOM; drags, resizes, and docks to any viewport edge.
- Picks and highlights elements, edits attributes and text directly in the DOM tree, applies validated inline CSS, and shows computed styles with a box-model diagram.
- Captures page console output and evaluates expressions in the page context — with values colored by type and `file:line` source links on every entry.
- Records network requests live — headers, timing, and fetch/XHR bodies — with a DevTools-style details pane; edits cookies and local/session storage in place.
- Lists page sources in a collapsible tree with syntax highlighting, fetching external files on demand.
- Ships in its own theme, light and dark, following the popup's theme toggle — with a one-switch fallback to the classic Chrome DevTools look.

## Installation

The extension is not on the Chrome Web Store yet, so it runs from a local build:

```bash
git clone git@github.com:luangjokaj/dev-inspector.git
cd dev-inspector
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/build/chrome-mv3-prod`.

Works in desktop Chrome and Chromium-based browsers, and in [Orion by Kagi](https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html) on iOS and iPadOS.

## Development

Requires Node 20+ and pnpm 9+.

```bash
pnpm install
pnpm dev
```

Load `apps/extension/build/chrome-mv3-dev` from `chrome://extensions` using **Load unpacked**. The dev build reloads as you edit.

Before opening a pull request:

```bash
pnpm typecheck
pnpm build
pnpm format:check
```

The extension lives in `apps/extension` (built with [Plasmo](https://www.plasmo.com/)); longer-form documentation lives in `docs/`.

## Known limitations

Console and network capture from page boot need the per-site grant (elsewhere capture starts at launch), response bodies are recorded for fetch/XHR only (static resources expose headers, not contents), and cross-origin iframes, CSP-blocked `eval`, and protected `chrome://` pages remain out of reach. Some inspections genuinely require the debugger protocol — breakpoints, profiling, CSP bypass — and are out of scope by design. The full list lives at the end of [docs/FEATURES.md](docs/FEATURES.md).

## Contributing

Issues and pull requests are welcome. If you are planning a larger change, please open an issue first to talk it through. Keep changes focused, run the checks above, and match the existing code style (Prettier is enforced).

## License

[MIT](LICENSE) © Luan Gjokaj
