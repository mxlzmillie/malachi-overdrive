import { expect, it } from 'vitest';
import { appendWorkRecipe, projectContinuation, WORK_RECIPES } from '../src/renderer/work-recipes.js';
import { MAX_INPUT_TEXT_CHARS } from '../src/shared/input.js';

it('keeps the exact original draft before adding a readable working approach', () => {
  const draft = 'My unfinished requirement\n  Keep the spacing.  ';
  const next = appendWorkRecipe(draft, WORK_RECIPES[1]);
  expect(next.startsWith(`${draft}\n\nWorking approach — Diagnose and fix`)).toBe(true);
  expect(next).toContain('regression test');
});

it('provides an editable requirements placeholder for a new brief', () => {
  for (const recipe of WORK_RECIPES) expect(appendWorkRecipe('', recipe)).toMatch(/My requirements: $/);
  expect(new Set(WORK_RECIPES.map(recipe => recipe.id)).size).toBe(WORK_RECIPES.length);
});

it('refuses an oversized append instead of truncating authored requirements', () => {
  const draft = 'a'.repeat(MAX_INPUT_TEXT_CHARS);
  expect(() => appendWorkRecipe(draft, WORK_RECIPES[0])).toThrow('64,000');
  expect(draft).toHaveLength(MAX_INPUT_TEXT_CHARS);
});

it('continues the selected project with its exact custom brief and no individual-file selection', () => {
  const next = projectContinuation({ id: 'custom', name: 'Malachi Overdrive', path: '/custom', createdAt: 1, brief: 'Use customised v2.0.8, not upstream.', summary: 'Generic summary.' });
  expect(next).toContain('Use customised v2.0.8, not upstream.');
  expect(next).not.toContain('Generic summary.');
  expect(next).toContain('AGENTS.md');
  expect(next).toContain('do not ask me to pick individual source files');
});

it('keeps release verification explicitly separate from deployment and installation', () => {
  const release = WORK_RECIPES.find(recipe => recipe.id === 'verify')!;
  expect(release.prompt).toContain('Do not deploy, install dependencies');
});
