/**
 * State machine analysis.
 *
 * Recognizes machines written with `@typeonce/effect-machine` — the
 * schema-first Machine API from Effect PR #6429 — and extracts the state tree
 * plus (fromState, event, toState) transition triples so they can be rendered
 * as an XState statechart.
 *
 * Shape detected:
 *   Machine.make({ states, events, initial }).handle({ ... })
 *
 * The state tree comes from `Machine.defineStates({...})` (or an inline
 * `states:` literal): a leaf is a tagged schema, a node is
 * `{ schema, type?, initial?, states }`. Nesting becomes dotted paths
 * ('workspace.document.Clean'), `type: 'parallel'` carries through, and a
 * compound `initial` becomes an `initial`-triggered edge. Final states can be
 * declared in either the state tree or the handler tree.
 *
 * Transitions come from the `.handle({...})` tree: `on` (events), `always`
 * (eventless), and `onDone` (compound completion). Targets are read from the
 * `target.full` / `target.local` / `target.branch` builders, including
 * `target.local.with(value, child => ...)` and nested region builders.
 */

import { statSync } from 'node:fs';
import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type ObjectLiteralExpression,
} from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface StateTransition {
  readonly from: string;
  readonly event: string;
  readonly to: string;
  /** Guard condition text when the transition is conditional (best-effort). */
  readonly guard?: string;
  /**
   * Named action labels attached to the transition. Labels only: the analyzer
   * renders and exports them but never runs anything.
   */
  readonly actions?: readonly string[];
  /**
   * Present when the transition fires automatically rather than on a user
   * event: `initial`, `always` (eventless), `after` (delayed), or
   * `done`/`error` (invoke completion). Automatic transitions are
   * reachability edges but are excluded from event-coverage accounting.
   * Absent for ordinary event transitions.
   */
  readonly trigger?: 'initial' | 'always' | 'after' | 'done' | 'error';
  /** Zero-based index of the invoke that owns a done/error transition. */
  readonly invokeIndex?: number;
}

export interface StateInvoke {
  readonly src: string;
  readonly id?: string;
}

export interface StateMachine {
  readonly name: string;
  readonly source: 'effect-machine' | 'machine-json';
  readonly initial: string | undefined;
  /** Every state path in the machine, parents included. */
  readonly states: readonly string[];
  readonly transitions: readonly StateTransition[];
  readonly location: SourceLocation | undefined;
  /**
   * The declared alphabet — the full set of states/events the machine declares.
   * `undefined` when it could not be resolved (e.g. an imported state tree).
   * Used to check the machine for completeness.
   */
  readonly declaredStates: readonly string[] | undefined;
  readonly declaredEvents: readonly string[] | undefined;
  readonly alphabetSource: 'schema' | 'tagged-union' | 'config' | undefined;
  /**
   * States the source explicitly marks final (`type: 'final'`). `undefined`
   * means the source has no final marker, and renderers fall back to
   * no-outgoing-transition inference.
   */
  readonly finalStates?: readonly string[];
  /** States marked `type: 'parallel'`: every child region is entered. */
  readonly parallelStates?: readonly string[];
  /** Entry action labels per state. Labels only — never executed. */
  readonly entryActions?: Readonly<Record<string, readonly string[]>>;
  /** Exit action labels per state. Labels only — never executed. */
  readonly exitActions?: Readonly<Record<string, readonly string[]>>;
  /** Invoked-child metadata per state (`invoke:` in the handler tree). */
  readonly invokes?: Readonly<Record<string, readonly StateInvoke[]>>;
}

/** Explicit finals when the source declares them; else no-outgoing inference. */
export function finalStatesOf(machine: StateMachine): ReadonlySet<string> {
  if (machine.finalStates !== undefined) return new Set(machine.finalStates);
  const hasOutgoing = new Set(machine.transitions.map((t) => t.from));
  return new Set(machine.states.filter((s) => !hasOutgoing.has(s)));
}

export interface StateMachineAnalysis {
  readonly machines: readonly StateMachine[];
}

// =============================================================================
// AST helpers
// =============================================================================

type SourceFile = ReturnType<Project['createSourceFile']>;

/** Strip `as const`, `satisfies`, parentheses and `<T>` assertions. */
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

/** Read a string-literal value (after unwrapping `as const`), or undefined. */
function stringValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  if (Node.isStringLiteral(u)) return u.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralText();
  return undefined;
}

interface PropEntry {
  readonly name: string;
  /** `undefined` for a shorthand property (`{ Idle }`). */
  readonly value: Node | undefined;
}

