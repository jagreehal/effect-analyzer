/**
 * Cross-Program Composition Resolver for Effect IR
 *
 * Builds a graph of Effect programs that reference other programs
 * (e.g. via identifier effects that match another program name).
 */

import type { StaticEffectIR, StaticFlowNode, ProjectServiceMap } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';
import { calculateComplexity } from './complexity';

// =============================================================================
// Types
// =============================================================================

export interface ProgramGraphNode {
  name: string;
  filePath: string;
  ir: StaticEffectIR;
  calls: ProgramCallEdge[];
  calledBy: string[];
}

export interface ProgramCallEdge {
  targetProgram: string;
  callSite?: { line: number; column: number };
  resolved: boolean;
}

export interface ProgramGraph {
  programs: Map<string, ProgramGraphNode>;
  entryProgram: string;
  circularDependencies: string[][];
  unresolvedReferences: UnresolvedProgramRef[];
}

export interface UnresolvedProgramRef {
  programName: string;
  referencedFrom: string;
  reason: string;
}

export interface CompositionResolverOptions {
  /** Entry program name when building from multiple IRs */
  entryProgramName?: string | undefined;
}

// =============================================================================
// Finding program references in IR (identifier effect nodes + yield* calls)
// =============================================================================

export interface YieldStarCall {
  callee: string;
  location?: { line: number; column: number } | undefined;
  isYieldStar: boolean;
}

function collectEffectCallees(
  nodes: readonly StaticFlowNode[],
  result: { callee: string; location?: { line: number; column: number } }[],
): void {
  for (const node of nodes) {
    if (node.type === 'effect') {
      const eff = node;
      const callee = eff.callee.trim();
      if (callee && !callee.startsWith('Effect.') && !callee.includes('.')) {
        const location = eff.location
          ? { line: eff.location.line, column: eff.location.column }
          : undefined;
        if (location) {
          result.push({ callee, location });
        } else {
          result.push({ callee });
        }
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectEffectCallees(children, result);
    }
  }
}

/**
 * Collect yield* references from generator nodes.
 * These represent cross-generator composition (yield* otherGenerator()).
 */
function collectYieldStarCalls(
  nodes: readonly StaticFlowNode[],
  result: YieldStarCall[],
): void {
  for (const node of nodes) {
    if (node.type === 'generator') {
      for (const y of node.yields) {
        if (y.effect.type === 'effect') {
          const callee = y.effect.callee.trim();
          // Ignore Effect.* calls — we want generator-to-generator calls
          if (callee && !callee.startsWith('Effect.') && !callee.includes('.')) {
            const location = y.effect.location
              ? { line: y.effect.location.line, column: y.effect.location.column }
              : undefined;
            result.push({ callee, isYieldStar: true, location });
          }
        }
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) {
      collectYieldStarCalls(children, result);
    }
  }
}

// =============================================================================
// Build Graph from multiple IRs
// =============================================================================

/**
 * Build a program composition graph from a list of analyzed IRs (e.g. from one file).
 */
export function analyzeProgramGraph(
  irs: readonly StaticEffectIR[],
  filePath: string,
  options: CompositionResolverOptions = {},
): ProgramGraph {
  const programNames = new Set(irs.map((ir) => ir.root.programName));
  const firstIr = irs.length > 0 ? irs[0] : undefined;
  const entryProgram =
    options.entryProgramName ?? (firstIr ? firstIr.root.programName : '');

  const graph: ProgramGraph = {
    programs: new Map(),
    entryProgram,
    circularDependencies: [],
    unresolvedReferences: [],
  };

  for (const ir of irs) {
    const name = ir.root.programName;
    const refs: { callee: string; location?: { line: number; column: number } }[] = [];
    collectEffectCallees(ir.root.children, refs);

    const calls: ProgramCallEdge[] = refs
      .filter((r) => programNames.has(r.callee) && r.callee !== name)
      .map((r) =>
        r.location
          ? { targetProgram: r.callee, callSite: r.location, resolved: true }
          : { targetProgram: r.callee, resolved: true },
      );

    for (const r of refs) {
      if (programNames.has(r.callee) && r.callee !== name) continue;
      if (r.callee.startsWith('Effect.') || r.callee.includes('.')) continue;
      graph.unresolvedReferences.push({
        programName: r.callee,
        referencedFrom: name,
        reason: 'Program not found in graph',
      });
    }

    const calledBy: string[] = [];
    for (const other of irs) {
      if (other.root.programName === name) continue;
      const otherRefs: { callee: string }[] = [];
      collectEffectCallees(other.root.children, otherRefs);
      if (otherRefs.some((r) => r.callee === name)) {
        calledBy.push(other.root.programName);
      }
    }

    graph.programs.set(name, {
      name,
      filePath,
      ir,
      calls,
      calledBy,
    });
  }

  // Detect cycles
  const stack: string[] = [];
  const visited = new Set<string>();
  function dfs(programName: string): void {
    if (stack.includes(programName)) {
      const start = stack.indexOf(programName);
      graph.circularDependencies.push([...stack.slice(start), programName]);
      return;
    }
    if (visited.has(programName)) return;
    visited.add(programName);
    stack.push(programName);
    const node = graph.programs.get(programName);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) dfs(call.targetProgram);
      }
    }
    stack.pop();
  }
  for (const name of graph.programs.keys()) {
    dfs(name);
  }

  return graph;
}

