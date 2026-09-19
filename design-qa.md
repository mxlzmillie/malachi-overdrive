# Ambient Edge design QA

**Source visual truth**

- `/workspace/scratch/f357ae0128dc/generated_images/exec-9a643a7a-a60d-4c4c-9325-bb50386d7193.png`
- Source pixels: 1536 × 1080. Desktop dark-state concept at generated-image density.

**Rendered implementation**

- `/Users/malachi/Developer/Chat On Steroids Workspace/malachi-overdrive-release-v2.0.19/artifacts/ambient-edge-2-0-20/ambient-edge-desktop-dark.png`
- Implementation pixels: 1440 × 900 from the production Electron/Chromium renderer, CSS viewport 1440 × 900, device scale factor 1.
- Responsive evidence: `artifacts/ambient-edge-2-0-20/ambient-edge-mobile-390.png` at a 390 × 844 CSS viewport.
- State: dark theme, active prime plus active worker, genuine latest activity and output counts, Ambient Edge preview expanded, full Control Rail closed.

The captures use different full-app canvases because the concept reimagines the conversation shell while the implementation deliberately preserves MALACHI OVERDRIVE's existing production shell. The comparison therefore normalizes around the shared right-edge capsule and preview state rather than claiming pixel-for-pixel parity across unrelated navigation and conversation content.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation keeps the product's existing sans/mono pairing, compact uppercase operational heading, restrained weights, and readable two-level hierarchy from the concept. Dynamic task and action copy truncate or clamp instead of colliding.
- Spacing and layout rhythm: the capsule remains narrow and detached from the work canvas; the preview is anchored beside it with equivalent grouping, border rhythm, radii, and elevation. The production geometry checks confirm no page overflow, clipped composer, or modal scrim at desktop and mobile widths.
- Colors and tokens: near-black surfaces, charcoal elevation, hairline borders, soft secondary text, and restrained MALACHI red states match the selected direction while using the existing production tokens.
- Image quality and asset fidelity: the concept's website thumbnail is illustrative. The implementation does not invent or rasterize a fake preview; it presents genuine task/activity/output state and uses the product's existing icon sprite. This is an intentional trust constraint, not missing placeholder art.
- Copy and content: “Working in background,” “The page stays yours while MALACHI works,” “Keep in background,” and “Open workbench” clearly explain the behavior without claiming unavailable progress percentages.
- Icons and controls: icons come from the existing product icon family, remain optically aligned, and all visible controls are real buttons with labels.
- Accessibility: capsule, close, new-task, completion, and workbench controls have accessible names; Escape closes the non-modal preview and restores focus; reduced-motion disables the live ring animation.

## Full-view comparison evidence

The source and implementation were opened together in one comparison input. Both preserve the conversation as the dominant surface, place a slim status capsule at the far-right edge, open a compact adjacent work preview without a page-covering overlay, expose an explicit larger workbench action, and reserve completion feedback for a small corner notification.

## Focused region comparison evidence

The original-resolution implementation capture was inspected around the right-edge capsule and preview. Heading, live state, elapsed time, latest genuine activity, active-worker/output facts, close control, quiet-background action, and workbench action are all readable and aligned. A separate crop was unnecessary because the original 1440-pixel capture exposes the complete component at legible size.

## Primary interactions and runtime checks

- Open and close the compact preview from the capsule.
- Keep work in the background without opening the full rail or adding a scrim.
- Open the full Control Rail only from the explicit workbench action.
- Preserve the current composer draft and page scroll.
- Show and automatically dismiss a completion notification on a real RUNNING → COMPLETE transition.
- Fit the preview and capsule at 1440 × 900 and 390 × 844.
- Production renderer reported zero console errors, zero forbidden fixture actions, and zero external requests.

## Comparison history

- Pass 1: no P0/P1/P2 findings. The implementation intentionally replaced the concept's illustrative thumbnail and fake determinate progress bar with genuine structured state so MALACHI never pretends to know a preview or percentage it does not have. No visual fix loop was required.

## Follow-up polish

- P3: when a future output-preview API exposes a verified image or local web preview, the preview card can display that real artifact without changing this layout.

final result: passed
