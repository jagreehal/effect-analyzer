import type { StaticEffectIR } from '../types';

interface TestabilityOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

/**
 * Render a testability-focused Mermaid flowchart from an Effect IR.
 *
 * Shows what needs mocking for testing: required services, isolation boundaries,
 * and mock complexity (easy leaf services vs hard infrastructure/layer services).
 */
export function renderTestabilityMermaid(
  ir: StaticEffectIR,
  options: TestabilityOptions = {},
): string {
  const direction = options.direction ?? 'LR';
  const services = ir.root.requiredServices ?? [];
  const deps = ir.root.dependencies;

  if (services.length === 0) {
    return `flowchart ${direction}\n  NoMocks((No services to mock - pure computation))`;
  }

  // Build a set of layer dependency names for classification
  const layerNames = new Set(deps.filter(d => d.isLayer).map(d => d.name));

  const lines: string[] = [`flowchart ${direction}`];
  const easyIds: string[] = [];
  const hardIds: string[] = [];

  for (let i = 0; i < services.length; i++) {
    const sid = `S${i}`;
    const service = services[i];
    if (!service) continue;
    lines.push(`  Prog[${ir.root.programName}] -->|needs mock| ${sid}{{"${service.serviceId}"}}`);

    if (layerNames.has(service.serviceId)) {
      hardIds.push(sid);
    } else {
      easyIds.push(sid);
    }
  }

  // Add class definitions
  lines.push('');
  lines.push('  classDef easy fill:#C8E6C9');
  lines.push('  classDef hard fill:#FFE0B2');

  if (easyIds.length > 0) {
    lines.push(`  class ${easyIds.join(',')} easy`);
  }
  if (hardIds.length > 0) {
    lines.push(`  class ${hardIds.join(',')} hard`);
  }

  // Summary note
  const mockWord = services.length === 1 ? 'mock' : 'mocks';
  lines.push('');
  lines.push(`  Note[Requires ${services.length} service ${mockWord}]`);

  return lines.join('\n');
}
