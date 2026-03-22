export type StepChangeKind =
  | "added"
  | "removed"
  | "unchanged"
  | "renamed"
  | "moved";

export interface StepDiffEntry {
  kind: StepChangeKind;
  stepId: string;
  previousStepId?: string;
  callee?: string;
  containerBefore?: string;
  containerAfter?: string;
}

export interface StructuralChange {
  kind: "added" | "removed";
  nodeType: string;
  description: string;
}

export interface DiffSummary {
  stepsAdded: number;
  stepsRemoved: number;
  stepsRenamed: number;
  stepsMoved: number;
  stepsUnchanged: number;
  structuralChanges: number;
  hasRegressions: boolean;
}

export interface ProgramDiff {
  beforeName: string;
  afterName: string;
  diffedAt: number;
  steps: StepDiffEntry[];
  structuralChanges: StructuralChange[];
  summary: DiffSummary;
}

export interface DiffOptions {
  detectRenames?: boolean;
  regressionMode?: boolean;
}

export interface DiffMarkdownOptions {
  showUnchanged?: boolean;
  title?: string;
}

export interface DiffMermaidOptions {
  showRemovedSteps?: boolean;
  direction?: "TB" | "LR" | "BT" | "RL";
}
