/**
 * LSP Server (GAP 23)
 *
 * Language Server Protocol server for Effect analysis.
 * Launch with --stdio (e.g. VS Code runs: node dist/lsp/server.js --stdio)
 *
 * Requires: vscode-languageserver, vscode-languageserver-textdocument
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let createConnection: (typeof import('vscode-languageserver/node'))['createConnection'];
let TextDocuments: (typeof import('vscode-languageserver'))['TextDocuments'];
let TextDocument: (typeof import('vscode-languageserver-textdocument'))['TextDocument'];

try {
  const lsp = require('vscode-languageserver/node');
  createConnection = lsp.createConnection;
  TextDocuments = lsp.TextDocuments;
  TextDocument = require('vscode-languageserver-textdocument').TextDocument;
} catch {
  console.error(
    'LSP server requires vscode-languageserver and vscode-languageserver-textdocument.\nInstall with: pnpm add vscode-languageserver vscode-languageserver-textdocument',
  );
  process.exit(1);
}

import { Effect } from 'effect';
import { analyzeEffectSource } from '../static-analyzer';
import { lintEffectProgram } from '../effect-linter';
import { calculateComplexity } from '../complexity';
import { buildLayerDependencyGraph } from '../layer-graph';
import { getStaticChildren } from '../types';
import { Option } from 'effect';
import type { StaticEffectIR, StaticFlowNode, StaticLayerNode } from '../types';
import type {
  CodeAction,
  CodeActionParams,
  CodeLens,
  CompletionItemKind,
  CompletionParams,
  DefinitionParams,
  DiagnosticSeverity,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DocumentHighlight,
  DocumentHighlightKind,
  DocumentHighlightParams,
  DocumentLink,
  DocumentLinkParams,
  DocumentSymbol,
  DocumentSymbolParams,
  FoldingRangeParams,
  HoverParams,
  ImplementationParams,
  InlayHint,
  InlayHintKind,
  InlayHintParams,
  Location,
  Position,
  PrepareRenameParams,
  Range,
  ReferenceParams,
  RenameParams,
  SelectionRange,
  SelectionRangeParams,
  SignatureHelpParams,
  SymbolInformation,
  SymbolKind,
  WorkspaceSymbolParams,
} from 'vscode-languageserver';
import type { TextDocument as _LspTextDocument } from 'vscode-languageserver-textdocument';

type ConnectionLike = ReturnType<(typeof import('vscode-languageserver/node'))['createConnection']> & {
  onDidChangeContent: (handler: (params: DidChangeTextDocumentParams) => void) => void;
  onDidClose: (handler: (params: DidCloseTextDocumentParams) => void) => void;
  onInlayHint: (handler: (params: InlayHintParams) => Promise<InlayHint[]>) => void;
  onSelectionRange: (handler: (params: SelectionRangeParams) => Promise<SelectionRange[]>) => void;
  onDocumentLink: (handler: (params: DocumentLinkParams) => Promise<DocumentLink[]>) => void;
};

const connection = createConnection() as ConnectionLike;
const documents = new TextDocuments(TextDocument);
const SYMBOL_KIND_FUNCTION: SymbolKind = 12;
const SYMBOL_KIND_VARIABLE: SymbolKind = 6;
const HIGHLIGHT_KIND_READ: DocumentHighlightKind = 2;
const INLAY_KIND_TYPE: InlayHintKind = 2;
const COMPLETION_KIND_METHOD: CompletionItemKind = 2;
const DIAGNOSTIC_ERROR: DiagnosticSeverity = 1;
const DIAGNOSTIC_WARNING: DiagnosticSeverity = 2;
const DIAGNOSTIC_INFO: DiagnosticSeverity = 3;

const toPosition = (line: number, character: number): Position => ({ line, character });

const toRange = (
  line: number,
  column: number,
  endLine?: number,
  endColumn?: number,
): Range => ({
  start: toPosition(line - 1, column),
  end: toPosition((endLine ?? line) - 1, (endColumn ?? column) + 1),
});

const toPointRange = (line: number, column: number, width = 1): Range => ({
  start: toPosition(line - 1, column),
  end: toPosition(line - 1, column + width),
});

/** In-memory cache: uri -> { version, programs } for incremental reuse */
const irCache = new Map<
  string,
  { version: number; programs: readonly StaticEffectIR[] }
>();

async function getPrograms(
  uri: string,
  text: string,
  version: number | undefined,
): Promise<readonly StaticEffectIR[]> {
  const cached = version !== undefined ? irCache.get(uri) : undefined;
  if (cached && cached.version === version) return cached.programs;
  const programs = await Effect.runPromise(
    analyzeEffectSource(text, uri).pipe(
      Effect.catchAll(() => Effect.succeed([] as StaticEffectIR[])),
    ),
  );
  if (version !== undefined) irCache.set(uri, { version, programs });
  return programs;
}

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: 2,
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    documentHighlightProvider: true,
    documentSymbolProvider: true,
    renameProvider: { prepareProvider: true },
    foldingRangeProvider: true,
    inlayHintProvider: true,
    selectionRangeProvider: true,
    codeActionProvider: true,
    completionProvider: { triggerCharacters: ['.', 'E', 'L', 'C', 'S', 'M', 'O', 'D'] },
    signatureHelpProvider: {
      triggerCharacters: ['(', ','],
      retriggerCharacters: [','],
    },
    codeLensProvider: { resolveProvider: true },
    implementationProvider: true,
    documentLinkProvider: { resolveProvider: false },
    workspaceSymbolProvider: true,
  },
}));

connection.onDidChangeContent((params: DidChangeTextDocumentParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (doc) void publishDiagnostics(doc);
});

connection.onDidClose((params: DidCloseTextDocumentParams) => {
  irCache.delete(params.textDocument.uri);
});

function findNodeAtPosition(
  nodes: readonly StaticFlowNode[],
  line: number,
  col: number,
): StaticFlowNode | undefined {
  let best: StaticFlowNode | undefined;
  for (const node of nodes) {
    const loc = node.location;
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    const child = findNodeAtPosition(children, line, col);
    if (child) {
      best = child;
    } else if (loc?.line === line && loc.column <= col) {
      if (!best || (loc.column >= (best.location?.column ?? 0))) best = node;
    }
  }
  return best;
}

function findNodeById(
  nodes: readonly StaticFlowNode[],
  id: string,
): StaticFlowNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    const found = findNodeById(children, id);
    if (found) return found;
  }
  return undefined;
}

connection.onDefinition(async (params: DefinitionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  const uri = params.textDocument.uri;
  const locations: Location[] = [];
  for (const ir of programs) {
    const node = findNodeAtPosition(ir.root.children, line, col);
    if (node?.type === 'effect') {
      const eff = node;
      const reqs = eff.requiredServices ?? [];
      if (reqs.length > 0) {
        const graph = buildLayerDependencyGraph(ir);
        for (const r of reqs) {
          const layerIds = graph.serviceToLayers.get(r.serviceId) ?? [];
          for (const layerId of layerIds) {
            const layerNode = findNodeById(ir.root.children, layerId);
            const loc = layerNode?.location ?? (layerNode as StaticLayerNode | undefined)?.location;
            if (loc) {
              locations.push({ uri, range: toRange(loc.line, loc.column) });
            }
          }
        }
      }
    }
  }
  return locations.length > 0 ? locations : null;
});

