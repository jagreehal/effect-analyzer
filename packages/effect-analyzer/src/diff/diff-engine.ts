import { Option } from 'effect';
import {
  getStaticChildren,
  type StaticEffectIR,
  type StaticEffectProgram,
  type StaticFlowNode,
} from '../types';
import type {
  ProgramDiff,
  DiffOptions,
  StepDiffEntry,
  StructuralChange,
  DiffSummary,
} from './types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface StepContext {
  stepId: string;
  callee: string;
  containerType: string;
  index: number;
  /** Content-based fingerprint for stable matching */
  fingerprint: string;
}

const CONTAINER_TYPES = new Set([
  'parallel',
  'race',
  'conditional',
  'decision',
  'switch',
  'loop',
  'error-handler',
  'retry',
  'generator',
  'pipe',
  'stream',
  'fiber',
]);

function computeFingerprint(node: StaticFlowNode): string {
  if (node.type === 'effect') {
    // Use displayName (includes variable name, e.g. "config <- succeed")
    // to disambiguate repeated callees; fall back to callee alone
    return node.displayName ?? node.callee;
  }
  return `${node.type}:${node.displayName ?? node.id}`;
}

// ---------------------------------------------------------------------------
// Tree walkers
// ---------------------------------------------------------------------------

function collectStepsWithContext(
  node: StaticFlowNode | StaticEffectProgram,
  containerType = 'root',
  index = 0,
): StepContext[] {
  const results: StepContext[] = [];

  if (node.type === 'effect') {
    results.push({
      stepId: node.id,
      callee: node.callee,
      containerType,
      index,
      fingerprint: computeFingerprint(node),
    });
    // Still recurse into callbackBody via getStaticChildren
  }

  const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
  const nextContainer = CONTAINER_TYPES.has(node.type) ? node.type : containerType;

  let childIdx = 0;
  for (const child of children) {
    // For effect nodes at this level, the container is the current node type
    const childResults = collectStepsWithContext(child, nextContainer, childIdx);
    results.push(...childResults);
    childIdx++;
  }

  return results;
}

function countContainerTypes(node: StaticFlowNode | StaticEffectProgram): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(n: StaticFlowNode | StaticEffectProgram): void {
    if (CONTAINER_TYPES.has(n.type)) {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    }
    const children = Option.getOrElse(getStaticChildren(n), () => [] as readonly StaticFlowNode[]);
    for (const child of children) {
      walk(child);
    }
  }

  walk(node);
  return counts;
}

// ---------------------------------------------------------------------------
// Diff algorithm
// ---------------------------------------------------------------------------

