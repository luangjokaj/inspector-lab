---
name: verify
description: Run this repo's pre-land gate (pnpm typecheck → pnpm build → pnpm lint → pnpm format:check, in that order) and report whether the change touches WebKit-sensitive code that needs a real-device iPad/Orion pass. Use before committing, before declaring a task done, or when the user asks to verify changes.
---

Run the pre-land gate from the repo root, in this exact order, stopping at the
first failure:

1. `pnpm typecheck` — if it fails with missing `.plasmo/index.d.ts`, run
   `pnpm build` first (the tsconfig includes that generated file), then retry.
2. `pnpm build`
3. `pnpm lint` — Biome; fix errors, report (do not mass-fix) pre-existing
   warnings.
4. `pnpm format:check` — if it fails, run `pnpm format` and re-check.

Report each step's result plainly. If a step fails, show the actual error
output and fix the root cause; do not skip ahead.

Then inspect the changed files (`git diff --name-only` plus staged/untracked)
and flag whether a **real-device iPad/Orion pass** is required before landing.
It is required when the change touches any user-visible behavior, and
especially these WebKit-sensitive areas:

- `lib/runtime-message.ts`, `lib/storage.ts`, or any messaging/storage flow
- `background.ts` (service worker lifecycle, session tombstones, webRequest)
- Injection plumbing: `injected/inspector-entry.tsx`, prehooks, page-bridge,
  `xml-compat.ts`, or anything using `bundle-text:`/`url:` schemes
- SVG/non-HTML document handling (`mountInFrame` path)
- Anything touching `chrome.permissions`, cookies, or the manifest

End the report with one of:

- "Gate passed. Needs a real-device pass (touches: <areas>)." — Claude cannot
  perform this pass; it is on the user.
- "Gate passed. No real-device pass needed (docs/tooling-only change)."
