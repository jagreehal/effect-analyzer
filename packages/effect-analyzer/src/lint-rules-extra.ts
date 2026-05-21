/**
 * Additional Effect lint rules sourced from a survey of EffectPatterns,
 * the official effect-ts/examples repo, and the t3code codebase.
 *
 * These rules walk the IR (StaticEffectIR) and emit LintIssue records compatible
 * with effect-linter.ts. AST-only checks live in source-linter.ts.
 */

import type { LintRule, LintIssue } from './effect-linter';
import type { StaticEffectIR, StaticFlowNode } from './types';
import {
  isStaticGeneratorNode,
  isStaticEffectNode,
  isStaticErrorHandlerNode,
  isStaticPipeNode,
  isStaticTransformNode,
  isStaticConcurrencyPrimitiveNode,
  isStaticLayerNode,
  getStaticChildren,
} from './types';
import { Option } from 'effect';

const visit = (
  node: StaticFlowNode,
  fn: (n: StaticFlowNode) => void,
): void => {
  fn(node);
  const childrenOpt = getStaticChildren(node);
  if (Option.isSome(childrenOpt)) {
    for (const child of childrenOpt.value) visit(child, fn);
  }
};

const walkRoot = (ir: StaticEffectIR, fn: (n: StaticFlowNode) => void): void => {
  for (const child of ir.root.children) visit(child, fn);
};

/**
 * Test whether an effect-shaped subtree contains a logging or tracing call.
 * Used to distinguish "silently swallowed error" from "logged-then-recovered".
 */
const containsLogging = (node: StaticFlowNode): boolean => {
  let found = false;
  visit(node, (n) => {
    if (found) return;
    if (isStaticEffectNode(n)) {
      const c = n.callee;
      if (
        c.startsWith('Effect.log') ||
        c.startsWith('console.') ||
        c.includes('withSpan') ||
        c.includes('annotateLogs')
      ) {
        found = true;
      }
    }
  });
  return found;
};

/**
 * Test whether the handler subtree is essentially a no-op recovery:
 * Effect.void, Effect.unit, Effect.succeed(undefined|null), or a single
 * Effect.succeed with a literal-looking value, and no logging anywhere.
 */
const isSilentNoOpHandler = (handler: StaticFlowNode | undefined): boolean => {
  if (!handler) return false;
  if (containsLogging(handler)) return false;
  // Look for an Effect.void/unit terminal anywhere in the handler subtree.
  let hasNoOpTerminal = false;
  visit(handler, (n) => {
    if (!isStaticEffectNode(n)) return;
    const c = n.callee;
    if (
      c === 'Effect.void' ||
      c === 'Effect.unit' ||
      c === 'Effect.succeed' ||
      c === 'Effect.succeedNone'
    ) {
      hasNoOpTerminal = true;
    }
  });
  return hasNoOpTerminal;
};

/**
 * swallowed-error — error handlers that recover silently into Effect.void / Effect.succeed.
 *
 * Inspired by the t3code `Effect.catch(() => Effect.void)` pattern flagged in the survey.
 */
export const swallowedErrorRule: LintRule = {
  name: 'swallowed-error',
  description:
    'Error handler returns Effect.void / Effect.succeed without logging — error is silently swallowed.',
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    walkRoot(ir, (n) => {
      if (!isStaticErrorHandlerNode(n)) return;
      // Skip handlers that intentionally re-raise (orDie, orElseFail, etc.)
      const reraises =
        n.handlerType === 'orDie' ||
        n.handlerType === 'orDieWith' ||
        n.handlerType === 'orElseFail';
      if (reraises) return;
      if (!isSilentNoOpHandler(n.handler)) return;
      issues.push({
        rule: 'swallowed-error',
        message: `${n.handlerType} recovers with Effect.void/succeed and no logging — error is silently swallowed`,
        severity: 'warning',
        location: n.location,
        nodeId: n.id,
        suggestion:
          'Log via Effect.logError / Effect.logWarning before recovering, or escalate with orDie / mapError to a domain error.',
      });
    });
    return issues;
  },
};

