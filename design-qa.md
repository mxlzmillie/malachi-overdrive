# Ambient Work Mode — production renderer QA

This report describes the v2.0.21 renderer. It supersedes the earlier Ambient Edge concept review.

## Method

Run `npm run build`, then `COS_QA_ARTIFACTS=ambient-work-2-0-21 node scripts/qa-overdrive.cjs`.
The script launches the production Electron renderer with its real sandboxed preload and isolated
fixture IPC. It does not launch production main services, send model messages, use the personal
profile or make external network requests. Activity and model identities in these screenshots are
explicit deterministic fixtures; live browser behavior requires separate installed-release validation.

Evidence is written beneath `artifacts/ambient-work-2-0-21/`:

- `visual-qa.json`: executed geometry, interaction and runtime assertions.
- `ambient-edge-desktop-dark.png`: preview beside the chat at 1440 × 900.
- `ambient-edge-mobile-390.png`: preview above the chat at 390 × 844.
- `ambient-edge-mobile-320.png`: narrow layout at 320 × 700.
- `ambient-complete-320.png` and `ambient-complete-1440.png`: event-driven completion notice.
- `control-rail-desktop-dark.png`, `control-rail-desktop-light.png` and
  `control-rail-mobile-390.png`: explicit full workbench in both themes and narrow layout.

## Observed results

Production-renderer checks pass with no console errors, no external HTTP/HTTPS/WebSocket requests
and no unexpected fixture actions. The capsule reserves its own edge; the preview reserves a grid column on desktop
and a bounded row above the conversation at narrow widths. Neither preview nor workbench creates
a scrim. The composer remains visible and its model/options controls do not overlap.

The inspection found and corrected inherited font fallback, capsule wrapping, compressed preview
headers, narrow workbench scrolling, and composer toolbar width. Final captures were visually
inspected after these corrections. Workbench controls and history share one independently scrolling
body so long content remains reachable in a small viewport.

A completion update arrives through the real preload event subscription. Its notice occupies a
separate layout row, retains typing focus, and is not repeated when the same receipt arrives again.
Reduced-motion is exercised with Chromium's reduced-motion preference; the status animation is off.
Keyboard behavior, exact task controls, notice focus, task-switch races and stale worker ownership
also have deterministic renderer tests.

## Verification boundary

These checks prove production layout and renderer interactions. They do not prove provider access,
native permissions, signed packaging, updater delivery or live background isolation. Those are
separate release and installed-app gates; this report does not claim them completed.
