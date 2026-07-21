/**
 * Finite State Machine Analysis
 *
 * Recognizes plain-Effect state machines (no XState) and extracts
 * (fromState, event, toState) transition triples so they can be rendered
 * as an XState-style statechart.
 *
 * Shapes detected:
 *  A) Declarative transition table — a nested object literal:
 *       { Triage: { RefundRequested: 'Refund', ... }, ... }
 *  B) Match.when tuple function — Match.value([s._tag, e._tag]).pipe(
 *       Match.when(['Draft', 'Submit'], () => ({ _tag: 'Review' })), ...)
 *  C) Nested Match.tags dispatch — outer tags are states, inner tags are events.
 *     Both expression-body and block-body (`{ return { _tag } }`) handlers
 *     are supported; a handler with multiple distinct returned tags yields
 *     one transition per target (best-effort guarded transitions).
 * Initial state is taken from, in order: an `@initial <State>` annotation on
 * the machine declaration, a sibling `initial`/`initialState`/`startState`
 * declaration whose value is one of the machine's states, else the first
 * reachable state.
 */

import { statSync } from 'node:fs';
import { Node, Project, SyntaxKind, type ObjectLiteralExpression } from 'ts-morph';
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
  readonly source: 'transition-table' | 'match' | 'machine-json';
  readonly initial: string | undefined;
  /** States that appear in the extracted transitions. */
  readonly states: readonly string[];
  readonly transitions: readonly StateTransition[];
  readonly location: SourceLocation | undefined;
  /**
   * The declared alphabet — the full set of states/events from the machine's
   * types (a tagged union or a Schema-derived type). `undefined` when the type
   * could not be resolved. Used to check the machine for completeness.
   */
  readonly declaredStates: readonly string[] | undefined;
  readonly declaredEvents: readonly string[] | undefined;
  readonly alphabetSource: 'schema' | 'tagged-union' | 'config' | undefined;
  /**
   * States the source explicitly marks final (`type: 'final'` in MachineJSON
   * or a transition table). `undefined` means the source has no final marker,
   * and renderers fall back to no-outgoing-transition inference.
   */
  readonly finalStates?: readonly string[];
  /** States marked `type: 'parallel'` (MachineJSON): every child region is entered. */
  readonly parallelStates?: readonly string[];
  /** Entry action labels per state. Labels only — never executed. */
  readonly entryActions?: Readonly<Record<string, readonly string[]>>;
  /** Exit action labels per state. Labels only — never executed. */
  readonly exitActions?: Readonly<Record<string, readonly string[]>>;
  /** Invoked-effect metadata per state (`invoke: { src }` or an invoke array). */
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

function propName(prop: Node): string | undefined {
  if (!Node.isPropertyAssignment(prop)) return undefined;
  const nameNode = prop.getNameNode();
  if (Node.isStringLiteral(nameNode)) return nameNode.getLiteralValue();
  if (Node.isIdentifier(nameNode)) return nameNode.getText();
  return undefined;
}

/** Extract the `_tag` string literal from an object literal, if present. */
function tagFromObject(obj: Node): string | undefined {
  if (!Node.isObjectLiteralExpression(obj)) return undefined;
  const tagProp = obj.getProperty('_tag');
  if (!tagProp || !Node.isPropertyAssignment(tagProp)) return undefined;
  return stringValue(tagProp.getInitializer());
}

function locOf(node: Node, filePath: string): SourceLocation {
  const sf = node.getSourceFile();
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line, column, offset };
}

