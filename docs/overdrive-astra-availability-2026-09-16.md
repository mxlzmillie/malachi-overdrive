# Astra selection availability — 2026-09-16

## Observed failure

The installed 2.0.17 renderer offered a synthetic `gpt-6-pro` / `pro` option even
though the observed account catalog contained only GPT-5.6 Sol and GPT-5.5. The
native ChatGPT picker in the affected conversation showed **Pro disabled**.
Delivery reached the browser, but model confirmation correctly failed before
prompt insertion or Send. This was not a slow browser pickup.

## Correction

`src/renderer/chat-models.ts` now admits only catalog-observed model/effort
combinations. A saved or selected Astra choice removed from the catalog remains
visible as an unavailable, disabled choice; it cannot send or silently become a
different model. Composer and settings status explain the unavailable choice.
A later catalog observation can restore the same choice. All observed models,
saved aliases, and existing Work/current-browser inheritance remain supported.

This does not enable provider-disabled models or change account entitlements.
No browser transport or main-process changes were needed. No prompt was resent
on a substitute model during diagnosis.

## Validation

The focused renderer suite passed 24 tests and TypeScript checking passed.
Regression coverage includes unavailable saved Astra, catalog removal and
restoration, explicit selection of an available alternative, stale injected
choice rejection, and existing Work inheritance.

`VITEST_MAX_WORKERS=2 npm run verify` passed: 3,467 tests passed across both
verification runs; 106 tests were skipped by the suite. Production build passed.
The ARM64 package passed `smoke-packaged-runtime.mjs` (PTY, tree-sitter, Sharp,
desktop addon, tunnel and ripgrep) and `smoke-macos-bundle.mjs` (26 Mach-O
payloads, metadata and signature checks).

Installed `/Applications/MALACHI OVERDRIVE.app`, preserving user data. The
previous bundle is retained at
`~/Library/Application Support/Malachi Overdrive Backups/app-before-astra-availability-20260916.saved`.
Installed and packaged `app.asar` SHA-256 both equal
`7db3d4281daaf5ebe2b808d8cf27a479b7c3324bbeb556d97c843a39e835f53e`.

The installed UI reopened, connected and loaded the affected chat. A fresh
Reload ChatGPT models completed and again observed only GPT-5.6 Sol and GPT-5.5,
each with `none`, `medium`, `high`, `xhigh`. The existing browser setting remains
GPT-5.5 Extra high. The failed draft was restored only for inspection and then
cleared back to the initially empty composer; no input was sent. The original
failed message remains in the transcript. Provider-disabled Astra is still
unavailable, so this is an admission/UI correction rather than a successful
Astra generation.
