/**
 * Colocated output - writes analysis files next to source files
 */

import * as path from 'path';
import * as fs from 'node:fs/promises';
import { Effect } from 'effect';
import type { StaticEffectIR, AnalysisStats, DiagramQuality, ServiceArtifact, ProjectServiceMap } from '../types';
import { renderMermaid, renderEnhancedMermaid, renderPathsMermaid } from './mermaid';
import { generatePaths } from '../path-generator';
import { renderExplanation } from './explain';

/**
 * Derive the output path for a colocated analysis file.
 * foo/bar.ts -> foo/bar.effect-analysis.md
 */
export const deriveOutputPath = (sourcePath: string, suffix: string): string => {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(dir, `${base}.${suffix}.md`);
};

/**
 * Format stats as a markdown summary
 */
const formatStats = (stats: AnalysisStats): string => {
  const lines: string[] = [];

  if (stats.totalEffects > 0) lines.push(`- **Total Effects**: ${stats.totalEffects}`);
  if (stats.parallelCount > 0) lines.push(`- **Parallel Operations**: ${stats.parallelCount}`);
  if (stats.raceCount > 0) lines.push(`- **Race Operations**: ${stats.raceCount}`);
  if (stats.errorHandlerCount > 0) lines.push(`- **Error Handlers**: ${stats.errorHandlerCount}`);
  if (stats.retryCount > 0) lines.push(`- **Retry Operations**: ${stats.retryCount}`);
  if (stats.timeoutCount > 0) lines.push(`- **Timeout Operations**: ${stats.timeoutCount}`);
  if (stats.resourceCount > 0) lines.push(`- **Resources**: ${stats.resourceCount}`);
  if (stats.loopCount > 0) lines.push(`- **Loops**: ${stats.loopCount}`);
  if (stats.conditionalCount > 0) lines.push(`- **Conditionals**: ${stats.conditionalCount}`);
  if (stats.layerCount > 0) lines.push(`- **Layers**: ${stats.layerCount}`);
  if (stats.unknownCount > 0) lines.push(`- **Unknown Nodes**: ${stats.unknownCount}`);

  return lines.length > 0 ? lines.join('\n') : '- No operations found';
};

/**
 * Render a single IR as markdown content for colocated output
 */