export function diffPrograms(
  before: StaticEffectIR,
  after: StaticEffectIR,
  options?: DiffOptions,
): ProgramDiff {
  const detectRenames = options?.detectRenames ?? true;
  const regressionMode = options?.regressionMode ?? false;

  const beforeSteps = collectStepsWithContext(before.root);
  const afterSteps = collectStepsWithContext(after.root);

  const matchedBeforeIdx = new Set<number>();
  const matchedAfterIdx = new Set<number>();
  const entries: StepDiffEntry[] = [];

  // Pass 1: Match by fingerprint (content-based, stable across analysis runs)
  // Sub-pass 1a: match same-container fingerprints first to avoid cross-container
  // matches stealing candidates when duplicates exist.
  function matchByFingerprint(requireSameContainer: boolean): void {
    for (let bIdx = 0; bIdx < beforeSteps.length; bIdx++) {
      if (matchedBeforeIdx.has(bIdx)) continue;
      const beforeStep = beforeSteps[bIdx];
      if (!beforeStep) continue;

      // Collect unmatched after-step candidates with the same fingerprint
      const candidates: number[] = [];
      for (let aIdx = 0; aIdx < afterSteps.length; aIdx++) {
        if (!matchedAfterIdx.has(aIdx) && afterSteps[aIdx]?.fingerprint === beforeStep.fingerprint) {
          if (requireSameContainer && afterSteps[aIdx]!.containerType !== beforeStep.containerType) continue;
          candidates.push(aIdx);
        }
      }
      if (candidates.length === 0) continue;

      // Pick best candidate by closest index
      let bestIdx = candidates[0]!;
      let bestDist = Math.abs(afterSteps[bestIdx]!.index - beforeStep.index);
      for (let i = 1; i < candidates.length; i++) {
        const aIdx = candidates[i]!;
        const dist = Math.abs(afterSteps[aIdx]!.index - beforeStep.index);
        if (dist < bestDist) {
          bestIdx = aIdx;
          bestDist = dist;
        }
      }

      const afterStep = afterSteps[bestIdx]!;
      matchedBeforeIdx.add(bIdx);
      matchedAfterIdx.add(bestIdx);

      if (beforeStep.containerType !== afterStep.containerType) {
        entries.push({
          kind: 'moved',
          stepId: afterStep.stepId,
          callee: afterStep.callee,
          containerBefore: beforeStep.containerType,
          containerAfter: afterStep.containerType,
        });
      } else {
        entries.push({
          kind: 'unchanged',
          stepId: afterStep.stepId,
          callee: afterStep.callee,
        });
      }
    }
  }
  // First match within same container, then allow cross-container moves
  matchByFingerprint(true);
  matchByFingerprint(false);

  // Pass 2: Rename detection — match unmatched by callee
  if (detectRenames) {
    for (let aIdx = 0; aIdx < afterSteps.length; aIdx++) {
      if (matchedAfterIdx.has(aIdx)) continue;
      const afterStep = afterSteps[aIdx];
      if (!afterStep) continue;
      // Find first unmatched before-step with same callee
      const bIdx = beforeSteps.findIndex(
        (bStep, bi) => !matchedBeforeIdx.has(bi) && bStep.callee === afterStep.callee,
      );
      if (bIdx >= 0) {
        const matchedBefore = beforeSteps[bIdx];
        if (!matchedBefore) continue;
        matchedBeforeIdx.add(bIdx);
        matchedAfterIdx.add(aIdx);
        entries.push({
          kind: 'renamed',
          stepId: afterStep.stepId,
          previousStepId: matchedBefore.stepId,
          callee: afterStep.callee,
        });
      }
    }
  }

  // Pass 3: Remaining unmatched → removed / added
  for (let bIdx = 0; bIdx < beforeSteps.length; bIdx++) {
    if (!matchedBeforeIdx.has(bIdx)) {
      const bs = beforeSteps[bIdx];
      if (!bs) continue;
      entries.push({
        kind: 'removed',
        stepId: bs.stepId,
        callee: bs.callee,
      });
    }
  }
  for (let aIdx = 0; aIdx < afterSteps.length; aIdx++) {
    if (!matchedAfterIdx.has(aIdx)) {
      const as2 = afterSteps[aIdx];
      if (!as2) continue;
      entries.push({
        kind: 'added',
        stepId: as2.stepId,
        callee: as2.callee,
      });
    }
  }

  // Structural changes — compare container counts
  const structuralChanges: StructuralChange[] = [];
  const beforeContainers = countContainerTypes(before.root);
  const afterContainers = countContainerTypes(after.root);

  const allContainerKeys = new Set([...beforeContainers.keys(), ...afterContainers.keys()]);
  for (const key of allContainerKeys) {
    const bCount = beforeContainers.get(key) ?? 0;
    const aCount = afterContainers.get(key) ?? 0;
    if (aCount > bCount) {
      for (let i = 0; i < aCount - bCount; i++) {
        structuralChanges.push({
          kind: 'added',
          nodeType: key,
          description: `${key} block added`,
        });
      }
    } else if (bCount > aCount) {
      for (let i = 0; i < bCount - aCount; i++) {
        structuralChanges.push({
          kind: 'removed',
          nodeType: key,
          description: `${key} block removed`,
        });
      }
    }
  }

  // Summary
  const summary: DiffSummary = {
    stepsAdded: entries.filter((e) => e.kind === 'added').length,
    stepsRemoved: entries.filter((e) => e.kind === 'removed').length,
    stepsRenamed: entries.filter((e) => e.kind === 'renamed').length,
    stepsMoved: entries.filter((e) => e.kind === 'moved').length,
    stepsUnchanged: entries.filter((e) => e.kind === 'unchanged').length,
    structuralChanges: structuralChanges.length,
    hasRegressions: regressionMode
      ? entries.some((e) => e.kind === 'removed') || structuralChanges.some((sc) => sc.kind === 'removed')
      : false,
  };

  return {
    beforeName: before.root.programName,
    afterName: after.root.programName,
    diffedAt: Date.now(),
    steps: entries,
    structuralChanges,
    summary,
  };
}
