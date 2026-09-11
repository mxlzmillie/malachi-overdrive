import type { LocalProject } from '../shared/projects.js';
import { MAX_INPUT_TEXT_CHARS, INPUT_TEXT_LIMIT_MESSAGE } from '../shared/input.js';

/** Authored starting points, not automation: choosing one only prepares an editable draft. */
export const WORK_RECIPES = [
  {
    id: 'build', label: 'Build a feature', icon: 'i-bolt',
    detail: 'Inspect → implement → test. Keep the existing architecture.',
    prompt: 'Inspect this project and its AGENTS.md first. Implement the requested feature end to end using the existing architecture and installed dependencies. Preserve unrelated changes. Keep a short plan, add focused regression tests, run the relevant checks and verify the visible result when applicable. Report changed files, actual validation and remaining blockers.'
  },
  {
    id: 'fix', label: 'Diagnose and fix', icon: 'i-terminal',
    detail: 'Reproduce the failure, fix its cause, prove the regression is gone.',
    prompt: 'Read this project’s instructions and reproduce the reported failure before editing. Trace the root cause, make the smallest complete fix, and add a regression test that fails before the fix and passes afterwards. Verify neighboring failure cases. Do not hide errors, relax permissions or add speculative retries. Report the cause, changes and actual test results.'
  },
  {
    id: 'polish', label: 'Polish the interface', icon: 'i-pencil',
    detail: 'Improve hierarchy, responsiveness and keyboard accessibility.',
    prompt: 'Inspect the current interface and project instructions. Preserve its established identity while improving hierarchy, spacing, readability, empty/error states and keyboard accessibility. Reuse existing components and assets. Verify the real result at desktop and narrow widths, including focus, overflow and reduced-motion behavior. Keep functional behavior intact and report the checks actually performed.'
  },
  {
    id: 'verify', label: 'Verify before release', icon: 'i-check',
    detail: 'Check the current diff, tests and build. Do not deploy.',
    prompt: 'Review the current project instructions and working-tree changes without discarding existing work. Identify the relevant verification commands from this project, run focused tests and the appropriate build, and inspect the visible result when applicable. Separate confirmed passes, failures, skipped checks and untested behavior. Do not deploy, install dependencies or change paid-service settings. Report release blockers with the next concrete action.'
  },
  {
    id: 'handoff', label: 'Prepare a project handoff', icon: 'i-steps',
    detail: 'Capture decisions, changed files, evidence and the next action.',
    prompt: 'Read this project’s instructions and existing handoff, then verify the current state against its files. Create or update a concise project handoff with the goal, decisions, changed files, exact validation results, known blockers and next concrete actions. Preserve unrelated documentation. Do not include secrets, invent completed checks or perform a deployment.'
  }
] as const;

export function projectContinuation(project: LocalProject): string {
  return `Continue working on ${project.name}.\n\n${project.brief ?? project.summary ?? ''}\n\nFirst read this project's AGENTS.md and handoff/README if present. Use this project's existing files together; do not ask me to pick individual source files. Confirm the current state before changing anything.\n\nWhat I want to do next: `;
}

/** Never truncate or replace the person's text; a rejected append leaves the caller unchanged. */
export function appendWorkRecipe(draft: string, recipe: typeof WORK_RECIPES[number]): string {
  const addition = `Working approach — ${recipe.label}\n${recipe.prompt}`;
  const next = draft ? `${draft}\n\n${addition}` : `${addition}\n\nMy requirements: `;
  if (next.length > MAX_INPUT_TEXT_CHARS) throw new Error(INPUT_TEXT_LIMIT_MESSAGE);
  return next;
}