connection.onImplementation(async (params: ImplementationParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  const uri = params.textDocument.uri;
  const locations: Location[] = [];
  for (const ir of programs) {
    const node = findNodeAtPosition(ir.root.children, line, col);
    if (node?.type === 'effect') {
      const eff = node;
      const reqs = eff.requiredServices ?? [];
      const graph = buildLayerDependencyGraph(ir);
      for (const r of reqs) {
        const layerIds = graph.serviceToLayers.get(r.serviceId) ?? [];
        for (const layerId of layerIds) {
          const layerNode = findNodeById(ir.root.children, layerId);
          const loc = layerNode?.location ?? (layerNode as StaticLayerNode | undefined)?.location;
          if (loc) {
            locations.push({
              uri,
              range: toRange(loc.line, loc.column, loc.endLine, loc.endColumn),
            });
          }
        }
      }
    }
  }
  return locations;
});

function collectServiceUsages(
  nodes: readonly StaticFlowNode[],
  serviceId: string,
  result: { line: number; column: number }[],
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      const eff = node;
      const reqs = eff.requiredServices ?? [];
      for (const r of reqs) {
        if (r.serviceId === serviceId && node.location) {
          result.push({ line: node.location.line, column: node.location.column });
        }
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    collectServiceUsages(children, serviceId, result);
  }
}

