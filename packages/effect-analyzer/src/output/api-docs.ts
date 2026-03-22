/**
 * API Documentation Output
 *
 * Renders HttpApi structure as markdown and OpenAPI paths.
 */

import type { HttpApiStructure } from '../http-api-extractor';

/**
 * Render API docs as markdown with H1 per API, H2 per group, and endpoint table.
 */
export function renderApiDocsMarkdown(structures: readonly HttpApiStructure[]): string {
  const lines: string[] = [];
  for (const api of structures) {
    lines.push(`# API: ${api.apiId}`);
    lines.push('');
    const apiPrefix = api.prefix ?? '';
    for (const group of api.groups) {
      lines.push(`## ${group.name}`);
      if (group.description) {
        lines.push('');
        lines.push(group.description);
        lines.push('');
      }
      lines.push('');
      lines.push('| Method | Path | Name | Description |');
      lines.push('|--------|------|------|-------------|');
      const groupPrefix = group.prefix ?? '';
      for (const ep of group.endpoints) {
        const fullPath = apiPrefix + groupPrefix + ep.path;
        const desc = ep.description ?? ep.summary ?? '-';
        const dep = ep.deprecated ? ' (deprecated)' : '';
        lines.push(`| ${ep.method} | ${fullPath} | ${ep.name}${dep} | ${desc} |`);
      }
      lines.push('');
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

/**
 * Render API structure as Mermaid flowchart (API -> groups -> endpoints).
 */
export function renderApiDocsMermaid(structures: readonly HttpApiStructure[]): string {
  const lines: string[] = ['flowchart TB'];
  let nodeId = 0;
  const ids = new Map<string, string>();
  const id = (prefix: string) => {
    const n = `${prefix}${nodeId++}`;
    ids.set(n, n);
    return n;
  };
  for (const api of structures) {
    const apiNode = id('api');
    lines.push(`  ${apiNode}["${api.apiId}"]`);
    for (const group of api.groups) {
      const groupNode = id('group');
      lines.push(`  ${groupNode}["${group.name}"]`);
      lines.push(`  ${apiNode} --> ${groupNode}`);
      const apiPrefix = api.prefix ?? '';
      const groupPrefix = group.prefix ?? '';
      for (const ep of group.endpoints) {
        const epNode = id('ep');
        const fullPath = apiPrefix + groupPrefix + ep.path;
        lines.push(`  ${epNode}["${ep.method} ${fullPath}"]`);
        lines.push(`  ${groupNode} --> ${epNode}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Render minimal OpenAPI paths object for merging into full spec.
 * Includes request/response schemas when extracted from Effect Schema.
 */
export function renderOpenApiPaths(structures: readonly HttpApiStructure[]): {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        summary?: string;
        deprecated?: boolean;
        requestBody?: { content: { 'application/json': { schema: unknown } } };
        responses?: Record<string, { content?: { 'application/json': { schema: unknown } }; description?: string }>;
        parameters?: { name: string; in: string; schema: unknown }[];
      }
    >
  >;
} {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const api of structures) {
    const apiPrefix = api.prefix ?? '';
    for (const group of api.groups) {
      const groupPrefix = group.prefix ?? '';
      for (const ep of group.endpoints) {
        const path = apiPrefix + groupPrefix + ep.path;
        paths[path] ??= {};
        const op = ep.method.toLowerCase();
        const pathOp: Record<string, unknown> = {
          operationId: `${group.name}.${ep.name}`,
          ...(ep.summary ? { summary: ep.summary } : {}),
          ...(ep.deprecated ? { deprecated: true } : {}),
        };
        if (ep.requestSchema) {
          pathOp.requestBody = {
            content: { 'application/json': { schema: ep.requestSchema } },
          };
        }
        if (ep.responseSchema) {
          pathOp.responses = {
            '200': {
              description: ep.summary ?? ep.description ?? 'Success',
              content: { 'application/json': { schema: ep.responseSchema } },
            },
          };
        }
        if (ep.urlParamsSchema?.properties) {
          const params = Object.entries(ep.urlParamsSchema.properties as Record<string, unknown>).map(
            ([name, schema]) => ({ name, in: 'path' as const, schema }),
          );
          if (params.length) pathOp.parameters = params;
        }
        paths[path][op] = pathOp;
      }
    }
  }
  return { paths } as ReturnType<typeof renderOpenApiPaths>;
}
