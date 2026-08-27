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
  type CallExpression,
  type ObjectLiteralExpression,
} from 'ts-morph';
import {
  isFunctionLike,
  isMachineCall,
  join,
  locOf,
  propEntries,
  propValue,
  stringValue,
  unwrap,
  type SourceFile,
} from './state-machine-ast';
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
 * `Machine.defineStates({...})` / `Machine.states({...})` call, or the `.states`
 * of one. `undefined` when
 * the tree is declared in another file.
 */
function stateTree(
  node: Node | undefined,
  sf: SourceFile,
  depth = 0,
): ObjectLiteralExpression | undefined {
  if (!node || depth > 8) return undefined;
  const u = unwrap(node);
  // `Machine.defineStates` (<= 0.5) and `Machine.states` (>= 0.6) both take the
  // tree as their sole argument.
  if (isMachineCall(u, 'defineStates') || isMachineCall(u, 'states')) {
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

const NODE_CONFIG_KEYS = ['schema', 'type', 'initial', 'states'] as const;

/**
 * The node config behind a state tree entry. A schema (an identifier, or a
 * `Union.cases.X` access) and the schema-less `{}` leaf of the 0.6+ API are
 * atomic; an object carrying any of `schema` / `type` / `initial` / `states`
 * configures a node.
 */
function nodeConfig(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node || !Node.isObjectLiteralExpression(node)) return undefined;
  return NODE_CONFIG_KEYS.some((key) => node.getProperty(key)) ? node : undefined;
}

/**
 * Flatten a state tree literal into dotted paths, keeping the parent/child
 * links so nothing downstream has to re-derive them from the path strings.
 */
function readStateTree(
  obj: ObjectLiteralExpression,
  parent: TreeNode | undefined,
  out: Map<string, TreeNode>,
  sf: SourceFile,
): void {
  for (const { name: key, value } of propEntries(obj)) {
    const inner = value ? unwrap(value) : undefined;
    const config = nodeConfig(inner);
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
 * Resolve one `<builder>.<mode>.<state>(...)` call to a full state path.
 * The builder is `target` in the 0.5-era destructured handler
 * (`({ target }) => target.full.X()`) and the handler's own parameter in the
 * 0.6+ shape (`(to) => to.full.X()`), so `builders` carries the parameter
 * names bound inside the handler.
 * `full` and `branch` are absolute; `local` is relative to the nearest
 * compound ancestor, and `local.with(...)` re-enters that scope itself.
 */
function targetPath(
  call: CallExpression,
  from: string,
  tree: ReadonlyMap<string, TreeNode>,
  builders: ReadonlySet<string> = new Set(),
): string | undefined {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  const mode = expr.getExpression();
  if (!Node.isPropertyAccessExpression(mode)) return undefined;
  const modeName = mode.getName();
  if (modeName !== 'full' && modeName !== 'local' && modeName !== 'branch') {
    return undefined;
  }
  const receiver = mode.getExpression().getText();
  if (!/(^|\.)target$/.test(receiver) && !builders.has(receiver)) return undefined;

  const segment = expr.getName();
  const base = modeName === 'local' ? localScope(from, tree) : '';
  const start =
    modeName === 'local' && segment === 'with' ? base : join(base, segment);
  return descendBuilder(call, start);
}

/** A call to `<anything>.<name>(...)` — a builder step, whatever the receiver. */
function isCallTo(node: Node | undefined, name: string): boolean {
  if (!node || !Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  return Node.isPropertyAccessExpression(expr) && expr.getName() === name;
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
    // `to.branches({ accepted: { target: ... } })` names its own conditions, so
    // the branch key is a better label than any surrounding expression.
    if (
      Node.isPropertyAssignment(cur) &&
      Node.isObjectLiteralExpression(cur.getParent()) &&
      isCallTo(cur.getParent().getParent(), 'branches')
    ) {
      return cur.getName();
    }
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

/**
 * Identifier parameters bound anywhere inside a handler. In the 0.6+ API the
 * target builder arrives as the handler's own parameter (`(to) => ...`), so its
 * name is whatever the author picked and has to be read from the source.
 */
function builderNames(handler: Node): Set<string> {
  const names = new Set<string>();
  const fns = [
    ...(isFunctionLike(handler) ? [handler] : []),
    ...handler.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...handler.getDescendantsOfKind(SyntaxKind.FunctionExpression),
  ];
  for (const fn of fns) {
    for (const param of fn.getParameters()) {
      const nameNode = param.getNameNode();
      if (Node.isIdentifier(nameNode)) names.add(nameNode.getText());
    }
  }
  return names;
}

/** Every distinct state path a handler body can transition to. */
function targetsOf(
  handler: Node,
  from: string,
  tree: ReadonlyMap<string, TreeNode>,
): HandlerTarget[] {
  const out: HandlerTarget[] = [];
  const seen = new Set<string>();
  const builders = builderNames(handler);
  const calls = [
    ...(Node.isCallExpression(handler) ? [handler] : []),
    ...handler.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  for (const call of calls) {
    const to = targetPath(call, from, tree, builders);
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

/**
 * Completion handlers on a 0.6+ invoke builder, mapped onto the IR triggers the
 * XState exporter already understands.
 */
const INVOKE_COMPLETIONS: Readonly<Record<string, 'done' | 'error'>> = {
  onDone: 'done',
  onFailure: 'error',
  onError: 'error',
};

/** Verbs that start a 0.6+ invoke builder chain — the root of the chain. */
const INVOKE_SOURCES = new Set(['effect', 'stream', 'timer', 'logic', 'child']);

interface InvokeBuilder {
  readonly invoke: StateInvoke;
  /** Completion handlers in source order, for `trigger` + `invokeIndex`. */
  readonly completions: readonly {
    readonly trigger: 'done' | 'error';
    readonly handler: Node;
  }[];
}

/**
 * Read a 0.6+ invoke builder chain:
 * `from.effect('load', ...).onDone(to => ...).onFailure(to => ...)`.
 * `undefined` when the node is not such a chain — the 0.5 `Machine.invoke({...})`
 * object form is read by `invokesOf` instead.
 */
function invokeBuilder(node: Node, sf: SourceFile): InvokeBuilder | undefined {
  const completions: { trigger: 'done' | 'error'; handler: Node }[] = [];
  let cur: Node = unwrap(node);
  for (let depth = 0; Node.isCallExpression(cur) && depth <= 8; depth += 1) {
    const expr = cur.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return undefined;
    const name = expr.getName();
    const trigger = INVOKE_COMPLETIONS[name];
    if (trigger !== undefined) {
      const handler = cur.getArguments()[0];
      if (handler) completions.unshift({ trigger, handler: unwrap(handler) });
      cur = expr.getExpression();
      continue;
    }
    if (!INVOKE_SOURCES.has(name)) return undefined;
    const first = cur.getArguments()[0];
    const id = stringValue(first) ?? (name === 'child' ? childId(first, sf) : undefined);
    return {
      invoke: { src: id ?? name, ...(id !== undefined ? { id } : {}) },
      completions,
    };
  }
  return undefined;
}

/**
 * Every invoke declared on a state, in source order. The 0.5 forms
 * (`Machine.invoke({...})`, a factory call) carry no completion handlers; the
 * 0.6+ builder chain carries its `onDone` / `onFailure` targets with it.
 */
function invokesOf(node: Node | undefined, sf: SourceFile, depth = 0): InvokeBuilder[] {
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
  const builder = invokeBuilder(u, sf);
  if (builder) return [builder];
  const callee = u.getExpression().getText();
  if (isMachineCall(u, 'invoke') || isMachineCall(u, 'invokeMachine')) {
    const config = objectLiteral(u.getArguments()[0], sf);
    const id = config ? stringValue(propValue(config, 'id')) : undefined;
    const src = id ?? childId(config ? propValue(config, 'child') : undefined, sf);
    return src === undefined
      ? []
      : [{ invoke: { src, ...(id !== undefined ? { id } : {}) }, completions: [] }];
  }
  // `invoke: () => SearchMachine({...})` — a local factory whose body builds the
  // invoke, so the declared id is one hop away.
  const factory = sf.getVariableDeclaration(callee)?.getInitializer();
  if (factory && isFunctionLike(unwrap(factory))) {
    return invokesOf(factory, sf, depth + 1);
  }
  return [{ invoke: { src: callee.split('.').pop() ?? callee }, completions: [] }];
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
    invokeIndex?: number,
  ): void => {
    for (const { to, guard } of targetsOf(handler, path, tree)) {
      out.transitions.push({
        from: path,
        event,
        to,
        ...(guard !== undefined ? { guard } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        ...(invokeIndex !== undefined ? { invokeIndex } : {}),
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
    if (found.length > 0) out.invokes[path] = found.map((f) => f.invoke);
    for (const [invokeIndex, { completions }] of found.entries()) {
      for (const { trigger, handler } of completions) {
        push(
          trigger === 'done' ? 'onDone' : 'onError',
          handler,
          trigger,
          invokeIndex,
        );
      }
    }
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

/** One `.handle({...})` implementation of a machine definition. */
interface Implementation {
  readonly handlers: ObjectLiteralExpression | undefined;
  /** The `.handle(...)` call itself, or the `make` call when unimplemented. */
  readonly anchor: Node;
}

/** The `.handle({...})` call chained directly onto an expression, if any. */
function handleCallOn(node: Node): CallExpression | undefined {
  const parent = node.getParent();
  if (!parent || !Node.isPropertyAccessExpression(parent)) return undefined;
  if (parent.getName() !== 'handle') return undefined;
  const call = parent.getParent();
  return call && Node.isCallExpression(call) ? call : undefined;
}

/**
 * Every implementation of a `Machine.make(...)` definition. Usually one, chained
 * directly. A definition stored in a `const` can be handled more than once —
 * production and testing variants of the same model — and each is its own
 * machine.
 */
function implementationsOf(
  makeCall: CallExpression,
  sf: SourceFile,
): Implementation[] {
  const asImplementation = (call: CallExpression): Implementation => ({
    handlers: objectLiteral(call.getArguments()[0], sf),
    anchor: call,
  });

  const chained = handleCallOn(makeCall);
  if (chained) return [asImplementation(chained)];

  const definition = ownerOf(makeCall)?.name;
  const found: Implementation[] = [];
  if (definition !== undefined) {
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getText() !== definition) continue;
      const call = handleCallOn(identifier);
      if (call) found.push(asImplementation(call));
    }
  }
  return found.length > 0 ? found : [{ handlers: undefined, anchor: makeCall }];
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
 * The longest prefix of a `to.a.b.c` property chain that names a real state.
 * The 0.6+ initial builder mixes state segments with verbs
 * (`to.workspace.initial.resolve(...)`, `to.Idle()`), and only the tree can say
 * where the path stops.
 */
function chainPath(
  node: Node,
  tree: ReadonlyMap<string, TreeNode>,
): string | undefined {
  const segments: string[] = [];
  let cur: Node = node;
  while (Node.isPropertyAccessExpression(cur)) {
    segments.unshift(cur.getName());
    cur = cur.getExpression();
  }
  if (!Node.isIdentifier(cur)) return undefined;
  let path = '';
  for (const segment of segments) {
    const next = join(path, segment);
    if (!tree.has(next)) break;
    path = next;
  }
  return path === '' ? undefined : path;
}

/**
 * The initial state path from the `initial:` value — a
 * `States.initial.<state>(...)` builder chain (<= 0.5), a `(to) => to.<state>`
 * builder chain (>= 0.6), or a `{ path }` snapshot literal.
 */
function initialPath(
  node: Node | undefined,
  tree: ReadonlyMap<string, TreeNode>,
): string | undefined {
  if (!node) return undefined;
  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const owner = expr.getExpression();
    // `States.initial.<state>(...)`. The 0.6+ builder also has an `initial`
    // segment (`to.workspace.initial.resolve(...)`), so the name after it only
    // counts when the tree agrees it is a state.
    if (
      Node.isPropertyAccessExpression(owner) &&
      owner.getName() === 'initial' &&
      tree.has(expr.getName())
    ) {
      return descendBuilder(call, expr.getName());
    }
  }
  for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const path = chainPath(access, tree);
    if (path !== undefined) return path;
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

/**
 * Tags of a `Machine.events(...)` descriptor — the 0.6+ event alphabet. The
 * argument is a `Schema.TaggedUnion({ Tag: {...} })` whose keys are the tags, or
 * tagged classes passed directly. `Machine.events()` declares an empty alphabet.
 */
function eventsDescriptor(
  node: Node | undefined,
  sf: SourceFile,
  depth = 0,
): string[] | undefined {
  if (!node || depth > 8) return undefined;
  const u = unwrap(node);
  if (Node.isIdentifier(u)) {
    return eventsDescriptor(
      sf.getVariableDeclaration(u.getText())?.getInitializer(),
      sf,
      depth + 1,
    );
  }
  if (!isMachineCall(u, 'events')) return undefined;
  const tags: string[] = [];
  for (const argument of u.getArguments().map(unwrap)) {
    const union = Node.isCallExpression(argument)
      ? objectLiteral(argument.getArguments()[0], sf)
      : undefined;
    if (union) {
      tags.push(...propEntries(union).map(({ name }) => name));
      continue;
    }
    if (!Node.isIdentifier(argument)) return undefined;
    tags.push(classTag(argument.getText(), sf) ?? argument.getText());
  }
  return tags;
}

/**
 * The declared event alphabet: an `events: [A, B]` array (<= 0.5) or a
 * `Machine.events(...)` descriptor (>= 0.6).
 */
function declaredEventsOf(
  config: ObjectLiteralExpression,
  sf: SourceFile,
): string[] | undefined {
  const events = propValue(config, 'events');
  const array = arrayLiteral(events, sf);
  if (!array || !Node.isArrayLiteralExpression(array)) {
    return eventsDescriptor(events, sf);
  }
  const elements = array.getElements().map(unwrap);
  if (!elements.every(Node.isIdentifier)) return undefined;
  return elements.map((element) => classTag(element.getText(), sf) ?? element.getText());
}

function extractMachine(
  makeCall: CallExpression,
  implementation: Implementation,
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
  const { handlers } = implementation;
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
  const owner = ownerOf(implementation.anchor) ?? ownerOf(makeCall);

  return {
    name: owner?.name ?? stringValue(propValue(config, 'id')) ?? 'Machine',
    source: 'effect-machine',
    initial: initialPath(propValue(config, 'initial'), tree) ?? declaredStates[0],
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

/**
 * State and event counts for a one-line summary. Events are the declared
 * alphabet — automatic triggers (`initial`, `always`, an invoke's `onDone` /
 * `onError`) are not events anyone can send, so they must not inflate it.
 */
export function summarizeAlphabet(machine: StateMachine): {
  readonly states: number;
  readonly events: number;
} {
  const observed = new Set(
    machine.transitions.filter((t) => t.trigger === undefined).map((t) => t.event),
  );
  return {
    states: machine.states.length,
    events: machine.declaredEvents?.length ?? observed.size,
  };
}

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
    for (const implementation of implementationsOf(call, sf)) {
      const machine = extractMachine(call, implementation, filePath, sf);
      if (machine) machines.push(machine);
    }
  }

  const analysis = { machines };
  if (source === undefined && mtimeMs !== undefined) {
    analysisCache.set(filePath, { mtimeMs, analysis });
  }
  return analysis;
}
