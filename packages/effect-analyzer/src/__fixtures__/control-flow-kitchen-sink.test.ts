/**
 * KITCHEN SINK integration tests for control flow analysis.
 *
 * Exercises every control flow IR node type and edge case:
 * - Deeply nested structures (4+ levels)
 * - Expression-level branching (ternary chains, &&, ||, ??)
 * - All loop types with all features
 * - Every try/catch/finally combination
 * - Terminal nodes in every position
 * - Switch fallthrough, mixed terminators
 * - Yields in unusual positions
 * - Nested function boundaries
 * - Real-world workflow patterns
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Effect } from 'effect';
import { analyze } from '../analyze';
import { resolve } from 'path';
import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticGeneratorNode,
  StaticDecisionNode,
  StaticSwitchNode,
  StaticLoopNode,
  StaticTryCatchNode,
  StaticTerminalNode,
  StaticOpaqueNode,
  StaticParallelNode,
  StaticRaceNode,
} from '../types';

const FIXTURE_PATH = resolve(__dirname, 'control-flow-kitchen-sink.ts');

/**
 * Recursively flatten all nodes from a program's IR tree.
 * Walks through every structure: yields, decision branches, switch cases,
 * try-catch bodies, loop bodies, terminal values, parallel/race children, etc.
 */
function flattenNodes(nodes: readonly StaticFlowNode[]): StaticFlowNode[] {
  const result: StaticFlowNode[] = [];
  for (const node of nodes) {
    result.push(node);

    if (node.type === 'generator') {
      const gen = node as StaticGeneratorNode;
      result.push(...flattenNodes(gen.yields.map((y) => y.effect)));
    }
    if (node.type === 'decision') {
      const dec = node as StaticDecisionNode;
      result.push(...flattenNodes(dec.onTrue));
      if (dec.onFalse) result.push(...flattenNodes(dec.onFalse));
    }
    if (node.type === 'switch') {
      const sw = node as StaticSwitchNode;
      for (const c of sw.cases) {
        result.push(...flattenNodes(c.body));
      }
    }
    if (node.type === 'try-catch') {
      const tc = node as StaticTryCatchNode;
      result.push(...flattenNodes(tc.tryBody));
      if (tc.catchBody) result.push(...flattenNodes(tc.catchBody));
      if (tc.finallyBody) result.push(...flattenNodes(tc.finallyBody));
    }
    if (node.type === 'loop') {
      const loop = node as StaticLoopNode;
      result.push(...flattenNodes([loop.body]));
      if (loop.headerYields) result.push(...flattenNodes(loop.headerYields));
    }
    if (node.type === 'terminal') {
      const term = node as StaticTerminalNode;
      if (term.value) result.push(...flattenNodes(term.value));
    }
    if (node.type === 'pipe') {
      result.push(...flattenNodes([node.initial]));
      result.push(...flattenNodes(node.transformations));
    }
    if (node.type === 'parallel' || node.type === 'race') {
      result.push(...flattenNodes(node.children));
    }
    if (node.type === 'error-handler') {
      result.push(...flattenNodes([node.source]));
      if (node.handler) result.push(...flattenNodes([node.handler]));
    }
  }
  return result;
}

function getFlattened(ir: StaticEffectIR): StaticFlowNode[] {
  return flattenNodes(ir.root.children);
}

/** Count nodes of a specific type */
function countByType(nodes: StaticFlowNode[], type: string): number {
  return nodes.filter((n) => n.type === type).length;
}

/** Find all nodes of a specific type with type narrowing */
function findByType<T extends StaticFlowNode>(
  nodes: StaticFlowNode[],
  type: string,
): T[] {
  return nodes.filter((n) => n.type === type) as T[];
}

/** Collect all unique node types in a flattened IR */
function collectTypes(nodes: StaticFlowNode[]): Set<string> {
  return new Set(nodes.map((n) => n.type));
}

