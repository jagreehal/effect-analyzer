/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Service Registry - builds a deduplicated service map for whole-codebase analysis.
 *
 * When the analyzer encounters `yield* SomeService`, this module creates a
 * first-class ServiceArtifact for that service, including its tag definition,
 * interface shape, layer implementations, consumers, and transitive dependencies.
 */

import type {
  StaticEffectIR,
  ServiceArtifact,
  LayerImplementation,
  ServiceConsumerRef,
  ProjectServiceMap,
  ServiceDefinition,
  SourceLocation,
  StaticFlowNode,
} from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';
import { loadTsMorph } from './ts-morph-loader';

// Minimal interfaces for ts-morph's dynamically-loaded API so that values
// flowing through the analyzer carry concrete types instead of `any`.
interface TsMorphSymbol {
  getName(): string;
}

interface TsMorphType {
  getProperties(): TsMorphSymbol[];
  getCallSignatures(): unknown[];
}

interface TsMorphTypeChecker {
  getTypeAtLocation(node: unknown): TsMorphType;
  getTypeOfSymbolAtLocation(symbol: unknown, node: unknown): TsMorphType;
}

interface TsMorphProject {
  getTypeChecker(): TsMorphTypeChecker;
}

interface TsMorphNode {
  getName(): string;
  getText(): string;
  getStart(): number;
  getKind(): number;
  getExtends(): TsMorphNode | undefined;
  getExpression(): TsMorphNode | undefined;
  getTypeArguments(): TsMorphNode[];
  getArguments?(): TsMorphNode[];
  getInitializer(): TsMorphNode | undefined;
}

interface TsMorphSourceFile {
  getDescendantsOfKind(kind: number): TsMorphNode[];
  getFilePath(): string;
  getProject(): TsMorphProject;
  getLineAndColumnAtPos(pos: number): { line: number; column: number };
}

// Re-export for convenience
export type { ProjectServiceMap, ServiceArtifact };

// =============================================================================
// Service tag definition extraction (augmented with location + file info)
// =============================================================================

interface ServiceTagInfo {
  readonly tagId: string;
  readonly className: string;
  readonly filePath: string;
  readonly location: SourceLocation;
  readonly definition: ServiceDefinition;
  readonly interfaceTypeText?: string | undefined;
}

/**
 * Extract service tag definitions from a source file, with location and file path info.
 * Augments the existing extractServiceDefinitionsFromFile pattern with richer metadata.
 */
function extractServiceTagsFromFile(
  sourceFile: TsMorphSourceFile,
  filePath: string,
): ServiceTagInfo[] {
  const { SyntaxKind } = loadTsMorph();
  const results: ServiceTagInfo[] = [];
  const typeChecker = sourceFile.getProject().getTypeChecker();
  const classDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);

  for (const classDecl of classDeclarations) {
    const name = classDecl.getName();
    if (!name) continue;
    const extExpr = classDecl.getExtends();
    if (!extExpr) continue;
    const extText = extExpr.getText();
    if (!extText.includes('Context.Tag') && !extText.includes('Effect.Service')) continue;

    // Extract tag string from Context.Tag('TagName') if possible
    let tagId = name;
    const tagMatch = /Context\.Tag\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(extText);
    if (tagMatch?.[1]) {
      tagId = tagMatch[1];
    }

    // Get type arguments for interface shape
    let typeArgs: readonly TsMorphNode[] = extExpr.getTypeArguments();
    if (typeArgs.length < 2) {
      const inner = extExpr.getExpression();
      if (inner && 'getTypeArguments' in inner && typeof inner.getTypeArguments === 'function') {
        typeArgs = inner.getTypeArguments();
      }
    }

    let definition: ServiceDefinition = { tagId, methods: [], properties: [] };
    let interfaceTypeText: string | undefined;

    if (typeArgs.length >= 2) {
      const interfaceTypeNode = typeArgs[1];
      if (interfaceTypeNode) {
        try {
          interfaceTypeText = interfaceTypeNode.getText();
          const type = typeChecker.getTypeAtLocation(interfaceTypeNode);
          const methods: string[] = [];
          const properties: string[] = [];
          for (const sym of type.getProperties()) {
            const propName = sym.getName();
            if (propName.startsWith('_') || propName === 'constructor') continue;
            const propType = typeChecker.getTypeOfSymbolAtLocation(sym, interfaceTypeNode);
            const callSigs = propType.getCallSignatures();
            if (callSigs.length > 0) methods.push(propName);
            else properties.push(propName);
          }
          definition = { tagId, methods, properties };
        } catch {
          // fall through with empty definition
        }
      }
    }

    const pos = classDecl.getStart();
    const lineAndCol = sourceFile.getLineAndColumnAtPos(pos);

    results.push({
      tagId,
      className: name,
      filePath,
      location: {
        filePath,
        line: lineAndCol.line,
        column: lineAndCol.column - 1,
      },
      definition,
      interfaceTypeText,
    });
  }

  return results;
}

