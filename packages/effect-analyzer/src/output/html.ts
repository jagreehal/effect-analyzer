/**
 * Interactive HTML Output (GAP 22 v2)
 *
 * Generates a self-contained HTML file with:
 * - Embedded IR and Mermaid diagram
 * - Search/filter nodes by type, name, complexity
 * - Click-to-navigate: click node to see source location, IR details
 * - Path explorer: select a path and highlight it
 * - Complexity heatmap: color nodes by complexity contribution
 * - Error/data flow toggles
 * - 6-theme system with system preference detection and localStorage persistence
 */

import type { StaticEffectIR } from '../types';
import { renderStaticMermaid } from './mermaid';
import { generatePaths } from '../path-generator';
import { calculateComplexity } from '../complexity';

export type HtmlTheme = 'midnight' | 'ocean' | 'ember' | 'forest' | 'daylight' | 'paper';

export interface HtmlOutputOptions {
  readonly title?: string | undefined;
  /** Named theme, or legacy 'light'/'dark' aliases (mapped to daylight/midnight). */
  readonly theme?: HtmlTheme | 'light' | 'dark' | undefined;
}

/**
 * Maps legacy theme aliases to their named equivalents.
 * Returns the theme name unchanged if it's already a named theme.
 */
export function resolveThemeName(
  theme: HtmlTheme | 'light' | 'dark' | undefined,
): HtmlTheme | undefined {
  if (theme === 'light') return 'daylight';
  if (theme === 'dark') return 'midnight';
  return theme;
}


/**
 * Render IR as a self-contained HTML page with interactive features.
 */
