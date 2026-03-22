import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';

interface DataflowOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

interface DataflowStep {
  readonly successType: string;
  readonly errorType: string;
  readonly transformLabel?: string | undefined;
  readonly isEffectful: boolean;
}

/** Generate a short node ID: S0, S1, S2, ... */
function stepId(index: number): string {
  return `S${index}`;
}

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/**
 * Extract pipe chains from IR, collecting transformation steps with type info.
 */
function collectPipeSteps(node: StaticFlowNode): DataflowStep[][] {
  const chains: DataflowStep[][] = [];

  if (node.type === 'pipe') {
    const pipeNode = node as {
      initial: StaticFlowNode;
      transformations: readonly StaticFlowNode[];
      typeFlow?: readonly { successType: string; errorType: string }[];
    };

    const steps: DataflowStep[] = [];

    // Initial step type from initial node's typeSignature or typeFlow[0]
    const initialSig =
      pipeNode.typeFlow?.[0] ??
      ('typeSignature' in pipeNode.initial
        ? (pipeNode.initial as { typeSignature?: { successType: string; errorType: string } }).typeSignature
        : undefined);

    if (initialSig) {
      steps.push({
        successType: initialSig.successType,
        errorType: initialSig.errorType,
        isEffectful: false,
      });
    }

    for (let i = 0; i < pipeNode.transformations.length; i++) {
      const t = pipeNode.transformations[i];
      if (!t) continue;
      const transformType =
        t.type === 'transform'
          ? (t as { transformType: string }).transformType
          : t.name ?? t.type;
      const isEffectful =
        t.type === 'transform'
          ? (t as { isEffectful: boolean }).isEffectful
          : false;

      // Type from typeFlow (index i+1) or from outputType on the transform
      const sig =
        pipeNode.typeFlow?.[i + 1] ??
        (t.type === 'transform'
          ? (t as { outputType?: { successType: string; errorType: string } }).outputType
          : undefined);

      if (sig) {
        steps.push({
          successType: sig.successType,
          errorType: sig.errorType,
          transformLabel: transformType,
          isEffectful,
        });
      } else {
        steps.push({
          successType: 'unknown',
          errorType: 'unknown',
          transformLabel: transformType,
          isEffectful,
        });
      }
    }

    if (steps.length > 0) {
      chains.push(steps);
    }
  }

  // Recurse into children
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  for (const child of children) {
    chains.push(...collectPipeSteps(child));
  }

  return chains;
}

/**
 * Extract generator yield steps as a dataflow chain.
 */
function collectGeneratorSteps(node: StaticFlowNode): DataflowStep[][] {
  const chains: DataflowStep[][] = [];

  if (node.type === 'generator') {
    const genNode = node as {
      yields: readonly { variableName?: string; effect: StaticFlowNode }[];
    };

    const steps: DataflowStep[] = [];
    for (const y of genNode.yields) {
      const sig =
        'typeSignature' in y.effect
          ? (y.effect as { typeSignature?: { successType: string; errorType: string } }).typeSignature
          : undefined;

      if (sig) {
        steps.push({
          successType: sig.successType,
          errorType: sig.errorType,
          transformLabel: y.variableName ?? y.effect.name,
          isEffectful: true,
        });
      } else {
        steps.push({
          successType: 'unknown',
          errorType: 'unknown',
          transformLabel: y.variableName ?? y.effect.name,
          isEffectful: true,
        });
      }
    }

    if (steps.length > 0) {
      chains.push(steps);
    }
  }

  // Recurse into children
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  for (const child of children) {
    chains.push(...collectGeneratorSteps(child));
  }

  return chains;
}

/**
 * Render a dataflow Mermaid flowchart from an Effect IR.
 *
 * Shows data transformation pipelines: how types evolve through pipe chains
 * and generator yield sequences.
 */
export function renderDataflowMermaid(
  ir: StaticEffectIR,
  options: DataflowOptions = {},
): string {
  const direction = options.direction ?? 'LR';

  // Collect all chains from IR
  const allChains: DataflowStep[][] = [];
  for (const child of ir.root.children) {
    allChains.push(...collectPipeSteps(child));
    allChains.push(...collectGeneratorSteps(child));
  }

  if (allChains.length === 0) {
    return `flowchart ${direction}\n  NoData((No data transformations))`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const styleLines: string[] = [];
  let globalIdx = 0;

  for (const steps of allChains) {
    const baseIdx = globalIdx;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;
      const id = stepId(baseIdx + i);
      const label = escapeLabel(step.successType);

      // Track node for styling
      if (step.successType === 'unknown') {
        styleLines.push(`  style ${id} fill:#EEEEEE`);
      } else {
        styleLines.push(`  style ${id} fill:#E8F5E9`);
      }

      if (i < steps.length - 1) {
        const nextStep = steps[i + 1];
        if (!nextStep) continue;
        const nextId = stepId(baseIdx + i + 1);
        const nextLabel = escapeLabel(nextStep.successType);

        // Build edge label
        let edgeLabel = nextStep.transformLabel ?? '';

        // Annotate error type changes
        const prevError = step.errorType;
        const nextError = nextStep.errorType;
        if (nextError !== prevError && nextError !== 'never' && nextError !== 'unknown') {
          edgeLabel = edgeLabel ? `${edgeLabel}<br/>E: ${escapeLabel(nextError)}` : `E: ${escapeLabel(nextError)}`;
        }

        // Effectful transforms get bold edges (==>)
        const arrow = nextStep.isEffectful ? '==>' : '-->';

        if (i === 0) {
          lines.push(`  ${id}["${label}"] ${arrow}|${edgeLabel}| ${nextId}["${nextLabel}"]`);
        } else {
          lines.push(`  ${id} ${arrow}|${edgeLabel}| ${nextId}["${nextLabel}"]`);
        }
      } else if (i === 0) {
        // Single-step chain: just render the node
        lines.push(`  ${id}["${label}"]`);
      }
    }

    globalIdx += steps.length;
  }

  return [...lines, ...styleLines].join('\n');
}