export const renderColocatedMarkdown = (
  ir: StaticEffectIR,
  direction: 'TB' | 'LR' | 'BT' | 'RL' = 'TB',
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const sections: string[] = [];

    // Header
    sections.push(`# Effect Analysis: ${ir.root.programName}`);
    sections.push('');

    // Metadata
    sections.push('## Metadata');
    sections.push('');
    sections.push(`- **File**: \`${ir.metadata.filePath}\``);
    sections.push(`- **Analyzed**: ${new Date(ir.metadata.analyzedAt).toISOString()}`);
    sections.push(`- **Source Type**: ${ir.root.source}`);
    if (ir.metadata.tsVersion) {
      sections.push(`- **TypeScript Version**: ${ir.metadata.tsVersion}`);
    }
    sections.push('');

    // Mermaid diagram
    sections.push('## Effect Flow');
    sections.push('');
    sections.push('```mermaid');
    const diagram = yield* renderMermaid(ir, { direction });
    sections.push(diagram.trim());
    sections.push('```');
    sections.push('');

    // Stats
    sections.push('## Statistics');
    sections.push('');
    sections.push(formatStats(ir.metadata.stats));
    sections.push('');

    // Explanation
    const explanation = renderExplanation(ir);
    sections.push('## Explanation');
    sections.push('');
    sections.push('```');
    sections.push(explanation);
    sections.push('```');
    sections.push('');

    // Dependencies
    if (ir.root.dependencies.length > 0) {
      sections.push('## Dependencies');
      sections.push('');
      for (const dep of ir.root.dependencies) {
        const typeInfo = dep.typeSignature ? `: ${dep.typeSignature}` : '';
        const layerInfo = dep.isLayer ? ' (Layer)' : '';
        sections.push(`- \`${dep.name}\`${typeInfo}${layerInfo}`);
      }
      sections.push('');
    }

    // Error types
    if (ir.root.errorTypes.length > 0) {
      sections.push('## Error Types');
      sections.push('');
      for (const errorType of ir.root.errorTypes) {
        sections.push(`- \`${errorType}\``);
      }
      sections.push('');
    }

    // Warnings
    if (ir.metadata.warnings.length > 0) {
      sections.push('## Warnings');
      sections.push('');
      for (const warning of ir.metadata.warnings) {
        const location = warning.location
          ? ` (${warning.location.filePath}:${warning.location.line})`
          : '';
        sections.push(`- **${warning.code}**: ${warning.message}${location}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  });

/**
 * Render one markdown doc for a source file with multiple programs (one section per program).
 * Gold tier: set useEnhanced true to use enhanced Mermaid diagrams in the doc.
 */
export const renderColocatedMarkdownForFile = (
  irs: readonly StaticEffectIR[],
  direction: 'TB' | 'LR' | 'BT' | 'RL' = 'TB',
  useEnhanced = true,
  qualityByProgram?: ReadonlyMap<string, DiagramQuality>,
  styleGuide = false,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const sections: string[] = [];
    for (let i = 0; i < irs.length; i++) {
      const ir = irs[i];
      if (!ir) continue;
      if (i > 0) sections.push('', '---', '');

      sections.push(`# Effect Analysis: ${ir.root.programName}`, '');

      sections.push('## Metadata', '');
      sections.push(`- **File**: \`${ir.metadata.filePath}\``);
      sections.push(`- **Analyzed**: ${new Date(ir.metadata.analyzedAt).toISOString()}`);
      sections.push(`- **Source Type**: ${ir.root.source}`);
      if (ir.metadata.tsVersion) {
        sections.push(`- **TypeScript Version**: ${ir.metadata.tsVersion}`);
      }
      sections.push('', '');

      sections.push('## Effect Flow', '', '```mermaid');
      const diagram = useEnhanced
        ? renderEnhancedMermaid(ir, { direction })
        : (yield* renderMermaid(ir, { direction }));
      sections.push(diagram.trim());
      sections.push('```', '', '');

      if (styleGuide) {
        const paths = generatePaths(ir);
        if (paths.length > 0) {
          sections.push('## Summary Flow (Style Guide)', '', '```mermaid');
          sections.push(
            renderPathsMermaid(paths, { direction, styleGuide: true }).trim(),
          );
          sections.push('```', '', '');
        }
      }

      const quality = qualityByProgram?.get(ir.root.id);
      if (quality) {
        sections.push('## Diagram Quality', '');
        sections.push(`- **Readability score**: ${quality.score} (${quality.band})`);
        sections.push(
          `- **Detailed steps**: ${quality.metrics.stepCountDetailed} | **Summary steps**: ${quality.metrics.stepCountSummary}`,
        );
        sections.push(
          `- **Unknown nodes**: ${quality.metrics.unknownNodeCount} | **Anonymous nodes**: ${quality.metrics.anonymousNodeCount}`,
        );
        sections.push('');
        if (quality.reasons.length > 0) {
          sections.push('### Reasons', '');
          for (const reason of quality.reasons) {
            sections.push(`- ${reason}`);
          }
          sections.push('');
        }
        if (quality.tips.length > 0) {
          sections.push('### Tips', '');
          for (const tip of quality.tips) {
            sections.push(`- ${tip}`);
          }
          sections.push('');
        }
        sections.push('');
      }

      sections.push('## Statistics', '', formatStats(ir.metadata.stats), '', '');

      // Explanation section
      const explanation = renderExplanation(ir);
      sections.push('## Explanation', '', '```', explanation, '```', '', '');

      if (ir.root.dependencies.length > 0) {
        sections.push('## Dependencies', '');
        for (const dep of ir.root.dependencies) {
          const typeInfo = dep.typeSignature ? `: ${dep.typeSignature}` : '';
          const layerInfo = dep.isLayer ? ' (Layer)' : '';
          sections.push(`- \`${dep.name}\`${typeInfo}${layerInfo}`);
        }
        sections.push('', '');
      }
      if (ir.root.errorTypes.length > 0) {
        sections.push('## Error Types', '');
        for (const errorType of ir.root.errorTypes) {
          sections.push(`- \`${errorType}\``);
        }
        sections.push('', '');
      }
      if (ir.metadata.warnings.length > 0) {
        sections.push('## Warnings', '');
        for (const warning of ir.metadata.warnings) {
          const location = warning.location
            ? ` (${warning.location.filePath}:${warning.location.line})`
            : '';
          sections.push(`- **${warning.code}**: ${warning.message}${location}`);
        }
        sections.push('', '');
      }
    }
    return sections.join('\n');
  });

/**
 * Write one colocated markdown file per source file (all programs in that file).
 */
export const writeColocatedOutputForFile = (
  filePath: string,
  irs: readonly StaticEffectIR[],
  suffix: string,
  direction: 'TB' | 'LR' | 'BT' | 'RL' = 'TB',
  useEnhanced = true,
  qualityByProgram?: ReadonlyMap<string, DiagramQuality>,
  styleGuide = false,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const outputPath = deriveOutputPath(filePath, suffix);
    const content = yield* renderColocatedMarkdownForFile(
      irs,
      direction,
      useEnhanced,
      qualityByProgram,
      styleGuide,
    );

    yield* Effect.tryPromise({
      try: () => fs.writeFile(outputPath, content, 'utf-8'),
      catch: (e) => new Error(`Failed to write ${outputPath}: ${String(e)}`),
    });

    return outputPath;
  });

