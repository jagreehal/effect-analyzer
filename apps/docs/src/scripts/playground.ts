import mermaid from 'mermaid';

type PlaygroundFormat =
  | 'html-viewer'
  | 'mermaid-railway'
  | 'summary'
  | 'explain'
  | 'json';
type OutputKind = 'html' | 'mermaid' | 'text';

type AnalyzeResponse =
  | {
      readonly type: 'success';
      readonly requestId: number;
      readonly outputKind: OutputKind;
      readonly programName: string;
      readonly programCount: number;
      readonly output: string;
    }
  | {
      readonly type: 'error';
      readonly requestId: number;
      readonly error: string;
    };

export const setupPlayground = (): void => {
  const input = document.querySelector<HTMLTextAreaElement>('#source-input');
  const status = document.querySelector<HTMLElement>('#status');
  const outputText = document.querySelector<HTMLElement>('#output-text');
  const outputDiagram =
    document.querySelector<HTMLElement>('#output-diagram');
  const outputHtml = document.querySelector<HTMLIFrameElement>('#output-html');
  const analyzeButton =
    document.querySelector<HTMLButtonElement>('#analyze-button');
  const formatSelect =
    document.querySelector<HTMLSelectElement>('#format-select');
  const sampleBadge =
    document.querySelector<HTMLElement>('#sample-badge');
  const openFullPage =
    document.querySelector<HTMLButtonElement>('#open-fullpage');

  if (
    !input ||
    !status ||
    !outputText ||
    !outputDiagram ||
    !outputHtml ||
    !analyzeButton ||
    !formatSelect
  ) {
    return;
  }

  let requestId = 0;
  let worker: Worker | null = null;
  let diagramId = 0;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'neutral',
  });

  const resetOutput = (): void => {
    outputHtml.hidden = true;
    outputHtml.srcdoc = '';
    outputDiagram.hidden = true;
    outputDiagram.replaceChildren();
    outputText.hidden = true;
    outputText.textContent = '';
    if (openFullPage) openFullPage.hidden = true;
  };

  const showText = (value: string): void => {
    outputHtml.hidden = true;
    outputHtml.srcdoc = '';
    outputDiagram.hidden = true;
    outputDiagram.replaceChildren();
    outputText.hidden = false;
    outputText.textContent = value;
    if (openFullPage) openFullPage.hidden = true;
  };

  const showHtml = (html: string): void => {
    outputDiagram.hidden = true;
    outputDiagram.replaceChildren();
    outputText.hidden = true;
    outputText.textContent = '';
    outputHtml.hidden = false;
    outputHtml.srcdoc = html;
    if (openFullPage) openFullPage.hidden = false;
  };

  const showMermaid = async (diagram: string): Promise<void> => {
    diagramId += 1;
    const renderId = `playground-diagram-${diagramId}`;
    const { svg } = await mermaid.render(renderId, diagram);
    outputHtml.hidden = true;
    outputHtml.srcdoc = '';
    outputText.hidden = true;
    outputText.textContent = diagram;
    outputDiagram.hidden = false;
    outputDiagram.innerHTML = svg;
  };

  const getWorker = (): Worker => {
    if (!worker) {
      worker = new Worker(
        new URL('./playground-worker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
        if (event.data.requestId !== requestId) {
          return;
        }

        analyzeButton.disabled = false;

        if (event.data.type === 'success') {
          const selectedProgram =
            event.data.programCount > 1
              ? `Showing ${event.data.programName} from ${String(event.data.programCount)} detected programs.`
              : `Showing ${event.data.programName}.`;

          status.textContent =
            event.data.outputKind === 'html'
              ? `Analysis succeeded. ${selectedProgram}`
              : event.data.outputKind === 'mermaid'
              ? `Analysis succeeded. ${selectedProgram}`
              : `Analysis succeeded. ${selectedProgram}`;
          sampleBadge?.replaceChildren();
          sampleBadge?.append(
            event.data.outputKind === 'html'
              ? 'Live viewer'
              : event.data.outputKind === 'mermaid'
                ? 'Live diagram'
                : 'Live result',
          );
          void (event.data.outputKind === 'html'
            ? Promise.resolve(showHtml(event.data.output))
            : event.data.outputKind === 'mermaid'
              ? showMermaid(event.data.output)
              : Promise.resolve(showText(event.data.output)));
          return;
        }

        status.textContent = 'Analysis failed.';
        sampleBadge?.replaceChildren();
        sampleBadge?.append('Run failed');
        showText(event.data.error);
      };

      worker.addEventListener('error', (event) => {
        analyzeButton.disabled = false;
        status.textContent = 'Worker failed.';
        showText(event.message);
      });
    }

    return worker;
  };

  status.textContent = 'Ready. Analysis loads on demand.';

  const run = (): void => {
    requestId += 1;
    analyzeButton.disabled = true;
    status.textContent = 'Analyzing in worker...';
    sampleBadge?.replaceChildren();
    sampleBadge?.append(
      formatSelect.value === 'html-viewer'
        ? 'Building viewer'
        : formatSelect.value === 'mermaid-railway'
          ? 'Building diagram'
        : 'Running sample',
    );
    resetOutput();
    getWorker().postMessage({
      type: 'analyze',
      requestId,
      code: input.value,
      format: formatSelect.value as PlaygroundFormat,
    });
  };

  analyzeButton.addEventListener('click', run);
  formatSelect.addEventListener('change', run);

  // Debounced auto-analyze on input
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const code = input.value.trim();
    if (!code) {
      // Empty input — reset to neutral state
      resetOutput();
      status.textContent = 'Enter Effect code and press Analyze, or start typing.';
      sampleBadge?.replaceChildren();
      sampleBadge?.append('Waiting for input');
      return;
    }
    status.textContent = 'Waiting for you to finish typing...';
    debounceTimer = setTimeout(run, 1500);
  });

  if (openFullPage) {
    openFullPage.addEventListener('click', () => {
      const html = outputHtml.srcdoc;
      if (!html) return;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Revoke after a short delay so the new tab can load
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  }

  const scheduleInitialRun = (): void => {
    globalThis.setTimeout(() => {
      if (requestId === 0) {
        run();
      }
    }, 150);
  };

  scheduleInitialRun();
};
