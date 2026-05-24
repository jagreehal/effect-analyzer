import { describe, it, expect } from 'vitest';
import {
  buildAgentReport,
  type AgentCouplingIssue,
  type CouplingPriorityMap,
} from './agent-report';

const makeCouplingIssue = (
  type: AgentCouplingIssue['type'],
  filePath: string,
): AgentCouplingIssue => ({
  type,
  filePath,
  projectFilePath: filePath,
  metric: 'fan-in',
  value: 99,
  threshold: 30,
  description: `synthetic ${type}`,
  suggestion: '',
  estimatedImpact: 'high',
  knownHub: false,
  knownHubReason: '',
});

describe('buildAgentReport — couplingPriorityMap', () => {
  it('uses default priorities when no override is supplied', () => {
    const report = buildAgentReport({
      findings: [],
      couplingIssues: [
        makeCouplingIssue('critical-fanin', '/a.ts'),
        makeCouplingIssue('high-fanin', '/b.ts'),
        makeCouplingIssue('high-fanout', '/c.ts'),
      ],
    });
    const byRule = new Map(report.improvements.map((i) => [i.rule, i.priority]));
    expect(byRule.get('coupling:critical-fanin')).toBe('P1');
    expect(byRule.get('coupling:high-fanin')).toBe('P2');
    expect(byRule.get('coupling:high-fanout')).toBe('P3');
  });

  it('applies overrides for the specified issue types only', () => {
    const overrides: CouplingPriorityMap = {
      'critical-fanin': 'P0',
      'high-fanout': 'P1',
    };
    const report = buildAgentReport({
      findings: [],
      couplingIssues: [
        makeCouplingIssue('critical-fanin', '/a.ts'),
        makeCouplingIssue('high-fanin', '/b.ts'),
        makeCouplingIssue('high-fanout', '/c.ts'),
      ],
      couplingPriorityMap: overrides,
    });
    const byRule = new Map(report.improvements.map((i) => [i.rule, i.priority]));
    expect(byRule.get('coupling:critical-fanin')).toBe('P0');
    // not overridden — stays default
    expect(byRule.get('coupling:high-fanin')).toBe('P2');
    expect(byRule.get('coupling:high-fanout')).toBe('P1');
  });

  it('partial override leaves unspecified types at their defaults', () => {
    const report = buildAgentReport({
      findings: [],
      couplingIssues: [
        makeCouplingIssue('critical-fanin', '/a.ts'),
        makeCouplingIssue('high-fanin', '/b.ts'),
      ],
      couplingPriorityMap: { 'high-fanin': 'P0' },
    });
    const byRule = new Map(report.improvements.map((i) => [i.rule, i.priority]));
    expect(byRule.get('coupling:critical-fanin')).toBe('P1'); // default
    expect(byRule.get('coupling:high-fanin')).toBe('P0'); // overridden
  });
});
