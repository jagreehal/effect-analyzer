import { describe, it, expect } from 'vitest';
import { renderDecisionsMermaid } from './output/mermaid-decisions';
import type {
  StaticEffectIR,
  StaticEffectNode,
  StaticFlowNode,
  StaticConditionalNode,
  StaticDecisionNode,
  StaticSwitchNode,
  StaticMatchNode,
} from './types';

const makeEffect = (overrides: Partial<StaticEffectNode> & { id: string; callee: string }): StaticEffectNode => ({
  type: 'effect',
  name: overrides.callee,
  ...overrides,
});

const makeIR = (children: StaticFlowNode[]): StaticEffectIR => ({
  root: {
    id: 'prog-1',
    type: 'program',
    programName: 'test',
    source: 'direct',
    children,
    dependencies: [],
    errorTypes: [],
  },
  metadata: {
    analyzedAt: Date.now(),
    filePath: 'test.ts',
    stats: {
      totalEffects: 0, parallelCount: 0, raceCount: 0, errorHandlerCount: 0,
      retryCount: 0, timeoutCount: 0, resourceCount: 0, loopCount: 0,
      conditionalCount: 0, layerCount: 0, unknownCount: 0, interruptionCount: 0,
      decisionCount: 0, switchCount: 0,
    },
  },
  references: new Map(),
});

describe('renderDecisionsMermaid', () => {
  it('renders conditional node with diamond shape and true/false edges', () => {
    const conditional: StaticConditionalNode = {
      id: 'cond-1',
      type: 'conditional',
      condition: 'isAdmin',
      conditionalType: 'if',
      onTrue: makeEffect({ id: 'e1', callee: 'grantAccess', displayName: 'Grant Access' }),
      onFalse: makeEffect({ id: 'e2', callee: 'denyAccess', displayName: 'Deny Access' }),
      trueEdgeLabel: 'Yes',
      falseEdgeLabel: 'No',
    };
    const ir = makeIR([conditional as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('flowchart TB');
    expect(result).toContain('{isAdmin}');
    expect(result).toContain('Yes');
    expect(result).toContain('No');
    expect(result).toContain('Grant Access');
    expect(result).toContain('Deny Access');
  });

  it('renders conditional node with default true/false labels when edge labels are absent', () => {
    const conditional: StaticConditionalNode = {
      id: 'cond-2',
      type: 'conditional',
      condition: 'isValid',
      conditionalType: 'if',
      onTrue: makeEffect({ id: 'e1', callee: 'proceed', displayName: 'Proceed' }),
    };
    const ir = makeIR([conditional as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('{isValid}');
    expect(result).toContain('true');
    expect(result).toContain('Proceed');
  });

  it('renders switch node with per-case edges', () => {
    const switchNode: StaticSwitchNode = {
      id: 'sw-1',
      type: 'switch',
      expression: 'status',
      source: 'raw-js',
      hasDefault: true,
      hasFallthrough: false,
      cases: [
        { labels: ['"active"'], isDefault: false, body: [makeEffect({ id: 'e1', callee: 'handleActive', displayName: 'Handle Active' })] },
        { labels: ['"inactive"'], isDefault: false, body: [makeEffect({ id: 'e2', callee: 'handleInactive', displayName: 'Handle Inactive' })] },
        { labels: [], isDefault: true, body: [makeEffect({ id: 'e3', callee: 'handleDefault', displayName: 'Handle Default' })] },
      ],
    };
    const ir = makeIR([switchNode as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('{status}');
    expect(result).toContain('"active"');
    expect(result).toContain('"inactive"');
    expect(result).toContain('default');
    expect(result).toContain('Handle Active');
    expect(result).toContain('Handle Inactive');
    expect(result).toContain('Handle Default');
  });

  it('renders match node with matchedTags', () => {
    const matchNode: StaticMatchNode = {
      id: 'match-1',
      type: 'match',
      matchOp: 'tag',
      matchedTags: ['Success', 'Failure', 'Pending'],
      isExhaustive: true,
    };
    const ir = makeIR([matchNode as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('{Match.tag}');
    expect(result).toContain('Success');
    expect(result).toContain('Failure');
    expect(result).toContain('Pending');
  });

  it('renders "No decisions" when no decision nodes exist', () => {
    const ir = makeIR([
      makeEffect({ id: 'e1', callee: 'doStuff', displayName: 'Do Stuff' }),
    ]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('flowchart TB');
    expect(result).toContain('NoDec((No decisions))');
  });

  it('renders nested decisions with links between diamonds', () => {
    const innerConditional: StaticConditionalNode = {
      id: 'cond-inner',
      type: 'conditional',
      condition: 'hasBalance',
      conditionalType: 'if',
      onTrue: makeEffect({ id: 'e2', callee: 'transfer', displayName: 'Transfer' }),
      onFalse: makeEffect({ id: 'e3', callee: 'reject', displayName: 'Reject' }),
    };

    const outerDecision: StaticDecisionNode = {
      id: 'dec-1',
      type: 'decision',
      decisionId: 'dec-1',
      label: 'Check user',
      condition: 'isAuthenticated',
      source: 'raw-if',
      onTrue: [innerConditional as unknown as StaticFlowNode],
      onFalse: [makeEffect({ id: 'e4', callee: 'loginRedirect', displayName: 'Login Redirect' })],
    };

    const ir = makeIR([outerDecision as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    // Both diamonds should appear
    expect(result).toContain('{isAuthenticated}');
    expect(result).toContain('{hasBalance}');
    // Outer true branch should link to inner decision
    expect(result).toContain('Login Redirect');
    expect(result).toContain('Transfer');
    expect(result).toContain('Reject');
  });

  it('respects direction option', () => {
    const conditional: StaticConditionalNode = {
      id: 'cond-1',
      type: 'conditional',
      condition: 'x > 0',
      conditionalType: 'if',
      onTrue: makeEffect({ id: 'e1', callee: 'positive', displayName: 'Positive' }),
    };
    const ir = makeIR([conditional as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir, { direction: 'LR' });

    expect(result).toContain('flowchart LR');
  });

  it('renders decision node with true/false branches', () => {
    const decision: StaticDecisionNode = {
      id: 'dec-1',
      type: 'decision',
      decisionId: 'dec-1',
      label: 'Age check',
      condition: 'age >= 18',
      source: 'raw-if',
      onTrue: [makeEffect({ id: 'e1', callee: 'allow', displayName: 'Allow' })],
      onFalse: [makeEffect({ id: 'e2', callee: 'deny', displayName: 'Deny' })],
    };
    const ir = makeIR([decision as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    expect(result).toContain('{age #gt;= 18}');
    expect(result).toContain('Allow');
    expect(result).toContain('Deny');
    expect(result).toContain('true');
    expect(result).toContain('false');
  });

  it('truncates long condition text', () => {
    const conditional: StaticConditionalNode = {
      id: 'cond-1',
      type: 'conditional',
      condition: 'someVeryLongConditionThatExceedsTheMaximumAllowedCharacterLimit',
      conditionalType: 'if',
      onTrue: makeEffect({ id: 'e1', callee: 'action', displayName: 'Action' }),
    };
    const ir = makeIR([conditional as unknown as StaticFlowNode]);
    const result = renderDecisionsMermaid(ir);

    // Should be truncated with ellipsis
    expect(result).toContain('...');
    expect(result).not.toContain('someVeryLongConditionThatExceedsTheMaximumAllowedCharacterLimit}');
  });
});
