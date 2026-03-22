import { describe, it, expect } from 'vitest';
import { loadTsMorph } from './ts-morph-loader';
import { buildProjectServiceMap } from './service-registry';

describe('service-registry', () => {
  it('maps Layer.* providers to tag IDs even when class name differs from Context.Tag string', () => {
    const { Project } = loadTsMorph();
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });

    const filePath = '/virtual/services.ts';
    const sourceFile = project.createSourceFile(
      filePath,
      `
      import { Context, Layer } from "effect";

      export class Logger extends Context.Tag("AppLogger")<Logger, { readonly log: (msg: string) => void }>() {}

      export const LoggerLive = Layer.succeed(Logger, {
        log: (_msg: string) => undefined
      });
      `,
      { overwrite: true },
    );

    const byFile = new Map<string, readonly any[]>([[filePath, []]]);
    const serviceMap = buildProjectServiceMap(byFile, new Map([[filePath, sourceFile]]));
    const loggerArtifact = serviceMap.services.get('AppLogger');

    expect(loggerArtifact).toBeDefined();
    expect(loggerArtifact?.layerImplementations.map((l) => l.name)).toContain('LoggerLive');
  });

  it('tracks unresolved services referenced by serviceCall nodes even when requiredServices is empty', () => {
    const byFile = new Map<string, readonly any[]>([
      [
        '/virtual/main.ts',
        [
          {
            root: {
              id: 'program-main',
              type: 'program',
              programName: 'main',
              source: 'generator',
              children: [
                {
                  id: 'node-1',
                  type: 'effect',
                  callee: 'MissingSvc',
                  description: 'service',
                  location: { filePath: '/virtual/main.ts', line: 3, column: 2 },
                  serviceCall: { serviceType: 'MissingSvc', methodName: 'Tag' },
                },
              ],
              dependencies: [],
              errorTypes: [],
              requiredServices: [],
            },
            metadata: {
              analyzedAt: Date.now(),
              filePath: '/virtual/main.ts',
              stats: {
                totalEffects: 1,
                parallelCount: 0,
                raceCount: 0,
                errorHandlerCount: 0,
                retryCount: 0,
                timeoutCount: 0,
                resourceCount: 0,
                loopCount: 0,
                conditionalCount: 0,
                layerCount: 0,
                unknownCount: 0,
              },
            },
            references: new Map(),
          },
        ],
      ],
    ]);

    const serviceMap = buildProjectServiceMap(byFile);
    expect(serviceMap.unresolvedServices).toContain('MissingSvc');
  });

  it('does not treat plain effect identifiers as unresolved services', () => {
    const byFile = new Map<string, readonly any[]>([
      [
        '/virtual/main.ts',
        [
          {
            root: {
              id: 'program-main',
              type: 'program',
              programName: 'main',
              source: 'generator',
              children: [
                {
                  id: 'node-1',
                  type: 'effect',
                  callee: 'helperProgram',
                  description: 'effect call',
                  location: { filePath: '/virtual/main.ts', line: 4, column: 2 },
                },
              ],
              dependencies: [],
              errorTypes: [],
              requiredServices: [],
            },
            metadata: {
              analyzedAt: Date.now(),
              filePath: '/virtual/main.ts',
              stats: {
                totalEffects: 1,
                parallelCount: 0,
                raceCount: 0,
                errorHandlerCount: 0,
                retryCount: 0,
                timeoutCount: 0,
                resourceCount: 0,
                loopCount: 0,
                conditionalCount: 0,
                layerCount: 0,
                unknownCount: 0,
              },
            },
            references: new Map(),
          },
        ],
      ],
    ]);

    const serviceMap = buildProjectServiceMap(byFile);
    expect(serviceMap.unresolvedServices).not.toContain('helperProgram');
  });
});