function collectLayerReferences(
  nodes: readonly StaticFlowNode[],
  layerId: string,
  result: { line: number; column: number }[],
): void {
  for (const node of nodes) {
    if (node.type === 'layer' && node.id === layerId && node.location) {
      result.push({ line: node.location.line, column: node.location.column });
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    collectLayerReferences(children, layerId, result);
  }
}

connection.onReferences(async (params: ReferenceParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  const uri = params.textDocument.uri;
  const locations: Location[] = [];

  for (const ir of programs) {
    const node = findNodeAtPosition(ir.root.children, line, col);
    if (node?.type === 'effect') {
      const eff = node;
      for (const r of eff.requiredServices ?? []) {
        const usages: { line: number; column: number }[] = [];
        collectServiceUsages(ir.root.children, r.serviceId, usages);
        for (const u of usages) {
          locations.push({ uri, range: toPointRange(u.line, u.column) });
        }
      }
    }
    if (node?.type === 'layer') {
      const layerId = node.id;
      const refs: { line: number; column: number }[] = [];
      collectLayerReferences(ir.root.children, layerId, refs);
      for (const r of refs) {
        locations.push({ uri, range: toPointRange(r.line, r.column) });
      }
    }
  }

  const seen = new Set<string>();
  return locations.filter((loc) => {
    const key = `${loc.range.start.line}:${loc.range.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

connection.onDocumentHighlight(async (params: DocumentHighlightParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  const _uri = params.textDocument.uri;
  const highlights: DocumentHighlight[] = [];

  for (const ir of programs) {
    const node = findNodeAtPosition(ir.root.children, line, col);
    if (node?.type === 'effect') {
      const eff = node;
      for (const r of eff.requiredServices ?? []) {
        const usages: { line: number; column: number }[] = [];
        collectServiceUsages(ir.root.children, r.serviceId, usages);
        for (const u of usages) {
          highlights.push({
            range: toPointRange(u.line, u.column),
            kind: HIGHLIGHT_KIND_READ,
          });
        }
      }
    }
    if (node?.type === 'layer') {
      const layerId = node.id;
      const refs: { line: number; column: number }[] = [];
      collectLayerReferences(ir.root.children, layerId, refs);
      for (const r of refs) {
        highlights.push({
          range: toPointRange(r.line, r.column),
          kind: HIGHLIGHT_KIND_READ,
        });
      }
    }
  }
  return highlights;
});

function nodeToDocumentSymbol(node: StaticFlowNode): DocumentSymbol | null {
  const loc = node.location;
  if (!loc) return null;
  const range = toRange(loc.line, loc.column, loc.endLine, loc.endColumn);
  let name: string;
  let kind: import('vscode-languageserver').SymbolKind;
  let detail: string | undefined;
  switch (node.type) {
    case 'effect':
      name = (node).callee;
      kind = SYMBOL_KIND_FUNCTION; // SymbolKind.Function
      detail = (node).errorType;
      break;
    case 'layer':
      name = node.name ?? 'Layer';
      kind = SYMBOL_KIND_VARIABLE; // SymbolKind.Variable
      detail = 'Layer';
      break;
    case 'generator':
      name = 'Effect.gen';
      kind = SYMBOL_KIND_FUNCTION;
      detail = `${(node).yields.length} yields`;
      break;
    case 'pipe':
      name = 'pipe';
      kind = SYMBOL_KIND_FUNCTION;
      detail = `${(node).transformations.length + 1} steps`;
      break;
    case 'parallel':
      name = (node).callee;
      kind = SYMBOL_KIND_FUNCTION;
      detail = `${(node).children.length} effects`;
      break;
    case 'race':
      name = (node).callee;
      kind = SYMBOL_KIND_FUNCTION;
      break;
    case 'error-handler':
      name = (node).handlerType;
      kind = SYMBOL_KIND_FUNCTION;
      break;
    default:
      name = node.name ?? node.type;
      kind = SYMBOL_KIND_FUNCTION;
  }
  const children = Option.getOrElse(getStaticChildren(node), () => [])
    .map((c) => nodeToDocumentSymbol(c))
    .filter((s) => s !== null);
  const symbol: DocumentSymbol = {
    name,
    kind,
    range,
    selectionRange: range,
  };
  if (detail !== undefined) symbol.detail = detail;
  if (children.length > 0) symbol.children = children;
  return symbol;
}

function toDocumentSymbol(
  ir: StaticEffectIR,
  _uri: string,
): DocumentSymbol {
  const loc = ir.root.location;
  const range = toRange(
    loc?.line ?? 1,
    loc?.column ?? 0,
    loc?.endLine ?? loc?.line ?? 1,
    loc?.endColumn ?? loc?.column,
  );
  const selectionRange = range;
  const children = ir.root.children
    .map((c) => nodeToDocumentSymbol(c))
    .filter((s) => s !== null);
  const kind = SYMBOL_KIND_FUNCTION; // SymbolKind.Function
  const symbol: DocumentSymbol = {
    name: `Effect: ${ir.root.programName}`,
    detail: ir.root.source === 'generator' ? 'Effect.gen' : ir.root.source,
    kind,
    range,
    selectionRange,
  };
  if (children.length > 0) symbol.children = children;
  return symbol;
}

connection.onDocumentSymbol(async (params: DocumentSymbolParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  return programs.map((ir) => toDocumentSymbol(ir, params.textDocument.uri));
});

connection.onWorkspaceSymbol(async (params: WorkspaceSymbolParams) => {
  const q = params.query.trim().toLowerCase();
  const results: SymbolInformation[] = [];
  for (const [uri, cached] of irCache) {
    for (const ir of cached.programs) {
      const name = `Effect: ${ir.root.programName}`;
      if (q && !name.toLowerCase().includes(q)) continue;
      const loc = ir.root.location;
      if (loc) {
        results.push({
          name,
          kind: SYMBOL_KIND_FUNCTION,
          location: {
            uri,
            range: {
              start: { line: loc.line - 1, character: loc.column },
              end: { line: (loc.endLine ?? loc.line) - 1, character: (loc.endColumn ?? loc.column) + 1 },
            },
          },
        });
      }
    }
  }
  return results;
});

connection.onPrepareRename(async (params: PrepareRenameParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  for (const ir of programs) {
    const loc = ir.root.location;
    if (loc?.line === line && loc.column <= col) {
      const nameLen = ir.root.programName.length;
      return {
        range: {
          start: { line: line - 1, character: loc.column },
          end: { line: line - 1, character: loc.column + nameLen },
        },
        placeholder: ir.root.programName,
      };
    }
  }
  return null;
});

connection.onRenameRequest(async (params: RenameParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const line = params.position.line + 1;
  const col = params.position.character;
  const newName = params.newName;
  const edits: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[] = [];
  for (const ir of programs) {
    const loc = ir.root.location;
    if (loc?.line === line && loc.column <= col) {
      const nameLen = ir.root.programName.length;
      edits.push({
        range: {
          start: { line: line - 1, character: loc.column },
          end: { line: line - 1, character: loc.column + nameLen },
        },
        newText: newName,
      });
      return { changes: { [params.textDocument.uri]: edits } };
    }
  }
  return null;
});

connection.onFoldingRanges(async (params: FoldingRangeParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const ranges: { startLine: number; endLine: number; kind?: string }[] = [];
  for (const ir of programs) {
    const loc = ir.root.location;
    if (loc?.endLine && loc.endLine > loc.line) {
      ranges.push({
        startLine: loc.line - 1,
        endLine: loc.endLine - 1,
        kind: 'region',
      });
    }
  }
  return ranges;
});

function collectEffectNodesWithTypes(
  nodes: readonly StaticFlowNode[],
  result: { line: number; column: number; typeStr: string }[],
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      const eff = node;
      if (!eff.location) continue;
      const sig = eff.typeSignature;
      if (sig) {
        result.push({
          line: eff.location.line,
          column: eff.location.column,
          typeStr: `Effect<${sig.successType}, ${sig.errorType}, ${sig.requirementsType}>`,
        });
      } else {
        const parts: string[] = [];
        if (eff.errorType) parts.push(`E: ${eff.errorType}`);
        const reqs = eff.requiredServices ?? [];
        if (reqs.length > 0) parts.push(`R: ${reqs.map((r) => r.serviceId).join(' | ')}`);
        if (parts.length > 0) {
          result.push({ line: eff.location.line, column: eff.location.column, typeStr: parts.join(' ') });
        }
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    collectEffectNodesWithTypes(children, result);
  }
}

connection.onInlayHint(async (params: InlayHintParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const hints: InlayHint[] = [];
  for (const ir of programs) {
    const nodes: { line: number; column: number; typeStr: string }[] = [];
    collectEffectNodesWithTypes(ir.root.children, nodes);
    for (const n of nodes) {
      hints.push({
        position: { line: n.line - 1, character: n.column },
        label: `: ${n.typeStr}`,
        kind: INLAY_KIND_TYPE, // InlayHintKind.Type
      });
    }
  }
  return hints;
});

interface SelRange {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  parent?: SelRange;
}

function collectNodeRanges(
  nodes: readonly StaticFlowNode[],
  result: SelRange[],
  parentRange?: SelRange,
): void {
  for (const node of nodes) {
    const loc = node.location;
    if (loc) {
      const range = {
        start: { line: loc.line - 1, character: loc.column },
        end: { line: (loc.endLine ?? loc.line) - 1, character: (loc.endColumn ?? loc.column) + 1 },
      };
      const item: SelRange = { range };
      if (parentRange !== undefined) item.parent = parentRange;
      result.push(item);
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      const nextParent: SelRange = { range };
      if (parentRange !== undefined) nextParent.parent = parentRange;
      collectNodeRanges(children, result, nextParent);
    }
  }
}

connection.onSelectionRange(async (params: SelectionRangeParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const all: SelRange[] = [];
  for (const ir of programs) {
    const rootLoc = ir.root.location;
    if (rootLoc) {
      const rootRange = {
        start: { line: rootLoc.line - 1, character: rootLoc.column },
        end: { line: (rootLoc.endLine ?? rootLoc.line) - 1, character: (rootLoc.endColumn ?? rootLoc.column) + 1 },
      };
      all.push({ range: rootRange });
      collectNodeRanges(ir.root.children, all, { range: rootRange });
    }
  }
  const pos = params.positions[0];
  if (!pos) return [];
  const matching: SelRange[] = [];
  for (const item of all) {
    const r = item.range;
    if (r.start.line <= pos.line && pos.line <= r.end.line && r.start.character <= pos.character && pos.character <= r.end.character) {
      matching.push(item);
    }
  }
  matching.sort((a, b) => {
    const aSize = (a.range.end.line - a.range.start.line) * 1000 + (a.range.end.character - a.range.start.character);
    const bSize = (b.range.end.line - b.range.start.line) * 1000 + (b.range.end.character - b.range.start.character);
    return aSize - bSize;
  });
  return matching.map((m) => {
    const out: SelRange = { range: m.range };
    if (m.parent !== undefined) out.parent = m.parent;
    return out;
  });
});

const EFFECT_COMPLETIONS = [
  { label: 'Effect.gen', desc: 'Generator-based effect composition', insertText: 'Effect.gen' },
  { label: 'Effect.succeed', desc: 'Create success from value', insertText: 'Effect.succeed' },
  { label: 'Effect.fail', desc: 'Create typed failure', insertText: 'Effect.fail' },
  { label: 'Effect.sync', desc: 'Wrap sync computation', insertText: 'Effect.sync' },
  { label: 'Effect.promise', desc: 'Wrap Promise', insertText: 'Effect.promise' },
  { label: 'Effect.try', desc: 'Try sync, catch to Effect', insertText: 'Effect.try' },
  { label: 'Effect.tryPromise', desc: 'Try Promise, catch to Effect', insertText: 'Effect.tryPromise' },
  { label: 'Effect.all', desc: 'Run effects in parallel', insertText: 'Effect.all' },
  { label: 'Effect.race', desc: 'Race effects', insertText: 'Effect.race' },
  { label: 'Effect.flatMap', desc: 'Sequential composition', insertText: 'Effect.flatMap' },
  { label: 'Effect.map', desc: 'Transform success', insertText: 'Effect.map' },
  { label: 'Effect.tap', desc: 'Side effect, keep value', insertText: 'Effect.tap' },
  { label: 'Effect.catchAll', desc: 'Handle all errors', insertText: 'Effect.catchAll' },
  { label: 'Effect.catchTag', desc: 'Handle tagged error', insertText: 'Effect.catchTag' },
  { label: 'Effect.provide', desc: 'Provide service', insertText: 'Effect.provide' },
  { label: 'Effect.provideService', desc: 'Provide single service', insertText: 'Effect.provideService' },
];

const LAYER_COMPLETIONS = [
  { label: 'Layer.succeed', desc: 'Layer from value', insertText: 'Layer.succeed' },
  { label: 'Layer.effect', desc: 'Layer from effect', insertText: 'Layer.effect' },
  { label: 'Layer.merge', desc: 'Merge layers', insertText: 'Layer.merge' },
  { label: 'Layer.mergeAll', desc: 'Merge array of layers', insertText: 'Layer.mergeAll' },
  { label: 'Layer.scoped', desc: 'Layer from scoped effect', insertText: 'Layer.scoped' },
  { label: 'Layer.function', desc: 'Layer from context function', insertText: 'Layer.function' },
];

const CONTEXT_COMPLETIONS = [
  { label: 'Context.Tag', desc: 'Service tag for DI', insertText: 'Context.Tag' },
  { label: 'Context.GenericTag', desc: 'Generic service tag', insertText: 'Context.GenericTag' },
  { label: 'Context.services', desc: 'Get all services from context', insertText: 'Context.services' },
];

const DURATION_COMPLETIONS = [
  { label: 'Duration.millis', desc: 'Duration in milliseconds', insertText: 'Duration.millis' },
  { label: 'Duration.seconds', desc: 'Duration in seconds', insertText: 'Duration.seconds' },
  { label: 'Duration.minutes', desc: 'Duration in minutes', insertText: 'Duration.minutes' },
  { label: 'Duration.hours', desc: 'Duration in hours', insertText: 'Duration.hours' },
  { label: 'Duration.zero', desc: 'Zero duration', insertText: 'Duration.zero' },
];

const OPTION_COMPLETIONS = [
  { label: 'Option.some', desc: 'Create Some', insertText: 'Option.some' },
  { label: 'Option.none', desc: 'Create None', insertText: 'Option.none' },
  { label: 'Option.fromNullable', desc: 'From null/undefined', insertText: 'Option.fromNullable' },
  { label: 'Option.match', desc: 'Pattern match', insertText: 'Option.match' },
  { label: 'Option.getOrElse', desc: 'Get value or default', insertText: 'Option.getOrElse' },
];

const SCHEDULE_COMPLETIONS = [
  { label: 'Schedule.spaced', desc: 'Fixed delay between recurrences', insertText: 'Schedule.spaced' },
  { label: 'Schedule.exponential', desc: 'Exponential backoff', insertText: 'Schedule.exponential' },
  { label: 'Schedule.recurs', desc: 'Limit number of recurrences', insertText: 'Schedule.recurs' },
  { label: 'Schedule.forever', desc: 'Never stop', insertText: 'Schedule.forever' },
  { label: 'Schedule.once', desc: 'Run once', insertText: 'Schedule.once' },
];

const STREAM_COMPLETIONS = [
  { label: 'Stream.make', desc: 'Create stream from values', insertText: 'Stream.make' },
  { label: 'Stream.fromIterable', desc: 'Stream from iterable', insertText: 'Stream.fromIterable' },
  { label: 'Stream.fromEffect', desc: 'Stream from single effect', insertText: 'Stream.fromEffect' },
  { label: 'Stream.map', desc: 'Transform chunks', insertText: 'Stream.map' },
  { label: 'Stream.mapEffect', desc: 'Effectful map', insertText: 'Stream.mapEffect' },
  { label: 'Stream.runCollect', desc: 'Run and collect chunks', insertText: 'Stream.runCollect' },
  { label: 'Stream.runForEach', desc: 'Run with side effect per chunk', insertText: 'Stream.runForEach' },
];

const CONFIG_COMPLETIONS = [
  { label: 'Config.string', desc: 'String config key', insertText: 'Config.string' },
  { label: 'Config.number', desc: 'Number config key', insertText: 'Config.number' },
  { label: 'Config.boolean', desc: 'Boolean config key', insertText: 'Config.boolean' },
  { label: 'Config.nested', desc: 'Nested config object', insertText: 'Config.nested' },
  { label: 'Config.withDefault', desc: 'Config with default value', insertText: 'Config.withDefault' },
  { label: 'Config.unwrap', desc: 'Run config to effect', insertText: 'Config.unwrap' },
];

const PIPE_COMPLETION = { label: 'pipe', desc: 'Pipe value through functions (effect)', insertText: 'pipe' };

const SCHEMA_COMPLETIONS = [
  { label: 'Schema.String', desc: 'String schema', insertText: 'Schema.String' },
  { label: 'Schema.Number', desc: 'Number schema', insertText: 'Schema.Number' },
  { label: 'Schema.Struct', desc: 'Struct schema', insertText: 'Schema.Struct' },
  { label: 'Schema.Union', desc: 'Union schema', insertText: 'Schema.Union' },
  { label: 'Schema.Literal', desc: 'Literal schema', insertText: 'Schema.Literal' },
  { label: 'Schema.decodeSync', desc: 'Decode sync', insertText: 'Schema.decodeSync' },
  { label: 'Schema.encodeSync', desc: 'Encode sync', insertText: 'Schema.encodeSync' },
];

const MATCH_COMPLETIONS = [
  { label: 'Match.type', desc: 'Match on type', insertText: 'Match.type' },
  { label: 'Match.tag', desc: 'Match on tag', insertText: 'Match.tag' },
  { label: 'Match.exhaustive', desc: 'Exhaustive match', insertText: 'Match.exhaustive' },
  { label: 'Match.when', desc: 'Match when predicate', insertText: 'Match.when' },
  { label: 'Match.orElse', desc: 'Fallback', insertText: 'Match.orElse' },
];

const EXIT_COMPLETIONS = [
  { label: 'Exit.succeed', desc: 'Success exit', insertText: 'Exit.succeed' },
  { label: 'Exit.fail', desc: 'Failure exit', insertText: 'Exit.fail' },
  { label: 'Exit.die', desc: 'Defect exit', insertText: 'Exit.die' },
  { label: 'Exit.match', desc: 'Pattern match exit', insertText: 'Exit.match' },
];

const CAUSE_COMPLETIONS = [
  { label: 'Cause.fail', desc: 'Typed failure cause', insertText: 'Cause.fail' },
  { label: 'Cause.die', desc: 'Defect cause', insertText: 'Cause.die' },
  { label: 'Cause.empty', desc: 'Empty cause', insertText: 'Cause.empty' },
  { label: 'Cause.match', desc: 'Match on cause', insertText: 'Cause.match' },
];

const REF_COMPLETIONS = [
  { label: 'Ref.make', desc: 'Create ref', insertText: 'Ref.make' },
  { label: 'Ref.get', desc: 'Get value', insertText: 'Ref.get' },
  { label: 'Ref.set', desc: 'Set value', insertText: 'Ref.set' },
  { label: 'Ref.update', desc: 'Update with function', insertText: 'Ref.update' },
  { label: 'Ref.modify', desc: 'Read and update', insertText: 'Ref.modify' },
];

const FIBER_COMPLETIONS = [
  { label: 'Fiber.join', desc: 'Wait for fiber', insertText: 'Fiber.join' },
  { label: 'Fiber.await', desc: 'Await exit', insertText: 'Fiber.await' },
  { label: 'Fiber.interrupt', desc: 'Interrupt fiber', insertText: 'Fiber.interrupt' },
  { label: 'Fiber.fork', desc: 'Fork effect (via Effect.fork)', insertText: 'Fiber.fork' },
];

const QUEUE_COMPLETIONS = [
  { label: 'Queue.bounded', desc: 'Bounded queue', insertText: 'Queue.bounded' },
  { label: 'Queue.unbounded', desc: 'Unbounded queue', insertText: 'Queue.unbounded' },
  { label: 'Queue.offer', desc: 'Offer element', insertText: 'Queue.offer' },
  { label: 'Queue.take', desc: 'Take element', insertText: 'Queue.take' },
];

const PUBSUB_COMPLETIONS = [
  { label: 'PubSub.bounded', desc: 'Bounded pub/sub', insertText: 'PubSub.bounded' },
  { label: 'PubSub.unbounded', desc: 'Unbounded pub/sub', insertText: 'PubSub.unbounded' },
  { label: 'PubSub.publish', desc: 'Publish message', insertText: 'PubSub.publish' },
  { label: 'PubSub.subscribe', desc: 'Subscribe', insertText: 'PubSub.subscribe' },
];

const SCOPE_COMPLETIONS = [
  { label: 'Scope.make', desc: 'Create scope', insertText: 'Scope.make' },
  { label: 'Scope.extend', desc: 'Extend scope', insertText: 'Scope.extend' },
  { label: 'Scope.addFinalizer', desc: 'Add finalizer', insertText: 'Scope.addFinalizer' },
  { label: 'Scope.close', desc: 'Close scope', insertText: 'Scope.close' },
];

const CHUNK_COMPLETIONS = [
  { label: 'Chunk.make', desc: 'Create chunk', insertText: 'Chunk.make' },
  { label: 'Chunk.fromIterable', desc: 'From iterable', insertText: 'Chunk.fromIterable' },
  { label: 'Chunk.map', desc: 'Map chunk', insertText: 'Chunk.map' },
  { label: 'Chunk.filter', desc: 'Filter chunk', insertText: 'Chunk.filter' },
  { label: 'Chunk.flatMap', desc: 'FlatMap chunk', insertText: 'Chunk.flatMap' },
  { label: 'Chunk.append', desc: 'Append element', insertText: 'Chunk.append' },
];

const EITHER_COMPLETIONS = [
  { label: 'Either.right', desc: 'Right value', insertText: 'Either.right' },
  { label: 'Either.left', desc: 'Left value', insertText: 'Either.left' },
  { label: 'Either.match', desc: 'Pattern match', insertText: 'Either.match' },
  { label: 'Either.fromNullable', desc: 'From nullable', insertText: 'Either.fromNullable' },
  { label: 'Either.mapLeft', desc: 'Map left', insertText: 'Either.mapLeft' },
];

const PREDICATE_COMPLETIONS = [
  { label: 'Predicate.isString', desc: 'String predicate', insertText: 'Predicate.isString' },
  { label: 'Predicate.isNumber', desc: 'Number predicate', insertText: 'Predicate.isNumber' },
  { label: 'Predicate.isBoolean', desc: 'Boolean predicate', insertText: 'Predicate.isBoolean' },
  { label: 'Predicate.not', desc: 'Negate predicate', insertText: 'Predicate.not' },
  { label: 'Predicate.and', desc: 'Combine with and', insertText: 'Predicate.and' },
];

const FUNCTION_COMPLETIONS = [
  { label: 'pipe', desc: 'Pipe value through functions', insertText: 'pipe' },
  { label: 'identity', desc: 'Identity function', insertText: 'identity' },
  { label: 'constant', desc: 'Constant function', insertText: 'constant' },
  { label: 'dual', desc: 'Flip argument order', insertText: 'dual' },
];

const DEFERRED_COMPLETIONS = [
  { label: 'Deferred.make', desc: 'Create deferred', insertText: 'Deferred.make' },
  { label: 'Deferred.succeed', desc: 'Complete with value', insertText: 'Deferred.succeed' },
  { label: 'Deferred.fail', desc: 'Complete with error', insertText: 'Deferred.fail' },
  { label: 'Deferred.await', desc: 'Wait for value', insertText: 'Deferred.await' },
];

const SEMAPHORE_COMPLETIONS = [
  { label: 'Semaphore.make', desc: 'Create semaphore', insertText: 'Semaphore.make' },
  { label: 'Semaphore.withPermit', desc: 'Run with one permit', insertText: 'Semaphore.withPermit' },
  { label: 'Semaphore.withPermits', desc: 'Run with N permits', insertText: 'Semaphore.withPermits' },
];

const CHANNEL_COMPLETIONS = [
  { label: 'Channel.succeed', desc: 'Succeed channel', insertText: 'Channel.succeed' },
  { label: 'Channel.fail', desc: 'Fail channel', insertText: 'Channel.fail' },
  { label: 'Channel.fromIterable', desc: 'From iterable', insertText: 'Channel.fromIterable' },
  { label: 'Channel.pipeTo', desc: 'Pipe to sink', insertText: 'Channel.pipeTo' },
];

const SINK_COMPLETIONS = [
  { label: 'Sink.forEach', desc: 'Sink that runs effect per element', insertText: 'Sink.forEach' },
  { label: 'Sink.collectAll', desc: 'Collect all elements', insertText: 'Sink.collectAll' },
  { label: 'Sink.drain', desc: 'Drain stream', insertText: 'Sink.drain' },
  { label: 'Sink.fold', desc: 'Fold elements', insertText: 'Sink.fold' },
];

const METRIC_COMPLETIONS = [
  { label: 'Metric.counter', desc: 'Counter metric', insertText: 'Metric.counter' },
  { label: 'Metric.gauge', desc: 'Gauge metric', insertText: 'Metric.gauge' },
  { label: 'Metric.histogram', desc: 'Histogram metric', insertText: 'Metric.histogram' },
  { label: 'Metric.increment', desc: 'Increment counter', insertText: 'Metric.increment' },
];

const TRACER_COMPLETIONS = [
  { label: 'Tracer.span', desc: 'Create span', insertText: 'Tracer.span' },
  { label: 'Tracer.withSpan', desc: 'Run with span', insertText: 'Tracer.withSpan' },
];

const LOGGER_COMPLETIONS = [
  { label: 'Logger.log', desc: 'Log message', insertText: 'Logger.log' },
  { label: 'Logger.info', desc: 'Info level', insertText: 'Logger.info' },
  { label: 'Logger.warning', desc: 'Warning level', insertText: 'Logger.warning' },
  { label: 'Logger.error', desc: 'Error level', insertText: 'Logger.error' },
];

const HASH_COMPLETIONS = [
  { label: 'Hash.string', desc: 'String hash', insertText: 'Hash.string' },
  { label: 'Hash.number', desc: 'Number hash', insertText: 'Hash.number' },
  { label: 'Hash.combine', desc: 'Combine hashes', insertText: 'Hash.combine' },
  { label: 'Hash.hash', desc: 'Hash a value', insertText: 'Hash.hash' },
];

const HASHMAP_COMPLETIONS = [
  { label: 'HashMap.empty', desc: 'Empty map', insertText: 'HashMap.empty' },
  { label: 'HashMap.make', desc: 'Make from iterable', insertText: 'HashMap.make' },
  { label: 'HashMap.set', desc: 'Set entry', insertText: 'HashMap.set' },
  { label: 'HashMap.get', desc: 'Get entry', insertText: 'HashMap.get' },
  { label: 'HashMap.has', desc: 'Check key', insertText: 'HashMap.has' },
];

const LIST_COMPLETIONS = [
  { label: 'List.nil', desc: 'Empty list', insertText: 'List.nil' },
  { label: 'List.cons', desc: 'Cons cell', insertText: 'List.cons' },
  { label: 'List.fromIterable', desc: 'From iterable', insertText: 'List.fromIterable' },
  { label: 'List.map', desc: 'Map list', insertText: 'List.map' },
  { label: 'List.filter', desc: 'Filter list', insertText: 'List.filter' },
];

const DATA_COMPLETIONS = [
  { label: 'Data.taggedEnum', desc: 'Tagged enum', insertText: 'Data.taggedEnum' },
  { label: 'Data.struct', desc: 'Struct data', insertText: 'Data.struct' },
  { label: 'Data.case', desc: 'Case of enum', insertText: 'Data.case' },
];

const EQUIVALENCE_COMPLETIONS = [
  { label: 'Equivalence.string', desc: 'String equivalence', insertText: 'Equivalence.string' },
  { label: 'Equivalence.number', desc: 'Number equivalence', insertText: 'Equivalence.number' },
  { label: 'Equivalence.struct', desc: 'Struct equivalence', insertText: 'Equivalence.struct' },
  { label: 'Equivalence.map', desc: 'Map with key eq', insertText: 'Equivalence.map' },
];

const ORDER_COMPLETIONS = [
  { label: 'Order.string', desc: 'String order', insertText: 'Order.string' },
  { label: 'Order.number', desc: 'Number order', insertText: 'Order.number' },
  { label: 'Order.reverse', desc: 'Reverse order', insertText: 'Order.reverse' },
  { label: 'Order.map', desc: 'Map to order', insertText: 'Order.map' },
];

const RECORD_COMPLETIONS = [
  { label: 'Record.get', desc: 'Get key', insertText: 'Record.get' },
  { label: 'Record.set', desc: 'Set key', insertText: 'Record.set' },
  { label: 'Record.has', desc: 'Has key', insertText: 'Record.has' },
  { label: 'Record.keys', desc: 'Keys of record', insertText: 'Record.keys' },
  { label: 'Record.fromIterable', desc: 'Record from entries', insertText: 'Record.fromIterable' },
];

const REDACTED_COMPLETIONS = [
  { label: 'Redacted.make', desc: 'Create redacted', insertText: 'Redacted.make' },
  { label: 'Redacted.unsafeMake', desc: 'Unsafe make', insertText: 'Redacted.unsafeMake' },
  { label: 'Redacted.value', desc: 'Get value', insertText: 'Redacted.value' },
];

const FIBERREF_COMPLETIONS = [
  { label: 'FiberRef.make', desc: 'Create fiber ref', insertText: 'FiberRef.make' },
  { label: 'FiberRef.get', desc: 'Get value', insertText: 'FiberRef.get' },
  { label: 'FiberRef.set', desc: 'Set value', insertText: 'FiberRef.set' },
  { label: 'FiberRef.locally', desc: 'Scoped override', insertText: 'FiberRef.locally' },
  { label: 'FiberRef.update', desc: 'Update value', insertText: 'FiberRef.update' },
];

const SYNCHRONIZEDREF_COMPLETIONS = [
  { label: 'SynchronizedRef.make', desc: 'Create sync ref', insertText: 'SynchronizedRef.make' },
  { label: 'SynchronizedRef.get', desc: 'Get value', insertText: 'SynchronizedRef.get' },
  { label: 'SynchronizedRef.set', desc: 'Set value', insertText: 'SynchronizedRef.set' },
  { label: 'SynchronizedRef.updateEffect', desc: 'Update with effect', insertText: 'SynchronizedRef.updateEffect' },
];

const REQUEST_COMPLETIONS = [
  { label: 'Request.tagged', desc: 'Tagged request', insertText: 'Request.tagged' },
  { label: 'Request.of', desc: 'Request value', insertText: 'Request.of' },
  { label: 'Request.fail', desc: 'Failed request', insertText: 'Request.fail' },
];

const PARSERESULT_COMPLETIONS = [
  { label: 'ParseResult.decode', desc: 'Decode to Either', insertText: 'ParseResult.decode' },
  { label: 'ParseResult.success', desc: 'Success result', insertText: 'ParseResult.success' },
  { label: 'ParseResult.failure', desc: 'Failure result', insertText: 'ParseResult.failure' },
];

// @effect/platform - HttpClient, HttpServer, HttpApp, FileSystem, Worker, CommandExecutor
const PLATFORM_HTTP_CLIENT_COMPLETIONS = [
  { label: 'HttpClient.request', desc: 'HTTP request', insertText: 'HttpClient.request' },
  { label: 'HttpClient.fetch', desc: 'Fetch URL', insertText: 'HttpClient.fetch' },
  { label: 'HttpClient.get', desc: 'GET request', insertText: 'HttpClient.get' },
  { label: 'HttpClient.post', desc: 'POST request', insertText: 'HttpClient.post' },
  { label: 'HttpClient.put', desc: 'PUT request', insertText: 'HttpClient.put' },
  { label: 'HttpClient.delete', desc: 'DELETE request', insertText: 'HttpClient.delete' },
  { label: 'HttpClient.json', desc: 'JSON body middleware', insertText: 'HttpClient.json' },
  { label: 'HttpClient.text', desc: 'Text body', insertText: 'HttpClient.text' },
];

const PLATFORM_HTTP_SERVER_COMPLETIONS = [
  { label: 'HttpServer.serve', desc: 'Serve HTTP app', insertText: 'HttpServer.serve' },
  { label: 'HttpServer.serveHttpApp', desc: 'Serve HttpApp', insertText: 'HttpServer.serveHttpApp' },
];

const PLATFORM_HTTP_APP_COMPLETIONS = [
  { label: 'HttpApp.app', desc: 'Create app', insertText: 'HttpApp.app' },
  { label: 'HttpApp.get', desc: 'GET route', insertText: 'HttpApp.get' },
  { label: 'HttpApp.post', desc: 'POST route', insertText: 'HttpApp.post' },
  { label: 'HttpApp.put', desc: 'PUT route', insertText: 'HttpApp.put' },
  { label: 'HttpApp.route', desc: 'Add route', insertText: 'HttpApp.route' },
  { label: 'HttpApp.withMiddleware', desc: 'Add middleware', insertText: 'HttpApp.withMiddleware' },
];

const PLATFORM_FILE_SYSTEM_COMPLETIONS = [
  { label: 'FileSystem.access', desc: 'Check path access', insertText: 'FileSystem.access' },
  { label: 'FileSystem.readFile', desc: 'Read file', insertText: 'FileSystem.readFile' },
  { label: 'FileSystem.writeFile', desc: 'Write file', insertText: 'FileSystem.writeFile' },
  { label: 'FileSystem.exists', desc: 'Path exists', insertText: 'FileSystem.exists' },
  { label: 'FileSystem.makeDirectory', desc: 'Create directory', insertText: 'FileSystem.makeDirectory' },
  { label: 'FileSystem.readDirectory', desc: 'Read directory', insertText: 'FileSystem.readDirectory' },
];

const PLATFORM_WORKER_COMPLETIONS = [
  { label: 'Worker.make', desc: 'Create worker', insertText: 'Worker.make' },
  { label: 'Worker.makePool', desc: 'Worker pool', insertText: 'Worker.makePool' },
];

const PLATFORM_COMMAND_EXECUTOR_COMPLETIONS = [
  { label: 'CommandExecutor.run', desc: 'Run command', insertText: 'CommandExecutor.run' },
  { label: 'CommandExecutor.start', desc: 'Start process', insertText: 'CommandExecutor.start' },
];

const SIGNATURES: { label: string; docs?: string; params: { label: string; docs?: string }[] }[] = [
  { label: 'Effect.gen(generator)', docs: 'Generator-based effect composition', params: [{ label: 'generator', docs: 'Function* that yields effects' }] },
  { label: 'Effect.all(effects, options?)', docs: 'Run effects in parallel or sequential', params: [{ label: 'effects', docs: 'Tuple or array of effects' }, { label: 'options', docs: '{ concurrency?, batching?, discard? }' }] },
  { label: 'Effect.pipe(effect, ...transforms)', docs: 'Pipe effect through transformations', params: [{ label: 'effect' }, { label: '...transforms', docs: 'flatMap, map, catchAll, etc.' }] },
  { label: 'Effect.tryPromise(fn)', docs: 'Wrap Promise-returning function', params: [{ label: 'fn', docs: '() => Promise<A>' }] },
  { label: 'Effect.try(fn)', docs: 'Wrap sync function that may throw', params: [{ label: 'fn', docs: '() => A' }] },
  { label: 'Layer.merge(layer1, layer2)', docs: 'Merge two layers', params: [{ label: 'layer1' }, { label: 'layer2' }] },
  { label: 'Schema.decodeSync(schema, value)', docs: 'Decode value with schema', params: [{ label: 'schema' }, { label: 'value' }] },
];

interface CompletionDef { label: string; desc: string; insertText: string }

const buildCompletionItems = (
  defs: readonly CompletionDef[],
  prefix: string,
) => {
  const list = prefix
    ? defs.filter((c) => c.label.toLowerCase().includes(prefix))
    : defs;
  return list.map((c) => ({
    label: c.label,
    kind: COMPLETION_KIND_METHOD,
    detail: c.desc,
    insertText: c.insertText,
  }));
};

connection.onSignatureHelp(async (params: SignatureHelpParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const line = doc.getText().split('\n')[params.position.line] ?? '';
  const pos = params.position.character;
  const before = line.slice(0, pos);
  const openParen = before.lastIndexOf('(');
  if (openParen === -1) return null;
  const callStart = before.slice(0, openParen).trim();
  const activeParam = (before.slice(openParen).match(/,/g) ?? []).length;
  let idx = -1;
  if (callStart.endsWith('Effect.gen')) idx = 0;
  else if (callStart.endsWith('Effect.all')) idx = 1;
  else if (callStart.endsWith('Effect.pipe')) idx = 2;
  else if (callStart.endsWith('Effect.tryPromise')) idx = 3;
  else if (callStart.endsWith('Effect.try')) idx = 4;
  else if (callStart.endsWith('Layer.merge')) idx = 5;
  else if (callStart.endsWith('Schema.decodeSync')) idx = 6;
  if (idx === -1) return null;
  const sig = SIGNATURES[idx]!;
  const parameters = sig.params.map((p) => {
    const param: { label: string; documentation?: string } = { label: p.label };
    if (p.docs !== undefined) param.documentation = p.docs;
    return param;
  });
  const signature: {
    label: string;
    parameters: { label: string; documentation?: string }[];
    documentation?: string;
    activeParameter: number;
  } = {
    label: sig.label,
    parameters,
    activeParameter: Math.min(activeParam, sig.params.length - 1),
  };
  if (sig.docs !== undefined) signature.documentation = sig.docs;
  return {
    signatures: [
      signature,
    ],
    activeSignature: 0,
    activeParameter: Math.min(activeParam, sig.params.length - 1),
  };
});

connection.onCompletion(async (params: CompletionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const line = doc.getText().split('\n')[params.position.line] ?? '';
  const pos = params.position.character;
  const before = line.slice(0, pos);
  const prefix = before.replace(/.*[\s(,[]/, '').toLowerCase();
  const effectMatch = /Effect\.?$/.exec(before);
  const layerMatch = /Layer\.?$/.exec(before);
  const contextMatch = /Context\.?$/.exec(before);
  const durationMatch = /Duration\.?$/.exec(before);
  const optionMatch = /Option\.?$/.exec(before);
  const scheduleMatch = /Schedule\.?$/.exec(before);
  const streamMatch = /Stream\.?$/.exec(before);
  const configMatch = /Config\.?$/.exec(before);
  const schemaMatch = /Schema\.?$/.exec(before);
  const matchMatch = /Match\.?$/.exec(before);
  const exitMatch = /Exit\.?$/.exec(before);
  const causeMatch = /Cause\.?$/.exec(before);
  const refMatch = /Ref\.?$/.exec(before);
  const fiberMatch = /Fiber\.?$/.exec(before);
  const queueMatch = /Queue\.?$/.exec(before);
  const pubsubMatch = /PubSub\.?$/.exec(before);
  const scopeMatch = /Scope\.?$/.exec(before);
  const chunkMatch = /Chunk\.?$/.exec(before);
  const eitherMatch = /Either\.?$/.exec(before);
  const predicateMatch = /Predicate\.?$/.exec(before);
  const functionMatch = /Function\.?$/.exec(before);
  const deferredMatch = /Deferred\.?$/.exec(before);
  const semaphoreMatch = /Semaphore\.?$/.exec(before);
  const channelMatch = /Channel\.?$/.exec(before);
  const sinkMatch = /Sink\.?$/.exec(before);
  const metricMatch = /Metric\.?$/.exec(before);
  const tracerMatch = /Tracer\.?$/.exec(before);
  const loggerMatch = /Logger\.?$/.exec(before);
  const hashMatch = /Hash\.?$/.exec(before);
  const hashMapMatch = /HashMap\.?$/.exec(before);
  const listMatch = /List\.?$/.exec(before);
  const dataMatch = /Data\.?$/.exec(before);
  const equivalenceMatch = /Equivalence\.?$/.exec(before);
  const orderMatch = /Order\.?$/.exec(before);
  const recordMatch = /Record\.?$/.exec(before);
  const redactedMatch = /Redacted\.?$/.exec(before);
  const fiberRefMatch = /FiberRef\.?$/.exec(before);
  const synchronizedRefMatch = /SynchronizedRef\.?$/.exec(before);
  const requestMatch = /Request\.?$/.exec(before);
  const parseResultMatch = /ParseResult\.?$/.exec(before);
  const platformHttpClientMatch = /HttpClient\.?$/.exec(before);
  const platformHttpServerMatch = /HttpServer\.?$/.exec(before);
  const platformHttpAppMatch = /HttpApp\.?$/.exec(before);
  const platformFileSystemMatch = /FileSystem\.?$/.exec(before);
  const platformWorkerMatch = /Worker\.?$/.exec(before);
  const platformCommandExecutorMatch = /CommandExecutor\.?$/.exec(before);
  const pipeMatch = /(^|[^\w])pipe\.?$/.test(before);
  if (effectMatch) return buildCompletionItems(EFFECT_COMPLETIONS, prefix);
  if (layerMatch) return buildCompletionItems(LAYER_COMPLETIONS, prefix);
  if (contextMatch) return buildCompletionItems(CONTEXT_COMPLETIONS, prefix);
  if (durationMatch) return buildCompletionItems(DURATION_COMPLETIONS, prefix);
  if (optionMatch) return buildCompletionItems(OPTION_COMPLETIONS, prefix);
  if (scheduleMatch) return buildCompletionItems(SCHEDULE_COMPLETIONS, prefix);
  if (streamMatch) return buildCompletionItems(STREAM_COMPLETIONS, prefix);
  if (configMatch) return buildCompletionItems(CONFIG_COMPLETIONS, prefix);
  if (schemaMatch) return buildCompletionItems(SCHEMA_COMPLETIONS, prefix);
  if (matchMatch) return buildCompletionItems(MATCH_COMPLETIONS, prefix);
  if (exitMatch) return buildCompletionItems(EXIT_COMPLETIONS, prefix);
  if (causeMatch) return buildCompletionItems(CAUSE_COMPLETIONS, prefix);
  if (refMatch) return buildCompletionItems(REF_COMPLETIONS, prefix);
  if (fiberMatch) return buildCompletionItems(FIBER_COMPLETIONS, prefix);
  if (queueMatch) return buildCompletionItems(QUEUE_COMPLETIONS, prefix);
  if (pubsubMatch) return buildCompletionItems(PUBSUB_COMPLETIONS, prefix);
  if (scopeMatch) return buildCompletionItems(SCOPE_COMPLETIONS, prefix);
  if (chunkMatch) return buildCompletionItems(CHUNK_COMPLETIONS, prefix);
  if (eitherMatch) return buildCompletionItems(EITHER_COMPLETIONS, prefix);
  if (predicateMatch) return buildCompletionItems(PREDICATE_COMPLETIONS, prefix);
  if (functionMatch) return buildCompletionItems(FUNCTION_COMPLETIONS, prefix);
  if (deferredMatch) return buildCompletionItems(DEFERRED_COMPLETIONS, prefix);
  if (semaphoreMatch) return buildCompletionItems(SEMAPHORE_COMPLETIONS, prefix);
  if (channelMatch) return buildCompletionItems(CHANNEL_COMPLETIONS, prefix);
  if (sinkMatch) return buildCompletionItems(SINK_COMPLETIONS, prefix);
  if (metricMatch) return buildCompletionItems(METRIC_COMPLETIONS, prefix);
  if (tracerMatch) return buildCompletionItems(TRACER_COMPLETIONS, prefix);
  if (loggerMatch) return buildCompletionItems(LOGGER_COMPLETIONS, prefix);
  if (hashMatch) return buildCompletionItems(HASH_COMPLETIONS, prefix);
  if (hashMapMatch) return buildCompletionItems(HASHMAP_COMPLETIONS, prefix);
  if (listMatch) return buildCompletionItems(LIST_COMPLETIONS, prefix);
  if (dataMatch) return buildCompletionItems(DATA_COMPLETIONS, prefix);
  if (equivalenceMatch) return buildCompletionItems(EQUIVALENCE_COMPLETIONS, prefix);
  if (orderMatch) return buildCompletionItems(ORDER_COMPLETIONS, prefix);
  if (recordMatch) return buildCompletionItems(RECORD_COMPLETIONS, prefix);
  if (redactedMatch) return buildCompletionItems(REDACTED_COMPLETIONS, prefix);
  if (fiberRefMatch) return buildCompletionItems(FIBERREF_COMPLETIONS, prefix);
  if (synchronizedRefMatch) return buildCompletionItems(SYNCHRONIZEDREF_COMPLETIONS, prefix);
  if (requestMatch) return buildCompletionItems(REQUEST_COMPLETIONS, prefix);
  if (parseResultMatch) return buildCompletionItems(PARSERESULT_COMPLETIONS, prefix);
  if (platformHttpClientMatch) return buildCompletionItems(PLATFORM_HTTP_CLIENT_COMPLETIONS, prefix);
  if (platformHttpServerMatch) return buildCompletionItems(PLATFORM_HTTP_SERVER_COMPLETIONS, prefix);
  if (platformHttpAppMatch) return buildCompletionItems(PLATFORM_HTTP_APP_COMPLETIONS, prefix);
  if (platformFileSystemMatch) return buildCompletionItems(PLATFORM_FILE_SYSTEM_COMPLETIONS, prefix);
  if (platformWorkerMatch) return buildCompletionItems(PLATFORM_WORKER_COMPLETIONS, prefix);
  if (platformCommandExecutorMatch) return buildCompletionItems(PLATFORM_COMMAND_EXECUTOR_COMPLETIONS, prefix);
  if (pipeMatch) {
    return buildCompletionItems([PIPE_COMPLETION], prefix);
  }
  if (!before.includes('Effect') && !before.includes('Layer') && !before.includes('Context') && !before.endsWith('.')) return [];
  return [];
});

const EFFECT_DOCS_URL = 'https://effect.website/docs';
connection.onDocumentLink(async (params: DocumentLinkParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const links: DocumentLink[] = [];
  const re = /from\s+["'](effect|@effect\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = doc.positionAt(m.index);
    const end = doc.positionAt(m.index + m[0].length);
    const pkg = m[1]!;
    const target = pkg === 'effect' ? EFFECT_DOCS_URL : `${EFFECT_DOCS_URL}/${pkg.replace('@effect/', '')}`;
    links.push({
      range: { start: { line: start.line, character: start.character }, end: { line: end.line, character: end.character } },
      target,
    });
  }
  return links;
});

connection.onCodeAction(async (params: CodeActionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const result = programs.length > 0 ? lintEffectProgram(programs[0]!) : { issues: [] as const };
  const actions: CodeAction[] = [];
  for (const diag of params.context.diagnostics) {
    if (diag.source !== 'effect-analyzer') continue;
    const issue = result.issues.find(
      (i) =>
        i.location?.line === diag.range.start.line + 1 &&
        i.location.column === diag.range.start.character,
    );
    if (issue?.fix) {
      actions.push({
        title: `Fix: ${issue.suggestion ?? issue.message}`,
        kind: 'quickfix',
        diagnostics: [diag],
        edit: {
          changes: {
            [params.textDocument.uri]: [
              { range: diag.range, newText: issue.fix },
            ],
          },
        },
      });
    }
  }
  return actions;
});

connection.onHover(async (params: HoverParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  if (programs.length === 0) return null;
  const line = params.position.line + 1;
  const col = params.position.character;
  for (const ir of programs) {
    const node = findNodeAtPosition(ir.root.children, line, col);
    if (node?.type === 'effect') {
      const eff = node;
      const lines: string[] = [`**${eff.callee}**`];
      if (eff.errorType) lines.push(`Error type: \`${eff.errorType}\``);
      const reqs = eff.requiredServices ?? [];
      if (reqs.length > 0) {
        lines.push(`Requires: ${reqs.map((r) => r.serviceId).join(', ')}`);
      }
      if (eff.description) lines.push(eff.description);
      return { contents: { kind: 'markdown', value: lines.join('\n\n') } };
    }
    if (node?.type === 'layer') {
      const layer = node;
      const lines: string[] = [`**Layer**${layer.name ? `: ${layer.name}` : ''}`];
      return { contents: { kind: 'markdown', value: lines.join('\n\n') } };
    }
  }
  const first = programs[0];
  if (!first) return null;
  const complexity = calculateComplexity(first);
  const lines: string[] = [
    `**Effect program:** ${first.root.programName}`,
    `Programs in file: ${programs.length}`,
    `Cyclomatic: ${complexity.cyclomaticComplexity} | Cognitive: ${complexity.cognitiveComplexity} | Paths: ${String(complexity.pathCount)}`,
  ];
  return { contents: { kind: 'markdown', value: lines.join('\n\n') } };
});

