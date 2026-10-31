/**
 * XState v6 / `@xstate/effect` machine extraction.
 *
 * Recognizes, when imported from `xstate` or `@xstate/effect`:
 *   createMachine({...})
 *   setup({...}).createMachine({...})
 *   setupEffect({...}).createMachine({...})
 *
 * The config literal is already MachineJSON-shaped, so this module only turns
 * the AST into plain data and hands it to {@link fromMachineJSON}. XState v6
 * transition functions (`onDone: ({ event }) => ({ target: 'done', ... })`)
 * are read for the `target` of every returned object, guarded by the `if` /
 * ternary conditions that lead to it.
 */

import { type CallExpression, Node, type ObjectLiteralExpression, SyntaxKind } from "ts-morph"
import type { StateMachine } from "./state-machine"
import { locOf, type SourceFile, stringValue, unwrap } from "./state-machine-ast"
import { fromMachineJSON, type MachineJSON } from "./state-machine-json"

const MODULES = new Set(["xstate", "@xstate/effect"])

/** Local name of `exported` when it is imported from xstate / @xstate/effect. */
function isXStateImport(name: string, exported: string, sf: SourceFile): boolean {
  return sf.getImportDeclarations().some((declaration) =>
    MODULES.has(declaration.getModuleSpecifierValue()) &&
    declaration.getNamedImports().some((ni) =>
      ni.getName() === exported && (ni.getAliasNode()?.getText() ?? exported) === name
    )
  )
}

function isCreateMachineCall(call: CallExpression, sf: SourceFile): boolean {
  const callee = call.getExpression()
  if (Node.isIdentifier(callee)) return isXStateImport(callee.getText(), "createMachine", sf)
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "createMachine") return false
  const setupCall = unwrap(callee.getExpression())
  if (!Node.isCallExpression(setupCall)) return false
  const setupFn = setupCall.getExpression()
  return Node.isIdentifier(setupFn) &&
    (isXStateImport(setupFn.getText(), "setup", sf) ||
      isXStateImport(setupFn.getText(), "setupEffect", sf))
}

const marker = (kind: "function" | "actor" | "value", id?: string) => ({
  $unserializable: kind,
  ...(id !== undefined ? { id } : {})
})

/** Keys whose values are actions: a bare string is shorthand for `{ type }`. */
const ACTION_KEYS = new Set(["entry", "exit", "actions"])
/** Root keys that only a state node (not the machine wrapper) carries. */
const ROOT_BEHAVIOUR = ["on", "always", "after", "invoke", "entry", "exit"] as const

/** Roles whose function values are XState v6 transition functions. */
const TRANSITION_ROLES = new Set(["transition", "always", "onDone", "onError"])

/**
 * Targets returned by an XState v6 transition function, each with the guard
 * of the branch it sits in: the enclosing `if` / ternary conditions, outer
 * first, plus `!(x)` for every earlier `if (x) return ...` it falls through,
 * joined with `&&`. A returned object without `target` is a targetless (self)
 * branch. No returned object at all → one targetless entry.
 */
