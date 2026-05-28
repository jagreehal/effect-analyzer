import type { StateMachine } from '../state-machine';
import type { StateMachineCoverage } from '../state-machine-coverage';
import { renderCoverageReport } from './statechart-coverage';
import { renderStatechartSVG } from './svg-statechart';
import { renderXStateConfig } from './xstate-config';

const esc = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export function renderStatechartVisualizerHTML(
  machines: readonly StateMachine[],
  coverages: readonly StateMachineCoverage[],
): string {
  const byName = new Map(coverages.map((coverage) => [coverage.machine, coverage]));
  const cards = machines.map((machine) => {
    const coverage = byName.get(machine.name);
    const warnings =
      coverage?.findings.filter((finding) => finding.severity === 'warning').length ?? 0;
    const config = renderXStateConfig(machine);
    return `<section class="machine" id="${esc(machine.name)}">
  <header>
    <div>
      <h2>${esc(machine.name)}</h2>
      <p>${machine.source} / ${machine.transitions.length} transitions / ${machine.states.length} states</p>
    </div>
    <div class="${warnings > 0 ? 'badge warn' : 'badge'}">${coverage ? pct(coverage.coverageRatio) : 'n/a'} coverage</div>
  </header>
  <div class="grid">
    <div class="diagram">${renderStatechartSVG(machine, coverage)}</div>
    <aside>
      <h3>Coverage</h3>
      <ul>
        <li>${warnings} warning${warnings === 1 ? '' : 's'}</li>
        <li>${coverage?.alphabetKnown ? `alphabet: ${coverage.alphabetSource ?? 'known'}` : 'alphabet: observed only'}</li>
        <li>initial: ${esc(machine.initial ?? 'unknown')}</li>
      </ul>
      <h3>XState export</h3>
      <pre><code>${esc(config)}</code></pre>
    </aside>
  </div>
</section>`;
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Effect Statecharts</title>
<style>
:root{color-scheme:dark;--bg:#111318;--panel:#1a1f27;--panel2:#202733;--line:#3a414d;--text:#e2e8f0;--muted:#9aa4b2;--accent:#4299e1;--warn:#f6ad55}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:28px}
.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:24px}
h1,h2,h3,p{margin:0}
h1{font-size:28px;line-height:1.15}
p,li{color:var(--muted)}
.summary{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:24px;overflow:auto}
.machine{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin-bottom:24px;overflow:hidden}
.machine>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid var(--line)}
.machine h2{font-size:19px}
.machine h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px}
.badge{border:1px solid var(--accent);color:#bfdbfe;border-radius:999px;padding:6px 10px;font-size:13px;font-weight:700;white-space:nowrap}
.badge.warn{border-color:var(--warn);color:#fed7aa}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:0}
.diagram{padding:18px;overflow:auto;background:#16191f}
aside{border-left:1px solid var(--line);padding:18px;background:var(--panel2)}
ul{padding-left:18px;margin:0 0 18px}
pre{margin:0;max-height:460px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:#0c0f14;padding:12px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.45;color:#dbeafe}
svg{max-width:none}
@media (max-width:900px){main{padding:16px}.hero{display:block}.grid{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line)}}
</style>
</head>
<body>
<main>
  <section class="hero">
    <div>
      <h1>Effect Statecharts</h1>
      <p>Plain Effect source, XState-style visualization, no XState runtime dependency.</p>
    </div>
    <div class="badge">${machines.length} machine${machines.length === 1 ? '' : 's'}</div>
  </section>
  <pre class="summary">${esc(renderCoverageReport(coverages))}</pre>
  ${cards.join('\n')}
</main>
</body>
</html>`;
}