/** Named properties of an object literal, shorthand included. */
function propEntries(obj: ObjectLiteralExpression): PropEntry[] {
  const out: PropEntry[] = [];
  for (const prop of obj.getProperties()) {
    if (Node.isShorthandPropertyAssignment(prop)) {
      out.push({ name: prop.getName(), value: undefined });
      continue;
    }
    if (!Node.isPropertyAssignment(prop)) continue;
    const nameNode = prop.getNameNode();
    const name = Node.isStringLiteral(nameNode)
      ? nameNode.getLiteralValue()
      : Node.isIdentifier(nameNode)
        ? nameNode.getText()
        : undefined;
    if (name !== undefined) out.push({ name, value: prop.getInitializer() });
  }
  return out;
}

function propValue(obj: ObjectLiteralExpression, name: string): Node | undefined {
  return obj.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
}

function locOf(node: Node, filePath: string): SourceLocation {
  const sf = node.getSourceFile();
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line, column, offset };
}

const join = (parent: string, child: string): string =>
  parent === '' ? child : `${parent}.${child}`;

function isFunctionLike(node: Node): node is ArrowFunction | FunctionExpression {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function isEffectMachineBinding(name: string, sf: SourceFile): boolean {
  return sf.getImportDeclarations().some((declaration) => {
    if (declaration.getModuleSpecifierValue() !== '@typeonce/effect-machine') {
      return false;
    }
    return declaration.getNamedImports().some((namedImport) => {
      if (namedImport.getName() !== 'Machine') return false;
      return (namedImport.getAliasNode()?.getText() ?? 'Machine') === name;
    });
  });
}

function isEffectMachineNamespace(name: string, sf: SourceFile): boolean {
  return sf.getImportDeclarations().some(
    (declaration) =>
      declaration.getModuleSpecifierValue() === '@typeonce/effect-machine' &&
      declaration.getNamespaceImport()?.getText() === name,
  );
}

/** A call to a method on the imported `Machine` namespace. */
function isMachineCall(node: Node, name: string): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== name) {
    return false;
  }
  const owner = expr.getExpression();
  if (Node.isIdentifier(owner)) {
    return isEffectMachineBinding(owner.getText(), node.getSourceFile());
  }
  return (
    Node.isPropertyAccessExpression(owner) &&
    owner.getName() === 'Machine' &&
    Node.isIdentifier(owner.getExpression()) &&
    isEffectMachineNamespace(owner.getExpression().getText(), node.getSourceFile())
  );
}

/**
 * The object literal behind a value, following a local `const` binding.
 * `undefined` when the value is imported or computed.
 */
function objectLiteral(
  node: Node | undefined,
  sf: SourceFile,
  depth = 0,
): ObjectLiteralExpression | undefined {
  if (!node || depth > 8) return undefined;
  const u = unwrap(node);
  if (Node.isObjectLiteralExpression(u)) return u;
  if (Node.isIdentifier(u)) {
    return objectLiteral(sf.getVariableDeclaration(u.getText())?.getInitializer(), sf, depth + 1);
  }
  return undefined;
}

/**
 * The object literal behind a `states:` value: an inline tree, a
 * `Machine.defineStates({...})` call, or the `.states` of one. `undefined` when
 * the tree is declared in another file.
 */
function stateTree(
  node: Node | undefined,
  sf: SourceFile,
  depth = 0,
): ObjectLiteralExpression | undefined {
  if (!node || depth > 8) return undefined;
  const u = unwrap(node);
  if (isMachineCall(u, 'defineStates')) {
    return objectLiteral(u.getArguments()[0], sf);
  }
  if (Node.isPropertyAccessExpression(u) && u.getName() === 'states') {
    return stateTree(u.getExpression(), sf, depth + 1);
  }
  if (Node.isIdentifier(u)) {
    return stateTree(sf.getVariableDeclaration(u.getText())?.getInitializer(), sf, depth + 1);
  }
  return objectLiteral(u, sf);
}

/**
 * The tag of a `Schema.TaggedClass<X>()('Tag', ...)`-style class declared in
 * this file, read syntactically from its extends clause. `undefined` when the
 * class is absent, imported, or not a Schema tagged class.
 */