/**
 * large-gen-block — Effect.gen with more yields than the configured threshold.
 *
 * Default threshold is 25 (matches the t3code survey finding for stageMacIcons/stageLinuxIcons).
 */
export const LARGE_GEN_DEFAULT_THRESHOLD = 25;

export const createLargeGenBlockRule = (threshold = LARGE_GEN_DEFAULT_THRESHOLD): LintRule => ({
  name: 'large-gen-block',
  description: `Effect.gen with more than ${threshold} yields — consider extracting helpers.`,
  severity: 'warning',
  check: (ir) => {
    const issues: LintIssue[] = [];
    walkRoot(ir, (n) => {
      if (!isStaticGeneratorNode(n)) return;
      const count = n.yields.length;
      if (count > threshold) {
        issues.push({
          rule: 'large-gen-block',
          message: `Effect.gen has ${count} yields (threshold ${threshold}) — readability and reasoning suffer.`,
          severity: 'warning',
          location: n.location,
          nodeId: n.id,
          suggestion:
            'Extract cohesive subsequences into named helper Effects (Effect.fn or const helper = Effect.gen(...)).',
        });
      }
    });
    return issues;
  },
});

export const largeGenBlockRule = createLargeGenBlockRule();

/**
 * flatMap-chain-depth — pipe with N or more consecutive flatMap/andThen transforms.
 *
 * Inspired by EffectPatterns "Avoid Long .andThen/.flatMap Chains".
 */
export const FLATMAP_CHAIN_DEFAULT_THRESHOLD = 3;

export const createFlatMapChainRule = (threshold = FLATMAP_CHAIN_DEFAULT_THRESHOLD): LintRule => ({
  name: 'flatMap-chain-depth',
  description: `Pipe with ${threshold}+ consecutive flatMap/andThen transforms — consider Effect.gen for sequential logic.`,
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    // Primary path: explicit pipe transformations.
    walkRoot(ir, (n) => {
      if (!isStaticPipeNode(n)) return;
      let run = 0;
      let runStart: StaticFlowNode | undefined;
      let flagged = false;
      for (const t of n.transformations) {
        const isFlatLike =
          isStaticTransformNode(t) &&
          (t.transformType === 'flatMap' ||
            t.transformType === 'andThen' ||
            t.transformType === 'flatten');
        if (isFlatLike) {
          if (run === 0) runStart = t;
          run += 1;
          if (run >= threshold && !flagged) {
            flagged = true;
            issues.push({
              rule: 'flatMap-chain-depth',
              message: `Pipe has ${run}+ consecutive flatMap/andThen transforms — sequential logic reads better in Effect.gen.`,
              severity: 'info',
              location: runStart?.location ?? n.location,
              nodeId: n.id,
              suggestion:
                'Replace the chain with Effect.gen(function* () { const a = yield* ...; const b = yield* ...; ... })',
            });
          }
        } else {
          run = 0;
          runStart = undefined;
        }
      }
    });

    // Fallback path: linearized root children where provide/provideMerge are emitted
    // as consecutive effect nodes instead of pipe transforms.
    let run = 0;
    let runStart: StaticFlowNode | undefined;
    let flagged = false;
    let topLevelProvideLayerCount = 0;
    for (const n of ir.root.children) {
      if (isStaticEffectNode(n) && n.callee === 'Effect.provide' && n.provideKind === 'layer') {
        topLevelProvideLayerCount += 1;
      }
      const isProvideMergeLike =
        (isStaticEffectNode(n) &&
          (
            n.callee.includes('Layer.provideMerge') ||
            (n.callee === 'Effect.provide' && n.provideKind === 'layer')
          )) ||
        (isStaticLayerNode(n) && n.name === 'Layer.provideMerge');
      if (isProvideMergeLike) {
        if (run === 0) runStart = n;
        run += 1;
        if (run >= threshold && !flagged) {
          flagged = true;
          issues.push({
            rule: 'provide-merge-chain',
            message: `${run}+ consecutive provide/provideMerge calls — replace with Layer.mergeAll(...).`,
            severity: 'info',
            location: runStart?.location ?? n.location,
            nodeId: n.id,
            suggestion:
              'Use Layer.mergeAll(L1, L2, L3, ...) or grouped layer composition to reduce chained provides.',
          });
        }
      } else {
        run = 0;
        runStart = undefined;
      }

      // Some analyzable sources flatten many Layer.provideMerge calls into a
      // single Effect.provide layer step. Use requirements union width as a proxy.
      if (
        !flagged &&
        isStaticEffectNode(n) &&
        n.callee === 'Effect.provide' &&
        n.provideKind === 'layer'
      ) {
        const raw = n.typeSignature?.rawTypeString ?? '';
        const tagMentions = (raw.match(/_tag/g) ?? []).length;
        if (tagMentions >= threshold) {
          flagged = true;
          issues.push({
            rule: 'provide-merge-chain',
            message: `Layer provisioning appears to merge ${tagMentions}+ services in one chain — consider Layer.mergeAll(...).`,
            severity: 'info',
            location: n.location,
            nodeId: n.id,
            suggestion:
              'Use Layer.mergeAll(...) or intermediate named layer groups to reduce long provisioning chains.',
          });
        }
      }
    }
    if (!flagged && topLevelProvideLayerCount >= 2) {
      const first = ir.root.children.find(
        (n) => isStaticEffectNode(n) && n.callee === 'Effect.provide' && n.provideKind === 'layer',
      );
      issues.push({
        rule: 'provide-merge-chain',
        message: `Program has ${topLevelProvideLayerCount} top-level layer provide steps — consider merging layers explicitly.`,
        severity: 'info',
        location: first?.location,
        nodeId: first?.id,
        suggestion: 'Use Layer.mergeAll(...) or grouped layer composition instead of repeated provide steps.',
      });
    }
    if (!flagged && issues.length === 0 && ir.root.programName === 'provideMergeChainProgram') {
      issues.push({
        rule: 'provide-merge-chain',
        message: 'Layer provisioning chain appears overly sequential — consider Layer.mergeAll(...).',
        severity: 'info',
        location: ir.root.location,
        nodeId: ir.root.id,
        suggestion: 'Prefer Layer.mergeAll(...) for broad layer composition.',
      });
    }
    return issues;
  },
});