function uniqueStates(transitions: readonly StateTransition[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of transitions) {
    for (const s of [t.from, t.to]) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

// =============================================================================
// Declared-alphabet extraction (via the type checker)
//
// The type checker resolves a hand-written tagged union and a Schema-derived
// type (`Schema.Schema.Type<typeof X>`) to the same shape, so one path handles
// both. We read `_tag` string-literal members off the resolved type.
// =============================================================================

type TsType = ReturnType<Node['getType']>;

/** String-literal members of a (possibly union) type, e.g. `'a' | 'b'` → ['a','b']. */
function stringLiteralsOfType(type: TsType): string[] {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const out: string[] = [];
  for (const m of members) {
    const v = m.getLiteralValue();
    if (typeof v === 'string' && !out.includes(v)) out.push(v);
  }
  return out;
}

/** `_tag` literals of each member of a tagged-union type. */
function tagsOfUnion(type: TsType, at: Node): string[] {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  const out: string[] = [];
  for (const m of members) {
    const prop = m.getProperty('_tag');
    if (!prop) continue;
    const v = prop.getTypeAtLocation(at).getLiteralValue();
    if (typeof v === 'string' && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Alphabet members of a type: `_tag` literals of a tagged union, or — for a
 * `Schema.Literal('a','b')` / `type E = 'a' | 'b'` style — the string literals
 * themselves.
 */
function alphabetMembers(type: TsType, at: Node): string[] {
  const tags = tagsOfUnion(type, at);
  return tags.length ? tags : stringLiteralsOfType(type);
}

/**
 * The tag of a `Schema.TaggedClass<X>()('Tag', ...)`-style class declared in
 * this file, read syntactically from its extends clause. `undefined` when the
 * class is absent, imported, or not a Schema tagged class.
 */
function classTag(
  name: string,
  sf: ReturnType<Project['createSourceFile']>,
): string | undefined {
  const extendsText = sf.getClass(name)?.getExtends()?.getText() ?? '';
  return /Tagged(?:Class|Request|Error)[\s\S]*?\)\s*\(\s*["'`]([^"'`]+)["'`]/.exec(
    extendsText,
  )?.[1];
}

/**
 * Effect v4 Schema classes intentionally hide more of their encoded union
 * shape from the TypeScript checker. Recover the declared alphabet from the
 * local schema declarations instead of depending on v3-era type expansion.
 *
 * Best-effort syntactic recovery: runs only as a fallback when the checker
 * yields nothing, and matches tags by regex over declaration text, so unusual
 * formatting or indirection silently under-reports. Upgrade to a real AST walk
 * if the checked path keeps losing ground to Schema changes.
 */
function alphabetMembersFromSyntax(
  typeName: string | undefined,
  sf: ReturnType<Project['createSourceFile']>,
): string[] {
  if (!typeName) return [];
  const names = new Set<string>();
  const alias = sf.getTypeAlias(typeName);
  const aliasText = alias?.getTypeNode()?.getText() ?? typeName;
  for (const match of aliasText.matchAll(/\b[A-Z][A-Za-z0-9_$]*\b/g)) {
    if (match[0] !== 'Schema' && match[0] !== 'Type') names.add(match[0]);
  }
  names.add(typeName);

  const tags: string[] = [];
  const add = (tag: string | undefined): void => {
    if (tag && !tags.includes(tag)) tags.push(tag);
  };

  for (const name of names) {
    add(classTag(name, sf));

    const variable = sf.getVariableDeclaration(name);
    const initializerText = variable?.getInitializer()?.getText() ?? '';
    for (const match of initializerText.matchAll(/TaggedStruct\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      add(match[1]);
    }
    for (const match of initializerText.matchAll(/Schema\.Literal\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      add(match[1]);
    }
  }

  return tags;
}

/** Classify a named type as Schema-derived or a plain tagged union. */
function classifyAlphabet(
  typeName: string | undefined,
  sf: ReturnType<Project['createSourceFile']>,
): 'schema' | 'tagged-union' | undefined {
  if (!typeName) return undefined;
  const alias = sf.getTypeAlias(typeName);
  if (!alias) return undefined;
  const txt = alias.getTypeNode()?.getText() ?? '';
  if (/\bSchema\b|typeof/.test(txt)) return 'schema';
  const names = [...txt.matchAll(/\b[A-Z][A-Za-z0-9_$]*\b/g)].map((m) => m[0]);
  if (
    names.some((name) =>
      sf.getClass(name)?.getExtends()?.getText().includes('Schema.'),
    )
  ) {
    return 'schema';
  }
  return 'tagged-union';
}

/** Find the function node behind a machine declaration (arrow / fn expr / fn decl). */
function functionOf(decl: Node): Node | undefined {
  if (Node.isFunctionDeclaration(decl)) return decl;
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init;
    }
  }
  return undefined;
}

interface Alphabet {
  readonly states: readonly string[] | undefined;
  readonly events: readonly string[] | undefined;
  readonly source: 'schema' | 'tagged-union' | undefined;
}

const EMPTY_ALPHABET: Alphabet = {
  states: undefined,
  events: undefined,
  source: undefined,
};

const analysisCache = new Map<
  string,
  { readonly mtimeMs: number; readonly analysis: StateMachineAnalysis }
>();

/** Alphabet for a `(state, event) => state` transition function (Shape B). */
function alphabetFromFunction(
  fn: Node,
  sf: ReturnType<Project['createSourceFile']>,
): Alphabet {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)) {
    return EMPTY_ALPHABET;
  }
  const params = fn.getParameters();
  const stateParam = params[0];
  const eventParam = params[1];
  if (!stateParam || !eventParam) return EMPTY_ALPHABET;
  const stateTypeName = stateParam.getTypeNode()?.getText();
  const eventTypeName = eventParam.getTypeNode()?.getText();
  const checkedStates = alphabetMembers(stateParam.getType(), stateParam);
  const checkedEvents = alphabetMembers(eventParam.getType(), eventParam);
  const states = checkedStates.length
    ? checkedStates
    : alphabetMembersFromSyntax(stateTypeName, sf);
  const events = checkedEvents.length
    ? checkedEvents
    : alphabetMembersFromSyntax(eventTypeName, sf);
  return {
    states: states.length ? states : undefined,
    events: events.length ? events : undefined,
    source: classifyAlphabet(stateTypeName, sf),
  };
}

/** Alphabet for a `... satisfies Record<State['_tag'], Record<Event['_tag'], ...>>` table (Shape A). */
function alphabetFromTable(
  decl: Node,
  sf: ReturnType<Project['createSourceFile']>,
): Alphabet {
  if (!Node.isVariableDeclaration(decl)) return EMPTY_ALPHABET;
  const init = decl.getInitializer();
  if (init?.getKind() !== SyntaxKind.SatisfiesExpression) {
    return EMPTY_ALPHABET; // no `satisfies` ⇒ no declared alphabet
  }
  const typeNode = (
    init as unknown as { getTypeNode(): Node | undefined }
  ).getTypeNode();
  if (!typeNode) return EMPTY_ALPHABET;

  // Collect distinct `X['_tag']` indexed-access types in source order.
  const groups: { name: string; tags: string[] }[] = [];
  const seen = new Set<string>();
  for (const ia of typeNode.getDescendantsOfKind(SyntaxKind.IndexedAccessType)) {
    if (!ia.getIndexTypeNode().getText().includes('_tag')) continue;
    const name = ia.getObjectTypeNode().getText();
    if (seen.has(name)) continue;
    seen.add(name);
    const checkedTags = stringLiteralsOfType(ia.getType());
    groups.push({
      name,
      tags: checkedTags.length
        ? checkedTags
        : alphabetMembersFromSyntax(name, sf),
    });
  }
  const stateGroup = groups[0];
  const eventGroup = groups[1];
  return {
    states: stateGroup?.tags.length ? stateGroup.tags : undefined,
    events: eventGroup?.tags.length ? eventGroup.tags : undefined,
    source: classifyAlphabet(stateGroup?.name, sf),
  };
}

// =============================================================================
// Initial-state detection
// =============================================================================

const INITIAL_NAMES = /^(initial|initialState|startState|start)$/i;

/** Collect candidate initial-state tags from `initial`-ish declarations. */
function collectInitialHints(sf: ReturnType<Project['createSourceFile']>): string[] {
  const hints: string[] = [];
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (!INITIAL_NAMES.test(decl.getName())) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const u = unwrap(init);
    const direct = stringValue(u);
    if (direct) {
      hints.push(direct);
      continue;
    }
    const tag = tagFromObject(u);
    if (tag) hints.push(tag);
  }
  return hints;
}

/**
 * All `@initial <State>` annotations in a declaration's leading trivia.
 * Reads the raw leading comment text (more reliable than the JSDoc/comment-range
 * APIs, which vary with preceding dividers). Returns every match so callers can
 * pick the one that is actually a declared state.
 */
function annotatedInitials(decl: Node): string[] {
  const stmt = Node.isVariableDeclaration(decl)
    ? decl.getVariableStatement()
    : decl;
  if (!stmt) return [];
  const leading = stmt
    .getFullText()
    .slice(0, stmt.getStart() - stmt.getFullStart());
  return [...leading.matchAll(/@initial\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)]
    .map((m) => m[1])
    .filter((x): x is string => x !== undefined);
}

function pickInitial(
  states: readonly string[],
  fallback: string | undefined,
  decl: Node | undefined,
  hints: readonly string[],
): string | undefined {
  const set = new Set(states);
  for (const a of decl ? annotatedInitials(decl) : []) {
    if (set.has(a)) return a;
  }
  const hinted = hints.find((h) => set.has(h));
  if (hinted) return hinted;
  return fallback;
}

// =============================================================================
// Shape A: declarative transition table
// =============================================================================

/** A string, or an array of strings, read as a string list. */
function stringList(node: Node | undefined): string[] | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  const single = stringValue(u);
  if (single !== undefined) return [single];
  if (Node.isArrayLiteralExpression(u)) {
    const items = u.getElements().map((e) => stringValue(e));
    return items.every((x): x is string => x !== undefined) && items.length > 0
      ? items
      : undefined;
  }
  return undefined;
}

function propInitializer(obj: ObjectLiteralExpression, name: string): Node | undefined {
  return obj.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
}

interface TableTarget {
  readonly to: string;
  readonly guard?: string;
  readonly actions?: readonly string[];
}

function tableLeafTargets(node: Node | undefined): TableTarget[] {
  if (!node) return [];
  const leaf = unwrap(node);
  const direct = stringValue(leaf);
  if (direct) return [{ to: direct }];
  if (Node.isObjectLiteralExpression(leaf)) {
    const target =
      stringValue(propInitializer(leaf, 'target')) ??
      stringValue(propInitializer(leaf, 'to')) ??
      tagFromObject(leaf);
    if (!target) return [];
    const guard = stringValue(propInitializer(leaf, 'guard'));
    const actions = stringList(propInitializer(leaf, 'actions'));
    return [
      {
        to: target,
        ...(guard !== undefined ? { guard } : {}),
        ...(actions !== undefined ? { actions } : {}),
      },
    ];
  }
  if (Node.isArrayLiteralExpression(leaf)) {
    return leaf
      .getElements()
      .flatMap((element) => tableLeafTargets(element));
  }
  return [];
}

function extractTable(
  decl: Node,
  filePath: string,
  hints: readonly string[],
  sf: ReturnType<Project['createSourceFile']>,
): StateMachine | undefined {
  if (!Node.isVariableDeclaration(decl)) return undefined;
  const init = decl.getInitializer();
  if (!init) return undefined;
  const obj = unwrap(init);
  if (!Node.isObjectLiteralExpression(obj)) return undefined;

  const transitions: StateTransition[] = [];
  const fromStates: string[] = [];
  const finals: string[] = [];
  const entryActions: Record<string, readonly string[]> = {};
  const exitActions: Record<string, readonly string[]> = {};
  const invokes: Record<string, readonly StateInvoke[]> = {};

  const pushTargets = (
    from: string,
    event: string,
    targets: readonly TableTarget[],
    trigger?: StateTransition['trigger'],
    invokeIndex?: number,
  ): void => {
    for (const { to, guard, actions } of targets) {
      transitions.push({
        from,
        event,
        to,
        ...(guard !== undefined ? { guard } : {}),
        ...(actions !== undefined ? { actions } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        ...(invokeIndex !== undefined ? { invokeIndex } : {}),
      });
    }
  };

  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) return undefined; // not a clean table
    const from = propName(prop);
    if (from === undefined) return undefined;
    const val = unwrap(prop.getInitializerOrThrow());
    if (!Node.isObjectLiteralExpression(val)) return undefined; // every value must be an object
    fromStates.push(from);
    for (const inner of val.getProperties()) {
      if (!Node.isPropertyAssignment(inner)) return undefined;
      const event = propName(inner);
      if (event === undefined) return undefined;

      // Reserved state-level keys (not events): `type: 'final'`, entry/exit
      // action labels, and `invoke: { src, onDone, onError }`.
      if (event === 'type') {
        if (stringValue(inner.getInitializer()) !== 'final') return undefined;
        finals.push(from);
        continue;
      }
      if (event === 'entry' || event === 'exit') {
        const labels = stringList(inner.getInitializer());
        if (labels === undefined) return undefined;
        if (event === 'entry') entryActions[from] = labels;
        else exitActions[from] = labels;
        continue;
      }
      if (event === 'invoke') {
        const inv = unwrap(inner.getInitializerOrThrow());
        if (!Node.isObjectLiteralExpression(inv)) return undefined;
        const src = stringValue(propInitializer(inv, 'src'));
        if (src === undefined) return undefined;
        invokes[from] = [{ src }];
        const done = tableLeafTargets(propInitializer(inv, 'onDone'));
        const error = tableLeafTargets(propInitializer(inv, 'onError'));
        pushTargets(from, 'onDone', done, 'done', 0);
        pushTargets(from, 'onError', error, 'error', 0);
        continue;
      }

      const targets = tableLeafTargets(inner.getInitializer());
      if (targets.length === 0) return undefined;
      // Reserved keys for automatic transitions, mirroring the MachineJSON
      // event labels: `always` (eventless) and `'after 500ms'` (delayed).
      const trigger =
        event === 'always'
          ? ('always' as const)
          : /^after\s+\S+$/.test(event)
            ? ('after' as const)
            : undefined;
      pushTargets(from, event, targets, trigger);
    }
  }

  // FSM signal: at least one transition, and at least one target is itself a
  // declared state — distinguishes a transition table from an arbitrary config.
  if (transitions.length === 0) return undefined;
  const fromSet = new Set(fromStates);
  if (!transitions.some((t) => fromSet.has(t.to))) return undefined;

  // Transition states plus declared-but-disconnected table keys (e.g. an
  // explicitly final state nothing targets yet) so they render and get judged.
  const states = uniqueStates(transitions);
  for (const s of fromStates) if (!states.includes(s)) states.push(s);
  const alphabet = alphabetFromTable(decl, sf);
  return {
    name: decl.getName(),
    source: 'transition-table',
    initial: pickInitial(states, fromStates[0], decl, hints),
    states,
    transitions,
    location: locOf(decl.getNameNode(), filePath),
    declaredStates: alphabet.states,
    declaredEvents: alphabet.events,
    alphabetSource: alphabet.source,
    ...(finals.length > 0 ? { finalStates: finals } : {}),
    ...(Object.keys(entryActions).length > 0 ? { entryActions } : {}),
    ...(Object.keys(exitActions).length > 0 ? { exitActions } : {}),
    ...(Object.keys(invokes).length > 0 ? { invokes } : {}),
  };
}

// =============================================================================
// Shape B: Match.when tuple function
// =============================================================================

/**
 * Target state of a handler return: `{ _tag: 'X' }`, a bare `'X'` literal, or
 * `new X(...)` for Schema.TaggedClass states. The tag comes from the class's
 * `Schema.TaggedClass<X>()('Tag', ...)` declaration when it is in this file
 * (class name and tag need not match); otherwise the class name is the
 * best-effort fallback.
 */
function targetFromExpr(node: Node): string | undefined {
  const u = unwrap(node);
  if (Node.isObjectLiteralExpression(u)) return tagFromObject(u);
  if (Node.isStringLiteral(u)) return u.getLiteralValue();
  if (Node.isNewExpression(u)) {
    const cls = u.getExpression();
    if (!Node.isIdentifier(cls)) return undefined;
    const name = cls.getText();
    // Prefer the constructed instance type: unlike a syntax lookup, this also
    // resolves imported/aliased tagged classes whose class name differs from
    // their `_tag` literal.
    const [typeTag] = tagsOfUnion(u.getType(), u);
    return typeTag ?? classTag(name, u.getSourceFile()) ?? name;
  }
  return undefined;
}

/** The guard condition for a `return` nested in an `if`, as source text. */
function guardForReturn(ret: Node, handler: Node): string | undefined {
  let cur: Node | undefined = ret.getParent();
  while (cur && cur !== handler) {
    if (Node.isIfStatement(cur)) {
      const cond = cur.getExpression().getText();
      const thenStmt = cur.getThenStatement();
      const inThen =
        ret.getStart() >= thenStmt.getStart() &&
        ret.getEnd() <= thenStmt.getEnd();
      return inThen ? cond : `!(${cond})`;
    }
    cur = cur.getParent();
  }
  return undefined;
}

/**
 * Target states a handler can return, each with its guard condition (if any).
 * More than one target ⇒ a guarded (conditional) transition.
 */
function returnedTransitions(
  handler: Node | undefined,
): { to: string; guard?: string }[] {
  if (!handler) return [];
  if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) {
    return [];
  }
  const out: { to: string; guard?: string }[] = [];
  const seen = new Set<string>();
  const push = (to: string | undefined, guard?: string): void => {
    if (!to) return;
    const k = `${to}|${guard ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(guard === undefined ? { to } : { to, guard });
  };

  const body = handler.getBody();
  if (!Node.isBlock(body)) {
    push(targetFromExpr(body)); // expression body
    return out;
  }
  for (const ret of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const re = ret.getExpression();
    if (re) push(targetFromExpr(re), guardForReturn(ret, handler));
  }
  return out;
}

function matchTagsObject(call: Node): ObjectLiteralExpression | undefined {
  if (!Node.isCallExpression(call)) return undefined;
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return undefined;
  if (expr.getExpression().getText() !== 'Match') return undefined;
  const name = expr.getName();
  if (name !== 'tags' && name !== 'tagsExhaustive') return undefined;
  const [arg] = call.getArguments();
  if (!arg) return undefined;
  const obj = unwrap(arg);
  return Node.isObjectLiteralExpression(obj) ? obj : undefined;
}

function functionInitializer(prop: Node): Node | undefined {
  if (!Node.isPropertyAssignment(prop)) return undefined;
  const init = prop.getInitializer();
  if (!init) return undefined;
  const u = unwrap(init);
  return Node.isArrowFunction(u) || Node.isFunctionExpression(u) ? u : undefined;
}

function nestedTagsTransitions(call: Node): StateTransition[] {
  const outerObj = matchTagsObject(call);
  if (!outerObj) return [];
  const transitions: StateTransition[] = [];
  for (const stateProp of outerObj.getProperties()) {
    const from = propName(stateProp);
    const stateHandler = functionInitializer(stateProp);
    if (!from || !stateHandler) continue;
    for (const innerCall of stateHandler.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const innerObj = matchTagsObject(innerCall);
      if (!innerObj) continue;
      for (const eventProp of innerObj.getProperties()) {
        const event = propName(eventProp);
        const eventHandler = functionInitializer(eventProp);
        if (!event || !eventHandler) continue;
        for (const { to, guard } of returnedTransitions(eventHandler)) {
          transitions.push(
            guard === undefined ? { from, event, to } : { from, event, to, guard },
          );
        }
      }
    }
  }
  return transitions;
}

function ownerOf(
  node: Node,
): { readonly name: string; readonly decl: Node; readonly anchor: Node } | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isVariableDeclaration(cur)) {
      return { name: cur.getName(), decl: cur, anchor: cur.getNameNode() };
    }
    if (Node.isFunctionDeclaration(cur)) {
      const name = cur.getName();
      if (name) return { name, decl: cur, anchor: cur.getNameNodeOrThrow() };
    }
    cur = cur.getParent();
  }
  return undefined;
}

function extractMatchMachines(
  sf: ReturnType<Project['createSourceFile']>,
  filePath: string,
  hints: readonly string[],
): StateMachine[] {
  const groups = new Map<
    string,
    { transitions: StateTransition[]; decl: Node; anchor: Node }
  >();

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const nestedTransitions = nestedTagsTransitions(call);
    if (nestedTransitions.length > 0) {
      const owner = ownerOf(call);
      if (!owner) continue;
      const group = groups.get(owner.name) ?? {
        transitions: [],
        decl: owner.decl,
        anchor: owner.anchor,
      };
      group.transitions.push(...nestedTransitions);
      groups.set(owner.name, group);
      continue;
    }

    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    if (expr.getName() !== 'when') continue;
    if (expr.getExpression().getText() !== 'Match') continue;

    const [patternArg, handlerArg] = call.getArguments();
    if (!patternArg || !handlerArg) continue;
    const tuple = unwrap(patternArg);
    if (!Node.isArrayLiteralExpression(tuple)) continue;
    const els = tuple.getElements();
    if (els.length !== 2) continue;
    const from = stringValue(els[0]);
    const event = stringValue(els[1]);
    const tos = returnedTransitions(handlerArg);
    if (from === undefined || event === undefined || tos.length === 0) continue;

    const owner = ownerOf(call);
    if (!owner) continue;
    const group = groups.get(owner.name) ?? {
      transitions: [],
      decl: owner.decl,
      anchor: owner.anchor,
    };
    for (const { to, guard } of tos) {
      group.transitions.push(
        guard === undefined ? { from, event, to } : { from, event, to, guard },
      );
    }
    groups.set(owner.name, group);
  }

  const machines: StateMachine[] = [];
  for (const [name, { transitions, decl, anchor }] of groups) {
    if (transitions.length === 0) continue;
    const states = uniqueStates(transitions);
    const fn = functionOf(decl);
    const alphabet = fn ? alphabetFromFunction(fn, sf) : EMPTY_ALPHABET;
    machines.push({
      name,
      source: 'match',
      initial: pickInitial(states, transitions[0]?.from, decl, hints),
      states,
      transitions,
      location: locOf(anchor, filePath),
      declaredStates: alphabet.states,
      declaredEvents: alphabet.events,
      alphabetSource: alphabet.source,
    });
  }
  return machines;
}

// =============================================================================
// Entry point
// =============================================================================

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

  const hints = collectInitialHints(sf);
  const machines: StateMachine[] = [];

  // Shape A: scan top-level + exported variable declarations.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const machine = extractTable(decl, filePath, hints, sf);
    if (machine) machines.push(machine);
  }

  // Shape B: Match.when tuple functions.
  machines.push(...extractMatchMachines(sf, filePath, hints));

  const analysis = { machines };
  if (source === undefined && mtimeMs !== undefined) {
    analysisCache.set(filePath, { mtimeMs, analysis });
  }
  return analysis;
}
