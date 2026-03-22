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

  const beforeMap = new Map<string, StepContext>();
  for (const s of beforeSteps) beforeMap.set(s.stepId, s);

  const afterMap = new Map<string, StepContext>();
  for (const s of afterSteps) afterMap.set(s.stepId, s);

  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();
  const entries: StepDiffEntry[] = [];

  // Pass 1: Match by stepId (node.id)
  for (const afterStep of afterSteps) {
    const beforeStep = beforeMap.get(afterStep.stepId);
    if (beforeStep) {
      matchedBefore.add(beforeStep.stepId);
      matchedAfter.add(afterStep.stepId);

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

  // Pass 2: Rename detection — match unmatched by callee + index position
  if (detectRenames) {
    const unmatchedBefore = beforeSteps.filter((s) => !matchedBefore.has(s.stepId));
    const unmatchedAfter = afterSteps.filter((s) => !matchedAfter.has(s.stepId));

    for (const afterStep of unmatchedAfter) {
      const candidate = unmatchedBefore.find(
        (bs) =>
          !matchedBefore.has(bs.stepId) &&
          bs.callee === afterStep.callee &&
          bs.index === afterStep.index,
      );
      if (candidate) {
        matchedBefore.add(candidate.stepId);
        matchedAfter.add(afterStep.stepId);
        entries.push({
          kind: 'renamed',
          stepId: afterStep.stepId,
          previousStepId: candidate.stepId,
          callee: afterStep.callee,
        });
      }
    }
  }

  // Pass 3: Remaining unmatched → removed / added
  for (const bs of beforeSteps) {
    if (!matchedBefore.has(bs.stepId)) {
      entries.push({
        kind: 'removed',
        stepId: bs.stepId,
        callee: bs.callee,
      });
    }
  }
  for (const as2 of afterSteps) {
    if (!matchedAfter.has(as2.stepId)) {
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