function transitionFunction(fn: Node): unknown {
  const branches: Array<{ target?: string | Array<string>; guard?: { "@expr": string } }> = []
  // Each operand is self-contained: `a || b` inside `c` joins as `(a || b) && c`.
  const and = (outer: string | undefined, cond: string): string => outer === undefined ? cond : `${outer} && ${cond}`
  const atom = (cond: Node): string => {
    const text = cond.getText()
    return Node.isIdentifier(cond) || Node.isPropertyAccessExpression(cond) || Node.isElementAccessExpression(cond) ||
        Node.isCallExpression(cond) || Node.isParenthesizedExpression(cond) || Node.isPrefixUnaryExpression(cond) ||
        Node.isLiteralExpression(cond) || Node.isTrueLiteral(cond) || Node.isFalseLiteral(cond)
      ? text
      : `(${text})`
  }
  const visit = (expr: Node | undefined, guard: string | undefined): void => {
    if (!expr) return
    const u = unwrap(expr)
    if (Node.isConditionalExpression(u)) {
      const cond = u.getCondition()
      visit(u.getWhenTrue(), and(guard, atom(cond)))
      visit(u.getWhenFalse(), and(guard, `!(${cond.getText()})`))
      return
    }
    if (!Node.isObjectLiteralExpression(u)) return
    // `target` is a string or, for parallel targets, an array of strings.
    const raw = propertyValue(u, "target")
    const rawU = raw === undefined ? undefined : unwrap(raw)
    const target = rawU !== undefined && Node.isArrayLiteralExpression(rawU)
      ? rawU.getElements().map(stringValue).filter((t): t is string => t !== undefined)
      : stringValue(raw)
    branches.push({
      ...(target !== undefined && target.length > 0 ? { target } : {}),
      ...(guard !== undefined ? { guard: { "@expr": guard } } : {})
    })
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return marker("function")
  const body = fn.getBody()
  if (!Node.isBlock(body)) {
    visit(body, undefined)
  } else {
    for (const ret of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (ret.getFirstAncestor((a) => Node.isFunctionLikeDeclaration(a)) !== fn) continue
      let guard: string | undefined
      // Walk from the function body down to the return: at each level, earlier
      // `if (x) return ...` siblings contribute `!(x)`, then the enclosing `if`
      // contributes its condition (negated in the `else`).
      const path = [
        ...ret.getAncestors().filter((a) => a.getFirstAncestor((b) => b === fn) !== undefined).reverse(),
        ret
      ]
      for (const [i, node] of path.entries()) {
        if (Node.isBlock(node)) {
          const next = path[i + 1]
          for (const stmt of node.getStatements()) {
            if (stmt === next) break
            if (
              Node.isIfStatement(stmt) && stmt.getElseStatement() === undefined &&
              alwaysReturns(stmt.getThenStatement())
            ) {
              guard = and(guard, `!(${stmt.getExpression().getText()})`)
            }
          }
        } else if (Node.isIfStatement(node)) {
          const cond = node.getExpression()
          const inElse = node.getElseStatement()?.containsRange(ret.getPos(), ret.getEnd()) ?? false
          guard = and(guard, inElse ? `!(${cond.getText()})` : atom(cond))
        }
      }
      visit(ret.getExpression(), guard)
    }
  }
  return branches.length > 0 ? branches : {}
}

/** A statement that ends in `return` on every path through it. */
function alwaysReturns(stmt: Node): boolean {
  if (Node.isReturnStatement(stmt)) return true
  if (Node.isBlock(stmt)) {
    const last = stmt.getStatements().at(-1)
    return last !== undefined && alwaysReturns(last)
  }
  if (Node.isIfStatement(stmt)) {
    const otherwise = stmt.getElseStatement()
    return otherwise !== undefined && alwaysReturns(stmt.getThenStatement()) && alwaysReturns(otherwise)
  }
  return false
}

function propertyName(prop: Node): string | undefined {
  if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop) || Node.isMethodDeclaration(prop)) {
    const nameNode = prop.getNameNode()
    if (Node.isStringLiteral(nameNode) || Node.isNumericLiteral(nameNode)) return nameNode.getLiteralText()
    return Node.isComputedPropertyName(nameNode) ? undefined : nameNode.getText()
  }
  return undefined
}

function propertyValue(obj: ObjectLiteralExpression, name: string): Node | undefined {
  for (const prop of obj.getProperties()) {
    if (propertyName(prop) !== name) continue
    if (Node.isPropertyAssignment(prop)) return prop.getInitializer()
    if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode()
    return prop
  }
  return undefined
}

/** Most AST nodes one machine's config may expand to (shared `const`s included). */
const NODE_BUDGET = 20_000

class BudgetExceeded extends Error {}