// =============================================================================
// Layer implementation extraction
// =============================================================================

/**
 * Extract layer implementations from a source file by scanning for
 * Layer.effect(Tag, ...), Layer.succeed(Tag, ...), Layer.sync(Tag, ...), etc.
 */
function extractLayerImplementationsFromFile(
  sourceFile: TsMorphSourceFile,
  filePath: string,
  identifierToServiceId: ReadonlyMap<string, string>,
): { readonly providesServiceId: string; readonly implementation: LayerImplementation }[] {
  const { SyntaxKind } = loadTsMorph();
  const results: { providesServiceId: string; implementation: LayerImplementation }[] = [];

  // Scan all variable declarations at top level for Layer.* calls
  const varDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);

  for (const varDecl of varDeclarations) {
    const initializer = varDecl.getInitializer();
    if (!initializer) continue;

    const initText = initializer.getText();

    // Check for Layer.effect, Layer.succeed, Layer.sync, Layer.scoped patterns
    const layerMatch = /Layer\.(effect|succeed|sync|scoped)\s*\(\s*/.exec(
      initText,
    );
    if (!layerMatch) continue;

    const kind = layerMatch[1] as 'effect' | 'succeed' | 'sync' | 'scoped';
    const layerName = varDecl.getName();

    // Try to find the service tag referenced as first argument
    // Look for the first identifier in the call args that matches a known service
    let providesServiceId: string | undefined;

    // Walk call expression to find first argument
    if (initializer.getKind() === (SyntaxKind.CallExpression as number)) {
      const args = initializer.getArguments?.();
      if (args && args.length > 0) {
        const firstArg = args[0];
        if (!firstArg) continue;
        const firstArgText = firstArg.getText().trim();
        providesServiceId = identifierToServiceId.get(firstArgText);
      }
    }

    // Also try to extract from pipe chains: Layer.effect(...).pipe(Layer.provide(...))
    // For now handle the unwrapped case and simple .pipe(Layer.provide(...))
    if (!providesServiceId) {
      // Try to match by text pattern: Layer.effect(ServiceName, ...)
      for (const identifier of identifierToServiceId.keys()) {
        if (
          initText.includes(`Layer.${kind}(${identifier}`) ||
          initText.includes(`Layer.${kind}(\n${identifier}`)
        ) {
          providesServiceId = identifierToServiceId.get(identifier);
          break;
        }
      }
    }

    if (!providesServiceId) continue;

    // Extract required services from Layer.provide() in pipe chain
    const requires: string[] = [];
    const provideMatch = /Layer\.provide\s*\(([^)]+)\)/.exec(initText);
    if (provideMatch?.[1]) {
      const provideArg = provideMatch[1].trim();
      // Could be a single layer or Layer.mergeAll(...)
      for (const [identifier, canonicalId] of identifierToServiceId.entries()) {
        if (canonicalId === providesServiceId) continue;
        if (provideArg.includes(identifier) && !requires.includes(canonicalId)) {
          requires.push(canonicalId);
        }
      }
    }

    // Also check for yield* inside Layer.effect body for service dependencies
    const yieldServiceMatches = initText.matchAll(/yield\*\s+(\w+)/g);
    for (const m of yieldServiceMatches) {
      const ident = m[1];
      const canonical = ident ? identifierToServiceId.get(ident) : undefined;
      if (canonical && canonical !== providesServiceId && !requires.includes(canonical)) {
        requires.push(canonical);
      }
    }
    const yieldServiceMatchesAlt = initText.matchAll(/yield\s*\*\s*(\w+)/g);
    for (const m of yieldServiceMatchesAlt) {
      const ident = m[1];
      const canonical = ident ? identifierToServiceId.get(ident) : undefined;
      if (canonical && canonical !== providesServiceId && !requires.includes(canonical)) {
        requires.push(canonical);
      }
    }

    const pos = varDecl.getStart();
    const lineAndCol = sourceFile.getLineAndColumnAtPos(pos);

    results.push({
      providesServiceId,
      implementation: {
        name: layerName,
        filePath,
        location: {
          filePath,
          line: lineAndCol.line,
          column: lineAndCol.column - 1,
        },
        kind,
        requires,
      },
    });
  }

  return results;
}

