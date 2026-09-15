import { expect, it } from 'vitest';
import { githubResources } from '../src/shared/github-resources.js';

it('ships exactly the five reviewed GitHub resources with unique stable identities', () => {
  expect(githubResources.map((item) => item.id)).toEqual([
    'free-for-dev', 'public-apis', 'easyspider', 'awesome-mcp-servers', 'strix',
  ]);
  expect(new Set(githubResources.map((item) => item.id)).size).toBe(githubResources.length);
  expect(new Set(githubResources.map((item) => item.homepage)).size).toBe(githubResources.length);
  for (const item of githubResources) {
    const url = new URL(item.homepage);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('github.com');
  }
});

it('keeps directories as links and external tools outside the plugin runtime', () => {
  expect(githubResources.filter((item) => item.kind === 'directory').map((item) => item.id)).toEqual([
    'free-for-dev', 'public-apis', 'awesome-mcp-servers',
  ]);
  const easy = githubResources.find((item) => item.id === 'easyspider')!;
  expect(easy.kind).toBe('external-app');
  expect(easy.license).toContain('AGPL-3.0');
  expect(easy.license).toContain('not bundled');
  expect(easy.setupCommand).toBeUndefined();
});

it('keeps Strix opt-in and states the authorization boundary before setup', () => {
  const strix = githubResources.find((item) => item.id === 'strix')!;
  expect(strix.kind).toBe('security-tool');
  expect(strix.license).toBe('Apache-2.0');
  expect(strix.setupCommand).toBe('npx skills add usestrix/strix');
  expect(strix.warning).toMatch(/own or are explicitly authorized to test/i);
  expect(strix.warning).toMatch(/never starts a pentest automatically/i);
});
