/**
 * HttpApi Structure Extractor
 *
 * Extracts HttpApi, HttpApiGroup, and HttpApiEndpoint structure from @effect/platform
 * source code for API documentation generation.
 */

import {
  SyntaxKind,
  type SourceFile,
  type Node,
  type CallExpression,
  type TemplateLiteral,
  type TaggedTemplateExpression,
  type PropertyAccessExpression,
  type Identifier,
  type VariableDeclaration,
  type ObjectLiteralExpression,
  type PropertyAssignment,
} from 'ts-morph';
import type { SourceLocation } from './types';
import { schemaToJsonSchema, type JsonSchemaObject } from './schema-to-json-schema';

// =============================================================================
// Types
// =============================================================================

export interface HttpApiEndpointInfo {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly location: SourceLocation;
  readonly description?: string;
  readonly summary?: string;
  readonly deprecated?: boolean;
  readonly excluded?: boolean;
  /** Request body schema (from .setPayload) as OpenAPI JSON Schema */
  readonly requestSchema?: JsonSchemaObject;
  /** Success response schema (from .addSuccess) as OpenAPI JSON Schema */
  readonly responseSchema?: JsonSchemaObject;
  /** URL/query params schema (from .setUrlParams) as OpenAPI JSON Schema */
  readonly urlParamsSchema?: JsonSchemaObject;
}

export interface HttpApiGroupInfo {
  readonly name: string;
  readonly endpoints: readonly HttpApiEndpointInfo[];
  readonly description?: string;
  readonly topLevel?: boolean;
  readonly prefix?: string;
}

export interface HttpApiStructure {
  readonly apiId: string;
  readonly filePath: string;
  readonly groups: readonly HttpApiGroupInfo[];
  readonly prefix?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function getLoc(
  filePath: string,
  node: { getStart: () => number },
  sf: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line: line + 1, column, offset };
}