/**
 * Write colocated output file for an IR (single program; multi-program files overwrite).
 */
export const writeColocatedOutput = (
  ir: StaticEffectIR,
  suffix: string,
  direction: 'TB' | 'LR' | 'BT' | 'RL' = 'TB',
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const outputPath = deriveOutputPath(ir.metadata.filePath, suffix);
    const content = yield* renderColocatedMarkdown(ir, direction);

    yield* Effect.tryPromise({
      try: () => fs.writeFile(outputPath, content, 'utf-8'),
      catch: (e) => new Error(`Failed to write ${outputPath}: ${String(e)}`),
    });

    return outputPath;
  });

// =============================================================================
// Service Artifact Output
// =============================================================================

/**
 * Render a service artifact as markdown content.
 */
export const renderServiceArtifactMarkdown = (
  artifact: ServiceArtifact,
): string => {
  const sections: string[] = [];

  sections.push(`# Service: ${artifact.serviceId}`);
  sections.push('');

  // Definition
  sections.push('## Definition');
  sections.push('');
  sections.push(`- **Class**: \`${artifact.className}\``);
  sections.push(`- **File**: \`${artifact.definitionFilePath}:${artifact.definitionLocation.line}\``);
  sections.push(`- **Tag**: \`'${artifact.serviceId}'\``);
  if (artifact.interfaceTypeText) {
    sections.push(`- **Type**: \`${artifact.interfaceTypeText}\``);
  }
  sections.push('');

  // Interface
  if (artifact.definition.methods.length > 0 || artifact.definition.properties.length > 0) {
    sections.push('## Interface');
    sections.push('');
    if (artifact.definition.methods.length > 0) {
      sections.push('**Methods:**');
      for (const method of artifact.definition.methods) {
        sections.push(`- \`${method}\``);
      }
      sections.push('');
    }
    if (artifact.definition.properties.length > 0) {
      sections.push('**Properties:**');
      for (const prop of artifact.definition.properties) {
        sections.push(`- \`${prop}\``);
      }
      sections.push('');
    }
  }

  // Layer Implementations
  if (artifact.layerImplementations.length > 0) {
    sections.push('## Layer Implementations');
    sections.push('');
    for (const layer of artifact.layerImplementations) {
      sections.push(`### ${layer.name} (\`${layer.filePath}:${layer.location.line}\`)`);
      sections.push('');
      sections.push(`- **Kind**: Layer.${layer.kind}`);
      if (layer.requires.length > 0) {
        sections.push(`- **Requires**: ${layer.requires.join(', ')}`);
      } else {
        sections.push('- **Requires**: (none)');
      }
      sections.push('');
    }
  }

  // Consumers
  if (artifact.consumers.length > 0) {
    sections.push(`## Consumers (${artifact.consumers.length} program${artifact.consumers.length === 1 ? '' : 's'})`);
    sections.push('');
    for (const consumer of artifact.consumers) {
      const loc = consumer.location ? `:${consumer.location.line}` : '';
      sections.push(`- \`${consumer.programName}\` in \`${consumer.filePath}${loc}\``);
    }
    sections.push('');
  }

  // Dependencies
  if (artifact.dependencies.length > 0) {
    sections.push('## Dependencies');
    sections.push('');
    for (const dep of artifact.dependencies) {
      sections.push(`- ${dep}`);
    }
    sections.push('');
  }

  return sections.join('\n');
};

/**
 * Derive the output path for a service artifact file.
 * service-id -> dir/service-id.service-analysis.md
 */
export const deriveServiceOutputPath = (
  definitionFilePath: string,
  serviceId: string,
): string => {
  const dir = path.dirname(definitionFilePath);
  const sanitized = serviceId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return path.join(dir, `${sanitized}.service-analysis.md`);
};

/**
 * Write a service artifact markdown file.
 */
export const writeServiceArtifact = (
  artifact: ServiceArtifact,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const outputPath = deriveServiceOutputPath(artifact.definitionFilePath, artifact.serviceId);
    const content = renderServiceArtifactMarkdown(artifact);

    yield* Effect.tryPromise({
      try: () => fs.writeFile(outputPath, content, 'utf-8'),
      catch: (e) => new Error(`Failed to write ${outputPath}: ${String(e)}`),
    });

    return outputPath;
  });

/**
 * Write all service artifact files for a project service map.
 */
export const writeAllServiceArtifacts = (
  serviceMap: ProjectServiceMap,
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const writtenPaths: string[] = [];
    for (const artifact of serviceMap.services.values()) {
      const outputPath = yield* writeServiceArtifact(artifact);
      writtenPaths.push(outputPath);
    }
    return writtenPaths;
  });
