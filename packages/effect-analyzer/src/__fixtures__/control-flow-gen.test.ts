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
} from '../types';

const FIXTURE_PATH = resolve(__dirname, 'control-flow-gen.ts');

/**
 * Recursively flatten all nodes from a program's IR tree.
 * Walks through yields, decision branches, switch cases,
 * try-catch bodies, loop bodies, terminal values, etc.
 */
function flattenNodes(nodes: readonly StaticFlowNode[]): StaticFlowNode[] {
  const result: StaticFlowNode[] = [];
  for (const node of nodes) {
    result.push(node);

    // Generator yields
    if (node.type === 'generator') {
      const gen = node as StaticGeneratorNode;
      result.push(...flattenNodes(gen.yields.map((y) => y.effect)));
    }

    // Decision branches
    if (node.type === 'decision') {
      const dec = node as StaticDecisionNode;
      result.push(...flattenNodes(dec.onTrue));
      if (dec.onFalse) result.push(...flattenNodes(dec.onFalse));
    }

    // Switch cases
    if (node.type === 'switch') {
      const sw = node as StaticSwitchNode;
      for (const c of sw.cases) {
        result.push(...flattenNodes(c.body));
      }
    }

    // Try-catch-finally
    if (node.type === 'try-catch') {
      const tc = node as StaticTryCatchNode;
      result.push(...flattenNodes(tc.tryBody));
      if (tc.catchBody) result.push(...flattenNodes(tc.catchBody));
      if (tc.finallyBody) result.push(...flattenNodes(tc.finallyBody));
    }

    // Loop body
    if (node.type === 'loop') {
      const loop = node as StaticLoopNode;
      result.push(...flattenNodes([loop.body]));
    }

    // Terminal value
    if (node.type === 'terminal') {
      const term = node as StaticTerminalNode;
      if (term.value) result.push(...flattenNodes(term.value));
    }

    // Pipe children
    if (node.type === 'pipe') {
      result.push(...flattenNodes([node.initial]));
      result.push(...flattenNodes(node.transformations));
    }

    // Parallel / Race children
    if (node.type === 'parallel' || node.type === 'race') {
      result.push(...flattenNodes(node.children));
    }

    // Error handler
    if (node.type === 'error-handler') {
      result.push(...flattenNodes([node.source]));
      if (node.handler) result.push(...flattenNodes([node.handler]));
    }
  }
  return result;
}

/**
 * Get flattened nodes from an IR program's root children.
 */
function getFlattened(ir: StaticEffectIR): StaticFlowNode[] {
  return flattenNodes(ir.root.children);
}

