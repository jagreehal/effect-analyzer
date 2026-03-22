/**
 * Plain-English explanation renderer for Effect IR trees.
 *
 * Walks the static IR and produces a human-readable narrative
 * describing what an Effect program does.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticEffectProgram,
} from '../types';
import { DEFAULT_LABEL_MAX, truncateDisplayText } from '../analysis-utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const indent = (depth: number): string => '  '.repeat(depth);

/** Summarise a node in a short inline phrase (no newline). */
function shortLabel(node: StaticFlowNode): string {
  const t = (s: string, max = DEFAULT_LABEL_MAX) => truncateDisplayText(s, max);
  switch (node.type) {
    case 'effect': {
      if (node.serviceCall) {
        return t(`${node.serviceCall.serviceType}.${node.serviceCall.methodName}`);
      }
      return t(node.displayName ?? node.callee);
    }
    case 'generator':
      return 'Effect.gen block';
    case 'pipe':
      return t(`pipe(${shortLabel(node.initial)})`);
    case 'parallel':
      return t(`${node.callee}(${node.children.length} effects)`);
    case 'race':
      return t(`${node.callee}(${node.children.length} effects)`);
    case 'error-handler':
      return node.handlerType;
    case 'retry':
      return 'retry';
    case 'timeout':
      return node.duration ? `timeout(${node.duration})` : 'timeout';
    case 'resource':
      return 'acquireRelease';
    case 'conditional':
      return `if ${node.conditionLabel ?? node.condition}`;
    case 'loop':
      return t(
        `${node.loopType}${node.iterSource ? `(${node.iterSource})` : ''}`,
      );
    case 'layer':
      return node.provides ? `Layer(${node.provides.join(', ')})` : 'Layer';
    case 'stream':
      return 'Stream';
    case 'fiber':
      return `Fiber.${node.operation}`;
    case 'concurrency-primitive':
      return `${node.primitive}.${node.operation}`;
    case 'decision':
      return `if ${node.condition}`;
    case 'switch':
      return `switch(${node.expression})`;
    case 'try-catch':
      return 'try/catch';
    case 'terminal':
      return node.terminalKind;
    case 'match':
      return node.matchedTags ? `Match(${node.matchedTags.join(', ')})` : 'Match';
    case 'transform':
      return node.transformType;
    case 'channel':
      return 'Channel';
    case 'sink':
      return 'Sink';
    case 'cause':
      return `Cause.${node.causeOp}`;
    case 'exit':
      return `Exit.${node.exitOp}`;
    case 'schedule':
      return `Schedule.${node.scheduleOp}`;
    case 'interruption':
      return node.interruptionType;
    case 'opaque':
      return `(opaque: ${node.reason})`;
    case 'unknown':
      return `(unknown: ${node.reason})`;
  }
}

/** Track whether parallel/race nodes are encountered during a walk. */
interface WalkState {
  hasParallelism: boolean;
  serviceCallsSeen: Set<string>;
}

// ---------------------------------------------------------------------------
// Core recursive walker
// ---------------------------------------------------------------------------

/**
 * Recursively walks a `StaticFlowNode` and produces indented description lines.
 */