function classTag(name: string, sf: SourceFile): string | undefined {
  const extendsText = sf.getClass(name)?.getExtends()?.getText() ?? '';
  return /Tagged(?:Class|Request|Error)[\s\S]*?\)\s*\(\s*["'`]([^"'`]+)["'`]/.exec(
    extendsText,
  )?.[1];
}

// =============================================================================
// State tree
// =============================================================================

type NodeKind = 'atomic' | 'compound' | 'parallel' | 'final';

interface TreeNode {
  readonly path: string;
  readonly kind: NodeKind;
  /** Declared initial child key of a compound node. */
  readonly initial: string | undefined;
  readonly parent: string | undefined;
  /** Full paths of the direct children, in declaration order. */
  readonly children: string[];
}

/**
 * Flatten a state tree literal into dotted paths, keeping the parent/child
 * links so nothing downstream has to re-derive them from the path strings.
 * A property whose value is an identifier (a tagged schema) is atomic; an
 * object with a `schema` property is a node config carrying
 * `type` / `initial` / `states`.
 */
function readStateTree(
  obj: ObjectLiteralExpression,
  parent: TreeNode | undefined,
  out: Map<string, TreeNode>,
  sf: SourceFile,
): void {
  for (const { name: key, value } of propEntries(obj)) {
    const inner = value ? unwrap(value) : undefined;
    const config =
      inner && Node.isObjectLiteralExpression(inner) && inner.getProperty('schema')
        ? inner
        : undefined;
    const type = config ? stringValue(propValue(config, 'type')) : undefined;
    const children = config ? stateTree(propValue(config, 'states'), sf) : undefined;
    const node: TreeNode = {
      path: join(parent?.path ?? '', key),
      kind:
        type === 'parallel'
          ? 'parallel'
          : type === 'final'
            ? 'final'
            : children
              ? 'compound'
              : 'atomic',
      initial: config ? stringValue(propValue(config, 'initial')) : undefined,
      parent: parent?.path,
      children: [],
    };
    out.set(node.path, node);
    parent?.children.push(node.path);
    if (children) readStateTree(children, node, out, sf);
  }
}

/** Nearest self-or-ancestor compound node — the scope of `target.local`. */
function localScope(path: string, tree: ReadonlyMap<string, TreeNode>): string {
  let node = tree.get(path);
  while (node) {
    if (node.kind === 'compound') return node.path;
    node = node.parent === undefined ? undefined : tree.get(node.parent);
  }
  return '';
}

// =============================================================================
// Target builders
// =============================================================================

/**
 * Walk a nested region builder: `parent(value, child => child.Leaf(...))`
 * appends `.Leaf`. Stops when the callback chains more than one region
 * (a parallel entry) — the parent path is then the sound target.
 */
function descendBuilder(call: CallExpression, path: string, depth = 0): string {
  if (depth > 8) return path;
  const arrows = call.getArguments().map(unwrap).filter(isFunctionLike);
  const arrow = arrows[0];
  if (arrows.length !== 1 || !arrow) return path;
  const param = arrow.getParameters()[0]?.getName();
  const body = unwrap(arrow.getBody());
  if (param === undefined || !Node.isCallExpression(body)) return path;
  const expr = body.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return path;
  const base = expr.getExpression();
  // A chained base (`region.a(...).b(...)`) enters several regions at once.
  if (!Node.isIdentifier(base) || base.getText() !== param) return path;
  return descendBuilder(body, join(path, expr.getName()), depth + 1);
}

/**
 * Resolve one `target.<mode>.<state>(...)` call to a full state path.
 * `full` and `branch` are absolute; `local` is relative to the nearest
 * compound ancestor, and `local.with(...)` re-enters that scope itself.
 */
function targetPath(
  call: CallExpression,
  from: string,
  tree: ReadonlyMap<string, TreeNode>,
): string | undefined {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  const mode = expr.getExpression();
  if (!Node.isPropertyAccessExpression(mode)) return undefined;
  const modeName = mode.getName();
  if (modeName !== 'full' && modeName !== 'local' && modeName !== 'branch') {
    return undefined;
  }
  if (!/(^|\.)target$/.test(mode.getExpression().getText())) return undefined;

  const segment = expr.getName();
  const base = modeName === 'local' ? localScope(from, tree) : '';
  const start =
    modeName === 'local' && segment === 'with' ? base : join(base, segment);
  return descendBuilder(call, start);
}

/**
 * The branch condition guarding a target, as source text. A handler picks its
 * target with an ordinary `if` or ternary, so the nearest enclosing condition
 * is the guard label — negated when the target sits in the else branch.
 */
function guardOf(call: Node, handler: Node): string | undefined {
  let child = call;
  let cur: Node | undefined = call.getParent();
  while (cur && cur !== handler) {
    if (Node.isConditionalExpression(cur)) {
      const cond = cur.getCondition().getText();
      return cur.getWhenTrue() === child ? cond : `!(${cond})`;
    }
    if (Node.isIfStatement(cur)) {
      const cond = cur.getExpression().getText();
      const then = cur.getThenStatement();
      const inThen =
        call.getStart() >= then.getStart() && call.getEnd() <= then.getEnd();
      return inThen ? cond : `!(${cond})`;
    }
    child = cur;
    cur = cur.getParent();
  }
  return undefined;
}

interface HandlerTarget {
  readonly to: string;
  readonly guard?: string;
}

/** Every distinct state path a handler body can transition to. */
function targetsOf(
  handler: Node,
  from: string,
  tree: ReadonlyMap<string, TreeNode>,
): HandlerTarget[] {
  const out: HandlerTarget[] = [];
  const seen = new Set<string>();
  const calls = [
    ...(Node.isCallExpression(handler) ? [handler] : []),
    ...handler.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  for (const call of calls) {
    const to = targetPath(call, from, tree);
    if (to === undefined) continue;
    const guard = guardOf(call, handler);
    const key = `${to}|${guard ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(guard === undefined ? { to } : { to, guard });
  }
  return out;
}

// =============================================================================
// Handler tree
// =============================================================================

/**
 * The id an invoked child was registered under: `Machine.child('selection', M)`
 * declares `'selection'`. Falls back to the reference's own text.
 */
function childId(node: Node | undefined, sf: SourceFile): string | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  if (!Node.isIdentifier(u)) return u.getText();
  const decl = sf.getVariableDeclaration(u.getText())?.getInitializer();
  const call = decl ? unwrap(decl) : undefined;
  return (
    (call && isMachineCall(call, 'child')
      ? stringValue(call.getArguments()[0])
      : undefined) ?? u.getText()
  );
}