// =============================================================================
// Consumer extraction from analyzed programs
// =============================================================================

function collectConsumers(
  byFile: ReadonlyMap<string, readonly StaticEffectIR[]>,
): Map<string, ServiceConsumerRef[]> {
  const consumers = new Map<string, ServiceConsumerRef[]>();

  for (const [filePath, irs] of byFile) {
    for (const ir of irs) {
      const programName = ir.root.programName;

      // From requiredServices on the program root
      if (ir.root.requiredServices) {
        for (const req of ir.root.requiredServices) {
          const list = consumers.get(req.serviceId) ?? [];
          list.push({
            programName,
            filePath,
            location: req.requiredAt,
          });
          consumers.set(req.serviceId, list);
        }
      }

      // Also walk the IR tree for service references in effect nodes
      collectConsumersFromNodes(ir.root.children, programName, filePath, consumers);
    }
  }

  return consumers;
}

function collectConsumersFromNodes(
  nodes: readonly StaticFlowNode[],
  programName: string,
  filePath: string,
  consumers: Map<string, ServiceConsumerRef[]>,
): void {
  for (const node of nodes) {
    if (node.type === 'effect' && node.serviceCall) {
      const serviceId = node.serviceCall.serviceType;
      if (serviceId) {
        const list = consumers.get(serviceId) ?? [];
        // Avoid duplicates for the same program
        if (!list.some((c) => c.programName === programName && c.filePath === filePath)) {
          list.push({
            programName,
            filePath,
            location: node.location,
          });
          consumers.set(serviceId, list);
        }
      }
    }

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectConsumersFromNodes(children, programName, filePath, consumers);
    }
  }
}

// =============================================================================
// Topological sort
// =============================================================================

function computeTopologicalOrder(
  services: ReadonlyMap<string, ServiceArtifact>,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (temp.has(id)) return; // cycle
    temp.add(id);
    const artifact = services.get(id);
    if (artifact) {
      for (const dep of artifact.dependencies) {
        visit(dep);
      }
    }
    temp.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of services.keys()) {
    visit(id);
  }

  return result;
}

// =============================================================================
// Transitive dependency computation
// =============================================================================