// =============================================================================
// Graph Utilities
// =============================================================================

export function getTopologicalOrder(graph: ProgramGraph): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (temp.has(name)) return;
    temp.add(name);
    const node = graph.programs.get(name);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) visit(call.targetProgram);
      }
    }
    temp.delete(name);
    visited.add(name);
    result.push(name);
  }

  for (const name of graph.programs.keys()) {
    visit(name);
  }
  return result;
}

export function getDependencies(
  graph: ProgramGraph,
  programName: string,
): string[] {
  const deps = new Set<string>();
  const visited = new Set<string>();

  function collect(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const node = graph.programs.get(name);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) {
          deps.add(call.targetProgram);
          collect(call.targetProgram);
        }
      }
    }
  }
  collect(programName);
  return Array.from(deps);
}

export function getDependents(
  graph: ProgramGraph,
  programName: string,
): string[] {
  const dependents = new Set<string>();
  const visited = new Set<string>();

  function collect(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const node = graph.programs.get(name);
    if (node) {
      for (const caller of node.calledBy) {
        dependents.add(caller);
        collect(caller);
      }
    }
  }
  collect(programName);
  return Array.from(dependents);
}

export function calculateGraphComplexity(
  graph: ProgramGraph,
): {
  totalCyclomaticComplexity: number;
  totalPrograms: number;
  maxDepth: number;
  hasCircularDependencies: boolean;
} {
  let totalCC = 0;
  let maxDepth = 0;

  for (const node of graph.programs.values()) {
    totalCC += calculateComplexity(node.ir).cyclomaticComplexity;
  }

  const order = getTopologicalOrder(graph);
  const depths = new Map<string, number>();

  for (const name of order) {
    const node = graph.programs.get(name);
    if (!node) continue;
    let depth = 0;
    for (const call of node.calls) {
      if (call.resolved) {
        depth = Math.max(
          depth,
          (depths.get(call.targetProgram) ?? 0) + 1,
        );
      }
    }
    depths.set(name, depth);
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    totalCyclomaticComplexity: totalCC,
    totalPrograms: graph.programs.size,
    maxDepth,
    hasCircularDependencies: graph.circularDependencies.length > 0,
  };
}

export function renderGraphMermaid(graph: ProgramGraph): string {
  const lines: string[] = [];
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

  lines.push('flowchart TD');
  lines.push('');
  lines.push('  %% Program Composition Graph');
  lines.push('');

  for (const [name] of graph.programs) {
    const isEntry = name === graph.entryProgram;
    const shape = isEntry
      ? `${sanitize(name)}[["${name}"]]\n`
      : `  ${sanitize(name)}["${name}"]`;
    lines.push(shape.startsWith('  ') ? shape : `  ${shape}`);
  }
  lines.push('');

  for (const [, node] of graph.programs) {
    for (const call of node.calls) {
      if (call.resolved) {
        const label = call.callSite
          ? `L${call.callSite.line}`
          : '';
        if (label) {
          lines.push(
            `  ${sanitize(node.name)} -->|${label}| ${sanitize(call.targetProgram)}`,
          );
        } else {
          lines.push(
            `  ${sanitize(node.name)} --> ${sanitize(call.targetProgram)}`,
          );
        }
      }
    }
  }

  // Style entry point and circular deps
  lines.push('');
  lines.push('  classDef entryPoint fill:#C8E6C9,stroke:#2E7D32,stroke-width:3px');
  lines.push(`  class ${sanitize(graph.entryProgram)} entryPoint`);

  if (graph.circularDependencies.length > 0) {
    lines.push('  classDef cyclic fill:#FFCDD2,stroke:#C62828,stroke-width:2px');
    const cyclicNodes = new Set<string>();
    for (const cycle of graph.circularDependencies) {
      for (const n of cycle) cyclicNodes.add(n);
    }
    for (const n of cyclicNodes) {
      lines.push(`  class ${sanitize(n)} cyclic`);
    }
  }

  return lines.join('\n');
}

