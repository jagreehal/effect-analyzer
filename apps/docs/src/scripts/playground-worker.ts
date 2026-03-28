import * as tsMorph from 'ts-morph';
import { Effect } from 'effect';
import type { StaticEffectIR } from '../../../../packages/effect-analyzer/src/browser';
import {
  analyzeSource,
  renderExplanation,
  renderInteractiveHTML,
  renderJSON,
  renderRailwayMermaid,
  renderSummary,
  setTsMorphModule,
} from '../../../../packages/effect-analyzer/src/browser';

type PlaygroundFormat =
  | 'html-viewer'
  | 'mermaid-railway'
  | 'summary'
  | 'explain'
  | 'json';
type OutputKind = 'html' | 'mermaid' | 'text';

type AnalyzeRequest = {
  readonly type: 'analyze';
  readonly requestId: number;
  readonly code: string;
  readonly format: PlaygroundFormat;
};

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

setTsMorphModule(tsMorph);

const PRIMARY_PROGRAM_NAMES = [
  'program',
  'main',
  'run',
  'workflow',
  'handler',
  'sendMoney',
] as const;

const pickPrimaryProgram = (
  programs: readonly StaticEffectIR[],
): StaticEffectIR => {
  const firstProgram = programs[0];
  if (!firstProgram) {
    throw new Error('No analyzable Effect programs found in source.');
  }

  for (const name of PRIMARY_PROGRAM_NAMES) {
    const found = programs.find((program) => program.root.programName === name);
    if (found) {
      return found;
    }
  }

  const exportedLooking = [...programs].sort((left, right) => {
    const leftScore = Number(!left.root.programName.includes('.'));
    const rightScore = Number(!right.root.programName.includes('.'));
    return rightScore - leftScore;
  });

  return exportedLooking[0] ?? firstProgram;
};

const renderResult = async (
  code: string,
  format: PlaygroundFormat,
): Promise<{
  output: string;
  outputKind: OutputKind;
  programName: string;
  programCount: number;
}> => {
  const programs = await Effect.runPromise(analyzeSource(code).all());
  const ir = pickPrimaryProgram(programs);

  switch (format) {
    case 'json':
      return {
        output: await Effect.runPromise(renderJSON(ir)),
        outputKind: 'text',
        programName: ir.root.programName,
        programCount: programs.length,
      };
    case 'html-viewer':
      return {
        output: renderInteractiveHTML(ir, {
          title: `${ir.root.programName} Playground Analysis`,
          theme: 'midnight',
        }),
        outputKind: 'html',
        programName: ir.root.programName,
        programCount: programs.length,
      };
    case 'explain':
      return {
        output: renderExplanation(ir),
        outputKind: 'text',
        programName: ir.root.programName,
        programCount: programs.length,
      };
    case 'mermaid-railway':
      return {
        output: renderRailwayMermaid(ir, { direction: 'LR' }),
        outputKind: 'mermaid',
        programName: ir.root.programName,
        programCount: programs.length,
      };
    default:
      return {
        output: renderSummary(ir),
        outputKind: 'text',
        programName: ir.root.programName,
        programCount: programs.length,
      };
  }
};

const serializeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
};

self.addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  if (event.data.type !== 'analyze') {
    return;
  }

  void renderResult(event.data.code, event.data.format)
    .then(({ output, outputKind, programName, programCount }) => {
      const response: AnalyzeResponse = {
        type: 'success',
        requestId: event.data.requestId,
        outputKind,
        programName,
        programCount,
        output,
      };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: AnalyzeResponse = {
        type: 'error',
        requestId: event.data.requestId,
        error: serializeError(error),
      };
      self.postMessage(response);
    });
});
