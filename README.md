# Inspector Lab

A movable, resizable in-page inspector built as a Manifest V3 Chrome extension.

## Features

Inspector Lab drops a DevTools-style window directly onto the page: an Elements panel with live styles, forced element states, and computed values, console capture and evaluation, sources and network views, and fully editable cookies and storage — floating or docked, themed light and dark, and persistent across reloads until you close it.

**[Read the full feature tour →](docs/FEATURES.md)**

Highlights:

- Launches from the extension popup with a user gesture and temporary `activeTab` access — no standing permission to every site.
- Injects a React + Cherry UI into an isolated Shadow DOM; drags, resizes, and docks to any viewport edge.
- Picks and highlights elements, applies validated inline CSS, and shows computed styles with a box-model diagram.
- Captures page console output and evaluates expressions in the page context.
- Lists sources and network requests; edits cookies and local/session storage in place, DevTools-style.
- Ships in Inspector Lab's own theme, light and dark, following the popup's theme toggle — with a one-switch fallback to the classic Chrome DevTools look.

## Development

```bash
pnpm install
pnpm dev
```

Load `apps/extension/build/chrome-mv3-dev` from `chrome://extensions` using **Load unpacked**.

Production checks:

```bash
pnpm typecheck
pnpm build
```

The production extension is emitted to `apps/extension/build/chrome-mv3-prod`.

## Current boundaries

Console capture from page boot needs the per-site grant (elsewhere history starts at launch), network rows come from the Performance timeline (no request/response bodies), and cross-origin iframes, CSP-blocked `eval`, and protected `chrome://` pages remain out of reach. The full list lives at the end of [docs/FEATURES.md](docs/FEATURES.md).
