/**
 * Platform Integration Detection (GAP 14)
 *
 * Detects which Effect platform modules are in use (HTTP, FileSystem, etc.).
 */

import { Project, SyntaxKind, type Node, type CallExpression, type TaggedTemplateExpression } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface PlatformUsageAnalysis {
  readonly platforms: ('node' | 'bun' | 'browser')[];
  readonly modules: {
    readonly http: {
      client: boolean;
      server: boolean;
      routes: string[];
      api: boolean;
      apiBuilder: boolean;
      endpoint: boolean;
      security: boolean;
      middleware: boolean;
    };
    readonly filesystem: { reads: string[]; writes: string[] };
    readonly sockets: boolean;
    readonly terminal: boolean;
    readonly workers: boolean;
    readonly commands: string[];
    readonly keyValueStore: boolean;
    readonly multipart: boolean;
    readonly codecs: string[];
    readonly openApi: boolean;
  };
  readonly locations: Map<string, SourceLocation>;
  readonly fileSystemOps?: { op: string; location: SourceLocation }[];
  readonly commandOps?: { op: string; location: SourceLocation }[];
  readonly routeDefinitions?: {
    readonly method: string;
    readonly name: string;
    readonly path: string;
    readonly location: SourceLocation;
    readonly apiId?: string;
    readonly groupName?: string;
  }[];
  readonly middlewareChain?: { name: string; location: SourceLocation }[];
  readonly cliCommands?: { name: string; hasSchema: boolean; location: SourceLocation }[];
}

function getLoc(
  filePath: string,
  node: { getStart: () => number },
  sf: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { filePath, line: line + 1, column };
}