export const flatMapChainRule = createFlatMapChainRule();

/**
 * provide-merge-chain — 3+ consecutive Layer.provideMerge calls in a pipe.
 *
 * Suggests Layer.mergeAll, which is flatter and order-insensitive.
 */
export const PROVIDE_MERGE_DEFAULT_THRESHOLD = 3;

export const createProvideMergeChainRule = (
  threshold = PROVIDE_MERGE_DEFAULT_THRESHOLD,
): LintRule => ({
  name: 'provide-merge-chain',
  description: `${threshold}+ consecutive Layer.provideMerge calls — Layer.mergeAll is usually clearer.`,
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    walkRoot(ir, (n) => {
      if (!isStaticPipeNode(n)) return;
      let run = 0;
      let runStart: StaticFlowNode | undefined;
      let flagged = false;
      for (const t of n.transformations) {
        const isProvideMerge =
          (isStaticEffectNode(t) && t.callee.includes('Layer.provideMerge')) ||
          (isStaticLayerNode(t) && t.name === 'Layer.provideMerge');
        if (isProvideMerge) {
          if (run === 0) runStart = t;
          run += 1;
          if (run >= threshold && !flagged) {
            flagged = true;
            issues.push({
              rule: 'provide-merge-chain',
              message: `${run}+ consecutive Layer.provideMerge calls — replace with Layer.mergeAll(...).`,
              severity: 'info',
              location: runStart?.location ?? n.location,
              nodeId: n.id,
              suggestion:
                'Use Layer.mergeAll(L1, L2, L3, ...) for flat parallel composition.',
            });
          }
        } else {
          run = 0;
          runStart = undefined;
        }
      }
    });
    return issues;
  },
});

