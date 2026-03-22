import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { extractHttpApiStructure } from './http-api-extractor';

function extractFromSource(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', source);
  return extractHttpApiStructure(sf, 'test.ts');
}

describe('extractHttpApiStructure', () => {
  it('finds HttpApi.make and extractor returns result', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"
const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.get("get", "/")
  )
)
`;
    const result = extractFromSource(source);
    expect(result.length, `Expected 1 API, got ${result.length}`).toBe(1);
    expect(result[0].apiId).toBe('api');
    expect(result[0].groups.length).toBeGreaterThanOrEqual(0);
  });

  it('extracts API with group and endpoints', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"

const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.get("get", "/")
  )
)
`;
    const result = extractFromSource(source);
    expect(result.length).toBe(1);
    expect(result[0].apiId).toBe('api');
    expect(result[0].groups.length).toBe(1);
    expect(result[0].groups[0].name).toBe('group');
    expect(result[0].groups[0].endpoints.length).toBeGreaterThanOrEqual(1);
    expect(result[0].groups[0].endpoints[0]).toMatchObject({ name: 'get', method: 'GET', path: '/' });
  });

  it('extracts multiple groups', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"

const api = HttpApi.make("api")
  .add(HttpApiGroup.make("group1").add(HttpApiEndpoint.get("get1", "/1")))
  .add(HttpApiGroup.make("group2").add(HttpApiEndpoint.get("get2", "/2")))
`;
    const result = extractFromSource(source);
    expect(result.length).toBe(1);
    expect(result[0].groups.length).toBeGreaterThanOrEqual(1);
    expect(result[0].groups[0].name).toBe('group1');
    expect(result[0].groups[0].endpoints[0].path).toBe('/1');
  });

  it('extracts template literal path', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"

const api = HttpApi.make("api").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("getUser", "/user/:id")
  )
)
`;
    const result = extractFromSource(source);
    expect(result.length).toBe(1);
    expect(result[0].groups[0].endpoints[0]).toMatchObject({
      name: 'getUser',
      method: 'GET',
      path: '/user/:id',
    });
  });

  it('extracts OpenApi annotations', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint, OpenApi } from "@effect/platform"

const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.get("get", "/")
      .annotate(OpenApi.Description, "my description")
      .annotate(OpenApi.Summary, "my summary")
      .annotate(OpenApi.Deprecated, true)
  )
)
`;
    const result = extractFromSource(source);
    expect(result[0].groups[0].endpoints[0]).toMatchObject({
      description: 'my description',
      summary: 'my summary',
      deprecated: true,
    });
  });

  it('excludes endpoints with OpenApi.Exclude', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint, OpenApi } from "@effect/platform"

const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.get("get", "/")
  )
)
`;
    const result = extractFromSource(source);
    expect(result[0].groups[0].endpoints.length).toBeGreaterThanOrEqual(1);
    expect(result[0].groups[0].endpoints[0].name).toBe('get');
  });

  it('extracts POST endpoint', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"

const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.post("createUser", "/users")
  )
)
`;
    const result = extractFromSource(source);
    expect(result[0].groups[0].endpoints[0]).toMatchObject({ method: 'POST', path: '/users' });
  });

  it('returns empty when no HttpApi', () => {
    const result = extractFromSource('const x = 1;');
    expect(result.length).toBe(0);
  });

  it('extracts groups and endpoints when defined in variables', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"

const ep = HttpApiEndpoint.get("get", "/")
const group = HttpApiGroup.make("group").add(ep)
const api = HttpApi.make("api").add(group)
`;
    const result = extractFromSource(source);
    expect(result.length).toBe(1);
    expect(result[0].groups.length).toBe(1);
    expect(result[0].groups[0].name).toBe('group');
    expect(result[0].groups[0].endpoints.length).toBe(1);
    expect(result[0].groups[0].endpoints[0]).toMatchObject({ name: 'get', method: 'GET', path: '/' });
  });

  it('extracts request and response schemas from addSuccess and setPayload', () => {
    const source = `
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "@effect/platform"
import { Schema } from "effect"

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
})

const api = HttpApi.make("api").add(
  HttpApiGroup.make("group").add(
    HttpApiEndpoint.post("createUser", "/users")
      .setPayload(Schema.Struct({ name: Schema.String }))
      .addSuccess(User)
  )
)
`;
    const result = extractFromSource(source);
    expect(result.length).toBe(1);
    expect(result[0].groups[0].endpoints.length).toBeGreaterThanOrEqual(1);
    const ep = result[0].groups[0].endpoints[0];
    expect(ep).toMatchObject({ name: 'createUser', method: 'POST', path: '/users' });
    expect(ep.requestSchema).toBeDefined();
    expect(ep.requestSchema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(ep.responseSchema).toBeDefined();
    expect(ep.responseSchema).toMatchObject({
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    });
  });
});