/**
 * AST → plain data in MachineJSON terms. `key` is the property holding `node`.
 * `budget` caps the total expansion, so `const`s that reference each other
 * many times cannot grow the result exponentially.
 */
function toData(
  node: Node | undefined,
  sf: SourceFile,
  key: string | undefined,
  budget: { left: number },
  depth = 0
): unknown {
  if (!node || depth > 32) return undefined
  if (--budget.left < 0) throw new BudgetExceeded()
  const u = unwrap(node)
  const literal = stringValue(u)
  if (literal !== undefined) return key !== undefined && ACTION_KEYS.has(key) ? { type: literal } : literal
  if (Node.isNumericLiteral(u)) return u.getLiteralValue()
  if (Node.isArrowFunction(u) || Node.isFunctionExpression(u) || Node.isMethodDeclaration(u)) {
    return key !== undefined && TRANSITION_ROLES.has(key)
      ? transitionFunction(u)
      : marker("function")
  }
  if (Node.isArrayLiteralExpression(u)) {
    return u.getElements().map((e) => toData(e, sf, key, budget, depth + 1))
  }
  if (Node.isObjectLiteralExpression(u)) {
    const out: Record<string, unknown> = {}
    for (const prop of u.getProperties()) {
      const name = propertyName(prop)
      if (name === undefined) continue
      // Event / delay / state names are keys of `on` / `after` / `states`; their
      // values take the parent's role so functions are read as transitions.
      const role = key === "on" || key === "after" ? "transition" : name
      let value = toData(
        Node.isPropertyAssignment(prop)
          ? prop.getInitializer()
          : Node.isShorthandPropertyAssignment(prop)
          ? prop.getNameNode()
          : prop,
        sf,
        role,
        budget,
        depth + 1
      )
      if (ACTION_KEYS.has(name) && value !== undefined && !Array.isArray(value)) value = [value]
      if (name === "guard" && typeof value === "string") value = { type: value }
      out[name] = value
    }
    return out
  }
  if (Node.isIdentifier(u)) {
    const init = sf.getVariableDeclaration(u.getText())?.getInitializer()
    if (init && Node.isObjectLiteralExpression(unwrap(init))) return toData(init, sf, key, budget, depth + 1)
    return marker(key === "src" ? "actor" : "value", u.getText())
  }
  return marker(key === "src" ? "actor" : "value", u.getText())
}

function nameOf(call: CallExpression): string | undefined {
  const decl = call.getFirstAncestor((a) => Node.isVariableDeclaration(a))
  return decl && Node.isVariableDeclaration(decl) ? decl.getName() : undefined
}

export function xstateMachinesIn(sf: SourceFile, filePath: string): Array<StateMachine> {
  const machines: Array<StateMachine> = []
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isCreateMachineCall(call, sf)) continue
    try {
      const config = toData(call.getArguments()[0], sf, undefined, { left: NODE_BUDGET })
      if (typeof config !== "object" || config === null || Array.isArray(config)) continue
      const root = config as Record<string, unknown>
      const name = nameOf(call) ?? (typeof root.id === "string" ? root.id : "machine")
      // fromMachineJSON reads child states. A root without `initial` (parallel or
      // atomic), or with its own handlers (`on`, `after`, ...), becomes a state
      // named after the machine; `.child` targets resolve against it.
      const json = (root.initial === undefined || ROOT_BEHAVIOUR.some((k) => root[k] !== undefined)
        ? { id: root.id, schemas: root.schemas, initial: name, states: { [name]: root } }
        : root) as unknown as MachineJSON
      machines.push({
        ...fromMachineJSON(json, { name }),
        source: "xstate",
        location: locOf(call, filePath)
      })
    } catch {
      // Configs assembled at runtime (spreads, computed keys, imported state
      // trees) or past NODE_BUDGET are left to the MachineJSON API.
    }
  }
  return machines
}