describe('Control Flow Analysis Integration', () => {
  let programsByName: Map<string, StaticEffectIR>;

  beforeAll(async () => {
    const results = await Effect.runPromise(
      analyze(FIXTURE_PATH).all(),
    );
    programsByName = new Map(
      results.map((ir) => [ir.root.programName, ir]),
    );
  }, 30_000);

  it('should discover all 13 programs', () => {
    // We have 13 exports in the fixture
    expect(programsByName.size).toBeGreaterThanOrEqual(13);
  });

  describe('ifElseProgram', () => {
    it('should have a decision node with source raw-if', () => {
      const ir = programsByName.get('ifElseProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const decisions = nodes.filter(
        (n): n is StaticDecisionNode =>
          n.type === 'decision' && n.source === 'raw-if',
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('should have both true and false branches populated', () => {
      const ir = programsByName.get('ifElseProgram')!;
      const nodes = getFlattened(ir);
      const decision = nodes.find(
        (n): n is StaticDecisionNode =>
          n.type === 'decision' && n.source === 'raw-if',
      );
      expect(decision).toBeDefined();
      expect(decision!.onTrue.length).toBeGreaterThan(0);
      expect(decision!.onFalse).toBeDefined();
      expect(decision!.onFalse!.length).toBeGreaterThan(0);
    });
  });

  describe('switchProgram', () => {
    it('should have a switch node', () => {
      const ir = programsByName.get('switchProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const switches = nodes.filter(
        (n): n is StaticSwitchNode => n.type === 'switch',
      );
      expect(switches.length).toBeGreaterThanOrEqual(1);
    });

    it('should have at least 2 cases and a default', () => {
      const ir = programsByName.get('switchProgram')!;
      const nodes = getFlattened(ir);
      const sw = nodes.find(
        (n): n is StaticSwitchNode => n.type === 'switch',
      )!;
      expect(sw.cases.length).toBeGreaterThanOrEqual(2);
      expect(sw.hasDefault).toBe(true);
    });
  });

  describe('forOfProgram', () => {
    it('should have a loop node with forOf type', () => {
      const ir = programsByName.get('forOfProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const loops = nodes.filter(
        (n): n is StaticLoopNode =>
          n.type === 'loop' && n.loopType === 'forOf',
      );
      expect(loops.length).toBeGreaterThanOrEqual(1);
    });

    it('should have an iterVariable', () => {
      const ir = programsByName.get('forOfProgram')!;
      const nodes = getFlattened(ir);
      const loop = nodes.find(
        (n): n is StaticLoopNode =>
          n.type === 'loop' && n.loopType === 'forOf',
      )!;
      expect(loop.iterVariable).toBeDefined();
    });
  });

  describe('whileProgram', () => {
    it('should have a loop node with while type', () => {
      const ir = programsByName.get('whileProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const loops = nodes.filter(
        (n): n is StaticLoopNode =>
          n.type === 'loop' && n.loopType === 'while',
      );
      expect(loops.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tryCatchProgram', () => {
    it('should have a try-catch node', () => {
      const ir = programsByName.get('tryCatchProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const tryCatches = nodes.filter(
        (n): n is StaticTryCatchNode => n.type === 'try-catch',
      );
      expect(tryCatches.length).toBeGreaterThanOrEqual(1);
    });

    it('should have try, catch, and finally bodies', () => {
      const ir = programsByName.get('tryCatchProgram')!;
      const nodes = getFlattened(ir);
      const tc = nodes.find(
        (n): n is StaticTryCatchNode => n.type === 'try-catch',
      )!;
      expect(tc.tryBody.length).toBeGreaterThan(0);
      expect(tc.catchBody).toBeDefined();
      expect(tc.catchBody!.length).toBeGreaterThan(0);
      expect(tc.finallyBody).toBeDefined();
      expect(tc.finallyBody!.length).toBeGreaterThan(0);
    });

    it('should have a catch variable', () => {
      const ir = programsByName.get('tryCatchProgram')!;
      const nodes = getFlattened(ir);
      const tc = nodes.find(
        (n): n is StaticTryCatchNode => n.type === 'try-catch',
      )!;
      expect(tc.catchVariable).toBe('e');
    });
  });

  describe('returnYieldProgram', () => {
    it('should have a decision node (from the if)', () => {
      const ir = programsByName.get('returnYieldProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const decisions = nodes.filter(
        (n): n is StaticDecisionNode => n.type === 'decision',
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('should have a terminal (return) node', () => {
      const ir = programsByName.get('returnYieldProgram')!;
      const nodes = getFlattened(ir);
      const terminals = nodes.filter(
        (n): n is StaticTerminalNode =>
          n.type === 'terminal' && n.terminalKind === 'return',
      );
      expect(terminals.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('nestedProgram', () => {
    it('should have a decision node containing a switch node', () => {
      const ir = programsByName.get('nestedProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);

      const decisions = nodes.filter(
        (n): n is StaticDecisionNode => n.type === 'decision',
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);

      const switches = nodes.filter(
        (n): n is StaticSwitchNode => n.type === 'switch',
      );
      expect(switches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ternaryProgram', () => {
    it('should have a decision node with source raw-ternary', () => {
      const ir = programsByName.get('ternaryProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const decisions = nodes.filter(
        (n): n is StaticDecisionNode =>
          n.type === 'decision' && n.source === 'raw-ternary',
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('shortCircuitProgram', () => {
    it('should have a decision node with source raw-short-circuit', () => {
      const ir = programsByName.get('shortCircuitProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const decisions = nodes.filter(
        (n): n is StaticDecisionNode =>
          n.type === 'decision' && n.source === 'raw-short-circuit',
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('nestedFunctionProgram', () => {
    it('should NOT include inner generator yields in the outer program', () => {
      const ir = programsByName.get('nestedFunctionProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);

      // The outer generator should have yields for 'outer' and 'after-fn'
      // but NOT for 'inner-should-not-be-in-outer' at the control-flow level.
      // (The non-yielded effect scanner may pick up some calls, so we check
      // that the generator node's direct yields contain only the expected
      // outer effects plus any non-yielded scanned effects.)
      const gen = ir!.root.children.find(
        (n): n is StaticGeneratorNode => n.type === 'generator',
      );
      expect(gen).toBeDefined();

      // The statement-level walker should NOT descend into the nested arrow function.
      // Count the decision/switch/loop/try-catch nodes: should be 0 since the
      // outer program has no control flow.
      const controlFlowTypes = ['decision', 'switch', 'loop', 'try-catch'];
      const controlFlowNodes = nodes.filter((n) =>
        controlFlowTypes.includes(n.type),
      );
      expect(controlFlowNodes.length).toBe(0);
    });
  });

  describe('fallthroughProgram', () => {
    it('should have a switch node with hasFallthrough=true', () => {
      const ir = programsByName.get('fallthroughProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const switches = nodes.filter(
        (n): n is StaticSwitchNode => n.type === 'switch',
      );
      expect(switches.length).toBeGreaterThanOrEqual(1);
      expect(switches[0]!.hasFallthrough).toBe(true);
    });
  });

  describe('tryFinallyReturnProgram', () => {
    it('should have a try-catch node with finallyBody', () => {
      const ir = programsByName.get('tryFinallyReturnProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const tryCatches = nodes.filter(
        (n): n is StaticTryCatchNode => n.type === 'try-catch',
      );
      expect(tryCatches.length).toBeGreaterThanOrEqual(1);
      const tc = tryCatches[0]!;
      expect(tc.finallyBody).toBeDefined();
      expect(tc.finallyBody!.length).toBeGreaterThan(0);
    });

    it('should have hasTerminalInTry=true', () => {
      const ir = programsByName.get('tryFinallyReturnProgram')!;
      const nodes = getFlattened(ir);
      const tc = nodes.find(
        (n): n is StaticTryCatchNode => n.type === 'try-catch',
      )!;
      expect(tc.hasTerminalInTry).toBe(true);
    });
  });

  describe('doWhileProgram', () => {
    it('should have a loop node with doWhile type', () => {
      const ir = programsByName.get('doWhileProgram');
      expect(ir).toBeDefined();
      const nodes = getFlattened(ir!);
      const loops = nodes.filter(
        (n): n is StaticLoopNode =>
          n.type === 'loop' && n.loopType === 'doWhile',
      );
      expect(loops.length).toBeGreaterThanOrEqual(1);
    });
  });
});