export function renderInteractiveHTML(
  ir: StaticEffectIR,
  options: HtmlOutputOptions = {},
): string {
  const title = options.title ?? `${ir.root.programName} - Effect Analysis`;
  const resolvedTheme = resolveThemeName(options.theme);
  const mermaidCode = renderStaticMermaid(ir).replace(/<\/script>/gi, '<\\/script>');

  // Generate paths and complexity for embedding
  const paths = generatePaths(ir);
  const complexity = calculateComplexity(ir);

  // Also generate the data-flow and error-flow overlay versions
  const mermaidWithDataFlow = renderStaticMermaid(ir, { dataFlowOverlay: true }).replace(/<\/script>/gi, '<\\/script>');
  const mermaidWithErrorFlow = renderStaticMermaid(ir, { errorFlowOverlay: true }).replace(/<\/script>/gi, '<\\/script>');

  const irJson = JSON.stringify(ir, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  const pathsJson = JSON.stringify(paths, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  const complexityJson = JSON.stringify(complexity, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');

  const initialThemeJs = resolvedTheme ? `"${resolvedTheme}"` : 'null';

  return `<!DOCTYPE html>
<html lang="en" data-theme="midnight">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></scr` + `ipt>
  <style>
    /* Theme definitions */
    [data-theme="midnight"] {
      --bg: #0f1117; --fg: #d4d7e0; --panel-bg: #161921; --header-bg: #1c1f2b;
      --border: #262a3a; --accent: #7b9dea; --accent-dim: rgba(123,157,234,0.12);
      --selected-bg: #1a3a5c;
    }
    [data-theme="ocean"] {
      --bg: #0a1628; --fg: #c8d8ee; --panel-bg: #0f1e35; --header-bg: #142742;
      --border: #1a3452; --accent: #4da6e8; --accent-dim: rgba(77,166,232,0.12);
      --selected-bg: #0f2847;
    }
    [data-theme="ember"] {
      --bg: #1a0f0f; --fg: #e0d0c8; --panel-bg: #221414; --header-bg: #2e1a1a;
      --border: #3a2222; --accent: #e8845a; --accent-dim: rgba(232,132,90,0.12);
      --selected-bg: #2e1a1a;
    }
    [data-theme="forest"] {
      --bg: #0c1a0f; --fg: #c8d8c8; --panel-bg: #111f14; --header-bg: #18281a;
      --border: #1e3a20; --accent: #5ac87a; --accent-dim: rgba(90,200,122,0.12);
      --selected-bg: #18281a;
    }
    [data-theme="daylight"] {
      --bg: #f8f9fb; --fg: #1a2030; --panel-bg: #ffffff; --header-bg: #ffffff;
      --border: #dde1ea; --accent: #3a6fd8; --accent-dim: rgba(58,111,216,0.08);
      --selected-bg: #e3f2fd;
    }
    [data-theme="paper"] {
      --bg: #faf8f5; --fg: #2a2218; --panel-bg: #fffefa; --header-bg: #fffefa;
      --border: #e0d8cc; --accent: #b07830; --accent-dim: rgba(176,120,48,0.08);
      --selected-bg: #f4f0e8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); }

    .header { padding: 0.75rem 1rem; background: var(--header-bg); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .header h1 { font-size: 1.1rem; font-weight: 600; }
    .header .stats { font-size: 0.8rem; opacity: 0.7; }

    .theme-picker { position: relative; margin-left: auto; }
    .theme-picker button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-bg); color: var(--fg); cursor: pointer; font-size: 0.8rem; }
    .theme-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 0; min-width: 140px; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    .theme-menu.open { display: block; }
    .theme-menu button { display: block; width: 100%; padding: 6px 12px; border: none; background: transparent; color: var(--fg); text-align: left; cursor: pointer; font-size: 0.8rem; }
    .theme-menu button:hover { background: var(--accent-dim); }
    .theme-menu button.active { color: var(--accent); font-weight: 600; }

    .toolbar { padding: 0.5rem 1rem; background: var(--panel-bg); border-bottom: 1px solid var(--border); display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .toolbar input[type="text"] { padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); font-size: 0.85rem; width: 200px; }
    .toolbar select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); font-size: 0.85rem; }
    .toolbar label { font-size: 0.85rem; display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .toolbar .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }

    .layout { display: grid; grid-template-columns: 1fr 380px; height: calc(100vh - 90px); }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } }

    .diagram-pane { overflow: auto; padding: 1rem; border-right: 1px solid var(--border); }
    .diagram-pane .mermaid { min-height: 200px; }

    .sidebar { overflow-y: auto; display: flex; flex-direction: column; }
    .sidebar-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--header-bg); }
    .sidebar-tabs button { flex: 1; padding: 8px; border: none; background: transparent; color: var(--fg); cursor: pointer; font-size: 0.8rem; border-bottom: 2px solid transparent; }
    .sidebar-tabs button.active { border-bottom-color: var(--accent); font-weight: 600; }
    .sidebar-tabs button:hover { background: var(--panel-bg); }

    .tab-content { flex: 1; overflow-y: auto; padding: 0.75rem; font-size: 0.85rem; }
    .tab-content[hidden] { display: none; }

    .detail-section { margin-bottom: 1rem; }
    .detail-section h3 { font-size: 0.9rem; margin-bottom: 0.4rem; color: var(--accent); }
    .detail-section pre { background: var(--panel-bg); padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.75rem; white-space: pre-wrap; word-break: break-word; }
    .detail-section table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .detail-section td, .detail-section th { padding: 4px 8px; text-align: left; border-bottom: 1px solid var(--border); }

    .path-item { padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 0.8rem; }
    .path-item:hover { background: var(--panel-bg); }
    .path-item.selected { border-color: var(--accent); background: var(--selected-bg); }
    .path-step { display: inline-block; padding: 2px 6px; margin: 1px; background: var(--panel-bg); border-radius: 3px; font-size: 0.75rem; }

    .complexity-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }
    .complexity-low { background: #C8E6C9; color: #1B5E20; }
    .complexity-medium { background: #FFF9C4; color: #F57F17; }
    .complexity-high { background: #FFCDD2; color: #B71C1C; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <span class="stats" id="complexity-stats"></span>
    <div class="theme-picker">
      <button onclick="toggleThemeMenu()" id="theme-btn">Theme</button>
      <div class="theme-menu" id="theme-menu">
        <button onclick="applyTheme('midnight')">Midnight</button>
        <button onclick="applyTheme('ocean')">Ocean</button>
        <button onclick="applyTheme('ember')">Ember</button>
        <button onclick="applyTheme('forest')">Forest</button>
        <button onclick="applyTheme('daylight')">Daylight</button>
        <button onclick="applyTheme('paper')">Paper</button>
      </div>
    </div>
  </div>
  <div class="toolbar">
    <input type="text" id="search" placeholder="Search nodes..." oninput="handleSearch(this.value)">
    <select id="typeFilter" onchange="handleTypeFilter(this.value)">
      <option value="">All types</option>
    </select>
    <div class="sep"></div>
    <label><input type="checkbox" id="toggleDataFlow" onchange="toggleOverlay('data')"> Data Flow</label>
    <label><input type="checkbox" id="toggleErrorFlow" onchange="toggleOverlay('error')"> Error Flow</label>
    <div class="sep"></div>
    <select id="pathSelect" onchange="selectPath(this.value)">
      <option value="">Select path...</option>
    </select>
  </div>
  <div class="layout">
    <div class="diagram-pane">
      <pre class="mermaid" id="mermaid-diagram">${escapeHtml(mermaidCode)}</pre>
    </div>
    <div class="sidebar">
      <div class="sidebar-tabs">
        <button class="active" onclick="showTab('details')">Details</button>
        <button onclick="showTab('paths')">Paths</button>
        <button onclick="showTab('ir')">IR</button>
      </div>
      <div class="tab-content" id="tab-details">
        <div class="detail-section">
          <h3>Complexity</h3>
          <table id="complexity-table"></table>
        </div>
        <div class="detail-section" id="node-details">
          <h3>Node Details</h3>
          <p style="opacity:0.6">Click a node in the diagram to see details.</p>
        </div>
      </div>
      <div class="tab-content" id="tab-paths" hidden>
        <div id="paths-list"></div>
      </div>
      <div class="tab-content" id="tab-ir" hidden>
        <pre id="ir-json" style="font-size:0.7rem">${irJson}</pre>
      </div>
    </div>
  </div>
  <script>
    var INITIAL_THEME = ${initialThemeJs};
    var STORAGE_KEY = 'effect-viz-theme';
    var DARK_THEMES = ['midnight', 'ocean', 'ember', 'forest'];

    var MERMAID_THEME_VARS = {
      midnight: { primaryColor: '#1e2233', primaryTextColor: '#d4d7e0', primaryBorderColor: '#3a4266', lineColor: '#3a4266', secondaryColor: '#262a3a', tertiaryColor: '#1c1f2b', background: '#0f1117', mainBkg: '#1e2233', nodeBorder: '#3a4266', clusterBkg: '#161921', clusterBorder: '#3a4266', titleColor: '#d4d7e0', edgeLabelBackground: '#161921', nodeTextColor: '#d4d7e0' },
      ocean: { primaryColor: '#132d4a', primaryTextColor: '#c8d8ee', primaryBorderColor: '#1f4a70', lineColor: '#1f4a70', secondaryColor: '#0f1e35', tertiaryColor: '#142742', background: '#0a1628', mainBkg: '#132d4a', nodeBorder: '#1f4a70', clusterBkg: '#0f1e35', clusterBorder: '#1f4a70', titleColor: '#c8d8ee', edgeLabelBackground: '#0f1e35', nodeTextColor: '#c8d8ee' },
      ember: { primaryColor: '#2e1c18', primaryTextColor: '#e0d0c8', primaryBorderColor: '#5a3328', lineColor: '#5a3328', secondaryColor: '#221414', tertiaryColor: '#2e1a1a', background: '#1a0f0f', mainBkg: '#2e1c18', nodeBorder: '#5a3328', clusterBkg: '#221414', clusterBorder: '#5a3328', titleColor: '#e0d0c8', edgeLabelBackground: '#221414', nodeTextColor: '#e0d0c8' },
      forest: { primaryColor: '#152e1a', primaryTextColor: '#c8d8c8', primaryBorderColor: '#264a2c', lineColor: '#264a2c', secondaryColor: '#111f14', tertiaryColor: '#18281a', background: '#0c1a0f', mainBkg: '#152e1a', nodeBorder: '#264a2c', clusterBkg: '#111f14', clusterBorder: '#264a2c', titleColor: '#c8d8c8', edgeLabelBackground: '#111f14', nodeTextColor: '#c8d8c8' },
      daylight: { primaryColor: '#e8ecf4', primaryTextColor: '#1a2030', primaryBorderColor: '#b0b8cc', lineColor: '#b0b8cc', secondaryColor: '#f0f2f8', tertiaryColor: '#ffffff', background: '#f8f9fb', mainBkg: '#e8ecf4', nodeBorder: '#b0b8cc', clusterBkg: '#ffffff', clusterBorder: '#dde1ea', titleColor: '#1a2030', edgeLabelBackground: '#ffffff', nodeTextColor: '#1a2030' },
      paper: { primaryColor: '#f0ebe0', primaryTextColor: '#2a2218', primaryBorderColor: '#c8bda8', lineColor: '#c8bda8', secondaryColor: '#f5f0e8', tertiaryColor: '#fffefa', background: '#faf8f5', mainBkg: '#f0ebe0', nodeBorder: '#c8bda8', clusterBkg: '#fffefa', clusterBorder: '#e0d8cc', titleColor: '#2a2218', edgeLabelBackground: '#fffefa', nodeTextColor: '#2a2218' }
    };

    function getSystemPreference() {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'midnight';
      }
      return 'daylight';
    }

    function resolveTheme() {
      if (INITIAL_THEME) return INITIAL_THEME;
      try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return stored;
      } catch(e) {}
      return getSystemPreference();
    }

    // Restyle SVG nodes after Mermaid renders to match the active theme.
    // Mermaid classDef styles are baked into SVG elements as inline style with !important,
    // so we must directly modify the style attribute to override them.
    function rethemeSvgNodes(themeName) {
      var isDark = DARK_THEMES.indexOf(themeName) >= 0;
      var vars = MERMAID_THEME_VARS[themeName] || MERMAID_THEME_VARS.midnight;
      var svg = document.querySelector('.mermaid svg');
      if (!svg) return;
      // Override all label-container shapes (nodes)
      var shapes = svg.querySelectorAll('.label-container');
      shapes.forEach(function(el) {
        el.setAttribute('style', 'fill:' + vars.primaryColor + ' !important;stroke:' + vars.primaryBorderColor + ' !important;stroke-width:1px !important');
      });
      // Override node labels text color
      var labels = svg.querySelectorAll('.nodeLabel, .label');
      labels.forEach(function(el) {
        el.style.color = vars.primaryTextColor;
        el.style.fill = vars.primaryTextColor;
      });
      // Override edge paths
      var edges = svg.querySelectorAll('.flowchart-link');
      edges.forEach(function(el) {
        el.style.stroke = vars.lineColor;
      });
      // Override edge labels
      var edgeLabels = svg.querySelectorAll('.edgeLabel');
      edgeLabels.forEach(function(el) {
        el.style.backgroundColor = vars.edgeLabelBackground;
        el.style.color = vars.primaryTextColor;
      });
      var edgeLabelRects = svg.querySelectorAll('.edgeLabel rect');
      edgeLabelRects.forEach(function(el) {
        el.setAttribute('style', 'fill:' + vars.edgeLabelBackground + ' !important');
      });
      // Override arrowheads
      var markers = svg.querySelectorAll('.marker, .arrowMarkerPath');
      markers.forEach(function(el) {
        el.setAttribute('style', 'fill:' + vars.lineColor + ' !important;stroke:' + vars.lineColor + ' !important');
      });
    }

    function applyTheme(name, skipRerender) {
      document.documentElement.setAttribute('data-theme', name);
      try { localStorage.setItem(STORAGE_KEY, name); } catch(e) {}
      // Update mermaid theme with custom variables matching our theme
      var vars = MERMAID_THEME_VARS[name] || MERMAID_THEME_VARS.midnight;
      mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: vars, securityLevel: 'loose' });
      if (!skipRerender) {
        var el = document.getElementById('mermaid-diagram');
        if (el) {
          el.removeAttribute('data-processed');
          mermaid.init(undefined, el);
          // Re-apply node colors after Mermaid re-renders
          setTimeout(function() { rethemeSvgNodes(name); }, 500);
        }
      }
      // Update active state in menu
      var btns = document.querySelectorAll('.theme-menu button');
      btns.forEach(function(b) {
        b.classList.toggle('active', b.textContent.toLowerCase() === name);
      });
      document.getElementById('theme-menu').classList.remove('open');
    }

    function toggleThemeMenu() {
      document.getElementById('theme-menu').classList.toggle('open');
    }

    // Close menu on outside click
    document.addEventListener('click', function(e) {
      var picker = document.querySelector('.theme-picker');
      if (picker && !picker.contains(e.target)) {
        document.getElementById('theme-menu').classList.remove('open');
      }
    });

    // Listen for system preference changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        // Only react if no explicit theme was set
        try {
          if (!localStorage.getItem(STORAGE_KEY) && !INITIAL_THEME) {
            applyTheme(e.matches ? 'midnight' : 'daylight');
          }
        } catch(ex) {}
      });
    }

    // Apply initial theme (skip re-render since Mermaid hasn't rendered yet)
    applyTheme(resolveTheme(), true);

    // Init Mermaid (single init on page load)
    var currentThemeName = resolveTheme();
    var initVars = MERMAID_THEME_VARS[currentThemeName] || MERMAID_THEME_VARS.midnight;
    mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: initVars, securityLevel: 'loose' });

    const IR_DATA = ${irJson};
    const PATHS_DATA = ${pathsJson};
    const COMPLEXITY = ${complexityJson};
    const DIAGRAMS = {
      base: ${JSON.stringify(mermaidCode)},
      dataFlow: ${JSON.stringify(mermaidWithDataFlow)},
      errorFlow: ${JSON.stringify(mermaidWithErrorFlow)}
    };

    // Complexity stats
    document.getElementById('complexity-stats').textContent =
      'CC: ' + COMPLEXITY.cyclomaticComplexity +
      ' | Cognitive: ' + COMPLEXITY.cognitiveComplexity +
      ' | Depth: ' + COMPLEXITY.maxDepth +
      ' | Paths: ' + COMPLEXITY.pathCount;

    // Complexity table
    var ct = document.getElementById('complexity-table');
    ct.innerHTML = Object.entries(COMPLEXITY).map(function(e) {
      return '<tr><td>' + e[0] + '</td><td><b>' + e[1] + '</b></td></tr>';
    }).join('');

    // Paths list
    var pl = document.getElementById('paths-list');
    var pathSelect = document.getElementById('pathSelect');
    PATHS_DATA.forEach(function(p, i) {
      var div = document.createElement('div');
      div.className = 'path-item';
      div.onclick = function() { selectPath(i); };
      div.innerHTML = '<b>Path ' + (i+1) + '</b> (' + p.steps.length + ' steps)<br>' +
        p.steps.map(function(s) { return '<span class="path-step">' + (s.name||s.nodeId) + '</span>'; }).join(' \u2192 ');
      pl.appendChild(div);
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = 'Path ' + (i+1) + ' (' + p.steps.length + ' steps)';
      pathSelect.appendChild(opt);
    });

    // Build flat node index for click-to-navigate
    var nodeIndex = {};
    function indexNodes(nodes) {
      if (!nodes) return;
      nodes.forEach(function(n) {
        if (n.id) nodeIndex[n.id] = n;
        // Recurse into known child arrays
        if (n.children) indexNodes(n.children);
        if (n.onTrue) indexNodes(n.onTrue);
        if (n.onFalse) indexNodes(n.onFalse);
        if (n.tryBody) indexNodes(n.tryBody);
        if (n.catchBody) indexNodes(n.catchBody);
        if (n.finallyBody) indexNodes(n.finallyBody);
        if (n.body) indexNodes(n.body);
        if (n.yields) n.yields.forEach(function(y) { if (y.effect) indexNodes([y.effect]); });
        if (n.source && n.source.id) indexNodes([n.source]);
        if (n.handler && n.handler.id) indexNodes([n.handler]);
        if (n.operations) indexNodes(n.operations);
        if (n.cases) n.cases.forEach(function(c) { if (c.body) indexNodes(c.body); });
      });
    }
    indexNodes(IR_DATA.root.children);

    // Type filter populate
    var types = new Set();
    function collectTypes(nodes) {
      if (!nodes) return;
      nodes.forEach(function(n) {
        types.add(n.type);
        if (n.children) collectTypes(n.children);
        if (n.onTrue) collectTypes(n.onTrue);
        if (n.onFalse) collectTypes(n.onFalse);
        if (n.body) collectTypes(n.body);
        if (n.tryBody) collectTypes(n.tryBody);
        if (n.catchBody) collectTypes(n.catchBody);
      });
    }
    collectTypes(IR_DATA.root.children);
    var tf = document.getElementById('typeFilter');
    Array.from(types).sort().forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      tf.appendChild(opt);
    });

    // Tab switching
    function showTab(name) {
      document.querySelectorAll('.tab-content').forEach(function(el) { el.hidden = true; });
      document.querySelectorAll('.sidebar-tabs button').forEach(function(el) { el.classList.remove('active'); });
      document.getElementById('tab-' + name).hidden = false;
      event.target.classList.add('active');
    }

    // Search
    function handleSearch(q) {
      // Simple text highlight in IR tab
      var pre = document.getElementById('ir-json');
      if (!q) { pre.innerHTML = JSON.stringify(IR_DATA, null, 2); return; }
      var text = JSON.stringify(IR_DATA, null, 2);
      var escaped = q.replace(/[.*+?^$` + `{}()|\\[\\]\\\\]/g, '\\\\$` + `&');
      pre.innerHTML = text.replace(new RegExp(escaped, 'gi'), '<mark>$` + `&</mark>');
    }

    function handleTypeFilter(type) {
      // Scroll IR to first occurrence of selected type
      if (!type) return;
      var pre = document.getElementById('ir-json');
      var text = pre.textContent;
      var idx = text.indexOf('"type": "' + type + '"');
      if (idx >= 0) {
        showTab('ir');
        document.querySelectorAll('.sidebar-tabs button').forEach(function(b) {
          b.classList.toggle('active', b.textContent === 'IR');
        });
      }
    }

    // Overlay toggles
    function toggleOverlay(kind) {
      var el = document.getElementById('mermaid-diagram');
      var dataOn = document.getElementById('toggleDataFlow').checked;
      var errorOn = document.getElementById('toggleErrorFlow').checked;
      var src = DIAGRAMS.base;
      if (dataOn) src = DIAGRAMS.dataFlow;
      if (errorOn) src = DIAGRAMS.errorFlow;
      if (dataOn && errorOn) src = DIAGRAMS.dataFlow; // data takes precedence
      el.innerHTML = src;
      el.removeAttribute('data-processed');
      mermaid.init(undefined, el);
      var curTheme = document.documentElement.getAttribute('data-theme') || 'midnight';
      setTimeout(function() { rethemeSvgNodes(curTheme); }, 500);
    }

    // Path selection
    function selectPath(idx) {
      idx = parseInt(idx);
      document.querySelectorAll('.path-item').forEach(function(el, i) {
        el.classList.toggle('selected', i === idx);
      });
    }

    // Click-to-navigate: show node details when clicking on diagram nodes
    function truncLabel(s, max) {
      if (!s || s.length <= max) return s;
      return s.slice(0, max) + '…';
    }
    var LABEL_MAX = 60;
    function showNodeDetails(nodeId) {
      var node = nodeIndex[nodeId];
      if (!node) return;
      var det = document.getElementById('node-details');
      var loc = node.location ? node.location.filePath + ':' + node.location.line + ':' + node.location.column : 'N/A';
      var html = '<h3>Node Details</h3>';
      html += '<table>';
      html += '<tr><td>ID</td><td><code>' + node.id + '</code></td></tr>';
      html += '<tr><td>Type</td><td><b>' + node.type + '</b></td></tr>';
      if (node.callee) html += '<tr><td>Callee</td><td>' + truncLabel(node.callee, LABEL_MAX) + '</td></tr>';
      if (node.displayName) html += '<tr><td>Display</td><td>' + truncLabel(node.displayName, LABEL_MAX) + '</td></tr>';
      if (node.semanticRole) html += '<tr><td>Role</td><td>' + node.semanticRole + '</td></tr>';
      html += '<tr><td>Location</td><td><code>' + loc + '</code></td></tr>';
      if (node.typeSignature) {
        var sig = node.typeSignature;
        html += '<tr><td>Type Sig</td><td><code>Effect&lt;' + (sig.successType||'?') + ', ' + (sig.errorType||'?') + ', ' + (sig.requirementsType||'?') + '&gt;</code></td></tr>';
      }
      html += '</table>';
      if (node.description) html += '<p style="margin-top:0.5rem;opacity:0.8">' + node.description + '</p>';
      det.innerHTML = html;
      // Switch to details tab
      document.querySelectorAll('.tab-content').forEach(function(el) { el.hidden = true; });
      document.querySelectorAll('.sidebar-tabs button').forEach(function(b) { b.classList.remove('active'); });
      document.getElementById('tab-details').hidden = false;
      document.querySelectorAll('.sidebar-tabs button')[0].classList.add('active');
    }

    // Register Mermaid click callbacks and apply theme to SVG after rendering
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        rethemeSvgNodes(document.documentElement.getAttribute('data-theme') || 'midnight');
        var svgNodes = document.querySelectorAll('.mermaid svg .node');
        svgNodes.forEach(function(el) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', function() {
            var id = el.id || '';
            // Mermaid node IDs often have prefixes; try to match against nodeIndex
            for (var key in nodeIndex) {
              if (id.indexOf(key) >= 0 || id.indexOf(key.replace(/[^a-zA-Z0-9]/g, '_')) >= 0) {
                showNodeDetails(key);
                return;
              }
            }
          });
        });
      }, 1000);
    });
  </scr` + `ipt>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