function computeTransitiveDeps(
  serviceId: string,
  layerImpls: readonly LayerImplementation[],
  allLayersByService: ReadonlyMap<string, readonly LayerImplementation[]>,
  visited = new Set<string>(),
): string[] {
  const deps: string[] = [];
  if (visited.has(serviceId)) return deps;
  visited.add(serviceId);

  for (const layer of layerImpls) {
    for (const req of layer.requires) {
      if (!deps.includes(req)) {
        deps.push(req);
      }
      // Recurse into the required service's layers
      const reqLayers = allLayersByService.get(req);
      if (reqLayers) {
        for (const transitive of computeTransitiveDeps(req, reqLayers, allLayersByService, visited)) {
          if (!deps.includes(transitive)) {
            deps.push(transitive);
          }
        }
      }
    }
  }

  return deps;
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Build a deduplicated project-level service map from analyzed program IRs.
 *
 * @param byFile Map of file path to analyzed programs in that file
 * @param sourceFiles Optional map of file path to ts-morph SourceFile for AST-level extraction.
 *   When not provided, only IR-level data (requiredServices, StaticLayerNode) is used.
 */
export function buildProjectServiceMap(
  byFile: ReadonlyMap<string, readonly StaticEffectIR[]>,
  sourceFiles?: ReadonlyMap<string, any>,
): ProjectServiceMap {
  // Step 1: Collect all service tag definitions
  const serviceTagInfos = new Map<string, ServiceTagInfo>();

  if (sourceFiles) {
    for (const [filePath, sf] of sourceFiles) {
      const tags = extractServiceTagsFromFile(sf as TsMorphSourceFile, filePath);
      for (const tag of tags) {
        // Use tagId (canonical tag string) as key, not className
        if (!serviceTagInfos.has(tag.tagId)) {
          serviceTagInfos.set(tag.tagId, tag);
        }
      }
    }
  }

  // Also collect from IR metadata serviceDefinitions
  for (const [filePath, irs] of byFile) {
    for (const ir of irs) {
      if (ir.metadata.serviceDefinitions) {
        for (const def of ir.metadata.serviceDefinitions) {
          if (!serviceTagInfos.has(def.tagId)) {
            serviceTagInfos.set(def.tagId, {
              tagId: def.tagId,
              className: def.tagId,
              filePath,
              location: { filePath, line: 1, column: 0 },
              definition: def,
            });
          }
        }
      }
    }
  }

  const knownServiceIds = new Set(serviceTagInfos.keys());
  const identifierToServiceId = new Map<string, string>();
  for (const [serviceId, tagInfo] of serviceTagInfos) {
    // Allow matching layers by either canonical tag ID or the tag class name
    if (!identifierToServiceId.has(serviceId)) identifierToServiceId.set(serviceId, serviceId);
    if (!identifierToServiceId.has(tagInfo.className)) {
      identifierToServiceId.set(tagInfo.className, serviceId);
    }
  }

  // Also collect service IDs referenced in programs but not yet in the tag map
  // (these may come from yield* SomeService without a tag definition in scope)
  const allReferencedServiceIds = new Set<string>();
  for (const irs of byFile.values()) {
    for (const ir of irs) {
      if (ir.root.requiredServices) {
        for (const req of ir.root.requiredServices) {
          allReferencedServiceIds.add(req.serviceId);
        }
      }
    }
  }

  // Step 2: Collect layer implementations
  const layersByService = new Map<string, LayerImplementation[]>();

  if (sourceFiles) {
    for (const [filePath, sf] of sourceFiles) {
      const layers = extractLayerImplementationsFromFile(sf as TsMorphSourceFile, filePath, identifierToServiceId);
      for (const match of layers) {
        if (!knownServiceIds.has(match.providesServiceId)) continue;
        const list = layersByService.get(match.providesServiceId) ?? [];
        list.push(match.implementation);
        layersByService.set(match.providesServiceId, list);
      }
    }
  }

  // Also extract layers from IR (StaticLayerNode with provides)
  for (const [filePath, irs] of byFile) {
    for (const ir of irs) {
      collectLayersFromIR(ir.root.children, filePath, knownServiceIds, identifierToServiceId, layersByService, ir);
    }
  }

  // Step 3: Collect consumers
  const consumersByService = collectConsumers(byFile);

  // Step 4: Build ServiceArtifact map
  const services = new Map<string, ServiceArtifact>();
  const unresolvedServices: string[] = [];

  // Build artifacts for known services
  for (const [serviceId, tagInfo] of serviceTagInfos) {
    const layerImpls = layersByService.get(serviceId) ?? [];
    const consumers = consumersByService.get(serviceId) ?? [];
    const dependencies = computeTransitiveDeps(serviceId, layerImpls, layersByService);

    services.set(serviceId, {
      serviceId,
      className: tagInfo.className,
      definitionFilePath: tagInfo.filePath,
      definitionLocation: tagInfo.location,
      definition: tagInfo.definition,
      interfaceTypeText: tagInfo.interfaceTypeText,
      layerImplementations: layerImpls,
      consumers,
      dependencies,
    });
  }

  // Track unresolved services (referenced but no tag definition)
  // Include both requiredServices and serviceCall nodes (consumersByService)
  const allReferenced = new Set(allReferencedServiceIds);
  for (const refId of consumersByService.keys()) {
    allReferenced.add(refId);
  }
  for (const refId of allReferenced) {
    if (!services.has(refId)) {
      unresolvedServices.push(refId);
    }
  }

  // Step 5: Topological sort
  const topologicalOrder = computeTopologicalOrder(services);

  return {
    services,
    unresolvedServices,
    topologicalOrder,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function collectLayersFromIR(
  nodes: readonly StaticFlowNode[],
  filePath: string,
  knownServiceIds: ReadonlySet<string>,
  identifierToServiceId: ReadonlyMap<string, string>,
  layersByService: Map<string, LayerImplementation[]>,
  ir: StaticEffectIR,
): void {
  for (const node of nodes) {
    if (node.type === 'layer' && node.provides) {
      for (const providedIdent of node.provides) {
        const canonical =
          identifierToServiceId.get(providedIdent) ??
          (knownServiceIds.has(providedIdent) ? providedIdent : undefined);
        if (canonical && knownServiceIds.has(canonical)) {
          const list = layersByService.get(canonical) ?? [];
          const requires =
            node.requires
              ? node.requires
                  .map((r) => identifierToServiceId.get(r) ?? r)
                  .filter((r) => knownServiceIds.has(r))
              : [];
          // Avoid duplicates
          if (!list.some((l) => l.name === (node.name ?? ir.root.programName) && l.filePath === filePath)) {
            list.push({
              name: node.name ?? ir.root.programName,
              filePath,
              location: node.location ?? { filePath, line: 1, column: 0 },
              kind: 'other',
              requires,
            });
            layersByService.set(canonical, list);
          }
        }
      }
    }

    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectLayersFromIR(children, filePath, knownServiceIds, identifierToServiceId, layersByService, ir);
    }
  }
}
