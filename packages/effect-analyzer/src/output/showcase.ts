/**
 * Showcase Output Generator
 *
 * Produces rich per-step detail from the Effect IR, matching the structure
 * of awaitly-analyze's analyzer-showcase.data.json format.
 */

import type {
  StaticEffectIR,
  StaticFlowNode,
  EffectTypeSignature,
  ShowcaseStepDetail,
  ShowcaseEntry,
} from '../types';
import { getStaticChildren } from '../types';
import { splitTopLevelUnion } from '../type-extractor';
import { Option } from 'effect';
import { renderStaticMermaid } from './mermaid';

// =============================================================================
// Types
// =============================================================================

export interface ShowcaseOptions {
  /** Mermaid diagram direction */
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL' | undefined;
}

interface WalkContext {
  readonly inLoop?: boolean | undefined;
  readonly loopType?: string | undefined;
  readonly iterationSource?: string | undefined;
  readonly inRetry?: { readonly attempts: number | 'unlimited'; readonly backoff: string } | undefined;
  readonly inTimeout?: { readonly ms: string } | undefined;
}

// =============================================================================
// Type Helpers
// =============================================================================

function resolveTypeConfidence(
  sig: EffectTypeSignature | undefined,
): 'declared' | 'inferred' | 'unknown' {
  if (!sig) return 'unknown';
  return sig.typeConfidence;
}

function formatErrorTypeDisplay(errorType: string): string {
  if (!errorType || errorType === 'never') return 'never';
  return errorType;
}

function parseErrorTags(errorType: string): readonly string[] {
  if (!errorType || errorType === 'never') return [];
  return splitTopLevelUnion(errorType)
    .filter((s) => s !== 'never');
}

function describeFlowNode(node: StaticFlowNode): string {
  switch (node.type) {
    case 'effect':
      return node.displayName ?? node.callee;
    case 'generator':
      return node.name ?? 'generator';
    case 'pipe':
      return node.name ?? 'pipe';
    default:
      return node.name ?? node.type;
  }
}

// =============================================================================
// Step Collection
// =============================================================================

function collectStepDetails(
  nodes: readonly StaticFlowNode[],
  result: ShowcaseStepDetail[],
  ctx: WalkContext,
): void {
  for (const node of nodes) {
    const detail = nodeToStepDetail(node, ctx);
    if (detail) result.push(detail);

    // Build updated context for children
    let childCtx = ctx;

    if (node.type === 'loop') {
      childCtx = {
        ...childCtx,
        inLoop: true,
        loopType: node.loopType,
        iterationSource: node.iterSource,
      };
      // Descend into loop body
      collectStepDetails([node.body], result, childCtx);
      continue;
    }

    if (node.type === 'retry') {
      const retryInfo = node.scheduleInfo
        ? {
            attempts: node.scheduleInfo.maxRetries ?? 'unlimited' as const,
            backoff: node.scheduleInfo.baseStrategy,
          }
        : { attempts: 'unlimited' as const, backoff: node.schedule ?? 'unknown' };
      childCtx = { ...childCtx, inRetry: retryInfo };
      // Descend into retry source
      collectStepDetails([node.source], result, childCtx);
      continue;
    }

    if (node.type === 'timeout') {
      childCtx = {
        ...childCtx,
        inTimeout: { ms: node.duration ?? 'unknown' },
      };
      collectStepDetails([node.source], result, childCtx);
      continue;
    }

    if (node.type === 'resource') {
      // Resource node produces its own detail; descend into use if present
      if (node.use) {
        collectStepDetails([node.use], result, ctx);
      }
      continue;
    }

    if (node.type === 'error-handler') {
      // Descend into source and handler
      collectStepDetails([node.source], result, ctx);
      if (node.handler) {
        collectStepDetails([node.handler], result, ctx);
      }
      continue;
    }

    if (node.type === 'generator') {
      // Generator is transparent — iterate through yields
      const yieldEffects = node.yields.map((y) => y.effect);
      collectStepDetails(yieldEffects, result, childCtx);
      continue;
    }

    // Generic descent into children
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectStepDetails(children, result, childCtx);
    }
  }
}

