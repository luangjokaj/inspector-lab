# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Inspector Lab - DevTools: a Manifest V3 browser extension (Plasmo + React 19 + styled-components v6 + cherry-styled-components) that injects a DevTools-style window into any page. Primary target is Orion by Kagi on iPadOS (WebKit); also desktop Chrome. pnpm workspace monorepo with a single package: `apps/extension`.

## Commands

- `pnpm dev` / `pnpm build` — Plasmo dev/prod builds into `apps/extension/build/`
- `pnpm typecheck` — `tsc --noEmit`; requires a prior dev/build because the tsconfig includes the generated `.plasmo/index.d.ts`
- `pnpm lint` — Biome, lint rules only (Prettier owns formatting; config in `biome.json` disables rules that conflict with the product, e.g. eval in `page-eval.ts`)
- `pnpm format` / `pnpm format:check` — Prettier over the whole repo (docs included)
- `pnpm --filter @inspector-lab/extension package` — build the store zip (there is no root `package` script)

Pre-land gate, in order: `pnpm typecheck` → `pnpm build` → `pnpm lint` → `pnpm format:check`.

Every user-visible change also needs a real-device pass on iPad/Orion before it lands. Claude cannot do this pass; explicitly flag "needs a real-device pass" in the summary of any user-visible change.

## Cross-browser invariants (WebKit/Orion)

- Never `await chrome.*` APIs directly — on Orion's WebKit runtime `chrome.*` is callback-only, so `await` resolves `undefined` and silently drops replies. Use `lib/runtime-message.ts` for messaging and `lib/storage.ts` (`storageGet`/`storageSet`/`watchStorage`) for storage.
- Retry only on proven non-delivery (`RUNTIME_UNAVAILABLE`, "receiving end does not exist", "could not establish connection"). "Message port closed" and timeouts mean the message _was_ delivered — retrying can re-apply a write. The retryable set (read-only messages only) is enumerated in `lib/runtime-message.ts`.
- Never put a flat timeout on human-gated messages (`permissions.request` blocks on a browser dialog).
- `injected/xml-compat.ts` must stay the first import in `injected/inspector-entry.tsx`.
- Page-world code is injected via `bundle-text:` inlining + MAIN-world `chrome.scripting.executeScript` — the only shape that works. `url:` imports from content-script entries break Plasmo bundle resolution, and MV3 CSP blocks eval/inline/blob injection. `@parcel/transformer-inline-string` (root devDep, exact-pinned) is what makes `bundle-text:` work; do not remove it.
- Error messages carry a human-readable `reason` string shown verbatim in the UI (there is no console on iPad). Generic "connection failed" wording is rejected in review.

## Privacy constraint

Zero telemetry, analytics, backend, or accounts — a hard product constraint enforced in review. Any new `chrome.storage` row or permission must be reflected in the PRIVACY.md storage table. Any new entry point must call `installGlobalDiagnostics(source)` from `lib/diagnostics.ts`.

## Versioning and releases

0.1.0 is live on the [Chrome Web Store](https://chromewebstore.google.com/detail/inspector-lab-devtools/jhpgckgieinonbibmjdgejephdmdogle) — the primary install path, including for Orion on iPad. The version in `apps/extension/package.json` must match the latest published store version; bump it only as part of an actual store release. CHANGELOG entries accumulate under `## [Unreleased]` (Keep a Changelog format) and move to a dated version heading when that release ships to the store.

## Style

- Imports: `~`-prefixed path alias only (`~lib/...`, `~injected/...`), never relative-parent imports. Inline `type` modifiers inside value imports; member lists sorted alphabetically with `type` entries after plain ones.
- Comments explain _why_, not _what_: modules open with a `/** … */` header describing the browser constraint that forced the design. Prose wraps at 80 columns.
- UI: Cherry components (`Button`, `Input`, `Select`, `Toggle`, …) over raw HTML controls; all colors/spacing/typography come from `theme.devtools.*` or Cherry theme tokens, never hardcoded.
- No tests by design — do not add a test harness. Verification is the pre-land gate plus on-device passes.

## Git

Conventional Commits with the established scopes (`feat(extension)`, `fix(extension)`, `docs`, `chore`, `style(extension)`). Small fixes commit straight to `main`; larger features get a branch. pnpm refuses packages published within the last 24h (`minimumReleaseAge` in `pnpm-workspace.yaml`) — a just-released dependency version will fail to install by design.