/**
 * Render a composition Mermaid diagram showing generator call relationships
 * with subgraphs grouping by file and yield* edge labels.
 */
export function renderCompositionMermaid(graph: ProgramGraph): string {
  const lines: string[] = [];
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

  lines.push('flowchart TD');
  lines.push('');

  // Group programs by file
  const byFile = new Map<string, ProgramGraphNode[]>();
  for (const [, node] of graph.programs) {
    const list = byFile.get(node.filePath) ?? [];
    list.push(node);
    byFile.set(node.filePath, list);
  }

  // Render subgraphs per file
  let fileIdx = 0;
  for (const [filePath, nodes] of byFile) {
    const fileName = filePath.split('/').pop() ?? filePath;
    lines.push(`  subgraph file${fileIdx}["${fileName}"]`);
    for (const node of nodes) {
      const isEntry = node.name === graph.entryProgram;
      if (isEntry) {
        lines.push(`    ${sanitize(node.name)}[["${node.name}"]]`);
      } else {
        lines.push(`    ${sanitize(node.name)}["${node.name}"]`);
      }
    }
    lines.push('  end');
    lines.push('');
    fileIdx++;
  }

  // Edges
  for (const [, node] of graph.programs) {
    for (const call of node.calls) {
      if (call.resolved) {
        const label = call.callSite ? `yield* L${call.callSite.line}` : 'yield*';
        lines.push(`  ${sanitize(node.name)} -->|${label}| ${sanitize(call.targetProgram)}`);
      }
    }
  }

  // Unresolved references
  if (graph.unresolvedReferences.length > 0) {
    lines.push('');
    lines.push('  %% Unresolved references');
    for (const ref of graph.unresolvedReferences) {
      const refId = `unresolved_${sanitize(ref.programName)}`;
      lines.push(`  ${refId}["? ${ref.programName}"]`);
      lines.push(`  ${sanitize(ref.referencedFrom)} -.-> ${refId}`);
    }
    lines.push('  classDef unresolved fill:#FFF3CD,stroke:#856404,stroke-dasharray:5');
    for (const ref of graph.unresolvedReferences) {
      lines.push(`  class unresolved_${sanitize(ref.programName)} unresolved`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Cross-File Composition Analysis
// =============================================================================

export interface ProjectCompositionOptions {
  /** Entry program name */
  entryProgramName?: string | undefined;
}

/**
 * Build a composition graph from a project-wide analysis result (multi-file).
 * Merges IRs across files into a unified program graph with cross-file edges.
 */
export function analyzeProjectComposition(
  byFile: ReadonlyMap<string, readonly StaticEffectIR[]>,
  options: ProjectCompositionOptions = {},
  serviceMap?: ProjectServiceMap,
): ProgramGraph {
  // Collect all programs across all files
  const allProgramNames = new Set<string>();
  const programToFile = new Map<string, string>();
  const programToIR = new Map<string, StaticEffectIR>();

  for (const [filePath, irs] of byFile) {
    for (const ir of irs) {
      const name = ir.root.programName;
      allProgramNames.add(name);
      programToFile.set(name, filePath);
      programToIR.set(name, ir);
    }
  }

  const firstProgram = allProgramNames.values().next().value;
  const entryProgram = options.entryProgramName ?? firstProgram ?? '';

  const graph: ProgramGraph = {
    programs: new Map(),
    entryProgram,
    circularDependencies: [],
    unresolvedReferences: [],
  };

  // Build nodes with cross-file edge resolution
  for (const [name, ir] of programToIR) {
    const filePath = programToFile.get(name) ?? '';
    const refs: { callee: string; location?: { line: number; column: number } }[] = [];
    collectEffectCallees(ir.root.children, refs);

    // Also collect yield* calls from generators
    const yieldRefs: YieldStarCall[] = [];
    collectYieldStarCalls(ir.root.children, yieldRefs);
    for (const yr of yieldRefs) {
      if (!refs.some(r => r.callee === yr.callee)) {
        const entry: { callee: string; location?: { line: number; column: number } } = { callee: yr.callee };
        if (yr.location) entry.location = yr.location;
        refs.push(entry);
      }
    }

    const calls: ProgramCallEdge[] = refs
      .filter((r) => allProgramNames.has(r.callee) && r.callee !== name)
      .map((r) =>
        r.location
          ? { targetProgram: r.callee, callSite: r.location, resolved: true }
          : { targetProgram: r.callee, resolved: true },
      );

    // Track unresolved references (service refs are resolved if serviceMap is provided)
    const knownServiceIds = serviceMap ? new Set(serviceMap.services.keys()) : new Set<string>();
    for (const r of refs) {
      if (allProgramNames.has(r.callee) && r.callee !== name) continue;
      if (r.callee.startsWith('Effect.') || r.callee.includes('.')) continue;
      if (r.callee === name) continue;
      if (knownServiceIds.has(r.callee)) continue; // resolved as service reference
      graph.unresolvedReferences.push({
        programName: r.callee,
        referencedFrom: name,
        reason: 'Program not found in project',
      });
    }

    // Build calledBy from all other programs
    const calledBy: string[] = [];
    for (const [otherName, otherIR] of programToIR) {
      if (otherName === name) continue;
      const otherRefs: { callee: string }[] = [];
      collectEffectCallees(otherIR.root.children, otherRefs);
      const otherYields: YieldStarCall[] = [];
      collectYieldStarCalls(otherIR.root.children, otherYields);
      if (
        otherRefs.some((r) => r.callee === name) ||
        otherYields.some((y) => y.callee === name)
      ) {
        calledBy.push(otherName);
      }
    }

    graph.programs.set(name, {
      name,
      filePath,
      ir,
      calls,
      calledBy,
    });
  }

  // Detect cycles
  const stack: string[] = [];
  const visited = new Set<string>();
  function dfs(programName: string): void {
    if (stack.includes(programName)) {
      const start = stack.indexOf(programName);
      graph.circularDependencies.push([...stack.slice(start), programName]);
      return;
    }
    if (visited.has(programName)) return;
    visited.add(programName);
    stack.push(programName);
    const node = graph.programs.get(programName);
    if (node) {
      for (const call of node.calls) {
        if (call.resolved) dfs(call.targetProgram);
      }
    }
    stack.pop();
  }
  for (const name of graph.programs.keys()) {
    dfs(name);
  }

  return graph;
}

// =============================================================================
// Service-Aware Composition Rendering
// =============================================================================

/**
 * Render a composition Mermaid diagram that includes service nodes from the service map.
 * Programs are rectangular, services are hexagonal.
 */
export function renderCompositionWithServicesMermaid(
  graph: ProgramGraph,
  projectServiceMap: ProjectServiceMap,
): string {
  const compLines: string[] = [];
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

  compLines.push('flowchart TD');
  compLines.push('');

  // Program nodes
  compLines.push('  %% Programs');
  for (const [name] of graph.programs) {
    const isEntry = name === graph.entryProgram;
    if (isEntry) {
      compLines.push(`  ${sanitize(name)}[["${name}"]]`);
    } else {
      compLines.push(`  ${sanitize(name)}["${name}"]`);
    }
  }
  compLines.push('');

  // Service nodes (hexagon shape)
  compLines.push('  %% Services');
  for (const [serviceId] of projectServiceMap.services) {
    compLines.push(`  svc_${sanitize(serviceId)}{{{"${serviceId}"}}}`);
  }
  compLines.push('');

  // Program-to-program edges
  compLines.push('  %% Program calls');
  for (const [, node] of graph.programs) {
    for (const call of node.calls) {
      if (call.resolved) {
        const label = call.callSite ? `yield* L${call.callSite.line}` : 'yield*';
        compLines.push(`  ${sanitize(node.name)} -->|${label}| ${sanitize(call.targetProgram)}`);
      }
    }
  }
  compLines.push('');

  // Program-to-service edges (yield* ServiceTag)
  compLines.push('  %% Service dependencies');
  for (const [serviceId, artifact] of projectServiceMap.services) {
    for (const consumer of artifact.consumers) {
      if (graph.programs.has(consumer.programName)) {
        compLines.push(`  ${sanitize(consumer.programName)} -.->|yield*| svc_${sanitize(serviceId)}`);
      }
    }
  }
  compLines.push('');

  // Service-to-service edges
  compLines.push('  %% Service layer dependencies');
  for (const [serviceId, artifact] of projectServiceMap.services) {
    for (const dep of artifact.dependencies) {
      if (projectServiceMap.services.has(dep)) {
        compLines.push(`  svc_${sanitize(serviceId)} -.-> svc_${sanitize(dep)}`);
      }
    }
  }
  compLines.push('');

  // Styling
  compLines.push('  classDef entryPoint fill:#C8E6C9,stroke:#2E7D32,stroke-width:3px');
  compLines.push('  classDef service fill:#E3F2FD,stroke:#1565C0,stroke-width:2px');
  compLines.push(`  class ${sanitize(graph.entryProgram)} entryPoint`);
  for (const serviceId of projectServiceMap.services.keys()) {
    compLines.push(`  class svc_${sanitize(serviceId)} service`);
  }

  return compLines.join('\n');
}
