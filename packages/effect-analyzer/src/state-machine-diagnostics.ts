/**
 * State machine diagnostics.
 *
 * Explains why a declaration that looks like a state machine was not
 * recognized. The CLI uses this so a failed `--format statechart-*` run teaches
 * the convention instead of printing "no machines found".
 *
 * This scanner is intentionally independent of the extraction code: it
 * re-derives near-miss candidates with its own light AST checks so it stays
 * stable while the extractor evolves.
 */

import { Node, Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';
import { analyzeStateMachines, type StateMachine } from './state-machine';

export interface StateMachineRejection {
  readonly name: string;
  readonly kind: 'transition-table' | 'match';
  readonly reason: string;
  readonly hint: string;
  readonly location: SourceLocation | undefined;
}

export interface StateMachineDiagnostics {
  readonly machines: readonly StateMachine[];
  readonly rejected: readonly StateMachineRejection[];
}

function unwrap(node: Node): Node {
  let cur = node;
  for (;;) {
    const k = cur.getKind();
    if (
      k === SyntaxKind.AsExpression ||
      k === SyntaxKind.SatisfiesExpression ||
      k === SyntaxKind.ParenthesizedExpression ||
      k === SyntaxKind.TypeAssertionExpression
    ) {
      cur = (cur as unknown as { getExpression(): Node }).getExpression();
      continue;
    }
    return cur;
  }
}

function stringVal(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  return Node.isStringLiteral(u) ? u.getLiteralValue() : undefined;
}

function propName(prop: Node): string | undefined {
  if (!Node.isPropertyAssignment(prop)) return undefined;
  const n = prop.getNameNode();
  if (Node.isStringLiteral(n)) return n.getLiteralValue();
  if (Node.isIdentifier(n)) return n.getText();
  return undefined;
}

/** Resolve a table leaf to its target state: string, `{ target }`, or array. */
function leafTarget(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  if (Node.isStringLiteral(u)) return u.getLiteralValue();
  if (Node.isObjectLiteralExpression(u)) {
    const t = u.getProperty('target');
    return t ? stringVal((t as { getInitializer?(): Node | undefined }).getInitializer?.()) : undefined;
  }
  if (Node.isArrayLiteralExpression(u)) {
    return leafTarget(u.getElements()[0]);
  }
  return undefined;
}

function returnsLiteralState(handler: Node): boolean {
  if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) {
    return false;
  }
  const isLiteral = (n: Node | undefined): boolean => {
    if (!n) return false;
    const u = unwrap(n);
    if (Node.isStringLiteral(u)) return true;
    return Node.isObjectLiteralExpression(u) && u.getProperty('_tag') !== undefined;
  };
  const body = handler.getBody();
  if (!Node.isBlock(body)) return isLiteral(body);
  return body
    .getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .some((r) => isLiteral(r.getExpression()));
}

function ownerOf(node: Node): { name: string; nameNode: Node } | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isVariableDeclaration(cur)) {
      return { name: cur.getName(), nameNode: cur.getNameNode() };
    }
    if (Node.isFunctionDeclaration(cur)) {
      const name = cur.getName();
      if (name) return { name, nameNode: cur.getNameNodeOrThrow() };
    }
    cur = cur.getParent();
  }
  return undefined;
}

function locOf(node: Node, filePath: string): SourceLocation {
  const sf = node.getSourceFile();
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line, column, offset };
}

function isMatchCall(call: Node, method: string): boolean {
  if (!Node.isCallExpression(call)) return false;
  const expr = call.getExpression();
  return (
    Node.isPropertyAccessExpression(expr) &&
    expr.getName() === method &&
    expr.getExpression().getText() === 'Match'
  );
}