connection.onCodeLens(async (params: import('vscode-languageserver').CodeLensParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
  const lenses: import('vscode-languageserver').CodeLens[] = [];
  for (const ir of programs) {
    const complexity = calculateComplexity(ir);
    const line = ir.root.location?.line ?? 1;
    const column = ir.root.location?.column ?? 0;
    lenses.push({
      range: { start: { line: line - 1, character: column }, end: { line: line - 1, character: column + 1 } },
      data: {
        title: '',
        irProgramName: ir.root.programName,
        complexity: {
          pathCount: complexity.pathCount,
          cyclomaticComplexity: complexity.cyclomaticComplexity,
          cognitiveComplexity: complexity.cognitiveComplexity,
        },
      },
    });
  }
  return lenses;
});

connection.onCodeLensResolve((lens: CodeLens) => {
  const data = lens.data as {
    irProgramName?: string;
    complexity?: { pathCount: number | string; cyclomaticComplexity: number; cognitiveComplexity: number };
  };
  const c = data?.complexity;
  const title =
    c !== undefined
      ? `Effect · ${data?.irProgramName ?? 'program'} · paths: ${c.pathCount} · cyclomatic: ${c.cyclomaticComplexity}`
      : 'Effect';
  return {
    ...lens,
    command: {
      title,
      command: 'effect-analyzer.showCodeLens',
    },
  };
});

async function publishDiagnostics(
  doc: import('vscode-languageserver-textdocument').TextDocument,
): Promise<void> {
  try {
    const programs = await getPrograms(doc.uri, doc.getText(), doc.version);
    const result =
      programs.length > 0
        ? lintEffectProgram(programs[0]!)
        : { issues: [] as const, summary: { errors: 0, warnings: 0, infos: 0, total: 0 } };
    const diagnostics = result.issues.map((i) => ({
      range: i.location
        ? {
            start: { line: i.location.line - 1, character: i.location.column },
            end: { line: (i.location.endLine ?? i.location.line) - 1, character: i.location.column + 20 },
          }
        : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: i.message,
      severity:
        i.severity === 'error'
          ? DIAGNOSTIC_ERROR
          : i.severity === 'warning'
            ? DIAGNOSTIC_WARNING
            : DIAGNOSTIC_INFO,
      source: 'effect-analyzer',
    }));
    await connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  } catch {
    // ignore
  }
}

documents.listen(connection);
connection.listen();
