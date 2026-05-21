import type { ProjectServiceMap } from './types';

export interface ServiceCycle {
  readonly services: readonly string[];
  readonly size: number;
}

const canonicalizeCycle = (cycle: readonly string[]): readonly string[] => {
  if (cycle.length === 0) return cycle;
  const base = [...cycle];
  let minIdx = 0;
  for (let i = 1; i < base.length; i++) {
    if (base[i]!.localeCompare(base[minIdx]!) < 0) minIdx = i;
  }
  const rotated = [...base.slice(minIdx), ...base.slice(0, minIdx)];
  return rotated;
};

export const detectServiceCycles = (serviceMap: ProjectServiceMap): readonly ServiceCycle[] => {
  const graph = new Map<string, readonly string[]>();
  for (const [serviceId, artifact] of serviceMap.services) {
    const deps = artifact.dependencies.filter((dep) => serviceMap.services.has(dep)).sort((a, b) => a.localeCompare(b));
    graph.set(serviceId, deps);
  }

  const indexByNode = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let index = 0;
  const cycles: ServiceCycle[] = [];

  const strongConnect = (node: string): void => {
    indexByNode.set(node, index);
    lowLink.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);

    const neighbors = graph.get(node) ?? [];
    for (const next of neighbors) {
      if (!indexByNode.has(next)) {
        strongConnect(next);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, indexByNode.get(next) ?? 0));
      }
    }

    if (lowLink.get(node) === indexByNode.get(node)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== node);

      const hasSelfLoop = (graph.get(node) ?? []).includes(node);
      if (scc.length > 1 || hasSelfLoop) {
        const canonical = canonicalizeCycle(scc.sort((a, b) => a.localeCompare(b)));
        cycles.push({ services: canonical, size: canonical.length });
      }
    }
  };

  for (const node of [...graph.keys()].sort((a, b) => a.localeCompare(b))) {
    if (!indexByNode.has(node)) strongConnect(node);
  }

  return cycles.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.services.join('|').localeCompare(b.services.join('|'));
  });
};