/** Label invoked children by their `id`, `child`, or called function. */
function invokesOf(node: Node | undefined, sf: SourceFile, depth = 0): StateInvoke[] {
  if (!node || depth > 8) return [];
  const u = unwrap(node);
  if (isFunctionLike(u)) return invokesOf(u.getBody(), sf, depth + 1);
  if (Node.isArrayLiteralExpression(u)) {
    return u.getElements().flatMap((element) => invokesOf(element, sf, depth + 1));
  }
  if (Node.isIdentifier(u)) {
    return invokesOf(
      sf.getVariableDeclaration(u.getText())?.getInitializer(),
      sf,
      depth + 1,
    );
  }
  if (!Node.isCallExpression(u)) return [];
  const callee = u.getExpression().getText();
  if (isMachineCall(u, 'invoke') || isMachineCall(u, 'invokeMachine')) {
    const config = objectLiteral(u.getArguments()[0], sf);
    const id = config ? stringValue(propValue(config, 'id')) : undefined;
    const src = id ?? childId(config ? propValue(config, 'child') : undefined, sf);
    return src === undefined ? [] : [{ src, ...(id !== undefined ? { id } : {}) }];
  }
  // `invoke: () => SearchMachine({...})` — a local factory whose body builds the
  // invoke, so the declared id is one hop away.
  const factory = sf.getVariableDeclaration(callee)?.getInitializer();
  if (factory && isFunctionLike(unwrap(factory))) {
    return invokesOf(factory, sf, depth + 1);
  }
  return [{ src: callee.split('.').pop() ?? callee }];
}

/**
 * Label for an `entry` / `exit` action. A named reference (`entry: logStart`)
 * carries its own name; an inline anonymous effect has none, so the state gets
 * a bare marker recording that an action runs there.
 */
function actionLabel(node: Node, kind: 'entry' | 'exit'): string {
  const u = unwrap(node);
  return Node.isIdentifier(u) ? u.getText() : kind;
}

interface HandlerScan {
  readonly transitions: StateTransition[];
  readonly finalStates: string[];
  readonly entry: Record<string, readonly string[]>;
  readonly exit: Record<string, readonly string[]>;
  readonly invokes: Record<string, readonly StateInvoke[]>;
}

