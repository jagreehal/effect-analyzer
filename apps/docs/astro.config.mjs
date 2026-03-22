import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://jagreehal.github.io',
  base: '/effect-analyzer',
  integrations: [
    starlight({
      title: 'effect-analyzer',
      favicon: '/favicon.svg',
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      logo: {
        dark: './src/assets/logo-dark.svg',
        light: './src/assets/logo-light.svg',
        replacesTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/effect-analyzer' },
      ],
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource/jetbrains-mono',
        './src/styles/custom.css',
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Installation', slug: 'installation' },
            { label: 'Quick Start', slug: 'quick-start' },
          ],
        },
        {
          label: 'Diagrams',
          items: [
            { label: 'Overview', slug: 'diagrams/overview' },
            { label: 'Railway Diagrams', slug: 'diagrams/railway' },
            { label: 'Service Maps', slug: 'diagrams/services' },
            { label: 'Error Flows', slug: 'diagrams/errors' },
            { label: 'All Formats', slug: 'diagrams/all-formats' },
          ],
        },
        {
          label: 'Analysis',
          items: [
            { label: 'Complexity Metrics', slug: 'analysis/complexity' },
            { label: 'Execution Paths', slug: 'analysis/paths' },
            { label: 'Test Coverage Matrix', slug: 'analysis/test-matrix' },
            { label: 'Data Flow', slug: 'analysis/data-flow' },
            { label: 'Error Analysis', slug: 'analysis/errors' },
          ],
        },
        {
          label: 'Project Tools',
          items: [
            { label: 'Coverage Audit', slug: 'project/coverage-audit' },
            { label: 'Semantic Diff', slug: 'project/diff' },
            { label: 'Migration Assistant', slug: 'project/migration' },
            { label: 'Strict Diagnostics', slug: 'project/diagnostics' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Library API', slug: 'reference/api' },
            { label: 'Interactive HTML', slug: 'reference/html-viewer' },
          ],
        },
      ],
    }),
  ],
});
