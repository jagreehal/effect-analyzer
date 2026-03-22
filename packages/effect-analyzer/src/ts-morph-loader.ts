/**
 * Dynamic ts-morph loader to avoid direct dependency issues
 */

import { createRequire } from 'node:module';
import type { Project, SourceFile } from 'ts-morph';

let tsMorphModule: typeof import('ts-morph') | null = null;
const projectCache = new Map<string, Project>();

/**
 * Load ts-morph dynamically (peer dependency)
 */
export const loadTsMorph = (): typeof import('ts-morph') => {
  if (!tsMorphModule) {
    try {
      const require = createRequire(import.meta.url);
      tsMorphModule = require('ts-morph');
    } catch {
      throw new Error(
        'ts-morph is required but not installed. Please install it as a peer dependency: npm install ts-morph',
      );
    }
  }
  return tsMorphModule!;
};

/**
 * Create a ts-morph project
 */
export const createProject = (tsConfigPath?: string  ): Project => {
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

/**
 * Clear cached ts-morph projects.
 */
export const clearProjectCache = (): void => {
  projectCache.clear();
};

/**
 * Create a project from source code (for testing)
 */
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