/** Extract path from template literal; use :param for ${HttpApiSchema.param("x", s)} or ${x} */
function extractPathFromTemplate(
  template: import('ts-morph').TemplateLiteral,
): string {
  const rawText = template.getText();
  const withParams = rawText.replace(
    /\$\{HttpApiSchema\.param\s*\(\s*["'](\w+)["'][^}]*\)\}/g,
    ':$1',
  ).replace(/\$\{[^}]*\}/g, ':param');
  const path = withParams.replace(/^`|`$/g, '').trim();
  return path.startsWith('/') ? path : `/${path}`;
}

/** Walk up .add() chain to find HttpApi.make(id) and HttpApiGroup.make(name) */
function walkAddChainForApiContext(
  node: Node,
): { apiId?: string; groupName?: string } {
  let apiId: string | undefined;
  let groupName: string | undefined;
  let current: Node = node;
  for (let i = 0; i < 20; i++) {
    const parent = current.getParent();
    if (!parent) break;
    if (parent.getKind() === SyntaxKind.CallExpression) {
      const call = parent as CallExpression;
      const callee = call.getExpression().getText();
      if (callee.endsWith('.add')) {
        const args = call.getArguments();
        if (args.length > 0) {
          const receiver = callee.slice(0, -4);
          const makeMatch = /HttpApi\.make\s*\(\s*["']([^"']+)["']/.exec(receiver);
          if (makeMatch) apiId = makeMatch[1];
          const groupMatch = /HttpApiGroup\.make\s*\(\s*["']([^"']+)["']/.exec(receiver);
          if (groupMatch) groupName = groupMatch[1];
        }
      }
    }
    current = parent;
  }
  const result: { apiId?: string; groupName?: string } = {};
  if (apiId !== undefined) result.apiId = apiId;
  if (groupName !== undefined) result.groupName = groupName;
  return result;
}

/**
 * Analyze a file for Effect platform usage.
 */
export function analyzePlatformUsage(
  filePath: string,
  source?: string,
): PlatformUsageAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  const http = {
    client: false,
    server: false,
    routes: [] as string[],
    api: false,
    apiBuilder: false,
    endpoint: false,
    security: false,
    middleware: false,
  };
  const filesystem = { reads: [] as string[], writes: [] as string[] };
  let sockets = false;
  let terminal = false;
  let workers = false;
  const commands: string[] = [];
  let keyValueStore = false;
  let multipart = false;
  const codecs: string[] = [];
  let openApi = false;
  const platforms: ('node' | 'bun' | 'browser')[] = [];
  const fileSystemOps: { op: string; location: SourceLocation }[] = [];
  const commandOps: { op: string; location: SourceLocation }[] = [];
  const routeDefinitions: {
    method: string;
    name: string;
    path: string;
    location: SourceLocation;
    apiId?: string;
    groupName?: string;
  }[] = [];
  const middlewareChain: { name: string; location: SourceLocation }[] = [];
  const cliCommands: { name: string; hasSchema: boolean; location: SourceLocation }[] = [];

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    if (
      expr.includes('HttpClient') ||
      expr.includes('HttpServer') ||
      expr.includes('HttpRouter') ||
      expr.includes('HttpApi') ||
      expr.includes('HttpApiBuilder') ||
      expr.includes('HttpApiEndpoint') ||
      expr.includes('HttpApiGroup') ||
      expr.includes('HttpApiSecurity') ||
      expr.includes('HttpApiClient')
    ) {
      if (expr.includes('HttpClient') || expr.includes('HttpApiClient')) http.client = true;
      http.server = http.server || expr.includes('HttpServer') || expr.includes('HttpRouter');
      http.api = http.api || (expr.includes('HttpApi') && !expr.includes('HttpApiBuilder') && !expr.includes('HttpApiEndpoint') && !expr.includes('HttpApiGroup') && !expr.includes('HttpApiSecurity') && !expr.includes('HttpApiClient'));
      http.apiBuilder = http.apiBuilder || expr.includes('HttpApiBuilder');
      http.endpoint = http.endpoint || expr.includes('HttpApiEndpoint') || expr.includes('HttpApiGroup');
      http.security = http.security || expr.includes('HttpApiSecurity');
      http.middleware = http.middleware || expr.includes('middleware') || expr.includes('Middleware');
      if (expr.includes('route') || expr.includes('.get') || expr.includes('.post') || expr.includes('.put') || expr.includes('.delete') || expr.includes('.patch')) {
        http.routes.push(expr);
      }
      locations.set('http', getLoc(filePath, node, sf));
    }
    if (expr.includes('FileSystem')) {
      if (expr.includes('read')) filesystem.reads.push(expr);
      if (expr.includes('write')) filesystem.writes.push(expr);
      locations.set('filesystem', getLoc(filePath, node, sf));
      const fsOps: Record<string, string> = { readFile: 'read', readFileString: 'read', writeFile: 'write', writeFileString: 'write', remove: 'delete', mkdir: 'mkdir', stat: 'stat', copy: 'copy', rename: 'rename', readDirectory: 'readDir' };
      for (const [method, op] of Object.entries(fsOps)) {
        if (expr.includes(method)) { fileSystemOps.push({ op, location: getLoc(filePath, node, sf) }); break; }
      }
    }
    if (expr.includes('Socket') || expr.includes('fromNetServer')) sockets = true;
    if (expr.includes('Terminal')) terminal = true;
    if (expr.includes('Worker')) workers = true;
    if (expr.includes('Command.')) {
      commands.push(expr);
      const cmdOps: Record<string, string> = { make: 'make', start: 'start', stdin: 'stdin', stdout: 'stdout', stderr: 'stderr', exitCode: 'exitCode' };
      for (const [method, op] of Object.entries(cmdOps)) {
        if (expr.includes(method)) { commandOps.push({ op, location: getLoc(filePath, node, sf) }); break; }
      }
    }
    if (expr.includes('KeyValueStore')) keyValueStore = true;
    if (expr.includes('Multipart')) multipart = true;
    if (
      expr.includes('Ndjson') ||
      expr.includes('MsgPack') ||
      expr.includes('Effectify')
    ) {
      codecs.push(expr);
    }
    if (expr.includes('OpenApi') || expr.includes('OpenApiJsonSchema')) {
      openApi = true;
    }
    // Route definitions from HttpApiEndpoint
    if (expr.includes('HttpApiEndpoint')) {
      const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
      for (const m of methods) {
        if (expr.includes(`.${m}`)) {
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
          const ctx = walkAddChainForApiContext(node);
          routeDefinitions.push({
            method: m.toUpperCase(),
            name,
            path: path || '/',
            location: getLoc(filePath, node, sf),
            ...(ctx.apiId !== undefined ? { apiId: ctx.apiId } : {}),
            ...(ctx.groupName !== undefined ? { groupName: ctx.groupName } : {}),
          });
          break;
        }
      }
    }
    // Middleware detection
    if (expr.includes('middleware') || expr.includes('Middleware')) {
      const mwName = expr.replace(/.*\./, '').replace(/\(.*/, '');
      if (mwName) middlewareChain.push({ name: mwName, location: getLoc(filePath, node, sf) });
    }
    // CLI commands
    if (expr.includes('Command.make') || expr.includes('Prompt.')) {
      const args = node.getArguments();
      const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'unnamed';
      const hasSchema = args.some(a => a.getText().includes('Schema'));
      cliCommands.push({ name: nameArg ?? 'unnamed', hasSchema, location: getLoc(filePath, node, sf) });
    }
  }

  if (
    http.client ||
    http.server ||
    http.api ||
    filesystem.reads.length > 0 ||
    filesystem.writes.length > 0
  ) {
    if (!platforms.includes('node')) platforms.push('node');
  }
  if (workers || multipart) {
    if (!platforms.includes('browser')) platforms.push('browser');
  }

  return {
    platforms,
    modules: {
      http: { ...http, routes: [...new Set(http.routes)] },
      filesystem: { reads: [...new Set(filesystem.reads)], writes: [...new Set(filesystem.writes)] },
      sockets,
      terminal,
      workers,
      commands: [...new Set(commands)],
      keyValueStore,
      multipart,
      codecs: [...new Set(codecs)],
      openApi,
    },
    locations,
    ...(fileSystemOps.length > 0 ? { fileSystemOps } : {}),
    ...(commandOps.length > 0 ? { commandOps } : {}),
    ...(routeDefinitions.length > 0 ? { routeDefinitions } : {}),
    ...(middlewareChain.length > 0 ? { middlewareChain } : {}),
    ...(cliCommands.length > 0 ? { cliCommands } : {}),
  };
}
