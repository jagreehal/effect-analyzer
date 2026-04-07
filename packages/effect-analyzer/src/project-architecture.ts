/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-redundant-type-constituents */
import { basename, relative, resolve } from 'path';
import { loadTsMorph } from './ts-morph-loader';

export interface CommandDefinitionSummary {
  readonly id: string;
  readonly file: string;
  readonly variableName: string;
  readonly commandName: string;
}

export interface RuntimeArchitectureStage {
  readonly source: string;
  readonly kind: 'identifier' | 'call' | 'function' | 'literal' | 'object' | 'expression';
}

export interface RuntimeArchitectureSummary {
  readonly id: string;
  readonly file: string;
  readonly runtimeName: string;
  readonly constructor: string;
  readonly model: RuntimeArchitectureStage | undefined;
  readonly flagsSchema: RuntimeArchitectureStage | undefined;
  readonly flags: RuntimeArchitectureStage | undefined;
  readonly init: RuntimeArchitectureStage | undefined;
  readonly update: RuntimeArchitectureStage | undefined;
  readonly view: RuntimeArchitectureStage | undefined;
  readonly container: RuntimeArchitectureStage | undefined;
  readonly subscriptions: RuntimeArchitectureStage | undefined;
  readonly resources: RuntimeArchitectureStage | undefined;
  readonly managedResources: RuntimeArchitectureStage | undefined;
  readonly routing: RuntimeArchitectureStage | undefined;
  readonly routingHandlers: readonly string[];
  readonly crash: RuntimeArchitectureStage | undefined;
  readonly crashHandlers: readonly string[];
  readonly slowView: RuntimeArchitectureStage | undefined;
  readonly title: RuntimeArchitectureStage | undefined;
  readonly devtools: RuntimeArchitectureStage | undefined;
  readonly capabilities: readonly string[];
  readonly relatedCommands: readonly string[];
}

export interface ProjectArchitectureSummary {
  readonly runtimes: readonly RuntimeArchitectureSummary[];
  readonly commandDefinitions: readonly CommandDefinitionSummary[];
  readonly layerAssemblies: readonly LayerAssemblySummary[];
  readonly filesScanned: number;
}

export interface LayerAssemblySummary {
  readonly id: string;
  readonly file: string;
  readonly name: string;
  readonly constructor: string;
  readonly operations: readonly string[];
  readonly references: readonly string[];
}

interface ExtractProjectArchitectureOptions {
  readonly tsconfig?: string | undefined;
}

const FEATURE_ORDER = [
  'flags',
  'routing',
  'subscriptions',
  'resources',
  'managedResources',
  'crash',
  'slowView',
  'title',
  'devtools',
] as const;

