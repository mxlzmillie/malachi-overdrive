# MALACHI OVERDRIVE 2.0.17 release hardening — 2026-09-16

> **Historical gate note.** This report records the 2.0.17 hardening sprint and its then-current
> release recommendation. The later 2.0.18 release decision on September 17, 2026 followed a green
> full shared-tree verification/build, the ordinary fresh-chat delivery check documented below, and
> explicit maintainer authorization to publish. Live three-worker/overnight/Compact & Resume limits
> that were not re-proved remain disclosed in the 2.0.18 public release notes rather than being
> rewritten here as if this earlier report had observed them.

## 1. Executive summary

**NOT READY for a public release.** This sprint repaired concrete startup, pairing, preview-file access, and provider-retry defects, and verified the macOS ARM64 candidate locally. A full live three-worker run, overnight recovery, all six release architectures, and a staged updater have not been proved. The live dogfood run failed at Compact & Resume when ChatGPT showed a generic error in the replacement conversation; no final worker or test result was produced. No release was published.

## 2. Architecture verified

Electron main owns local capabilities, sessions, secrets, the loopback MCP endpoints, and the browser bridge. The preload exposes fixed renderer IPC. The renderer owns the chat and Control Rail. The extension observes ChatGPT, selects and sends in a browser tab, and returns receipts; it has no local-tool execution authority. Core MCP owns files, process/terminal, preview, and project permissions. Desktop MCP owns computer operations. Native sessions and logs are local; the browser transport connects to the signed-in ChatGPT service. Architecture sources include `AGENTS.md`, `src/main/mcp`, `src/main/bridge.ts`, `src/main/session`, `src/renderer`, and `extension`.

## 3. Problems discovered

- A pending macOS Keychain/SecurityAgent response could hold initial renderer state indefinitely, leaving “Loading conversations…” on first launch.
- A local process could request the bridge's extension pairing endpoint without a code shown in the desktop app.
- An already-open preview URL could keep serving project files after the approved folder or read capability changed.
- Goal processing could retry durable HTTP 4xx errors; explicit restrictions must stop retrying.
- README and security documentation had stale first-run, permission, and log descriptions.
- The candidate's live coding task initially used an invalid virtual shell path, recovered by switching to relative source paths, and repeatedly read files; it entered an automatic context-compaction handoff before final verification. The replacement ChatGPT conversation displayed “Something went wrong,” and its app command expired without a confirmed destination. This is a failed live dogfood run, not a completed benchmark.

## 4. Root causes

Startup assembled state by awaiting OS-backed secret reads without a bound. Bridge pairing relied on possession of locally exposed metadata rather than a human-visible proof. Preview authorization was decided only when the URL was created. Goal retry classification treated broad client errors as transient. Documentation lagged behind implementation.

## 5. Implementation changes

- Bound startup secret observation to eight seconds and show actionable Keychain guidance while keeping the renderer usable; bridge status can render without a pending credential read.
- Require a rotating app-window pairing code for every new bridge pairing, including reconnect; advance bridge protocol to 14 and expose the code in Setup and the extension popup.
- Give preview URLs a random secret, use a same-site HttpOnly cookie for dependent assets, and recheck the live folder/read capability on every request.
- Treat durable provider 4xx and rate-limit responses as terminal for Goal retries; retain bounded retry for transient cases.
- Align onboarding, security, and provider-limit documentation with observed behavior.
- Add a fourteen-scenario release benchmark recorder that distinguishes isolated fixtures from live tasks.

## 6. Exact files changed

Existing work was preserved. The current working-tree change set includes:

`AGENTS.md`, `CHANGELOG.md`, `README.md`, `SECURITY.md`, `THIRD-PARTY-NOTICES.txt`; `extension/background.js`, `extension/content.js`, `extension/popup.css`, `extension/popup.html`, `extension/popup.js`; `scripts/fetch-with-retry.mjs`, `scripts/qa-overdrive.cjs`, `scripts/release-benchmark.mjs`; `src/main/bridge.ts`, `src/main/goal.ts`, `src/main/ipc.ts`, `src/main/mcp/kernel.ts`, `src/main/mcp/server.ts`, `src/main/mcp/tools-core.ts`, `src/main/preview-server.ts`, `src/main/secrets.ts`, `src/main/session/input-attachments.ts`, `src/main/session/input.ts`, `src/main/version.ts`; `src/preload/index.ts`; `src/renderer/agent-panel.ts` (removed), `src/renderer/chat-models.ts`, `src/renderer/chat.ts`, `src/renderer/control-rail.css`, `src/renderer/control-rail.ts`, `src/renderer/index.html`, `src/renderer/styles.css`; `docs/overdrive-astra-availability-2026-09-16.md`, `docs/overdrive-startup-2026-09-16.md`, `docs/release-benchmark.md`, this report, and `artifacts/release-benchmark.json`.