/** Read one state's handler config: transitions, final marker, actions, invokes, children. */
function readHandlerNode(
  config: ObjectLiteralExpression,
  path: string,
  tree: ReadonlyMap<string, TreeNode>,
  sf: SourceFile,
  out: HandlerScan,
): void {
  const push = (
    event: string,
    handler: Node,
    trigger?: StateTransition['trigger'],
  ): void => {
    for (const { to, guard } of targetsOf(handler, path, tree)) {
      out.transitions.push({
        from: path,
        event,
        to,
        ...(guard !== undefined ? { guard } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
      });
    }
  };

  const on = objectLiteral(propValue(config, 'on'), sf);
  for (const { name: event, value } of on ? propEntries(on) : []) {
    if (!value) continue;
    const handler = unwrap(value);
    // `{ reenter: true, transition: handler }` is the long form of a handler.
    push(
      event,
      Node.isObjectLiteralExpression(handler)
        ? (propValue(handler, 'transition') ?? handler)
        : handler,
    );
  }

  const always = propValue(config, 'always');
  if (always) push('always', always, 'always');

  const onDone = propValue(config, 'onDone');
  if (onDone) push('onDone', onDone, 'done');

  if (stringValue(propValue(config, 'type')) === 'final') {
    out.finalStates.push(path);
  }

  const entry = propValue(config, 'entry');
  if (entry) out.entry[path] = [actionLabel(entry, 'entry')];
  const exit = propValue(config, 'exit');
  if (exit) out.exit[path] = [actionLabel(exit, 'exit')];

  const invoke = propValue(config, 'invoke');
  if (invoke) {
    const found = invokesOf(invoke, sf);
    if (found.length > 0) out.invokes[path] = found;
  }

  const children = objectLiteral(propValue(config, 'states'), sf);
  for (const { name: key, value } of children ? propEntries(children) : []) {
    const child = objectLiteral(value, sf);
    if (child) readHandlerNode(child, join(path, key), tree, sf, out);
  }
}

// =============================================================================
// Machine assembly
// =============================================================================

/** The `.handle({...})` object chained onto a `Machine.make(...)` call. */
function handleObject(
  makeCall: CallExpression,
  sf: SourceFile,
): ObjectLiteralExpression | undefined {
  const parent = makeCall.getParent();
  if (!parent || !Node.isPropertyAccessExpression(parent)) return undefined;
  if (parent.getName() !== 'handle') return undefined;
  const call = parent.getParent();
  if (!call || !Node.isCallExpression(call)) return undefined;
  return objectLiteral(call.getArguments()[0], sf);
}

/** `{ path, state: { path, ... } }` — the deepest path of a snapshot literal. */
function snapshotPath(
  obj: ObjectLiteralExpression,
  depth = 0,
): string | undefined {
  if (depth > 8) return undefined;
  const path = stringValue(propValue(obj, 'path'));
  if (path === undefined) return undefined;
  const child = objectLiteral(propValue(obj, 'state'), obj.getSourceFile());
  return (child ? snapshotPath(child, depth + 1) : undefined) ?? path;
}

/**
 * The initial state path from the `initial:` value — either a
 * `States.initial.<state>(...)` builder chain or a `{ path }` snapshot literal.
 */
function initialPath(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const owner = expr.getExpression();
    if (Node.isPropertyAccessExpression(owner) && owner.getName() === 'initial') {
      return descendBuilder(call, expr.getName());
    }
  }
  for (const obj of node.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    const path = snapshotPath(obj);
    if (path !== undefined) return path;
  }
  return undefined;
}

/** The declaration a `Machine.make(...)` chain is assigned to. */
function ownerOf(node: Node): { readonly name: string; readonly anchor: Node } | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isVariableDeclaration(cur)) {
      return { name: cur.getName(), anchor: cur.getNameNode() };
    }
    cur = cur.getParent();
  }
  return undefined;
}

function arrayLiteral(
  node: Node | undefined,
  sf: SourceFile,
  depth = 0,
): Node | undefined {
  if (!node || depth > 8) return undefined;
  const unwrapped = unwrap(node);
  if (Node.isArrayLiteralExpression(unwrapped)) return unwrapped;
  if (Node.isIdentifier(unwrapped)) {
    return arrayLiteral(
      sf.getVariableDeclaration(unwrapped.getText())?.getInitializer(),
      sf,
      depth + 1,
    );
  }
  return undefined;
}

/** Tags of the `events: [A, B]` array — the declared event alphabet. */
function declaredEventsOf(
  config: ObjectLiteralExpression,
  sf: SourceFile,
): string[] | undefined {
  const array = arrayLiteral(propValue(config, 'events'), sf);
  if (!array || !Node.isArrayLiteralExpression(array)) return undefined;
  const elements = array.getElements().map(unwrap);
  if (!elements.every(Node.isIdentifier)) return undefined;
  return elements.map((element) => classTag(element.getText(), sf) ?? element.getText());
}

