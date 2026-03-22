/**
 * Unit tests for HTML output with 6-theme system.
 */

import { describe, it, expect } from 'vitest';
import { renderInteractiveHTML, resolveThemeName } from './html';
import type { StaticEffectIR, StaticEffectNode, StaticGeneratorNode } from '../types';

function makeEffectNode(id: string, callee: string): StaticEffectNode {
  return { id, type: 'effect', callee };
}

function makeGeneratorNode(
  id: string,
  yields: { effect: StaticEffectNode }[],
): StaticGeneratorNode {
  return {
    id,
    type: 'generator',
    yields: yields.map((y) => ({ effect: y.effect })),
  };
}

function makeIR(rootChildren: StaticEffectIR['root']['children']): StaticEffectIR {
  return {
    root: {
      id: 'program-1',
      type: 'program',
      programName: 'testProgram',
      source: 'generator',
      children: rootChildren,
      dependencies: [],
      errorTypes: [],
    },
    metadata: {
      analyzedAt: Date.now(),
      filePath: 'test.ts',
      warnings: [],
      stats: {
        totalEffects: 0,
        parallelCount: 0,
        raceCount: 0,
        errorHandlerCount: 0,
        retryCount: 0,
        timeoutCount: 0,
        resourceCount: 0,
        loopCount: 0,
        conditionalCount: 0,
        layerCount: 0,
        interruptionCount: 0,
        unknownCount: 0,
        decisionCount: 0,
        switchCount: 0,
        tryCatchCount: 0,
        terminalCount: 0,
        opaqueCount: 0,
      },
    },
    references: new Map(),
  };
}

const sampleIR = makeIR([
  makeGeneratorNode('gen-1', [
    { effect: makeEffectNode('e1', 'Effect.succeed') },
  ]),
]);

describe('html output', () => {
  describe('resolveThemeName', () => {
    it('maps "light" to "daylight"', () => {
      expect(resolveThemeName('light')).toBe('daylight');
    });

    it('maps "dark" to "midnight"', () => {
      expect(resolveThemeName('dark')).toBe('midnight');
    });

    it('passes named themes through unchanged', () => {
      expect(resolveThemeName('ocean')).toBe('ocean');
      expect(resolveThemeName('ember')).toBe('ember');
      expect(resolveThemeName('forest')).toBe('forest');
      expect(resolveThemeName('daylight')).toBe('daylight');
      expect(resolveThemeName('paper')).toBe('paper');
      expect(resolveThemeName('midnight')).toBe('midnight');
    });

    it('returns undefined for undefined input', () => {
      expect(resolveThemeName(undefined)).toBeUndefined();
    });
  });

  describe('theme CSS definitions', () => {
    const html = renderInteractiveHTML(sampleIR);

    it('includes all 6 theme CSS blocks', () => {
      expect(html).toContain('[data-theme="midnight"]');
      expect(html).toContain('[data-theme="ocean"]');
      expect(html).toContain('[data-theme="ember"]');
      expect(html).toContain('[data-theme="forest"]');
      expect(html).toContain('[data-theme="daylight"]');
      expect(html).toContain('[data-theme="paper"]');
    });

    it('uses CSS custom properties', () => {
      expect(html).toContain('var(--bg)');
      expect(html).toContain('var(--fg)');
      expect(html).toContain('var(--panel-bg)');
      expect(html).toContain('var(--header-bg)');
      expect(html).toContain('var(--border)');
      expect(html).toContain('var(--accent)');
    });
  });

  describe('theme picker UI', () => {
    const html = renderInteractiveHTML(sampleIR);

    it('contains a theme picker element', () => {
      expect(html).toContain('theme-picker');
    });

    it('contains a theme menu', () => {
      expect(html).toContain('theme-menu');
    });
  });

  describe('system preference detection', () => {
    const html = renderInteractiveHTML(sampleIR);

    it('includes prefers-color-scheme media query detection', () => {
      expect(html).toContain('prefers-color-scheme');
    });

    it('includes localStorage persistence', () => {
      expect(html).toContain('localStorage');
      expect(html).toContain('effect-viz-theme');
    });

    it('includes applyTheme function', () => {
      expect(html).toContain('applyTheme');
    });
  });

  describe('explicit theme option', () => {
    it('sets INITIAL_THEME to the specified theme', () => {
      const html = renderInteractiveHTML(sampleIR, { theme: 'ocean' });
      expect(html).toContain('INITIAL_THEME = "ocean"');
    });

    it('maps legacy "dark" to "midnight"', () => {
      const html = renderInteractiveHTML(sampleIR, { theme: 'dark' });
      expect(html).toContain('INITIAL_THEME = "midnight"');
    });

    it('maps legacy "light" to "daylight"', () => {
      const html = renderInteractiveHTML(sampleIR, { theme: 'light' });
      expect(html).toContain('INITIAL_THEME = "daylight"');
    });
  });

  describe('default system preference', () => {
    it('sets INITIAL_THEME to null when no theme specified', () => {
      const html = renderInteractiveHTML(sampleIR);
      expect(html).toContain('INITIAL_THEME = null');
    });
  });

  it('resolveTheme follows priority: INITIAL_THEME > localStorage > system preference', () => {
    const html = renderInteractiveHTML(sampleIR);
    expect(html).toContain('INITIAL_THEME');
    expect(html).toContain('localStorage.getItem');
    expect(html).toContain('getSystemPreference');
  });

  describe('data-theme attribute', () => {
    it('sets data-theme attribute on html element', () => {
      const html = renderInteractiveHTML(sampleIR);
      expect(html).toContain('data-theme');
    });
  });

  describe('mermaid theme integration', () => {
    it('uses dark mermaid theme for dark themes', () => {
      const html = renderInteractiveHTML(sampleIR, { theme: 'midnight' });
      // The JS should use base theme with custom themeVariables for each theme
      expect(html).toContain("theme: 'base'");
      expect(html).toContain('DARK_THEMES');
      expect(html).toContain("'midnight'");
    });
  });
});
