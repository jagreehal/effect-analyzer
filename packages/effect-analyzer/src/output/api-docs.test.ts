import { describe, it, expect } from 'vitest';
import { renderApiDocsMarkdown, renderApiDocsMermaid, renderOpenApiPaths } from './api-docs';
import type { HttpApiStructure } from '../http-api-extractor';

const structures: readonly HttpApiStructure[] = [
  {
    apiId: 'TodoApi',
    filePath: 'test.ts',
    prefix: '/api',
    groups: [
      {
        name: 'todos',
        prefix: '/v1',
        endpoints: [
          {
            name: 'listTodos',
            method: 'GET',
            path: '/todos',
            location: {
              filePath: 'test.ts',
              line: 1,
              column: 1,
            },
          },
        ],
      },
    ],
  },
];

describe('api docs renderers', () => {
  it('includes both API and group prefixes in rendered endpoint paths', () => {
    const markdown = renderApiDocsMarkdown(structures);

    expect(markdown).toContain('| GET | /api/v1/todos | listTodos | - |');
  });

  it('includes both API and group prefixes in Mermaid endpoint labels', () => {
    const mermaid = renderApiDocsMermaid(structures);

    expect(mermaid).toContain('GET /api/v1/todos');
  });

  it('renders URL params as path parameters in OpenAPI output', () => {
    const { paths } = renderOpenApiPaths([
      {
        apiId: 'TodoApi',
        filePath: 'test.ts',
        groups: [
          {
            name: 'todos',
            endpoints: [
              {
                name: 'getTodo',
                method: 'GET',
                path: '/todos/:id',
                location: {
                  filePath: 'test.ts',
                  line: 1,
                  column: 1,
                },
                urlParamsSchema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                  required: ['id'],
                },
              },
            ],
          },
        ],
      },
    ]);

    expect(paths['/todos/:id']?.get?.parameters).toContainEqual({
      name: 'id',
      in: 'path',
      schema: { type: 'string' },
    });
  });
});
