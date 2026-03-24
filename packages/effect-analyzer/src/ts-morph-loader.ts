/**
 * Runtime-configurable ts-morph loader.
 *
 * Node uses a lazy builtin-module fallback so browser bundles do not pull in
 * `node:module` at build time. Browser consumers must explicitly provide a
 * ts-morph-compatible module before calling source analysis APIs.
 */

import type { Project, SourceFile } from 'ts-morph';

type TsMorphModule = typeof import('ts-morph');
type TsMorphLoader = () => TsMorphModule;

let tsMorphModule: TsMorphModule | null = null;
let tsMorphLoader: TsMorphLoader | null = null;
const projectCache = new Map<string, Project>();

interface BuiltinAwareProcess {
  readonly getBuiltinModule?: (id: string) => unknown;
}

const getBuiltinModule = (id: string): unknown => {
  const maybeProcess = (globalThis as { process?: BuiltinAwareProcess }).process;
  return maybeProcess?.getBuiltinModule?.(id);
};

const loadNodeTsMorph = (): TsMorphModule | null => {
  const moduleBuiltin =
    getBuiltinModule('node:module') ?? getBuiltinModule('module');
  const createRequire =
    moduleBuiltin &&
    typeof moduleBuiltin === 'object' &&
    'createRequire' in moduleBuiltin
      ? (moduleBuiltin.createRequire as (url: string) => NodeJS.Require)
      : undefined;

  if (!createRequire) {
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    return require('ts-morph') as TsMorphModule;
  } catch {
    return null;
  }
};

export const setTsMorphModule = (module: TsMorphModule): void => {
  tsMorphModule = module;
};

export const setTsMorphLoader = (loader: TsMorphLoader): void => {
  tsMorphLoader = loader;
  tsMorphModule = null;
};

export const resetTsMorphRuntime = (): void => {
  tsMorphModule = null;
  tsMorphLoader = null;
  projectCache.clear();
};

export const loadTsMorph = (): TsMorphModule => {
  if (tsMorphModule) {
    return tsMorphModule;
  }

  const configuredModule =
    tsMorphLoader?.() ?? loadNodeTsMorph();

  if (!configuredModule) {
    throw new Error(
      'ts-morph is not configured. In Node, install ts-morph as a dependency. In browser builds, call setTsMorphModule() or setTsMorphLoader() before analysis.',
    );
  }

  tsMorphModule = configuredModule;
  return configuredModule;
};

export const createProject = (tsConfigPath?: string): Project => {
  const cacheKey = tsConfigPath ?? '__default__';
  const cached = projectCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { Project } = loadTsMorph();
  const options: { tsConfigFilePath?: string } = {};
  if (tsConfigPath) {
    options.tsConfigFilePath = tsConfigPath;
  }
  const project = new Project(options);
  projectCache.set(cacheKey, project);
  return project;
};

export const clearProjectCache = (): void => {
  projectCache.clear();
};

export const createProjectFromSource = (
  code: string,
  filePath = 'temp.ts',
): SourceFile => {
  const { Project } = loadTsMorph();
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      esModuleInterop: true,
    },
  });
  return project.createSourceFile(filePath, code);
};