export function diagnoseStateMachines(
  filePath: string,
  source?: string,
): StateMachineDiagnostics {
  const project = new Project({ useInMemoryFileSystem: !!source });
  const sf = source
    ? project.createSourceFile(filePath, source, { overwrite: true })
    : project.addSourceFileAtPath(filePath);

  const { machines } = analyzeStateMachines(filePath, source);
  const matched = new Set(machines.map((m) => m.name));
  const rejected: StateMachineRejection[] = [];
  const reported = new Set<string>();

  const add = (
    name: string,
    kind: StateMachineRejection['kind'],
    reason: string,
    hint: string,
    anchor: Node,
  ): void => {
    if (matched.has(name) || reported.has(name)) return;
    reported.add(name);
    rejected.push({ name, kind, reason, hint, location: locOf(anchor, filePath) });
  };

  // A) Object literals that look like a transition table.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getName();
    if (matched.has(name)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const hasSatisfies = init.getKind() === SyntaxKind.SatisfiesExpression;
    const intentional =
      hasSatisfies || /transition|machine|states?|fsm|workflow/i.test(name);
    if (!intentional) continue;
    const obj = unwrap(init);
    if (!Node.isObjectLiteralExpression(obj)) continue;
    const props = obj.getProperties().filter((p) => Node.isPropertyAssignment(p));
    if (props.length === 0) continue;

    const keys = new Set(
      props.map(propName).filter((k): k is string => k !== undefined),
    );
    let hasObjectValue = false;
    let hasLeaf = false;
    let targetsAnotherState = false;
    for (const p of props) {
      if (!Node.isPropertyAssignment(p)) continue;
      const value = unwrap(p.getInitializer() ?? p);
      if (!Node.isObjectLiteralExpression(value)) continue;
      hasObjectValue = true;
      for (const ev of value.getProperties()) {
        if (!Node.isPropertyAssignment(ev)) continue;
        const target = leafTarget(ev.getInitializer());
        if (target !== undefined) {
          hasLeaf = true;
          if (keys.has(target)) targetsAnotherState = true;
        }
      }
    }

    if (!hasObjectValue) {
      add(
        name,
        'transition-table',
        'values are not nested event→state objects',
        'shape it as `{ State: { Event: NextState } }`',
        decl.getNameNode(),
      );
    } else if (!hasLeaf) {
      add(
        name,
        'transition-table',
        'no event maps to a state',
        'a leaf must be a state string or `{ target: State }`',
        decl.getNameNode(),
      );
    } else if (!targetsAnotherState) {
      add(
        name,
        'transition-table',
        'no event targets another state, so it reads as config, not a machine',
        'at least one event should lead to a different state',
        decl.getNameNode(),
      );
    }
  }

  // B) Match.when arms whose owner produced no machine.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isMatchCall(call, 'when')) continue;
    const owner = ownerOf(call);
    if (!owner || matched.has(owner.name) || reported.has(owner.name)) continue;
    const [pattern, handler] = call.getArguments();
    const tuple = pattern ? unwrap(pattern) : undefined;
    if (
      !tuple ||
      !Node.isArrayLiteralExpression(tuple) ||
      tuple.getElements().length !== 2
    ) {
      add(
        owner.name,
        'match',
        'a Match.when pattern is not a 2-tuple [state, event]',
        "use Match.when(['State', 'Event'], () => nextState)",
        owner.nameNode,
      );
    } else if (!handler || !returnsLiteralState(handler)) {
      add(
        owner.name,
        'match',
        'a Match.when handler does not return a literal next state',
        "return { _tag: 'Next' } or a state string",
        owner.nameNode,
      );
    }
  }

  // C) Single-level Match.tags (variant dispatch mistaken for a machine).
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isMatchCall(call, 'tags')) continue;
    const owner = ownerOf(call);
    if (!owner || matched.has(owner.name) || reported.has(owner.name)) continue;
    const [arg] = call.getArguments();
    const obj = arg ? unwrap(arg) : undefined;
    const nested =
      obj !== undefined &&
      Node.isObjectLiteralExpression(obj) &&
      obj.getProperties().some((p) => p.getText().includes('Match.'));
    if (!nested) {
      add(
        owner.name,
        'match',
        'single-level Match.tags reads as variant dispatch, not transitions',
        'nest Match.value(event).pipe(Match.tags({...})) inside each state',
        owner.nameNode,
      );
    }
  }

  return { machines, rejected };
}