function extractPathFromTemplate(
  template: TemplateLiteral,
): string {
  const rawText = template.getText();
  const withParams = rawText
    .replace(/\$\{HttpApiSchema\.param\s*\(\s*["'](\w+)["'][^}]*\)\}/g, ':$1')
    .replace(/\$\{[^}]*\}/g, ':param');
  const path = withParams.replace(/^`|`$/g, '').trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function extractAnnotations(node: CallExpression, _sf: SourceFile, _filePath: string): {
  description?: string;
  summary?: string;
  deprecated?: boolean;
  excluded?: boolean;
} {
  const result: { description?: string; summary?: string; deprecated?: boolean; excluded?: boolean } = {};
  let current: Node | undefined = node;
  for (let i = 0; i < 30 && current; i++) {
    const parent = current.getParent();
    if (parent?.getKind() !== SyntaxKind.CallExpression) {
      current = parent;
      continue;
    }
    const call = parent as CallExpression;
    const callee = call.getExpression().getText();
    const args = call.getArguments();
    if (args.length < 2) {
      current = parent;
      continue;
    }
    const tagArg = args[0]?.getText();
    const valueArg = args[1]?.getText();
    if (callee.endsWith('.annotate') || callee.endsWith('.annotateContext')) {
      if (tagArg?.includes('OpenApi.Description') || tagArg?.includes('Description')) {
        const v = valueArg?.replace(/^["']|["']$/g, '');
        if (v) result.description = v;
      } else if (tagArg?.includes('OpenApi.Summary') || tagArg?.includes('Summary')) {
        const v = valueArg?.replace(/^["']|["']$/g, '');
        if (v) result.summary = v;
      } else if (tagArg?.includes('OpenApi.Deprecated') || tagArg?.includes('Deprecated')) {
        result.deprecated = valueArg === 'true';
      } else if (tagArg?.includes('OpenApi.Exclude') || tagArg?.includes('Exclude')) {
        result.excluded = valueArg === 'true';
      }
    }
    current = parent;
  }
  return result;
}

function extractEndpointSchemas(
  endpointBase: CallExpression,
  sf: SourceFile,
): { requestSchema?: JsonSchemaObject; responseSchema?: JsonSchemaObject; urlParamsSchema?: JsonSchemaObject } {
  const result: {
    requestSchema?: JsonSchemaObject;
    responseSchema?: JsonSchemaObject;
    urlParamsSchema?: JsonSchemaObject;
  } = {};
  const project = sf.getProject();
  let current: Node | undefined = endpointBase;
  for (let i = 0; i < 40 && current; i++) {
    const parent = current.getParent();
    if (parent?.getKind() !== SyntaxKind.CallExpression) {
      current = parent;
      continue;
    }
    const call = parent as CallExpression;
    const callee = call.getExpression().getText();
    const args = call.getArguments();
    if (args.length < 1) {
      current = parent;
      continue;
    }
    const schemaArg = args[0];
    if (callee.endsWith('.addSuccess') && schemaArg && !result.responseSchema) {
      const json = schemaToJsonSchema(schemaArg, sf, project);
      if (json) result.responseSchema = json;
    } else if (callee.endsWith('.setPayload') && schemaArg && !result.requestSchema) {
      const json = schemaToJsonSchema(schemaArg, sf, project);
      if (json) result.requestSchema = json;
    } else if (
      (callee.endsWith('.setUrlParams') || callee.endsWith('.setQueryParams')) &&
      schemaArg &&
      !result.urlParamsSchema
    ) {
      const json = schemaToJsonSchema(schemaArg, sf, project);
      if (json) result.urlParamsSchema = json;
    }
    current = parent;
  }
  return result;
}

function extractEndpoint(
  node: CallExpression,
  method: string,
  sf: SourceFile,
  filePath: string,
): HttpApiEndpointInfo | null {
  const args = node.getArguments();
  const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'unnamed';
  const name = nameArg ?? 'unnamed';
  let path = '/';
  if (args.length >= 2) {
    path = args[1]?.getText().replace(/["'`]/g, '') ?? '/';
  } else {
    const parent = node.getParent();
    if (parent?.getKind() === SyntaxKind.TaggedTemplateExpression) {
      const template = (parent as TaggedTemplateExpression).getTemplate();
      path = extractPathFromTemplate(template);
    }
  }
  const annotations = extractAnnotations(node, sf, filePath);
  if (annotations.excluded) return null;
  const schemas = extractEndpointSchemas(node, sf);
  return {
    name,
    method: method.toUpperCase(),
    path: path || '/',
    location: getLoc(filePath, node, sf),
    ...(annotations.description ? { description: annotations.description } : {}),
    ...(annotations.summary ? { summary: annotations.summary } : {}),
    ...(annotations.deprecated ? { deprecated: true } : {}),
    ...(schemas.requestSchema ? { requestSchema: schemas.requestSchema } : {}),
    ...(schemas.responseSchema ? { responseSchema: schemas.responseSchema } : {}),
    ...(schemas.urlParamsSchema ? { urlParamsSchema: schemas.urlParamsSchema } : {}),
  };
}

function collectEndpointsFromGroup(groupMakeNode: CallExpression, sf: SourceFile, filePath: string): HttpApiEndpointInfo[] {
  const endpoints: HttpApiEndpointInfo[] = [];
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
  const seen = new Set<string>();

  const addArgs = collectAddArgsFromChain(groupMakeNode);

  function findEndpointBase(call: CallExpression): CallExpression | undefined {
    let current: Node = call;
    const schemaMethods = ['.annotate', '.addSuccess', '.setPayload', '.setUrlParams', '.setQueryParams', '.addFailure'];
    for (let i = 0; i < 15; i++) {
      if (current.getKind() !== SyntaxKind.CallExpression) return undefined;
      const c = current as CallExpression;
      const expr = c.getExpression().getText();
      for (const m of methods) {
        const hasMethod = expr.includes(`HttpApiEndpoint.${m}`) || expr.includes(`HttpApiEndpoint.${m}(`);
        const notChained = !schemaMethods.some((s) => expr.endsWith(s) || expr.includes(s));
        if (hasMethod && !expr.includes('.annotate') && notChained) {
          return c;
        }
      }
      const isChained = schemaMethods.some((s) => expr.endsWith(s) || expr.includes(s));
      if (isChained) {
        const receiver = c.getExpression();
        if (receiver.getKind() === SyntaxKind.CallExpression) {
          current = receiver as CallExpression;
        } else {
          current = (receiver as PropertyAccessExpression).getExpression();
        }
        continue;
      }
      return undefined;
    }
    return undefined;
  }

  function resolveToEndpointOrAdd(n: Node): Node | undefined {
    if (n.getKind() === SyntaxKind.CallExpression) return n;
    if (n.getKind() === SyntaxKind.Identifier) {
      const name = (n as Identifier).getText();
      const symbol = (n as Identifier).getSymbol();
      const decls = symbol?.getDeclarations() ?? symbol?.getAliasedSymbol()?.getDeclarations() ?? [];
      for (const decl of decls) {
        if (decl.getKind() === SyntaxKind.VariableDeclaration) {
          const init = (decl as VariableDeclaration).getInitializer();
          if (init) return init;
        }
      }
      const vars = sf.getVariableDeclarations();
      for (const v of vars) {
        if (v.getName() === name) {
          const init = v.getInitializer();
          if (init) return init;
        }
      }
    }
    return undefined;
  }

  function visit(n: Node) {
    const resolved = resolveToEndpointOrAdd(n);
    if (resolved?.getKind() !== SyntaxKind.CallExpression) return;
    const call = resolved as CallExpression;
    const base = findEndpointBase(call);
    if (base) {
      const expr = base.getExpression().getText();
      for (const m of methods) {
        if (expr.includes(`HttpApiEndpoint.${m}`)) {
          const ep = extractEndpoint(base, m, sf, filePath);
          if (ep && !seen.has(`${ep.method}:${ep.path}:${ep.name}`)) {
            seen.add(`${ep.method}:${ep.path}:${ep.name}`);
            endpoints.push(ep);
          }
          return;
        }
      }
    }
    const expr = call.getExpression().getText();
    if (expr.endsWith('.add')) {
      for (const arg of call.getArguments()) {
        visit(arg);
      }
    }
  }

  for (const arg of addArgs) {
    visit(arg);
  }
  return endpoints;
}

function extractGroupInfo(
  groupCall: CallExpression,
  sf: SourceFile,
  filePath: string,
  groupPrefix?: string,
): HttpApiGroupInfo | null {
  const args = groupCall.getArguments();
  const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'group';
  const name = nameArg ?? 'group';
  const optsArg = args[1];
  let topLevel = false;
  if (optsArg?.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = optsArg as ObjectLiteralExpression;
    const topLevelProp = obj.getProperty('topLevel');
    if (topLevelProp?.getKind() === SyntaxKind.PropertyAssignment) {
      const init = (topLevelProp as PropertyAssignment).getInitializer();
      topLevel = init?.getText() === 'true';
    }
  }
  const endpoints = collectEndpointsFromGroup(groupCall, sf, filePath);
  const annotations = extractAnnotations(groupCall, sf, filePath);
  return {
    name,
    endpoints,
    ...(annotations.description ? { description: annotations.description } : {}),
    ...(topLevel ? { topLevel: true } : {}),
    ...(groupPrefix ? { prefix: groupPrefix } : {}),
  };
}

function extractPrefixFromChain(call: CallExpression): string | undefined {
  let current: Node | undefined = call;
  for (let i = 0; i < 25; i++) {
    if (current.getKind() !== SyntaxKind.CallExpression) break;
    const c = current as CallExpression;
    const expr = c.getExpression().getText();
    if (expr.endsWith('.prefix')) {
      const args = c.getArguments();
      if (args.length >= 1) {
        const path = args[0]?.getText().replace(/["'`]/g, '');
        if (path) return path.startsWith('/') ? path : `/${path}`;
      }
      break;
    }
    const receiver = c.getExpression();
    if (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
      current = (receiver as PropertyAccessExpression).getExpression();
    } else {
      break;
    }
  }
  return undefined;
}

/** Find the topmost .add() in the chain that contains the make, then collect all add args. */
function collectAddArgsFromChain(makeNode: CallExpression): Node[] {
  const args: Node[] = [];
  let topAdd: CallExpression | undefined;
  let current: Node = makeNode;
  const makeExpr = makeNode.getExpression().getText();
  const isApiMake = makeExpr.includes('HttpApi.make');
  const isGroupMake = makeExpr.includes('HttpApiGroup.make');
  for (let i = 0; i < 20; i++) {
    let parent: Node | undefined = current.getParent();
    if (!parent) break;
    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      parent = parent.getParent();
    }
    if (parent?.getKind() !== SyntaxKind.CallExpression) break;
    const call = parent as CallExpression;
    const callee = call.getExpression().getText();
    if (callee.endsWith('.add')) {
      if (isApiMake && callee.includes('HttpApiGroup.make')) break;
      if (isGroupMake && callee.includes('HttpApi.make') && !callee.includes('HttpApiGroup')) break;
      topAdd = call;
      current = parent;
      continue;
    }
    break;
  }
  if (!topAdd) return args;
  current = topAdd;
  for (let i = 0; i < 50; i++) {
    if (current.getKind() === SyntaxKind.CallExpression) {
      const call = current as CallExpression;
      const callee = call.getExpression().getText();
      if (callee.endsWith('.add')) {
        for (const arg of call.getArguments()) {
          args.push(arg);
        }
        const receiver = call.getExpression();
        if (receiver.getKind() === SyntaxKind.CallExpression) {
          current = receiver as CallExpression;
          continue;
        }
        if (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
          const inner = (receiver as PropertyAccessExpression).getExpression();
          if (inner.getKind() === SyntaxKind.CallExpression) {
            current = inner as CallExpression;
            continue;
          }
        }
      }
    }
    break;
  }
  return args;
}

function collectGroupsFromApiRoot(
  makeNode: CallExpression,
  sf: SourceFile,
  filePath: string,
): HttpApiGroupInfo[] {
  const groups: HttpApiGroupInfo[] = [];
  const seen = new Set<string>();

  const addArgs = collectAddArgsFromChain(makeNode);

  const chainMethods = ['.add', '.prefix', '.annotate'];
  function getMakeFromAddChain(call: CallExpression): CallExpression | undefined {
    let current: Node = call;
    for (let i = 0; i < 20; i++) {
      if (current.getKind() !== SyntaxKind.CallExpression) return undefined;
      const c = current as CallExpression;
      const expr = c.getExpression().getText();
      if (expr.includes('HttpApiGroup.make') && !chainMethods.some((m) => expr.endsWith(m))) return c;
      if (expr.includes('HttpApi.make') && !chainMethods.some((m) => expr.endsWith(m))) return c;
      if (chainMethods.some((m) => expr.endsWith(m))) {
        const receiver = c.getExpression();
        if (receiver.getKind() === SyntaxKind.CallExpression) {
          current = receiver as CallExpression;
          continue;
        }
        if (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
          const inner = (receiver as PropertyAccessExpression).getExpression();
          if (inner.getKind() === SyntaxKind.CallExpression) {
            current = inner as CallExpression;
            continue;
          }
        }
        return undefined;
      }
      return undefined;
    }
    return undefined;
  }

  function resolveToGroupOrApi(arg: Node): CallExpression | undefined {
    if (arg.getKind() === SyntaxKind.CallExpression) return arg as CallExpression;
    if (arg.getKind() === SyntaxKind.Identifier) {
      const name = (arg as Identifier).getText();
      const symbol = (arg as Identifier).getSymbol();
      const decls = symbol?.getDeclarations() ?? symbol?.getAliasedSymbol()?.getDeclarations() ?? [];
      for (const decl of decls) {
        if (decl.getKind() === SyntaxKind.VariableDeclaration) {
          const init = (decl as VariableDeclaration).getInitializer();
          if (init?.getKind() === SyntaxKind.CallExpression) return init as CallExpression;
        }
      }
      const vars = sf.getVariableDeclarations();
      for (const v of vars) {
        if (v.getName() === name) {
          const init = v.getInitializer();
          if (init?.getKind() === SyntaxKind.CallExpression) return init as CallExpression;
        }
      }
    }
    return undefined;
  }

  function processArg(arg: Node) {
    const call = resolveToGroupOrApi(arg);
    if (!call) return;
    const expr = call.getExpression().getText();
    if (expr.includes('HttpApiGroup.make')) {
      const makeNode = getMakeFromAddChain(call);
      if (makeNode) {
        const groupPrefix = extractPrefixFromChain(call);
        const group = extractGroupInfo(makeNode, sf, filePath, groupPrefix);
        if (group && !seen.has(group.name)) {
          seen.add(group.name);
          groups.push(group);
        }
      }
      return;
    }
    if (expr.includes('HttpApi.make')) {
      const makeNode = getMakeFromAddChain(call);
      if (makeNode) {
        for (const a of collectAddArgsFromChain(makeNode)) {
          processArg(a);
        }
      }
    }
  }

  for (const arg of addArgs) {
    processArg(arg);
  }
  return groups;
}

function findApiRootFromMake(makeNode: CallExpression): CallExpression {
  let current: Node | undefined = makeNode;
  for (let i = 0; i < 50; i++) {
    const parent = current.getParent();
    if (parent?.getKind() !== SyntaxKind.CallExpression) return makeNode;
    const call = parent as CallExpression;
    const callee = call.getExpression().getText();
    if (callee.endsWith('.add')) {
      const receiver = call.getExpression();
      if (receiver.getKind() === SyntaxKind.CallExpression) {
        const recCall = receiver as CallExpression;
        const recExpr = recCall.getExpression().getText();
        if (recExpr.includes('HttpApi.make')) {
          current = recCall;
          continue;
        }
      }
    }
    break;
  }
  return current as CallExpression;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Extract HttpApi structure from a source file.
 * Returns all HttpApi.make(...) declarations with their groups and endpoints.
 */
export function extractHttpApiStructure(
  sourceFile: SourceFile,
  filePath: string,
): HttpApiStructure[] {
  const results: HttpApiStructure[] = [];
  const filePathResolved = filePath || sourceFile.getFilePath();
  const seenApiIds = new Set<string>();

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    if (!expr.includes('HttpApi.make') || expr.includes('HttpApiBuilder')) continue;
    if (expr.includes('.add')) continue;
    const args = (node).getArguments();
    const apiId = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : undefined;
    if (!apiId) continue;
    if (seenApiIds.has(apiId)) continue;
    const root = findApiRootFromMake(node);
    const groups = collectGroupsFromApiRoot(root, sourceFile, filePathResolved);
    seenApiIds.add(apiId);
    results.push({ apiId, filePath: filePathResolved, groups });
  }

  return results;
}