## 7. Tests added or changed

`test/bridge-done-repair-silence.test.ts`, `test/bridge.test.ts`, `test/content-script.test.ts`, `test/extension-popup.test.ts`, `test/extension.test.ts`, `test/fetch-with-retry.test.ts`, `test/goal.test.ts`, `test/input-delivery-integration.test.ts`, `test/mcp.test.ts`, `test/preview-server.test.ts`, `test/renderer-agent-panel.test.ts` (removed with its UI), `test/renderer-chat-models.test.ts`, `test/renderer-control-rail.test.ts`, `test/renderer-state.test.ts` (unchanged, rerun), `test/resume.test.ts`, `test/secrets.test.ts`, `test/session-finish.test.ts`, `test/session-input.test.ts`, and `test/task-request.test.ts`. The pairing, preview, retry, and startup fixes have focused regression coverage.

## 8. Test results

Focused bridge/Goal/extension: **543 passed**. Preview/MCP: **167 passed, 7 skipped**. Startup secrets: **16 passed**. Renderer state/timeline rerun: **117 passed**. The clean final `npm run verify` passed: **3,475 passed, 106 skipped** in the main suite and **2 passed** in the shutdown suite, plus typecheck, privacy/history, and third-party notices. The preceding full run had three renderer failures during concurrent dogfooding; both affected suites and the clean full rerun passed. The final source `npm run build` passed. `node scripts/qa-overdrive.cjs` had one transient 390px workbench geometry failure, then passed on rerun with no forbidden actions, external requests, or console errors. `git diff --check` passed. The macOS ARM64 unpacked package and bundle smoke passed before the final documentation/copy edit; the packaged app was not rebuilt after that edit because it was running the live dogfood task.

## 9. Benchmark results

`artifacts/release-benchmark.json` records scenarios 6–14 as **PASS in isolated fixtures only** and scenarios 1–5 as **NOT TESTED**. Null model/worker fields mean the runner had no provider-admission or live worker evidence. See `docs/release-benchmark.md` for the reproducible procedure.

## 10. Multi-agent findings

The candidate UI displayed dormant worker histories. In the live dogfood task, the first `agents status` call was correctly refused because no worker belonged to that conversation; a subsequent spawn/result and three simultaneous workers were not confirmed. The three-worker stress gate remains **NOT TESTED**. No fixture result should be construed as live worker admission.

## 11. Long-run and recovery findings

Live extension reload connected protocol 14, the app recovered from the initial Keychain stall after an eight-second bound, and the bridge accepted a new browser input after about 3.6 seconds. The live task saved its 23k-character automatic compaction brief, but the ChatGPT destination displayed a provider-side error and never confirmed the resumed message. The app retained the ticket and did not automatically resend a possibly sent message. The original input likewise displayed an unconfirmed-delivery notice despite the model having begun work. Multi-hour, overnight, sleep/wake, browser restart, and worker recovery were not exercised end to end.

## 12. Model-truth findings

Requested model and effort are distinct from an admitted model. The UI/catalog and failure fixtures were checked, and a stale hardcoded alias was removed in earlier local work. Exact live GPT-6 Pro/Astra admission and each worker's admitted model were **NOT TESTED**; no actual provider model is asserted from a label alone.

## 13. Provider-compliance findings

Repository-wide search separated historical/marketing language, implementation, fixtures, and unrelated uses of “limit” or “bypass.” No account-rotation, quota-reset, or provider-metering-evasion implementation was found. Goal's broad 4xx retry was corrected. README states provider limits still apply; the local app and browser transport cannot grant extra provider credit.

## 14. Security findings

Two source-backed access-control issues were fixed: unauthenticated local pairing and stale preview authorization. Focused tests cover both. A selective security scan completed with no remaining findings in its reviewed surfaces; it did **not** review every inventoried file. The scan returned a measured aggregate of **24,839,189 tokens across six threads**; that accounting is not a coverage measure. A git-tracked secret-pattern scan found no high-risk token or private-key matches. This is not a security certification. The app keeps sessions and rotating logs on disk; Chrome/Opera browser transport necessarily sends user-authored prompts to the selected provider.

## 15. Onboarding findings

The local macOS ARM64 candidate opened, rendered Setup after the bounded Keychain probe, reloaded the existing Opera Air extension, connected at bridge protocol 14, created a project chat, and sent a coding prompt. Pairing now requires the code visible in the desktop app. A stranger's full GitHub-to-first-verified-coding-task journey was not completed.

