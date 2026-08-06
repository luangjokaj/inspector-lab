# Inspector Lab

A movable, resizable in-page inspector built as a Manifest V3 Chrome extension.

## Current MVP

- Launches from the extension popup with a user gesture.
- Requests temporary `activeTab` access instead of permanent access to every site.
- Injects a React + Cherry UI into an isolated Shadow DOM.
- Drags from the top instrument bar and resizes from the lower-right handle.
- Picks and highlights elements on the host page.
- Shows the selector, dimensions, relationships, attributes, text, and common computed styles.
- Applies validated inline CSS property/value pairs to the selected element.
- Hides and reopens the existing inspector instance without duplicating it.

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

The MVP inspects the shared DOM and computed CSS. It does not yet capture page-console history, network traffic, source files, cross-origin iframe contents, or protected `chrome://` pages.
