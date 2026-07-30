/**
 * State machine diagnostics.
 *
 * Explains why a declaration that looks like an `@typeonce/effect-machine`
 * machine was not recognized. The CLI uses this so a failed
 * `--format statechart-*` run teaches the convention instead of printing
 * "no machines found".
 *
 * This scanner is intentionally independent of the extraction code: it
 * re-derives near-miss candidates with its own light AST checks so it stays
 * stable while the extractor evolves.
 */

import { Node, Project, SyntaxKind, type CallExpression } from 'ts-morph';
import type { SourceLocation } from './types';
import { analyzeStateMachines, type StateMachine } from './state-machine';

export interface StateMachineRejection {
  readonly name: string;
  readonly kind: 'effect-machine';
  readonly reason: string;
  readonly hint: string;
  readonly location: SourceLocation | undefined;
}

export interface StateMachineDiagnostics {
  readonly machines: readonly StateMachine[];
  readonly rejected: readonly StateMachineRejection[];
}

function locOf(node: Node, filePath: string): SourceLocation {
  const sf = node.getSourceFile();
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line, column, offset };
}

function isEffectMachineBinding(name: string, sf: ReturnType<Project['createSourceFile']>): boolean {
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

function isEffectMachineNamespace(
  name: string,
  sf: ReturnType<Project['createSourceFile']>,
): boolean {
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

function ownerOf(node: Node): { name: string; nameNode: Node } | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (Node.isVariableDeclaration(cur)) {
      return { name: cur.getName(), nameNode: cur.getNameNode() };
    }
    cur = cur.getParent();
  }
  return undefined;
}

/** An `X.<name>(...)` call, wherever `X` came from. */
function isNamedCall(node: Node, name: string): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  return Node.isPropertyAccessExpression(expr) && expr.getName() === name;
}

/** The receiver of an `X.make(...)` call, as written. */
function receiverOf(call: CallExpression): string {
  const expr = call.getExpression();
  return Node.isPropertyAccessExpression(expr)
    ? expr.getExpression().getText()
    : '';
}

/**
 * Is `.handle({...})` chained onto this call? It is the signature that
 * separates a real machine from an unrelated `make` — worth reporting even
 * when the receiver is not a recognized `Machine` binding.
 */
function hasHandleChain(call: CallExpression): boolean {
  const parent = call.getParent();
  return (
    !!parent &&
    Node.isPropertyAccessExpression(parent) &&
    parent.getName() === 'handle'
  );
}

const unresolvedBindingReason = (call: CallExpression): string =>
  `\`${receiverOf(call)}\` is not a \`Machine\` imported from @typeonce/effect-machine`;

const UNRESOLVED_BINDING_HINT =
  'import it directly — `import { Machine } from "@typeonce/effect-machine"`; a local re-export cannot be followed';

/** The `states:` value of a `Machine.make(...)` config, if written inline. */
function statesArgument(makeCall: CallExpression): Node | undefined {
  const config = makeCall.getArguments()[0];
  if (!config || !Node.isObjectLiteralExpression(config)) return undefined;
  return config
    .getProperty('states')
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
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
    reason: string,
    hint: string,
    anchor: Node,
  ): void => {
    if (matched.has(name) || reported.has(name)) return;
    reported.add(name);
    rejected.push({
      name,
      kind: 'effect-machine',
      reason,
      hint,
      location: locOf(anchor, filePath),
    });
  };

  const usedStateTrees = new Set<string>();
  /** An unresolved `Machine` binding was already reported for this file. */
  let bindingReported = false;

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isMachineCall(call, 'make')) {
      // A `.make(...).handle(...)` chain the extractor skipped because its
      // receiver is not a `Machine` imported from the package — most often a
      // local barrel that re-exports it. Without this the file goes silent.
      if (!isNamedCall(call, 'make') || !hasHandleChain(call)) continue;
      const chained = ownerOf(call);
      add(
        chained?.name ?? 'Machine.make',
        unresolvedBindingReason(call),
        UNRESOLVED_BINDING_HINT,
        chained?.nameNode ?? call,
      );
      bindingReported = true;
      continue;
    }
    const owner = ownerOf(call);
    const name = owner?.name ?? 'Machine.make';
    const anchor = owner?.nameNode ?? call;

    const states = statesArgument(call);
    if (states) {
      // `MyStates.states` — remember the tree so an unused defineStates is not
      // also reported.
      const root = states.getText().split('.')[0];
      if (root) usedStateTrees.add(root);
    }

    add(
      name,
      states
        ? 'the state tree is not declared in this file, so its states cannot be read'
        : 'the machine config has no `states` property',
      'declare `Machine.defineStates({...})` in this file and pass its `.states`',
      anchor,
    );
  }

  // A state tree that no machine in this file consumes.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isMachineCall(call, 'defineStates')) {
      // A barrel-imported `defineStates`. Same root cause as an unresolved
      // `.make(...)` chain, so only speak when that has not already said it.
      if (bindingReported || !isNamedCall(call, 'defineStates')) continue;
      const unresolved = ownerOf(call);
      if (!unresolved) continue;
      add(
        unresolved.name,
        unresolvedBindingReason(call),
        UNRESOLVED_BINDING_HINT,
        unresolved.nameNode,
      );
      bindingReported = true;
      continue;
    }
    const owner = ownerOf(call);
    if (!owner || usedStateTrees.has(owner.name)) continue;
    add(
      owner.name,
      'states are defined but no Machine.make in this file uses them',
      'pass `states: ' + owner.name + '.states` to Machine.make({...})',
      owner.nameNode,
    );
  }

  return { machines, rejected };
}