## 16. Updater and release findings

The updater has a baked trusted repository, architecture selection, and checksum manifest paths in source. The local dev package had no trusted release repository configured, so a staged live update was not tested. The CI workflow defines six platform/architecture jobs; no CI release run or Windows/Linux installer smoke was performed. The macOS ARM64 unpacked candidate and bundle smoke passed; do not infer verification for macOS x64, Windows, or Linux.

## 17. Remaining known issues

The live dogfood task spent excessive context rereading source and failed at its automatic resume, with ChatGPT showing a generic provider error; no workers or prime test result followed. Clicking ChatGPT’s visible Retry returned to a new composer prefilled with the same handoff, but did not establish a safe, app-confirmed continuation; it was not submitted a second time. Full release-level confidence depends on a completed representative task, live three-worker admission, overnight/recovery run, and native CI artifacts. After the user reported that the Documents shortcut did not open the app, the validated local ARM64 candidate was installed at `/Applications/MALACHI OVERDRIVE.app` so the existing Documents shortcut points to the one running copy. The previous installed bundle was preserved under `Developer/Chat On Steroids Workspace/installed-backups`. This is a local repair, not a public release.

The later send investigation found that the full source chat had an unresolved Compact & Resume ticket, yet new input was admitted and expired after 60 seconds. New input to a moving session is now refused before connector startup, remains in the composer, and shows the recovery action. A fresh-chat live check exposed a second boundary: an idle-looking ChatGPT tab could be recycled while its content recorder still held the old compaction job, so the new input never claimed. The companion now excludes that tab from reuse and opens or selects another eligible tab. The ARM64 app and stable unpacked extension were refreshed locally; Opera reconnected with protocol 14. Typecheck and the four relevant suites passed (738 tests), including the handoff/reuse regression. A successful post-fix live send is still unconfirmed, so this is not evidence to change the Compact & Resume or release gates above.

The authorized post-fix fresh-chat check on 2026-09-16 was claimed by the browser in 2.4 seconds, and the recorder observed a new ChatGPT conversation and a completed turn. The exact message receipt did not reach the app, however. After the bounded 180-second confirmation window, the input moved to `cancelled` with the explicit warning that it may already have been sent and will not be resent. Opera's page content was unavailable to the accessibility/screenshot observer during this check, so the observed turn cannot safely substitute for an exact delivery receipt. Delivery remains unverified; investigate the missing receipt in the live Opera/ChatGPT surface before treating this as a passing end-to-end send.

Opera's ChatGPT conversation was subsequently visible and showed both the exact 2,406-character input and `OVERDRIVE_OK` reply. The app's cancellation was a false negative. A receipt-only recovery path now projects a digest of authorized ordinary fresh-chat sends to the paired companion for one hour. It checks the original tab's single user bubble against that digest and its assigned conversation, then journals the old owner's ACK without pressing Send again. Receipt probes have a three-second bound and run outside shared maintenance; an unanswered tab cannot hold up other chats. Temporary/planner inputs are excluded. The source was typechecked and 1,030 focused tests passed, including exact-match and mismatch recovery cases; the subsequent three-test receipt suite also passed with the nonblocking check. The new ARM64 package was built locally.

The remaining live check is input `60c1c45e-a8e6-4d80-8c3b-c0e0cae82d56` in conversation `6aab1bab-6830-83e9-b463-8933e6a20f7c`. Its authored bubble has ID `bab8dbea-3757-4c33-b0e7-4ca90589ece6`; both the app outbox and browser normalized text hash to `1ff5b01133080b182b40ae9840e5645522b0305fa891e3aaac6c7e71190bced7`. The receipt has not yet been recovered in the app. Opera's companion remained on “Looking for the app” after reload, and the app shut down at 23:09 UTC. Further live inspection was blocked by native computer-control service startup failures; the alternate Desktop connector returned HTTP 504. Do not claim full end-to-end delivery recovery has passed.

The final bounded-receipt ARM64 build was installed in `/Applications/MALACHI OVERDRIVE.app`, its signature verified, and its companion code matched the stable unpacked extension. The Documents shortcut still targets that installed app. The app was closed during installation; relaunch and companion reconnection are the next live checks when native computer control is available.

### Local verification follow-up — 2026-09-17

The installed ARM64 app reopened and authenticated its browser wake channel. Both tunnels recovered automatically from the overnight connection interruptions; later successful Desktop connector calls established that the tunnel can transport requests. This is not evidence of a completed chat delivery.