export function explainNode(
  node: StaticFlowNode,
  depth: number,
  state: WalkState = { hasParallelism: false, serviceCallsSeen: new Set() },
): string[] {
  const pad = indent(depth);
  const lines: string[] = [];

  switch (node.type) {
    // ----- effect -----------------------------------------------------------
    case 'effect': {
      if (node.serviceCall) {
        state.serviceCallsSeen.add(node.serviceCall.serviceType);
        // Tag-style service acquisition (e.g. yield* Logger)
        if (
          node.callee.includes('Tag') ||
          node.callee.includes('Context') ||
          node.callee === node.serviceCall.serviceType
        ) {
          lines.push(`${pad}Acquires ${node.serviceCall.serviceType} service`);
        } else {
          const desc = node.description ? ` — ${node.description}` : '';
          lines.push(
            `${pad}Calls ${node.serviceCall.serviceType}.${node.serviceCall.methodName}${desc}`,
          );
        }
      } else {
        const label = truncateDisplayText(
          node.displayName ?? node.callee,
          DEFAULT_LABEL_MAX,
        );
        const desc = node.description ? ` — ${node.description}` : '';
        // If displayName has a binding arrow (e.g. "logger <- Logger"), it's a service yield
        if (label.includes(' <- ')) {
          lines.push(`${pad}Yields ${label}`);
        } else {
          lines.push(`${pad}Calls ${label}${desc}`);
        }
      }
      break;
    }

    // ----- generator --------------------------------------------------------
    case 'generator': {
      for (const y of node.yields) {
        const childLines = explainNode(y.effect, depth, state);
        // If variableName and the displayName already contains it (e.g. "logger <- Logger"),
        // skip adding it again. Otherwise prefix with "varName = ..."
        const firstChild = childLines[0];
        if (y.variableName && firstChild !== undefined) {
          const trimmed = firstChild.trimStart();
          const alreadyHasBinding = trimmed.includes(`${y.variableName} <-`) || trimmed.includes(`${y.variableName} =`);
          if (!alreadyHasBinding) {
            childLines[0] = `${pad}${y.variableName} = ${trimmed.replace(/^Calls /, '')}`;
          }
        }
        lines.push(...childLines);
      }
      if (node.returnNode) {
        const retLines = explainNode(node.returnNode, depth, state);
        const firstRet = retLines[0];
        if (firstRet !== undefined) {
          const trimmed = firstRet.trimStart();
          retLines[0] = `${pad}Returns ${trimmed.replace(/^Calls /, '')}`;
          lines.push(...retLines);
        }
      }
      break;
    }

    // ----- pipe -------------------------------------------------------------
    case 'pipe': {
      lines.push(`${pad}Pipes ${shortLabel(node.initial)} through:`);
      const initLines = explainNode(node.initial, depth + 1, state);
      lines.push(...initLines);
      for (const t of node.transformations) {
        const tLines = explainNode(t, depth + 1, state);
        lines.push(...tLines);
      }
      break;
    }

    // ----- parallel ---------------------------------------------------------
    case 'parallel': {
      state.hasParallelism = true;
      const concDesc =
        node.concurrency !== undefined && node.concurrency !== 'sequential'
          ? ` (concurrency: ${node.concurrency})`
          : '';
      lines.push(
        `${pad}Runs ${node.children.length} effects in ${node.mode}${concDesc}:`,
      );
      for (const child of node.children) {
        lines.push(...explainNode(child, depth + 1, state));
      }
      break;
    }

    // ----- race -------------------------------------------------------------
    case 'race': {
      state.hasParallelism = true;
      lines.push(`${pad}Races ${node.children.length} effects:`);
      for (const child of node.children) {
        lines.push(...explainNode(child, depth + 1, state));
      }
      break;
    }

    // ----- error-handler ----------------------------------------------------
    case 'error-handler': {
      const tagInfo = node.errorTag
        ? ` "${node.errorTag}"`
        : node.errorTags && node.errorTags.length > 0
          ? ` [${node.errorTags.join(', ')}]`
          : '';
      switch (node.handlerType) {
        case 'catchAll':
          lines.push(`${pad}Catches all errors on:`);
          break;
        case 'catchTag':
          lines.push(`${pad}Catches tag${tagInfo} on:`);
          break;
        case 'catchTags':
          lines.push(`${pad}Catches tags${tagInfo} on:`);
          break;
        case 'orElse':
          lines.push(`${pad}Falls back (orElse) on error:`);
          break;
        case 'orDie':
          lines.push(`${pad}Converts errors to defects (orDie):`);
          break;
        case 'mapError':
          lines.push(`${pad}Maps error on:`);
          break;
        case 'ignore':
          lines.push(`${pad}Ignores errors on:`);
          break;
        default:
          lines.push(`${pad}Handles errors (${node.handlerType})${tagInfo}:`);
      }
      lines.push(...explainNode(node.source, depth + 1, state));
      if (node.handler) {
        lines.push(`${pad}  Handler:`);
        lines.push(...explainNode(node.handler, depth + 2, state));
      }
      break;
    }

    // ----- retry ------------------------------------------------------------
    case 'retry': {
      if (node.scheduleInfo) {
        const maxPart =
          node.scheduleInfo.maxRetries !== undefined
            ? `max ${node.scheduleInfo.maxRetries}`
            : '';
        const stratPart = node.scheduleInfo.baseStrategy;
        const parts = [maxPart, stratPart].filter(Boolean).join(', ');
        lines.push(`${pad}Retries (${parts}):`);
      } else if (node.schedule) {
        lines.push(`${pad}Retries with ${node.schedule}:`);
      } else {
        lines.push(`${pad}Retries:`);
      }
      lines.push(...explainNode(node.source, depth + 1, state));
      if (node.hasFallback) {
        lines.push(`${pad}  (with fallback on exhaustion)`);
      }
      break;
    }

    // ----- timeout ----------------------------------------------------------
    case 'timeout': {
      const dur = node.duration ? ` after ${node.duration}` : '';
      lines.push(`${pad}Times out${dur}:`);
      lines.push(...explainNode(node.source, depth + 1, state));
      if (node.hasFallback) {
        lines.push(`${pad}  (with fallback on timeout)`);
      }
      break;
    }

    // ----- resource ---------------------------------------------------------
    case 'resource': {
      lines.push(`${pad}Acquires resource:`);
      lines.push(...explainNode(node.acquire, depth + 1, state));
      if (node.use) {
        lines.push(`${pad}  Uses:`);
        lines.push(...explainNode(node.use, depth + 2, state));
      }
      lines.push(`${pad}  Then releases:`);
      lines.push(...explainNode(node.release, depth + 2, state));
      break;
    }

    // ----- conditional ------------------------------------------------------
    case 'conditional': {
      const label = node.conditionLabel ?? node.condition;
      lines.push(`${pad}If ${label}:`);
      lines.push(...explainNode(node.onTrue, depth + 1, state));
      if (node.onFalse) {
        lines.push(`${pad}Else:`);
        lines.push(...explainNode(node.onFalse, depth + 1, state));
      }
      break;
    }

    // ----- decision ---------------------------------------------------------
    case 'decision': {
      lines.push(`${pad}If ${node.condition}:`);
      for (const child of node.onTrue) {
        lines.push(...explainNode(child, depth + 1, state));
      }
      if (node.onFalse && node.onFalse.length > 0) {
        lines.push(`${pad}Else:`);
        for (const child of node.onFalse) {
          lines.push(...explainNode(child, depth + 1, state));
        }
      }
      break;
    }

    // ----- switch -----------------------------------------------------------
    case 'switch': {
      lines.push(`${pad}Switch on ${node.expression}:`);
      for (const c of node.cases) {
        const caseLabel = c.isDefault
          ? 'default'
          : c.labels.join(', ');
        lines.push(`${pad}  Case ${caseLabel}:`);
        for (const child of c.body) {
          lines.push(...explainNode(child, depth + 2, state));
        }
      }
      break;
    }

    // ----- try-catch --------------------------------------------------------
    case 'try-catch': {
      lines.push(`${pad}Try:`);
      for (const child of node.tryBody) {
        lines.push(...explainNode(child, depth + 1, state));
      }
      if (node.catchBody && node.catchBody.length > 0) {
        lines.push(`${pad}Catch:`);
        for (const child of node.catchBody) {
          lines.push(...explainNode(child, depth + 1, state));
        }
      }
      if (node.finallyBody && node.finallyBody.length > 0) {
        lines.push(`${pad}Finally:`);
        for (const child of node.finallyBody) {
          lines.push(...explainNode(child, depth + 1, state));
        }
      }
      break;
    }

    // ----- terminal ---------------------------------------------------------
    case 'terminal': {
      switch (node.terminalKind) {
        case 'return': {
          if (node.value && node.value.length > 0) {
            lines.push(`${pad}Returns:`);
            for (const child of node.value) {
              lines.push(...explainNode(child, depth + 1, state));
            }
          } else {
            lines.push(`${pad}Returns`);
          }
          break;
        }
        case 'throw':
          lines.push(`${pad}Throws`);
          break;
        case 'break':
          lines.push(`${pad}Breaks`);
          break;
        case 'continue':
          lines.push(`${pad}Continues`);
          break;
      }
      break;
    }

    // ----- loop -------------------------------------------------------------
    case 'loop': {
      const src = node.iterSource
        ? ` over ${truncateDisplayText(node.iterSource, DEFAULT_LABEL_MAX)}`
        : '';
      lines.push(`${pad}Iterates (${node.loopType})${src}:`);
      lines.push(...explainNode(node.body, depth + 1, state));
      break;
    }

    // ----- layer ------------------------------------------------------------
    case 'layer': {
      const provides =
        node.provides && node.provides.length > 0
          ? ` providing ${node.provides.join(', ')}`
          : '';
      const requires =
        node.requires && node.requires.length > 0
          ? ` (requires ${node.requires.join(', ')})`
          : '';
      lines.push(`${pad}Provides layer${provides}${requires}:`);
      for (const op of node.operations) {
        lines.push(...explainNode(op, depth + 1, state));
      }
      break;
    }

    // ----- stream -----------------------------------------------------------
    case 'stream': {
      const ops = node.pipeline.map((o) => o.operation).join(' -> ');
      const sinkPart = node.sink ? ` -> ${node.sink}` : '';
      lines.push(`${pad}Stream: ${ops}${sinkPart}`);
      lines.push(...explainNode(node.source, depth + 1, state));
      break;
    }

    // ----- fiber ------------------------------------------------------------
    case 'fiber': {
      const scopeNote = node.isDaemon ? ' (daemon)' : node.isScoped ? ' (scoped)' : '';
      lines.push(`${pad}Fiber ${node.operation}${scopeNote}:`);
      if (node.fiberSource) {
        lines.push(...explainNode(node.fiberSource, depth + 1, state));
      }
      break;
    }

    // ----- concurrency-primitive --------------------------------------------
    case 'concurrency-primitive': {
      const cap = node.capacity !== undefined ? ` (capacity: ${node.capacity})` : '';
      lines.push(`${pad}${node.primitive}.${node.operation}${cap}`);
      if (node.source) {
        lines.push(...explainNode(node.source, depth + 1, state));
      }
      break;
    }

    // ----- match ------------------------------------------------------------
    case 'match': {
      if (node.matchedTags && node.matchedTags.length > 0) {
        lines.push(`${pad}Matches tags: ${node.matchedTags.join(', ')}`);
      } else {
        lines.push(`${pad}Match (${node.matchOp})`);
      }
      break;
    }

    // ----- transform --------------------------------------------------------
    case 'transform': {
      lines.push(`${pad}Transforms via ${node.transformType}`);
      if (node.source) {
        lines.push(...explainNode(node.source, depth + 1, state));
      }
      break;
    }

    // ----- cause ------------------------------------------------------------
    case 'cause': {
      lines.push(`${pad}Cause.${node.causeOp}`);
      if (node.children) {
        for (const child of node.children) {
          lines.push(...explainNode(child, depth + 1, state));
        }
      }
      break;
    }

    // ----- exit -------------------------------------------------------------
    case 'exit': {
      lines.push(`${pad}Exit.${node.exitOp}`);
      break;
    }

    // ----- schedule ---------------------------------------------------------
    case 'schedule': {
      lines.push(`${pad}Schedule.${node.scheduleOp}`);
      break;
    }

    // ----- channel ----------------------------------------------------------
    case 'channel': {
      const ops = node.pipeline.map((o) => o.operation).join(' -> ');
      lines.push(`${pad}Channel${ops ? `: ${ops}` : ''}`);
      if (node.source) {
        lines.push(...explainNode(node.source, depth + 1, state));
      }
      break;
    }

    // ----- sink -------------------------------------------------------------
    case 'sink': {
      const ops = node.pipeline.map((o) => o.operation).join(' -> ');
      lines.push(`${pad}Sink${ops ? `: ${ops}` : ''}`);
      if (node.source) {
        lines.push(...explainNode(node.source, depth + 1, state));
      }
      break;
    }

    // ----- interruption -----------------------------------------------------
    case 'interruption': {
      lines.push(`${pad}${node.interruptionType}`);
      if (node.source) {
        lines.push(...explainNode(node.source, depth + 1, state));
      }
      if (node.handler) {
        lines.push(`${pad}  On interrupt:`);
        lines.push(...explainNode(node.handler, depth + 2, state));
      }
      break;
    }

    // ----- opaque -----------------------------------------------------------
    case 'opaque': {
      lines.push(`${pad}(opaque: ${node.reason})`);
      break;
    }

    // ----- unknown ----------------------------------------------------------
    case 'unknown': {
      lines.push(`${pad}(unknown: ${node.reason})`);
      break;
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Program-level renderer
// ---------------------------------------------------------------------------

function renderProgram(program: StaticEffectProgram, _ir: StaticEffectIR): string {
  const state: WalkState = {
    hasParallelism: false,
    serviceCallsSeen: new Set(),
  };

  // Collect body lines from children
  const bodyLines: string[] = [];
  for (const child of program.children) {
    bodyLines.push(...explainNode(child, 1, state));
  }

  // Number top-level steps
  const numberedLines = numberTopLevelSteps(bodyLines);

  // Header
  const header = `${program.programName} (${program.source}):`;

  // Footer sections
  const footer: string[] = [];

  // Services required
  const services = new Set<string>();
  for (const dep of program.dependencies) {
    services.add(dep.name);
  }
  Array.from(state.serviceCallsSeen).forEach((svc) => {
    services.add(svc);
  });
  if (services.size > 0) {
    footer.push(`  Services required: ${Array.from(services).join(', ')}`);
  }

  // Error paths
  if (program.errorTypes.length > 0) {
    footer.push(`  Error paths: ${program.errorTypes.join(', ')}`);
  }

  // Concurrency
  if (state.hasParallelism) {
    footer.push('  Concurrency: uses parallelism / racing');
  } else {
    footer.push('  Concurrency: sequential (no parallelism)');
  }

  const sections = [header, numberedLines.join('\n')];
  if (footer.length > 0) {
    sections.push('');
    sections.push(footer.join('\n'));
  }

  return sections.join('\n');
}

/**
 * Numbers lines at depth=1 (2 leading spaces) as top-level steps,
 * leaving deeper lines unchanged.
 */
function numberTopLevelSteps(lines: string[]): string[] {
  let step = 0;
  return lines.map((line) => {
    // Depth-1 lines start with exactly 2 spaces then a non-space character
    if (/^ {2}\S/.test(line)) {
      step++;
      return `  ${step}. ${line.trimStart()}`;
    }
    return line;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders a full plain-English explanation for a single Effect IR program.
 */
export function renderExplanation(ir: StaticEffectIR): string {
  return renderProgram(ir.root, ir);
}

/**
 * Renders explanations for multiple programs, separated by `---`.
 */
export function renderMultipleExplanations(irs: readonly StaticEffectIR[]): string {
  return irs.map((ir) => renderExplanation(ir)).join('\n\n---\n\n');
}