function extractMachine(
  makeCall: CallExpression,
  filePath: string,
  sf: SourceFile,
): StateMachine | undefined {
  const config = objectLiteral(makeCall.getArguments()[0], sf);
  if (!config) return undefined;
  const statesObj = stateTree(propValue(config, 'states'), sf);
  if (!statesObj) return undefined;

  const tree = new Map<string, TreeNode>();
  readStateTree(statesObj, undefined, tree, sf);
  if (tree.size === 0) return undefined;

  const scan: HandlerScan = {
    transitions: [],
    finalStates: [],
    entry: {},
    exit: {},
    invokes: {},
  };
  const handlers = handleObject(makeCall, sf);
  for (const { name: key, value } of handlers ? propEntries(handlers) : []) {
    const nodeConfig = objectLiteral(value, sf);
    if (nodeConfig) readHandlerNode(nodeConfig, key, tree, sf, scan);
  }

  const declaredStates: string[] = [];
  const finals: string[] = [];
  const parallels: string[] = [];
  const transitions: StateTransition[] = [];
  for (const node of tree.values()) {
    declaredStates.push(node.path);
    if (node.kind === 'final') finals.push(node.path);
    if (node.kind === 'parallel') parallels.push(node.path);
    // Entering a state implies entering its initial child — a compound's
    // declared `initial`, and every region of a parallel node.
    const entered =
      node.kind === 'parallel'
        ? node.children
        : node.initial !== undefined
          ? [join(node.path, node.initial)]
          : [];
    for (const to of entered) {
      transitions.push({ from: node.path, event: '', to, trigger: 'initial' });
    }
  }
  for (const finalState of scan.finalStates) {
    if (!finals.includes(finalState)) finals.push(finalState);
  }
  transitions.push(...scan.transitions);

  // A target that is not in the tree (a typo, or a state added to a handler but
  // not to `defineStates`) still gets drawn, and coverage flags it as undeclared.
  const states = [...new Set([...declaredStates, ...transitions.map((t) => t.to)])];
  const declaredEvents = declaredEventsOf(config, sf);
  const owner = ownerOf(makeCall);

  return {
    name: owner?.name ?? stringValue(propValue(config, 'id')) ?? 'Machine',
    source: 'effect-machine',
    initial: initialPath(propValue(config, 'initial')) ?? declaredStates[0],
    states,
    transitions,
    location: locOf(owner?.anchor ?? makeCall, filePath),
    declaredStates,
    declaredEvents,
    alphabetSource: 'config',
    // Always set, even when empty: the state tree and handler config declare
    // finals explicitly, so no-outgoing inference would mark ordinary leaves.
    finalStates: finals,
    ...(parallels.length > 0 ? { parallelStates: parallels } : {}),
    ...(Object.keys(scan.entry).length > 0 ? { entryActions: scan.entry } : {}),
    ...(Object.keys(scan.exit).length > 0 ? { exitActions: scan.exit } : {}),
    ...(Object.keys(scan.invokes).length > 0 ? { invokes: scan.invokes } : {}),
  };
}

// =============================================================================
// Entry point
// =============================================================================

const analysisCache = new Map<
  string,
  { readonly mtimeMs: number; readonly analysis: StateMachineAnalysis }
>();

export function analyzeStateMachines(
  filePath: string,
  source?: string,
): StateMachineAnalysis {
  const mtimeMs =
    source === undefined
      ? (() => {
          try {
            return statSync(filePath).mtimeMs;
          } catch {
            return undefined;
          }
        })()
      : undefined;
  // Only trust the cache when the mtime is known; a failed stat must re-analyze.
  if (source === undefined && mtimeMs !== undefined) {
    const cached = analysisCache.get(filePath);
    if (cached?.mtimeMs === mtimeMs) return cached.analysis;
  }
  const project = new Project({ useInMemoryFileSystem: !!source });
  const sf = source
    ? project.createSourceFile(filePath, source, { overwrite: true })
    : project.addSourceFileAtPath(filePath);

  const machines: StateMachine[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isMachineCall(call, 'make')) continue;
    const machine = extractMachine(call, filePath, sf);
    if (machine) machines.push(machine);
  }

  const analysis = { machines };
  if (source === undefined && mtimeMs !== undefined) {
    analysisCache.set(filePath, { mtimeMs, analysis });
  }
  return analysis;
}