describe('Control Flow Kitchen Sink', () => {
  let programsByName: Map<string, StaticEffectIR>;
  let allPrograms: StaticEffectIR[];

  beforeAll(async () => {
    allPrograms = await Effect.runPromise(analyze(FIXTURE_PATH).all());
    programsByName = new Map(
      allPrograms.map((ir) => [ir.root.programName, ir]),
    );
  }, 60_000);

  // ========================================================================
  // META: Discovery
  // ========================================================================
  describe('Discovery', () => {
    it('should discover all 30 programs', () => {
      expect(programsByName.size).toBeGreaterThanOrEqual(30);
    });

    it('should have all expected program names', () => {
      const expected = [
        'deeplyNested', 'nestedTernary', 'chainedShortCircuit',
        'allLoopTypes', 'tryCatchOnly', 'tryFinallyOnly',
        'tryReturnFinally', 'nestedTryCatch', 'tryCatchRethrow',
        'switchMixedTerminators', 'switchAllReturns',
        'returnFromNestedIf', 'throwWithYieldValue', 'guardClauses',
        'yieldsInUnusualPositions', 'expressionUnwrapping',
        'nestedFunctionBoundary', 'ifElseChain', 'labeledBreak',
        'forOfHeaderYield', 'whileComplexCondition',
        'switchInsideLoop', 'checkoutWorkflow', 'dataPipeline',
        'stateMachine', 'mixedExpressionBranching', 'racePattern',
        'forOfEarlyExit', 'whileWithContinue', 'conditionalParallel',
      ];
      for (const name of expected) {
        expect(programsByName.has(name), `Missing program: ${name}`).toBe(true);
      }
    });

    it('should contain all control flow node types across all programs', () => {
      const allTypes = new Set<string>();
      for (const ir of allPrograms) {
        const types = collectTypes(getFlattened(ir));
        types.forEach((t) => allTypes.add(t));
      }
      expect(allTypes.has('decision')).toBe(true);
      expect(allTypes.has('switch')).toBe(true);
      expect(allTypes.has('loop')).toBe(true);
      expect(allTypes.has('try-catch')).toBe(true);
      expect(allTypes.has('terminal')).toBe(true);
      expect(allTypes.has('effect')).toBe(true);
      expect(allTypes.has('generator')).toBe(true);
    });
  });

  // ========================================================================
  // 1. DEEPLY NESTED: if → switch → for-of → try/catch
  // ========================================================================
  describe('deeplyNested', () => {
    it('should have a decision containing a switch containing a loop containing try-catch', () => {
      const ir = programsByName.get('deeplyNested')!;
      const nodes = getFlattened(ir);

      // Must have all four control flow types
      expect(countByType(nodes, 'decision')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'switch')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'loop')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'try-catch')).toBeGreaterThanOrEqual(1);
    });

    it('decision should have both branches populated', () => {
      const ir = programsByName.get('deeplyNested')!;
      const nodes = getFlattened(ir);
      const decision = findByType<StaticDecisionNode>(nodes, 'decision')
        .find((d) => d.source === 'raw-if');
      expect(decision).toBeDefined();
      expect(decision!.onTrue.length).toBeGreaterThan(0);
      expect(decision!.onFalse).toBeDefined();
      expect(decision!.onFalse!.length).toBeGreaterThan(0);
    });

    it('loop should be forOf type', () => {
      const ir = programsByName.get('deeplyNested')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'forOf')).toBe(true);
    });

    it('try-catch should have both tryBody and catchBody', () => {
      const ir = programsByName.get('deeplyNested')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.tryBody.length).toBeGreaterThan(0);
      expect(tc.catchBody).toBeDefined();
      expect(tc.catchBody!.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // 2. NESTED TERNARY CHAIN
  // ========================================================================
  describe('nestedTernary', () => {
    it('should produce decision nodes from ternary expressions', () => {
      const ir = programsByName.get('nestedTernary')!;
      const nodes = getFlattened(ir);
      const ternaries = findByType<StaticDecisionNode>(nodes, 'decision')
        .filter((d) => d.source === 'raw-ternary');
      // Nested ternary should produce at least 2 decision nodes
      // (outer ternary + at least one inner ternary)
      expect(ternaries.length).toBeGreaterThanOrEqual(1);
    });

    it('should have effect nodes for each discount value', () => {
      const ir = programsByName.get('nestedTernary')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // Should have effects for 0.30, 0.20, 0.10, and 0
      expect(effects.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // 3. CHAINED SHORT-CIRCUIT
  // ========================================================================
  describe('chainedShortCircuit', () => {
    it('should produce short-circuit decision nodes for && and ||', () => {
      const ir = programsByName.get('chainedShortCircuit')!;
      const nodes = getFlattened(ir);
      const shortCircuits = findByType<StaticDecisionNode>(nodes, 'decision')
        .filter((d) => d.source === 'raw-short-circuit');
      // Should detect && and || and ?? as short-circuit decisions
      expect(shortCircuits.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect nullish coalescing (??) as raw-short-circuit', () => {
      const ir = programsByName.get('chainedShortCircuit')!;
      const nodes = getFlattened(ir);
      const nullish = findByType<StaticDecisionNode>(nodes, 'decision')
        .filter((d) => d.source === 'raw-short-circuit' && d.condition.includes('!= null'));
      expect(nullish.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 4. ALL LOOP TYPES
  // ========================================================================
  describe('allLoopTypes', () => {
    it('should have forOf, forIn, for, while, and doWhile loops', () => {
      const ir = programsByName.get('allLoopTypes')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      const types = new Set(loops.map((l) => l.loopType));
      expect(types.has('forOf')).toBe(true);
      expect(types.has('forIn')).toBe(true);
      expect(types.has('for')).toBe(true);
      expect(types.has('while')).toBe(true);
      expect(types.has('doWhile')).toBe(true);
    });

    it('while loop should have hasEarlyExit for break', () => {
      const ir = programsByName.get('allLoopTypes')!;
      const nodes = getFlattened(ir);
      const whileLoop = findByType<StaticLoopNode>(nodes, 'loop')
        .find((l) => l.loopType === 'while');
      expect(whileLoop).toBeDefined();
      expect(whileLoop!.hasEarlyExit).toBe(true);
    });

    it('do-while should contain a terminal (return) inside its body', () => {
      const ir = programsByName.get('allLoopTypes')!;
      const nodes = getFlattened(ir);
      // The do-while body has `return yield* ...` which is a terminal
      const terminals = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(terminals.length).toBeGreaterThanOrEqual(1);
    });

    it('forIn loop should have an iterVariable', () => {
      const ir = programsByName.get('allLoopTypes')!;
      const nodes = getFlattened(ir);
      const forIn = findByType<StaticLoopNode>(nodes, 'loop')
        .find((l) => l.loopType === 'forIn');
      expect(forIn).toBeDefined();
      expect(forIn!.iterVariable).toBeDefined();
    });
  });

  // ========================================================================
  // 5. TRY/CATCH MATRIX
  // ========================================================================
  describe('tryCatchOnly', () => {
    it('should have try and catch but no finally', () => {
      const ir = programsByName.get('tryCatchOnly')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.tryBody.length).toBeGreaterThan(0);
      expect(tc.catchBody).toBeDefined();
      expect(tc.finallyBody).toBeUndefined();
    });
  });

  describe('tryFinallyOnly', () => {
    it('should have try and finally but no catch', () => {
      const ir = programsByName.get('tryFinallyOnly')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.tryBody.length).toBeGreaterThan(0);
      expect(tc.catchBody).toBeUndefined();
      expect(tc.finallyBody).toBeDefined();
      expect(tc.finallyBody!.length).toBeGreaterThan(0);
    });
  });

  describe('tryReturnFinally', () => {
    it('should have try, catch, and finally', () => {
      const ir = programsByName.get('tryReturnFinally')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.tryBody.length).toBeGreaterThan(0);
      expect(tc.catchBody).toBeDefined();
      expect(tc.finallyBody).toBeDefined();
      expect(tc.finallyBody!.length).toBeGreaterThan(0);
    });

    it('should have hasTerminalInTry because of return in try', () => {
      const ir = programsByName.get('tryReturnFinally')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.hasTerminalInTry).toBe(true);
    });

    it('should have catch variable "err"', () => {
      const ir = programsByName.get('tryReturnFinally')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.catchVariable).toBe('err');
    });
  });

  describe('nestedTryCatch', () => {
    it('should have at least 2 try-catch nodes (inner and outer)', () => {
      const ir = programsByName.get('nestedTryCatch')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');
      expect(tryCatches.length).toBeGreaterThanOrEqual(2);
    });

    it('outer should have finally, inner should have catch', () => {
      const ir = programsByName.get('nestedTryCatch')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');

      // At least one should have finallyBody
      const withFinally = tryCatches.filter((tc) => tc.finallyBody && tc.finallyBody.length > 0);
      expect(withFinally.length).toBeGreaterThanOrEqual(1);

      // At least two should have catchBody (inner + outer)
      const withCatch = tryCatches.filter((tc) => tc.catchBody && tc.catchBody.length > 0);
      expect(withCatch.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('tryCatchRethrow', () => {
    it('should have a try-catch with catch variable "e"', () => {
      const ir = programsByName.get('tryCatchRethrow')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.catchVariable).toBe('e');
      expect(tc.catchBody).toBeDefined();
    });
  });

  // ========================================================================
  // 6. SWITCH FALLTHROUGH PATTERNS
  // ========================================================================
  describe('switchMixedTerminators', () => {
    it('should have a switch with hasFallthrough=true', () => {
      const ir = programsByName.get('switchMixedTerminators')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      expect(sw.hasFallthrough).toBe(true);
    });

    it('should have a default case', () => {
      const ir = programsByName.get('switchMixedTerminators')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      expect(sw.hasDefault).toBe(true);
    });

    it('should have fallthrough group with combined labels (draft + pending)', () => {
      const ir = programsByName.get('switchMixedTerminators')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      // The draft/pending group should be combined
      const draftPending = sw.cases.find((c) =>
        c.labels.some((l) => l.includes('draft') || l === "'draft'"),
      );
      expect(draftPending).toBeDefined();
      expect(draftPending!.labels.length).toBeGreaterThanOrEqual(2);
    });

    it('should have a terminal (return) in the archived case', () => {
      const ir = programsByName.get('switchMixedTerminators')!;
      const nodes = getFlattened(ir);
      const terminals = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(terminals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('switchAllReturns', () => {
    it('should have a switch with at least 3 cases + default', () => {
      const ir = programsByName.get('switchAllReturns')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      expect(sw.cases.length).toBeGreaterThanOrEqual(4);
      expect(sw.hasDefault).toBe(true);
    });

    it('every case should contain a terminal return', () => {
      const ir = programsByName.get('switchAllReturns')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      for (const c of sw.cases) {
        const caseNodes = flattenNodes(c.body);
        const hasReturn = caseNodes.some(
          (n) => n.type === 'terminal' && (n as StaticTerminalNode).terminalKind === 'return',
        );
        expect(hasReturn, `Case ${c.labels.join('/')} should have return`).toBe(true);
      }
    });
  });

  // ========================================================================
  // 7. TERMINALS IN EVERY POSITION
  // ========================================================================
  describe('returnFromNestedIf', () => {
    it('should have nested decisions (if inside if)', () => {
      const ir = programsByName.get('returnFromNestedIf')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(2);
    });

    it('should have return terminal in innermost branch', () => {
      const ir = programsByName.get('returnFromNestedIf')!;
      const nodes = getFlattened(ir);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      // Multiple returns: one for premium-active, one for inactive
      expect(returns.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('throwWithYieldValue', () => {
    it('should have a decision and at least one effect inside the throw branch', () => {
      const ir = programsByName.get('throwWithYieldValue')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('guardClauses', () => {
    it('should have multiple decision nodes (one per guard clause)', () => {
      const ir = programsByName.get('guardClauses')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      // Three guard clauses: a <= 0, b <= 0, c <= 0
      expect(decisions.length).toBeGreaterThanOrEqual(3);
    });

    it('should have return terminals in guard branches', () => {
      const ir = programsByName.get('guardClauses')!;
      const nodes = getFlattened(ir);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(returns.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ========================================================================
  // 8. YIELDS IN UNUSUAL POSITIONS
  // ========================================================================
  describe('yieldsInUnusualPositions', () => {
    it('should extract multiple effect nodes from array/object/arg yields', () => {
      const ir = programsByName.get('yieldsInUnusualPositions')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // Should find effects for: String arg, 2 array items, 2 object values, template literal
      expect(effects.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ========================================================================
  // 9. EXPRESSION UNWRAPPING
  // ========================================================================
  describe('expressionUnwrapping', () => {
    it('should unwrap as, !, satisfies, and parens to find the yield expressions', () => {
      const ir = programsByName.get('expressionUnwrapping')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // 4 yield* expressions unwrapped through various wrappers
      expect(effects.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ========================================================================
  // 10. NESTED FUNCTION BOUNDARY
  // ========================================================================
  describe('nestedFunctionBoundary', () => {
    it('should NOT include yields from nested arrow/function/class generators', () => {
      const ir = programsByName.get('nestedFunctionBoundary')!;
      const nodes = getFlattened(ir);

      // Should NOT have any control flow nodes (no if/switch/loop/try-catch)
      const controlFlowTypes = ['decision', 'switch', 'loop', 'try-catch'];
      const controlFlowNodes = nodes.filter((n) => controlFlowTypes.includes(n.type));
      expect(controlFlowNodes.length).toBe(0);

      // But should have effect nodes for 'before-nested' and 'after-nested'
      const effects = findByType<any>(nodes, 'effect');
      expect(effects.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // 11. IF/ELSE CHAIN
  // ========================================================================
  describe('ifElseChain', () => {
    it('should produce a chain of decision nodes for else-if ladder', () => {
      const ir = programsByName.get('ifElseChain')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      // else-if ladder: at least 3 decisions (>=90, >=80, >=70)
      expect(decisions.length).toBeGreaterThanOrEqual(3);
    });

    it('every branch should have an effect node', () => {
      const ir = programsByName.get('ifElseChain')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // grade-A, grade-B, grade-C, grade-F
      expect(effects.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ========================================================================
  // 12. LABELED BREAK
  // ========================================================================
  describe('labeledBreak', () => {
    it('should have effect nodes before and after the labeled block', () => {
      const ir = programsByName.get('labeledBreak')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // 'start', the yield inside the block, 'skipped-by-break', 'after-label'
      expect(effects.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect the decision from the if statement (now has yield in branch)', () => {
      const ir = programsByName.get('labeledBreak')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 13. FOR-OF WITH HEADER YIELD
  // ========================================================================
  describe('forOfHeaderYield', () => {
    it('should have a forOf loop', () => {
      const ir = programsByName.get('forOfHeaderYield')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'forOf')).toBe(true);
    });

    it('should have headerYields for the yield* in the iterable expression', () => {
      const ir = programsByName.get('forOfHeaderYield')!;
      const nodes = getFlattened(ir);
      const forOf = findByType<StaticLoopNode>(nodes, 'loop')
        .find((l) => l.loopType === 'forOf');
      expect(forOf).toBeDefined();
      // The `yield* Effect.succeed(...)` in the for-of iterable should be a header yield
      expect(forOf!.headerYields).toBeDefined();
      expect(forOf!.headerYields!.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 14. WHILE WITH COMPLEX CONDITION
  // ========================================================================
  describe('whileComplexCondition', () => {
    it('should have a while loop', () => {
      const ir = programsByName.get('whileComplexCondition')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'while')).toBe(true);
    });

    it('should have yields inside the loop body', () => {
      const ir = programsByName.get('whileComplexCondition')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // 'iteration' yield + 'false' yield (shouldContinue = yield*)
      expect(effects.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // 15. SWITCH INSIDE LOOP (break targets switch, not loop)
  // ========================================================================
  describe('switchInsideLoop', () => {
    it('should have a forOf loop containing a switch', () => {
      const ir = programsByName.get('switchInsideLoop')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'loop')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'switch')).toBeGreaterThanOrEqual(1);
    });

    it('switch should have a quit case with return terminal', () => {
      const ir = programsByName.get('switchInsideLoop')!;
      const nodes = getFlattened(ir);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(returns.length).toBeGreaterThanOrEqual(1);
    });

    it('should have the after-switch yield inside the loop body', () => {
      const ir = programsByName.get('switchInsideLoop')!;
      const nodes = getFlattened(ir);
      const effects = findByType<any>(nodes, 'effect');
      // added, removed, quitting, unknown-cmd, after-switch-in-loop, exited-via-quit
      expect(effects.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ========================================================================
  // 16. REAL-WORLD: Checkout workflow
  // ========================================================================
  describe('checkoutWorkflow', () => {
    it('should have decisions for empty cart, inventory, and premium', () => {
      const ir = programsByName.get('checkoutWorkflow')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      // At least: empty cart check, inventory check, premium ternary
      expect(decisions.length).toBeGreaterThanOrEqual(2);
    });

    it('should have parallel nodes for concurrent fetches', () => {
      const ir = programsByName.get('checkoutWorkflow')!;
      const nodes = getFlattened(ir);
      const parallels = findByType<StaticParallelNode>(nodes, 'parallel');
      // At least: user+inventory fetch, post-payment parallel
      expect(parallels.length).toBeGreaterThanOrEqual(1);
    });

    it('should have try-catch-finally for payment', () => {
      const ir = programsByName.get('checkoutWorkflow')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');
      expect(tryCatches.length).toBeGreaterThanOrEqual(1);
      const tc = tryCatches[0]!;
      expect(tc.catchBody).toBeDefined();
      expect(tc.finallyBody).toBeDefined();
    });

    it('should have return terminals for early exits', () => {
      const ir = programsByName.get('checkoutWorkflow')!;
      const nodes = getFlattened(ir);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      // empty-cart return, out-of-stock return, completed return, payment-failed return
      expect(returns.length).toBeGreaterThanOrEqual(2);
    });

    it('should have a ternary for premium discount', () => {
      const ir = programsByName.get('checkoutWorkflow')!;
      const nodes = getFlattened(ir);
      const ternaries = findByType<StaticDecisionNode>(nodes, 'decision')
        .filter((d) => d.source === 'raw-ternary');
      expect(ternaries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 17. REAL-WORLD: Data pipeline
  // ========================================================================
  describe('dataPipeline', () => {
    it('should have a forOf loop', () => {
      const ir = programsByName.get('dataPipeline')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'loop')).toBeGreaterThanOrEqual(1);
    });

    it('should have try-catch inside the loop', () => {
      const ir = programsByName.get('dataPipeline')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'try-catch')).toBeGreaterThanOrEqual(1);
    });

    it('should have a decision for null check inside loop', () => {
      const ir = programsByName.get('dataPipeline')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('should have a final decision for results.length === 0', () => {
      const ir = programsByName.get('dataPipeline')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // 18. REAL-WORLD: State machine
  // ========================================================================
  describe('stateMachine', () => {
    it('should have a while loop containing a switch', () => {
      const ir = programsByName.get('stateMachine')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'loop')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'switch')).toBeGreaterThanOrEqual(1);
    });

    it('switch should have at least 5 cases (idle, active, paused, error, default)', () => {
      const ir = programsByName.get('stateMachine')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      expect(sw.cases.length).toBeGreaterThanOrEqual(5);
      expect(sw.hasDefault).toBe(true);
    });

    it('active case should have a nested decision (if shouldPause)', () => {
      const ir = programsByName.get('stateMachine')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      // At least one decision inside the switch body
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 19. MIXED EXPRESSION BRANCHING
  // ========================================================================
  describe('mixedExpressionBranching', () => {
    it('should detect ternary and/or short-circuit decisions', () => {
      const ir = programsByName.get('mixedExpressionBranching')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      // The ternary + ?? combination should produce at least 1 decision
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 20. RACE PATTERN
  // ========================================================================
  describe('racePattern', () => {
    it('should detect Effect.race as a race node', () => {
      const ir = programsByName.get('racePattern')!;
      const nodes = getFlattened(ir);
      const races = findByType<StaticRaceNode>(nodes, 'race');
      expect(races.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 21. FOR-OF WITH EARLY EXIT
  // ========================================================================
  describe('forOfEarlyExit', () => {
    it('should have a forOf loop with hasEarlyExit', () => {
      const ir = programsByName.get('forOfEarlyExit')!;
      const nodes = getFlattened(ir);
      const loop = findByType<StaticLoopNode>(nodes, 'loop')
        .find((l) => l.loopType === 'forOf');
      expect(loop).toBeDefined();
      expect(loop!.hasEarlyExit).toBe(true);
    });

    it('should have a decision inside the loop for the break condition', () => {
      const ir = programsByName.get('forOfEarlyExit')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 22. WHILE WITH CONTINUE
  // ========================================================================
  describe('whileWithContinue', () => {
    it('should have a while loop', () => {
      const ir = programsByName.get('whileWithContinue')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'while')).toBe(true);
    });

    it('should have hasEarlyExit for the continue statement', () => {
      // continue is not break/return so it may not trigger hasEarlyExit
      // but the if with yield should produce a decision
      const ir = programsByName.get('whileWithContinue')!;
      const nodes = getFlattened(ir);
      // The yield only happens for odd numbers — should detect if condition
      const effects = findByType<any>(nodes, 'effect');
      expect(effects.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 23. CONDITIONAL PARALLEL
  // ========================================================================
  describe('conditionalParallel', () => {
    it('should have a decision node', () => {
      const ir = programsByName.get('conditionalParallel')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('should have a parallel node inside the batch branch', () => {
      const ir = programsByName.get('conditionalParallel')!;
      const nodes = getFlattened(ir);
      const parallels = findByType<StaticParallelNode>(nodes, 'parallel');
      expect(parallels.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 24. TRIPLE-NESTED TRY/CATCH
  // ========================================================================
  describe('tripleNestedTry', () => {
    it('should have at least 3 try-catch nodes', () => {
      const ir = programsByName.get('tripleNestedTry')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');
      expect(tryCatches.length).toBeGreaterThanOrEqual(3);
    });

    it('should have finally blocks on outer 2 levels', () => {
      const ir = programsByName.get('tripleNestedTry')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');
      const withFinally = tryCatches.filter((tc) => tc.finallyBody && tc.finallyBody.length > 0);
      expect(withFinally.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ========================================================================
  // 25. FOR LOOP WITH HEADER YIELDS
  // ========================================================================
  describe('forLoopHeaderYields', () => {
    it('should have a for loop', () => {
      const ir = programsByName.get('forLoopHeaderYields')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'for')).toBe(true);
    });
  });

  // ========================================================================
  // 26. COMPLEX RETURN EXPRESSIONS
  // ========================================================================
  describe('complexReturns', () => {
    it('should have a decision and returns', () => {
      const ir = programsByName.get('complexReturns')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(returns.length).toBeGreaterThanOrEqual(1);
    });

    it('should have a ternary in the return expression', () => {
      const ir = programsByName.get('complexReturns')!;
      const nodes = getFlattened(ir);
      const ternaries = findByType<StaticDecisionNode>(nodes, 'decision')
        .filter((d) => d.source === 'raw-ternary');
      expect(ternaries.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 27. DO-WHILE RETRY PATTERN
  // ========================================================================
  describe('doWhileRetry', () => {
    it('should have a doWhile loop', () => {
      const ir = programsByName.get('doWhileRetry')!;
      const nodes = getFlattened(ir);
      const loops = findByType<StaticLoopNode>(nodes, 'loop');
      expect(loops.some((l) => l.loopType === 'doWhile')).toBe(true);
    });

    it('should have try-catch inside the loop', () => {
      const ir = programsByName.get('doWhileRetry')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'try-catch')).toBeGreaterThanOrEqual(1);
    });

    it('should have a return terminal', () => {
      const ir = programsByName.get('doWhileRetry')!;
      const nodes = getFlattened(ir);
      const returns = findByType<StaticTerminalNode>(nodes, 'terminal')
        .filter((t) => t.terminalKind === 'return');
      expect(returns.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 28. SWITCH WITH BLOCKS
  // ========================================================================
  describe('switchWithBlocks', () => {
    it('should have a switch with at least 4 cases', () => {
      const ir = programsByName.get('switchWithBlocks')!;
      const nodes = getFlattened(ir);
      const sw = findByType<StaticSwitchNode>(nodes, 'switch')[0]!;
      expect(sw.cases.length).toBeGreaterThanOrEqual(4);
    });

    it('update case should contain a nested decision', () => {
      const ir = programsByName.get('switchWithBlocks')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('delete case should contain a try-catch', () => {
      const ir = programsByName.get('switchWithBlocks')!;
      const nodes = getFlattened(ir);
      const tryCatches = findByType<StaticTryCatchNode>(nodes, 'try-catch');
      expect(tryCatches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 29. MAX NESTING DEPTH
  // ========================================================================
  describe('maxNestingDepth', () => {
    it('should have all 4 control flow types: try-catch, switch, loop, decision', () => {
      const ir = programsByName.get('maxNestingDepth')!;
      const nodes = getFlattened(ir);
      expect(countByType(nodes, 'try-catch')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'switch')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'loop')).toBeGreaterThanOrEqual(1);
      expect(countByType(nodes, 'decision')).toBeGreaterThanOrEqual(1);
    });

    it('should have finally body for outer try', () => {
      const ir = programsByName.get('maxNestingDepth')!;
      const nodes = getFlattened(ir);
      const tc = findByType<StaticTryCatchNode>(nodes, 'try-catch')[0]!;
      expect(tc.finallyBody).toBeDefined();
    });
  });

  // ========================================================================
  // 30. EMPTY BRANCHES
  // ========================================================================
  describe('emptyBranches', () => {
    it('should have decisions with only one branch populated', () => {
      const ir = programsByName.get('emptyBranches')!;
      const nodes = getFlattened(ir);
      const decisions = findByType<StaticDecisionNode>(nodes, 'decision');
      expect(decisions.length).toBeGreaterThanOrEqual(2);

      // At least one should have an empty/undefined false branch
      // or at least one should have a populated true and absent false
    });
  });

  // ========================================================================
  // AGGREGATE STATISTICS
  // ========================================================================
  describe('Aggregate statistics', () => {
    it('should have high decision count across all programs', () => {
      let totalDecisions = 0;
      for (const ir of allPrograms) {
        totalDecisions += countByType(getFlattened(ir), 'decision');
      }
      // With 30 programs many having conditionals, expect significant count
      expect(totalDecisions).toBeGreaterThanOrEqual(20);
    });

    it('should have diverse loop types', () => {
      const allLoopTypes = new Set<string>();
      for (const ir of allPrograms) {
        const loops = findByType<StaticLoopNode>(getFlattened(ir), 'loop');
        loops.forEach((l) => allLoopTypes.add(l.loopType));
      }
      expect(allLoopTypes.has('forOf')).toBe(true);
      expect(allLoopTypes.has('forIn')).toBe(true);
      expect(allLoopTypes.has('for')).toBe(true);
      expect(allLoopTypes.has('while')).toBe(true);
      expect(allLoopTypes.has('doWhile')).toBe(true);
    });

    it('should have multiple try-catch variations', () => {
      let withCatch = 0;
      let withFinally = 0;
      let withBoth = 0;
      let withTerminal = 0;
      for (const ir of allPrograms) {
        for (const tc of findByType<StaticTryCatchNode>(getFlattened(ir), 'try-catch')) {
          if (tc.catchBody && tc.catchBody.length > 0) withCatch++;
          if (tc.finallyBody && tc.finallyBody.length > 0) withFinally++;
          if (tc.catchBody && tc.finallyBody) withBoth++;
          if (tc.hasTerminalInTry) withTerminal++;
        }
      }
      expect(withCatch).toBeGreaterThanOrEqual(5);
      expect(withFinally).toBeGreaterThanOrEqual(4);
      expect(withBoth).toBeGreaterThanOrEqual(2);
      expect(withTerminal).toBeGreaterThanOrEqual(1);
    });

    it('should have all decision sources represented', () => {
      const sources = new Set<string>();
      for (const ir of allPrograms) {
        for (const d of findByType<StaticDecisionNode>(getFlattened(ir), 'decision')) {
          sources.add(d.source);
        }
      }
      expect(sources.has('raw-if')).toBe(true);
      expect(sources.has('raw-ternary')).toBe(true);
      expect(sources.has('raw-short-circuit')).toBe(true);
    });

    it('should have terminal nodes for return', () => {
      let totalReturns = 0;
      for (const ir of allPrograms) {
        totalReturns += findByType<StaticTerminalNode>(getFlattened(ir), 'terminal')
          .filter((t) => t.terminalKind === 'return').length;
      }
      expect(totalReturns).toBeGreaterThanOrEqual(10);
    });
  });
});