const describeText = (text: string, fallback: string): string => {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}...`;
};

const detectStageKind = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expr: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): RuntimeArchitectureStage['kind'] => {
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) return 'identifier';
  if (Node.isCallExpression(expr)) return 'call';
  if (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr) || Node.isMethodDeclaration(expr)) return 'function';
  if (Node.isObjectLiteralExpression(expr)) return 'object';
  if (
    Node.isStringLiteral(expr) ||
    Node.isNumericLiteral(expr) ||
    expr.getKindName() === 'TrueKeyword' ||
    expr.getKindName() === 'FalseKeyword' ||
    expr.getKindName() === 'NullKeyword'
  ) return 'literal';
  return 'expression';
};

const describeStage = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expr: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): RuntimeArchitectureStage => ({
  source: describeText(expr.getText(), expr.getKindName()),
  kind: detectStageKind(expr, Node),
});

const getPropertyExpression = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objectLiteral: any,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | undefined => {
  const prop = objectLiteral.getProperty(name);
  if (!prop) return undefined;
  if (Node.isPropertyAssignment(prop)) return prop.getInitializer();
  if (Node.isShorthandPropertyAssignment(prop)) return prop.getNameNode();
  if (Node.isMethodDeclaration(prop)) return prop;
  return undefined;
};

const extractNestedHandlers = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expr: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): readonly string[] => {
  if (!expr || !Node.isObjectLiteralExpression(expr)) return [];
  return expr.getProperties().flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prop: any) => {
      if (
        Node.isPropertyAssignment(prop) ||
        Node.isShorthandPropertyAssignment(prop) ||
        Node.isMethodDeclaration(prop)
      ) {
        return [prop.getName()];
      }
      return [];
    },
  );
};

const inferCapabilities = (
  summary: Omit<RuntimeArchitectureSummary, 'capabilities' | 'relatedCommands'>,
): string[] => {
  const features: string[] = [];
  if (summary.flags || summary.flagsSchema) features.push('flags');
  if (summary.routing) features.push('routing');
  if (summary.subscriptions) features.push('subscriptions');
  if (summary.resources) features.push('resources');
  if (summary.managedResources) features.push('managedResources');
  if (summary.crash) features.push('crash');
  if (summary.slowView) features.push('slowView');
  if (summary.title) features.push('title');
  if (summary.devtools) features.push('devtools');
  return FEATURE_ORDER.filter((feature) => features.includes(feature));
};

const isMakeProgramCall = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): boolean => {
  const expression = call.getExpression();
  const text = expression.getText();
  return Node.isIdentifier(expression)
    ? text === 'makeProgram'
    : Node.isPropertyAccessExpression(expression) && text.endsWith('.makeProgram');
};

const isCommandDefineCall = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): boolean => {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  return expression.getName() === 'define' && expression.getExpression().getText().endsWith('Command');
};

const runtimeNameForCall = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  filePath: string,
  ordinal: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): string => {
  const parent = call.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  return `${basename(filePath, '.ts')}-runtime-${String(ordinal)}`;
};

const isLayerCall = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
): boolean => {
  const text = call.getExpression().getText();
  return text.startsWith('Layer.');
};

const isLayerAssemblyRoot = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): boolean => {
  if (!isLayerCall(call)) return false;
  const parent = call.getParent();
  if (!parent) return false;
  if (Node.isVariableDeclaration(parent) && parent.getInitializer() === call) return true;
  if (Node.isReturnStatement(parent) && parent.getExpression() === call) return true;
  return false;
};

const getLayerAssemblyName = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  filePath: string,
  ordinal: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): string => {
  const parent = call.getParent();
  if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
  return `${basename(filePath, '.ts')}-layer-${String(ordinal)}`;
};

const extractLayerAssembly = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: any,
  filePath: string,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Node: any,
): LayerAssemblySummary => {
  const operations: string[] = [];
  const references = new Set<string>();

  const collectLayerRefs = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expr: any,
  ): void => {
    if (!expr) return;
    if (Node.isIdentifier(expr)) {
      const text = expr.getText();
      if (!['Layer', 'Effect'].includes(text)) references.add(text);
      return;
    }
    if (Node.isPropertyAccessExpression(expr)) {
      const text = expr.getText();
      if (!text.startsWith('Layer.') && !text.startsWith('Effect.')) {
        references.add(text);
      }
      return;
    }
    if (Node.isCallExpression(expr)) {
      collectLayerCall(expr);
      return;
    }
    if (Node.isArrayLiteralExpression(expr)) {
      for (const element of expr.getElements()) collectLayerRefs(element);
    }
  };

  const collectLayerCall = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    current: any,
  ): void => {
    const exprText = current.getExpression().getText();
    if (exprText.startsWith('Layer.')) {
      operations.push(exprText.replace(/^Layer\./, ''));
    } else if (exprText.endsWith('.pipe')) {
      operations.push('pipe');
      const pipeBase = current.getExpression().getExpression();
      collectLayerRefs(pipeBase);
      if (Node.isCallExpression(pipeBase)) {
        collectLayerCall(pipeBase);
      }
    }
    for (const arg of current.getArguments()) {
      collectLayerRefs(arg);
    }
  };

  collectLayerCall(call);

  return {
    id: `${filePath}:${name}`,
    file: filePath,
    name,
    constructor: call.getExpression().getText(),
    operations,
    references: [...references],
  };
};

export function extractProjectArchitecture(
  filePaths: readonly string[],
  options: ExtractProjectArchitectureOptions = {},
): ProjectArchitectureSummary {
  try {
    const { Project, Node } = loadTsMorph();
    const project = options.tsconfig
      ? new Project({ tsConfigFilePath: options.tsconfig })
      : new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });

    const sourceFiles = filePaths.flatMap((filePath) => {
      try {
        return [project.addSourceFileAtPath(filePath)];
      } catch {
        return [];
      }
    });

    const commands: CommandDefinitionSummary[] = [];
    const runtimes: RuntimeArchitectureSummary[] = [];
    const layerAssemblies: LayerAssemblySummary[] = [];

    for (const sourceFile of sourceFiles) {
      const filePath = resolve(sourceFile.getFilePath());
      let runtimeOrdinal = 0;
      let layerOrdinal = 0;

      sourceFile.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return undefined;

        if (isCommandDefineCall(node, Node)) {
          const parent = node.getParent();
          const variableName =
            parent && Node.isVariableDeclaration(parent)
              ? parent.getName()
              : `command-${String(commands.length + 1)}`;
          const firstArg = node.getArguments()[0];
          const commandName =
            firstArg && Node.isStringLiteral(firstArg)
              ? firstArg.getLiteralText()
              : variableName;
          commands.push({
            id: `${filePath}:${variableName}`,
            file: filePath,
            variableName,
            commandName,
          });
          return undefined;
        }

        if (isLayerAssemblyRoot(node, Node)) {
          layerOrdinal += 1;
          const layerName = getLayerAssemblyName(node, filePath, layerOrdinal, Node);
          layerAssemblies.push(extractLayerAssembly(node, filePath, layerName, Node));
          return undefined;
        }

        if (!isMakeProgramCall(node, Node)) return undefined;
        const configArg = node.getArguments()[0];
        if (!configArg || !Node.isObjectLiteralExpression(configArg)) return undefined;

        runtimeOrdinal += 1;
        const runtimeName = runtimeNameForCall(node, filePath, runtimeOrdinal, Node);
        const model = getPropertyExpression(configArg, 'Model', Node);
        const flagsSchema = getPropertyExpression(configArg, 'Flags', Node);
        const flags = getPropertyExpression(configArg, 'flags', Node);
        const init = getPropertyExpression(configArg, 'init', Node);
        const update = getPropertyExpression(configArg, 'update', Node);
        const view = getPropertyExpression(configArg, 'view', Node);
        const container = getPropertyExpression(configArg, 'container', Node);
        const subscriptions = getPropertyExpression(configArg, 'subscriptions', Node);
        const resources = getPropertyExpression(configArg, 'resources', Node);
        const managedResources = getPropertyExpression(configArg, 'managedResources', Node);
        const routing = getPropertyExpression(configArg, 'routing', Node);
        const crash = getPropertyExpression(configArg, 'crash', Node);
        const slowView = getPropertyExpression(configArg, 'slowView', Node);
        const title = getPropertyExpression(configArg, 'title', Node);
        const devtools = getPropertyExpression(configArg, 'devtools', Node);

        const baseRuntime = {
          id: `${filePath}:${runtimeName}`,
          file: filePath,
          runtimeName,
          constructor: node.getExpression().getText(),
          model: model ? describeStage(model, Node) : undefined,
          flagsSchema: flagsSchema ? describeStage(flagsSchema, Node) : undefined,
          flags: flags ? describeStage(flags, Node) : undefined,
          init: init ? describeStage(init, Node) : undefined,
          update: update ? describeStage(update, Node) : undefined,
          view: view ? describeStage(view, Node) : undefined,
          container: container ? describeStage(container, Node) : undefined,
          subscriptions: subscriptions ? describeStage(subscriptions, Node) : undefined,
          resources: resources ? describeStage(resources, Node) : undefined,
          managedResources: managedResources ? describeStage(managedResources, Node) : undefined,
          routing: routing ? describeStage(routing, Node) : undefined,
          routingHandlers: extractNestedHandlers(routing, Node),
          crash: crash ? describeStage(crash, Node) : undefined,
          crashHandlers: extractNestedHandlers(crash, Node),
          slowView: slowView ? describeStage(slowView, Node) : undefined,
          title: title ? describeStage(title, Node) : undefined,
          devtools: devtools ? describeStage(devtools, Node) : undefined,
        };

        runtimes.push({
          ...baseRuntime,
          capabilities: inferCapabilities(baseRuntime),
          relatedCommands: [],
        });
        return undefined;
      });
    }

    const commandsByFile = new Map<string, string[]>();
    for (const command of commands) {
      const current = commandsByFile.get(command.file) ?? [];
      if (!current.includes(command.commandName)) current.push(command.commandName);
      commandsByFile.set(command.file, current);
    }

    return {
      runtimes: runtimes.map((runtime) => ({
        ...runtime,
        relatedCommands: commandsByFile.get(runtime.file) ?? [],
      })),
      commandDefinitions: commands,
      layerAssemblies,
      filesScanned: sourceFiles.length,
    };
  } catch {
    return {
      runtimes: [],
      commandDefinitions: [],
      layerAssemblies: [],
      filesScanned: 0,
    };
  }
}

export function renderProjectArchitecture(
  summary: ProjectArchitectureSummary,
  baseDir?: string,
): string {
  if (summary.runtimes.length === 0 && summary.layerAssemblies.length === 0) {
    return '(no runtime architecture detected)';
  }

  const runtimeSections = summary.runtimes.map((runtime) => {
    const fileLabel = baseDir
      ? relative(baseDir, runtime.file) || basename(runtime.file)
      : runtime.file;
    const lines: string[] = [];
    lines.push(`${runtime.runtimeName} (${fileLabel})`);
    lines.push(`  Constructor: ${runtime.constructor}`);
    lines.push(
      `  Loop: ${runtime.flags || runtime.flagsSchema ? 'Flags -> init -> Model + Commands' : 'init -> Model + Commands'}`,
    );
    lines.push('  Loop: Message -> update -> Model + Commands');
    lines.push('  Loop: Model -> view -> Html');
    if (runtime.subscriptions) {
      lines.push(`  Subscriptions: ${runtime.subscriptions.source} -> Message stream`);
    }
    if (runtime.resources) {
      lines.push(`  Resources: ${runtime.resources.source}`);
    }
    if (runtime.managedResources) {
      lines.push(`  Managed resources: ${runtime.managedResources.source}`);
    }
    if (runtime.routing) {
      const handlers =
        runtime.routingHandlers.length > 0
          ? ` (${runtime.routingHandlers.join(', ')})`
          : '';
      lines.push(`  Routing: ${runtime.routing.source}${handlers}`);
    }
    if (runtime.crash) {
      const handlers =
        runtime.crashHandlers.length > 0
          ? ` (${runtime.crashHandlers.join(', ')})`
          : '';
      lines.push(`  Crash handling: ${runtime.crash.source}${handlers}`);
    }
    if (runtime.slowView) {
      lines.push(`  Slow view: ${runtime.slowView.source}`);
    }
    if (runtime.title) {
      lines.push(`  Title: ${runtime.title.source}`);
    }
    if (runtime.devtools) {
      lines.push(`  Devtools: ${runtime.devtools.source}`);
    }
    if (runtime.relatedCommands.length > 0) {
      lines.push(`  Commands in file: ${runtime.relatedCommands.join(', ')}`);
    }
    if (runtime.capabilities.length > 0) {
      lines.push(`  Capabilities: ${runtime.capabilities.join(', ')}`);
    }
    return lines.join('\n');
  });

  const commandFiles = new Map<string, string[]>();
  for (const command of summary.commandDefinitions) {
    const fileLabel = baseDir
      ? relative(baseDir, command.file) || basename(command.file)
      : command.file;
    const current = commandFiles.get(fileLabel) ?? [];
    if (!current.includes(command.commandName)) current.push(command.commandName);
    commandFiles.set(fileLabel, current);
  }

  const commandSection =
    commandFiles.size === 0
      ? ''
      : `\n\nCommand definitions:\n${[...commandFiles.entries()]
          .map(([file, names]) => `  ${file}: ${names.join(', ')}`)
          .join('\n')}`;

  const isTestLayer = (layer: LayerAssemblySummary): boolean =>
    /(?:^|\/)__tests__\/|(?:^|\/)test\/|\.test\.[cm]?[jt]sx?$/.test(layer.file);

  const renderLayerBlock = (title: string, layers: readonly LayerAssemblySummary[]): string =>
    layers.length === 0
      ? ''
      : `\n\n${title}:\n${layers
          .map((layer) => {
            const fileLabel = baseDir
              ? relative(baseDir, layer.file) || basename(layer.file)
              : layer.file;
            const refs = layer.references.length > 0 ? `\n    References: ${layer.references.join(', ')}` : '';
            const ops = layer.operations.length > 0 ? layer.operations.join(' -> ') : layer.constructor;
            return `  ${layer.name} (${fileLabel})\n    Ops: ${ops}${refs}`;
          })
          .join('\n')}`;

  const appLayers = summary.layerAssemblies.filter((layer) => !isTestLayer(layer));
  const testLayers = summary.layerAssemblies.filter((layer) => isTestLayer(layer));
  const layerSection =
    renderLayerBlock('Layer assemblies', appLayers) +
    renderLayerBlock('Test layer assemblies', testLayers);

  return [
    `Project architecture (${String(summary.runtimes.length)} runtime${summary.runtimes.length === 1 ? '' : 's'}, ${String(summary.layerAssemblies.length)} layer assembl${summary.layerAssemblies.length === 1 ? 'y' : 'ies'})`,
    ...runtimeSections,
  ].join('\n\n') + commandSection + layerSection;
}