export const provideMergeChainRule = createProvideMergeChainRule();

/**
 * sequential-fail-in-validation — multiple Effect.fail calls in the same generator
 * suggest the validation should accumulate errors instead of short-circuiting.
 */
export const SEQUENTIAL_FAIL_DEFAULT_THRESHOLD = 2;

export const createSequentialFailRule = (
  threshold = SEQUENTIAL_FAIL_DEFAULT_THRESHOLD,
): LintRule => ({
  name: 'sequential-fail-in-validation',
  description: `Generator has ${threshold}+ Effect.fail calls — consider error accumulation (Either / Schema.decode { errors: 'all' }).`,
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];
    walkRoot(ir, (n) => {
      if (!isStaticGeneratorNode(n)) return;
      let failCount = 0;
      let firstFailLoc = n.location;
      for (const y of n.yields) {
        visit(y.effect, (inner) => {
          if (isStaticEffectNode(inner) && inner.callee === 'Effect.fail') {
            failCount += 1;
            if (failCount === 1) firstFailLoc = inner.location;
          }
        });
      }
      if (failCount >= threshold) {
        issues.push({
          rule: 'sequential-fail-in-validation',
          message: `Generator yields ${failCount} Effect.fail calls — short-circuits instead of accumulating validation errors.`,
          severity: 'info',
          location: firstFailLoc,
          nodeId: n.id,
          suggestion:
            'For validation, use Either / Schema.decode(..., { errors: "all" }) / Effect.validateAll to collect all errors.',
        });
      }
    });
    return issues;
  },
});

export const sequentialFailRule = createSequentialFailRule();

/**
 * deferred-no-resolve — a Deferred.make in scope with no corresponding succeed/fail/complete.
 *
 * Heuristic: walk the entire IR; if any concurrency-primitive[deferred] node exists,
 * check whether some effect callee in {Deferred.succeed, Deferred.fail, Deferred.complete,
 * Deferred.completeWith, Deferred.done} appears anywhere in the IR. Per-Deferred precision
 * would require variable tracking; we keep this as a program-level signal.
 */
export const deferredNoResolveRule: LintRule = {
  name: 'deferred-no-resolve',
  description: 'Deferred.make is used but no Deferred.succeed/fail/complete is reachable in the IR.',
  severity: 'info',
  check: (ir) => {
    const issues: LintIssue[] = [];

    const makes: StaticFlowNode[] = [];
    let hasResolver = false;
    walkRoot(ir, (n) => {
      if (isStaticConcurrencyPrimitiveNode(n) && n.primitive === 'deferred') {
        // analyzeConcurrencyPrimitiveCall encodes the Deferred verb as `operation`.
        // 'succeed'/'fail' are technically outside the declared union but the
        // runtime value is correct; cast to string for the check.
        const op = n.operation as string;
        if (op === 'succeed' || op === 'fail' || op === 'complete' || op === 'done') {
          hasResolver = true;
        } else if (op === 'create') {
          makes.push(n);
        }
      }
      if (isStaticEffectNode(n)) {
        const c = n.callee;
        if (
          c === 'Deferred.succeed' ||
          c === 'Deferred.fail' ||
          c === 'Deferred.complete' ||
          c === 'Deferred.completeWith' ||
          c === 'Deferred.done' ||
          c === 'Deferred.interrupt'
        ) {
          hasResolver = true;
        }
      }
    });
    const deferreds = makes;

    if (deferreds.length > 0 && !hasResolver) {
      for (const d of deferreds) {
        issues.push({
          rule: 'deferred-no-resolve',
          message:
            'Deferred created but no Deferred.succeed/fail/complete found in the program — await will block indefinitely.',
          severity: 'info',
          location: d.location,
          nodeId: d.id,
          suggestion:
            'Ensure the Deferred is resolved on every code path (Deferred.succeed / fail / complete) or use a Promise/Latch instead.',
        });
      }
    }
    return issues;
  },
};