function nodeToStepDetail(
  node: StaticFlowNode,
  ctx: WalkContext,
): ShowcaseStepDetail | null {
  switch (node.type) {
    case 'effect': {
      const sig = node.typeSignature;
      const outputType = sig?.successType ?? 'unknown';
      const errorType = sig?.errorType ?? 'never';
      return {
        stepId: node.id,
        name: node.displayName ?? node.callee,
        callee: node.callee,
        outputType,
        outputTypeKind: resolveTypeConfidence(sig),
        outputTypeDisplay: outputType,
        outputTypeText: sig ? `Effect<${sig.successType}, ${sig.errorType}, ${sig.requirementsType}>` : `Effect<${outputType}>`,
        errorTypeDisplay: formatErrorTypeDisplay(errorType),
        errors: parseErrorTags(errorType),
        depSource: node.serviceCall?.serviceType,
        stepKind: 'effect',
        // Propagate context
        ...(ctx.inRetry ? { retry: ctx.inRetry } : {}),
        ...(ctx.inTimeout ? { timeout: ctx.inTimeout } : {}),
        ...(ctx.inLoop
          ? {
              repeats: 'loop' as const,
              loopType: ctx.loopType,
              iterationSource: ctx.iterationSource,
            }
          : {}),
      };
    }

    case 'retry': {
      const retryInfo = node.scheduleInfo
        ? {
            attempts: node.scheduleInfo.maxRetries ?? ('unlimited' as const),
            backoff: node.scheduleInfo.baseStrategy,
          }
        : {
            attempts: 'unlimited' as const,
            backoff: node.schedule ?? 'unknown',
          };
      return {
        stepId: node.id,
        name: node.name ?? 'Retry',
        callee: 'Effect.retry',
        outputType: 'void',
        outputTypeKind: 'unknown',
        outputTypeDisplay: 'void',
        outputTypeText: 'retry wrapper',
        errorTypeDisplay: 'never',
        errors: [],
        stepKind: 'retry',
        retry: retryInfo,
      };
    }

    case 'timeout': {
      return {
        stepId: node.id,
        name: node.name ?? 'Timeout',
        callee: 'Effect.timeout',
        outputType: 'void',
        outputTypeKind: 'unknown',
        outputTypeDisplay: 'void',
        outputTypeText: 'timeout wrapper',
        errorTypeDisplay: 'TimeoutException',
        errors: ['TimeoutException'],
        stepKind: 'timeout',
        timeout: { ms: node.duration ?? 'unknown' },
      };
    }

    case 'resource': {
      return {
        stepId: node.id,
        name: node.name ?? 'Resource',
        callee: 'Effect.acquireRelease',
        outputType: 'void',
        outputTypeKind: 'unknown',
        outputTypeDisplay: 'void',
        outputTypeText: 'resource lifecycle',
        errorTypeDisplay: 'never',
        errors: [],
        stepKind: 'resource',
        kind: 'resource',
        acquire: describeFlowNode(node.acquire),
        use: node.use ? describeFlowNode(node.use) : undefined,
        release: describeFlowNode(node.release),
      };
    }

    case 'error-handler': {
      if (node.handlerType === 'catchTag' || node.handlerType === 'catchTags') {
        const errors = node.errorTags
          ? [...node.errorTags]
          : node.errorTag
            ? [node.errorTag]
            : [];
        return {
          stepId: node.id,
          name: node.name ?? node.handlerType,
          callee: `Effect.${node.handlerType}`,
          outputType: 'void',
          outputTypeKind: 'unknown',
          outputTypeDisplay: 'void',
          outputTypeText: `error handler (${node.handlerType})`,
          errorTypeDisplay: errors.join(' | ') || 'unknown',
          errors,
          stepKind: 'error-handler',
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate a showcase entry from an analyzed Effect IR.
 */
export function generateShowcase(
  ir: StaticEffectIR,
  options?: ShowcaseOptions,
  sourceCode?: string,
): ShowcaseEntry {
  const mermaid = renderStaticMermaid(ir, {
    direction: options?.direction ?? 'TB',
  });

  const stepDetails: ShowcaseStepDetail[] = [];
  collectStepDetails(ir.root.children, stepDetails, {});

  return {
    title: ir.root.programName,
    code: sourceCode ?? '',
    mermaid,
    stepDetails,
  };
}

/**
 * Generate showcase entries for multiple programs.
 */
export function generateMultipleShowcase(
  irs: readonly StaticEffectIR[],
  options?: ShowcaseOptions,
  sourceCode?: string,
): ShowcaseEntry[] {
  return irs.map((ir) => generateShowcase(ir, options, sourceCode));
}
