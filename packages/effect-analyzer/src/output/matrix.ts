import type { StaticEffectIR, ProjectServiceMap } from '../types';

/**
 * Build a program x service dependency matrix as a markdown table from IR dependencies.
 */
export function renderDependencyMatrix(irs: readonly StaticEffectIR[]): string {
  // Collect all unique service/dependency names and program names.
  // Note: program names can collide (e.g. multiple `main` programs across files).
  // We render one row per program name, but preserve the *actual* program count in the footer.
  const serviceSet = new Set<string>();
  const depsByProgramName = new Map<string, Set<string>>();

  for (const ir of irs) {
    const programName = ir.root.programName;
    const depSet = depsByProgramName.get(programName) ?? new Set<string>();
    for (const dep of ir.root.dependencies) {
      serviceSet.add(dep.name);
      depSet.add(dep.name);
    }
    depsByProgramName.set(programName, depSet);
  }

  const services = [...serviceSet].sort((a, b) => a.localeCompare(b));
  const programNames = [...depsByProgramName.keys()].sort((a, b) =>
    a.localeCompare(b),
  );

  return buildMarkdownTable(
    programNames,
    services,
    (program, service) => {
      const deps = depsByProgramName.get(program);
      return deps ? deps.has(service) : false;
    },
    { programs: irs.length, services: services.length },
  );
}

/**
 * Build a program x service dependency matrix as a markdown table from the
 * project-level service map (more accurate than IR-based).
 */
export function renderDependencyMatrixFromServiceMap(
  serviceMap: ProjectServiceMap,
): string {
  const services: string[] = [];
  const programSet = new Set<string>();
  const programInstances = new Set<string>();
  const serviceToProgramsMap = new Map<string, Set<string>>();

  for (const [serviceId, artifact] of serviceMap.services) {
    services.push(serviceId);
    const consumerPrograms = new Set<string>();
    for (const consumer of artifact.consumers) {
      consumerPrograms.add(consumer.programName);
      programSet.add(consumer.programName);
      // Program names can collide across files; preserve true program instance count.
      programInstances.add(`${consumer.filePath}::${consumer.programName}`);
    }
    serviceToProgramsMap.set(serviceId, consumerPrograms);
  }

  services.sort((a, b) => a.localeCompare(b));
  const programs = [...programSet].sort((a, b) => a.localeCompare(b));

  return buildMarkdownTable(programs, services, (program, service) => {
    const consumers = serviceToProgramsMap.get(service);
    return consumers ? consumers.has(program) : false;
  }, { programs: programInstances.size, services: services.length });
}

/**
 * Render a markdown table with programs as rows and services as columns.
 */
function buildMarkdownTable(
  programs: readonly string[],
  services: readonly string[],
  hasRelation: (program: string, service: string) => boolean,
  summary?: { readonly programs: number; readonly services: number },
): string {
  const summaryPrograms = summary?.programs ?? programs.length;
  const summaryServices = summary?.services ?? services.length;
  if (programs.length === 0 || services.length === 0) {
    return `_No dependencies found._\n\n${summaryPrograms} programs × ${summaryServices} services`;
  }

  const lines: string[] = [];

  // Header row
  lines.push(`| Program | ${services.join(' | ')} |`);

  // Separator row with centered alignment for service columns
  const separators = services.map((s) => `:${'-'.repeat(Math.max(s.length - 2, 1))}:`);
  lines.push(`|${'-'.repeat(9)}|${separators.join('|')}|`);

  // Data rows
  for (const program of programs) {
    const cells = services.map((service) => (hasRelation(program, service) ? '✓' : ''));
    lines.push(`| ${program} | ${cells.join(' | ')} |`);
  }

  lines.push('');
  lines.push(`${summaryPrograms} programs × ${summaryServices} services`);

  return lines.join('\n');
}