The full `npm run verify` passed on the current source: 141 ordinary suites passed (6 skipped), with 3,482 tests passed and 106 skipped, followed by the separate shutdown suite with 2 tests passed. The installed app signature passed `codesign --verify --deep --strict`. The source, installed resources and stable Opera extension directory have identical `background.js`, `content.js` and `chatgpt-dom.js` files. The Documents shortcut still resolves to the installed app.

The remaining live send check is blocked by confirmed macOS permissions, not merely an unavailable screenshot: the Desktop connector returned `SCREEN_PERMISSION_REQUIRED`, then reported an open `universalAccessAuthWarn` window and `ACCESSIBILITY_PERMISSION_REQUIRED`. The user has been asked to enable Accessibility/Device Control and Screen Recording for MALACHI OVERDRIVE and fully restart it. Native Sky control separately fails to start its pipe. No new message was sent, no failed input was resent, and no delivery was marked successful. Complete a new authorized send/reply check once permissions are restored; release status remains unchanged.

### Successful local send verification — 2026-09-17, 10:20 UTC

After the user restarted Codex, native CUA control was available again. A new harmless input was sent through the installed Overdrive composer: `Delivery check 2026-09-17: reply exactly OVERDRIVE_READY. Do not use tools or open files.` Input `7736d5f5-5ad9-4088-82a5-0fb7c200cd3f` was claimed after 1,536 ms and acknowledged after 9,494 ms. Its durable state is `sent`, with no error, conversation `6aabbee0-df34-83ea-b069-f2fb53413749`, and user message `b9a87564-8849-49eb-b642-8f9c51c10e0a`. The app created session `2026-09-17-d14e90ff`.

The Overdrive UI visibly displayed both `Delivery confirmed` and the assistant reply `OVERDRIVE_READY`. This passes the local ordinary fresh-chat send/reply check on the installed candidate. It does not prove overnight reliability, long-message delivery, compaction recovery, or the other release gates. The old uncertain send was not resent or manually marked successful. Full verification and installed-file/signature checks from the earlier follow-up remain applicable; no production code changed during this live verification.

## 18. Anything NOT TESTED

Live scenarios 1–5, end-to-end three-worker stress and failure recovery, exact live model admission for prime/workers, overnight sleep/wake/reconnect, complete first-run journey, staged updater failure/recovery, macOS x64, Windows x64/ARM64, Linux x64/ARM64, and the public release workflow.

## 19. Release gate

| Gate | Status | Evidence / limit |
| --- | --- | --- |
| Core tools | PASS | Focused MCP and preview fixtures; live read calls observed. |
| Terminal execution | NOT TESTED | Live task's initial shell path was rejected; fixture coverage does not prove a complete terminal run. |
| Folder security | PASS | Live preview authorization and folder fixtures; selective security review. |
| Multi-agent | NOT TESTED | Live spawn and reports not confirmed. |
| 3-worker stress test | NOT TESTED | No completed simultaneous three-worker run. |
| Model truth | NOT TESTED | No live admitted-model confirmation. |
| Exact-model failure handling | PASS | Regression fixtures only; live admission remains open. |
| Control Rail | PASS | Renderer and packaged visual fixture checks; live detailed state not fully exercised. |
| Session persistence | PASS | Existing session catalog loaded; regression suite. |
| Compact & Resume | FAIL | Live summary saved; destination showed “Something went wrong” and did not confirm the handoff. |
| Recovery | FAIL | Live provider error remained unresolved; fixtures pass but no successful end-to-end recovery. |
| Provider-limit behavior | PASS | 4xx/429 retry classification and regression coverage. |
| Provider compliance | PASS | Source search and retry fix; no account/quota evasion found. |
| Updater | NOT TESTED | Local package lacks configured release source. |
| Windows packages | NOT TESTED | CI run and installer smoke absent. |
| macOS packages | NOT TESTED | ARM64 only; x64 absent. |
| Linux packages | NOT TESTED | CI run and installer smoke absent. |
| Documentation truth | PASS | README, SECURITY, CHANGELOG aligned for examined areas. |
| Full relevant test suite | PASS | Clean final `npm run verify`: 3,475 main + 2 shutdown passed. |
| Production build | PASS | Final-source `npm run build` passed; macOS ARM64 packaged candidate predates the last copy edit. |

## 20. Final recommendation

**NOT READY.** Keep this candidate in local evaluation. Complete the live dogfood and three-worker run, run the overnight recovery matrix, and obtain green native CI artifacts and updater evidence before proposing a public release. Do not tag or publish on this report alone.
