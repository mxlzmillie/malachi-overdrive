export type GithubResourceKind = 'directory' | 'external-app' | 'security-tool';

export interface GithubResourceEntry {
  id: string;
  name: string;
  description: string;
  kind: GithubResourceKind;
  icon: string;
  homepage: string;
  license: string;
  badge: string;
  actionLabel: string;
  secondaryUrl?: string;
  secondaryLabel?: string;
  setupCommand?: string;
  warning?: string;
}

/** Reviewed upstream GitHub resources. These are links/setup recipes, never vendored source. */
export const githubResources: GithubResourceEntry[] = [
  {
    id: 'free-for-dev',
    name: 'free-for.dev',
    description: 'Curated free tiers for cloud, developer infrastructure, APIs, hosting and tooling.',
    kind: 'directory',
    icon: 'free-dev',
    homepage: 'https://github.com/ripienaar/free-for-dev',
    license: 'Linked upstream resource · no root license file detected',
    badge: 'Free developer services',
    actionLabel: 'Open directory',
  },
  {
    id: 'public-apis',
    name: 'Public APIs',
    description: 'A community-maintained directory of public APIs across business, data, media and developer categories.',
    kind: 'directory',
    icon: 'public-apis',
    homepage: 'https://github.com/public-apis/public-apis',
    license: 'MIT',
    badge: 'API directory',
    actionLabel: 'Browse APIs',
  },
  {
    id: 'easyspider',
    name: 'EasySpider',
    description: 'Visual no-code browser automation, data collection and web crawling with a separate desktop/CLI runtime.',
    kind: 'external-app',
    icon: 'easyspider',
    homepage: 'https://github.com/NaiboWang/EasySpider',
    license: 'AGPL-3.0 · external application, not bundled',
    badge: 'Web automation',
    actionLabel: 'Open project',
    secondaryUrl: 'https://github.com/NaiboWang/EasySpider/releases',
    secondaryLabel: 'Open releases',
    warning: 'EasySpider runs separately with your operating-system permissions. Review the upstream release and scraping rules for every site you automate.',
  },
  {
    id: 'awesome-mcp-servers',
    name: 'Awesome MCP Servers',
    description: 'A large community directory of Model Context Protocol servers and integrations to explore.',
    kind: 'directory',
    icon: 'mcp-directory',
    homepage: 'https://github.com/punkpeye/awesome-mcp-servers',
    license: 'MIT',
    badge: 'MCP directory',
    actionLabel: 'Browse MCP servers',
  },
  {
    id: 'strix',
    name: 'Strix',
    description: 'Open-source AI application-security testing with a local CLI, Docker sandbox and agent skills.',
    kind: 'security-tool',
    icon: 'strix',
    homepage: 'https://github.com/usestrix/strix',
    license: 'Apache-2.0',
    badge: 'Security testing',
    actionLabel: 'Open project',
    secondaryUrl: 'https://docs.strix.ai/quickstart',
    secondaryLabel: 'Open setup guide',
    setupCommand: 'npx skills add usestrix/strix',
    warning: 'Use Strix only on applications and systems you own or are explicitly authorized to test. OVERDRIVE never starts a pentest automatically.',
  },
];
