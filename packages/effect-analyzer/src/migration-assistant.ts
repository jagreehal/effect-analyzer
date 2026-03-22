/**
 * Migration Assistant (GAP 29)
 *
 * Detects patterns that could be migrated to Effect (try/catch, Promise.all, etc.).
 */

import { readdir } from 'node:fs/promises';
import { join, extname } from 'path';
import { Project, SyntaxKind } from 'ts-morph';

// =============================================================================
// Types
// =============================================================================

export interface MigrationOpportunity {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly pattern: string;
  readonly suggestion: string;
  readonly codeSnippet?: string | undefined;
}

export interface MigrationReport {
  readonly opportunities: readonly MigrationOpportunity[];
  readonly fileCount: number;
}

// =============================================================================
// Detection
// =============================================================================

function addOpportunity(
  list: MigrationOpportunity[],
  filePath: string,
  node: { getStart: () => number },
  sourceFile: { getLineAndColumnAtPos: (pos: number) => { line: number; column: number }; getText: () => string },
  pattern: string,
  suggestion: string,
  snippet?: string,
): void {
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
  list.push({
    filePath,
    line: line + 1,
    column,
    pattern,
    suggestion,
    codeSnippet: snippet ?? sourceFile.getText().slice(node.getStart(), node.getStart() + 80).replace(/\n/g, ' '),
  });
}

/**
 * Scan a file for migration opportunities.
 */
export function findMigrationOpportunities(
  filePath: string,
  source?: string,
): MigrationOpportunity[] {
  const opportunities: MigrationOpportunity[] = [];
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);

  // try/catch -> Effect.try / Effect.tryPromise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    addOpportunity(
      opportunities,
      filePath,
      node,
      sourceFile,
      'try/catch',
      'Effect.try or Effect.tryPromise with catch handler',
    );
  }

  // Promise.all -> Effect.all
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'Promise.all' || (text.endsWith('.all') && text.includes('Promise'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.all',
        'Effect.all([...], { concurrency: "unbounded" })',
      );
    }
    if (text === 'Promise.race' || (text.endsWith('.race') && text.includes('Promise'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.race',
        'Effect.race(first, second)',
      );
    }
  }

  // setTimeout / setInterval / setImmediate -> Effect.sleep / Schedule
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'setTimeout' || text === 'setInterval') {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        text === 'setTimeout' ? 'Effect.sleep(Duration.millis(n))' : 'Schedule.spaced(Duration.millis(n))',
      );
    }
    if (text === 'setImmediate' || text === 'process.setImmediate') {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'setImmediate',
        'Effect.sync + queueMicrotask or Effect.async',
      );
    }
  }

  // XMLHttpRequest -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'XMLHttpRequest' || text.includes('XMLHttpRequest')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new XMLHttpRequest()',
        'HttpClient.request or @effect/platform HttpClient',
      );
    }
  }

  // Worker / worker_threads -> Effect Worker
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'Worker' || text.includes('Worker')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new Worker()',
        'Worker.make or @effect/platform Worker',
      );
    }
  }

  // fs.exists (callback) -> Effect.promise (only fs module, not Option.exists / Exit.exists)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsExists =
      text === 'fs.exists' ||
      (text.endsWith('.exists') && text.startsWith('fs.'));
    if (isFsExists && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.exists (callback)',
        'Effect.promise or fs.promises.access',
      );
    }
  }

  // http.request / https.request (callback) -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.endsWith('.request') && (text.includes('http') || text.includes('https'))) ||
      (text === 'request' && sourceFile.getText().includes('http'))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'http.request / https.request',
        'HttpClient.request or @effect/platform HttpClient',
      );
    }
  }

  // dns.lookup, dns.resolve (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.startsWith('dns.') || text.includes('dns.')) &&
      (text.includes('lookup') || text.includes('resolve') || text.includes('reverse'))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'dns (callback)',
        'Effect.promise or dns.promises',
      );
    }
  }

  // fetch( -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'fetch') {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fetch()',
        'HttpClient.request or @effect/platform HttpClient',
      );
    }
  }

  // EventEmitter -> PubSub
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'EventEmitter' || text.includes('EventEmitter')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new EventEmitter()',
        'PubSub.bounded<EventType>() or PubSub.unbounded<EventType>()',
      );
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.endsWith('.on(') || text.endsWith('.addListener(')) &&
      (text.includes('Emitter') || text.includes('emitter'))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'EventEmitter.on / addListener',
        'PubSub.subscribe for PubSub',
      );
    }
    if (text.endsWith('.emit(') && (text.includes('Emitter') || text.includes('emitter'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'EventEmitter.emit',
        'PubSub.publish for PubSub',
      );
    }
  }

  // class-based DI -> Context.Tag + Layer
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const name = node.getName();
    const text = node.getText();
    if (
      name &&
      (text.includes('new ') || text.includes('constructor')) &&
      (name.endsWith('Service') || name.endsWith('Repository') || name.endsWith('Client'))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `class ${name} (manual DI)`,
        `Context.Tag<${name}>() + Layer.effect or Layer.succeed`,
      );
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.endsWith('Service') || text.endsWith('Repository') || text.endsWith('Client')) &&
      !text.includes('Context') &&
      !text.includes('Layer')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `new ${text}()`,
        `Context.Tag + Layer.effect for dependency injection`,
      );
    }
  }

  // async/await -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (node.getModifiers().some((m) => m.getText() === 'async') || node.getText().startsWith('async')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'async function',
        'Effect.gen or Effect.pipe with flatMap',
      );
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
    if (node.getText().startsWith('async')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'async arrow function',
        'Effect.gen or Effect.pipe with flatMap',
      );
    }
  }

  // Promise.then chains -> Effect.flatMap
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text.endsWith('.then') && text.includes('Promise')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.then',
        'Effect.flatMap for sequential composition',
      );
    }
    if (text === 'Promise.allSettled' || (text.endsWith('.allSettled') && text.includes('Promise'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.allSettled',
        'Effect.all with merge or separate error handling',
      );
    }
    if (text.endsWith('.catch') && (text.includes('Promise') || text.includes('.then'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.catch',
        'Effect.catchAll or Effect.catchTag for typed error handling',
      );
    }
    if (text.endsWith('.finally') && (text.includes('Promise') || text.includes('.then'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'Promise.finally',
        'Effect.ensuring for cleanup',
      );
    }
  }

  // addEventListener -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'addEventListener' || text.endsWith('.addEventListener')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'addEventListener',
        'Effect.async or EventTarget + Effect.asyncInterrupt',
      );
    }
  }

  // fs.readFile / fs.writeFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsCallback =
      (text === 'fs.readFile' || text === 'fs.writeFile' || text === 'readFile' || text === 'writeFile') ||
      (text.endsWith('.readFile') && text.startsWith('fs.')) ||
      (text.endsWith('.writeFile') && text.startsWith('fs.'));
    if (isFsCallback && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text.includes('write') ? 'fs.writeFile (callback)' : 'fs.readFile (callback)',
        'Effect.promise or fs.promises + Effect.tryPromise',
      );
    }
  }

  // throw new Error -> Effect.fail
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    addOpportunity(
      opportunities,
      filePath,
      node,
      sourceFile,
      'throw',
      'Effect.fail(error) for typed error channel',
    );
  }

  // util.promisify -> Effect.tryPromise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'promisify' || text.endsWith('.promisify')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'util.promisify',
        'Effect.tryPromise or Effect.async for callback-style APIs',
      );
    }
  }

  // new Promise -> Effect.async or Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'Promise') {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new Promise(...)',
        'Effect.async or Effect.promise for callback-style',
      );
    }
  }

  // for await -> Stream.iterate or Effect.asyncIterable
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
    if (node.getAwaitKeyword()) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'for await...of',
        'Stream.iterate or Effect.asyncIterable for async iteration',
      );
    }
  }

  // sync fs (readFileSync, writeFileSync) -> Effect.promise + fs/promises
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      text === 'readFileSync' ||
      text === 'writeFileSync' ||
      text === 'existsSync' ||
      text.endsWith('.readFileSync') ||
      text.endsWith('.writeFileSync') ||
      text.endsWith('.existsSync')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        'Effect.promise or fs/promises + Effect.tryPromise',
      );
    }
  }

  // process.nextTick -> Effect.sync + queueMicrotask or Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'process.nextTick' || (text.endsWith('.nextTick') && text.includes('process'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'process.nextTick',
        'Effect.sync + queueMicrotask or Effect.async',
      );
    }
  }

  // queueMicrotask -> Effect.sync
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'queueMicrotask' || text.endsWith('.queueMicrotask')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'queueMicrotask',
        'Effect.sync for deferred execution',
      );
    }
  }

  // WebSocket -> Effect.async / @effect/platform
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'WebSocket' || text.includes('WebSocket')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new WebSocket()',
        'Effect.async or @effect/platform WebSocket',
      );
    }
  }

  // MessageChannel -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'MessageChannel' || text.includes('MessageChannel')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new MessageChannel()',
        'Effect.async or Queue for cross-context messaging',
      );
    }
  }

  // fs.appendFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsAppend =
      text === 'fs.appendFile' ||
      (text.endsWith('.appendFile') && text.startsWith('fs.'));
    if (isFsAppend && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.appendFile (callback)',
        'Effect.promise or fs.promises.appendFile',
      );
    }
  }

  // fs.mkdir / fs.stat / fs.unlink (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsCallback =
      (text === 'fs.mkdir' || text === 'fs.stat' || text === 'fs.unlink' ||
        (text.endsWith('.mkdir') && text.startsWith('fs.')) ||
        (text.endsWith('.stat') && text.startsWith('fs.')) ||
        (text.endsWith('.unlink') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    if (isFsCallback) {
      const name = text.includes('mkdir') ? 'fs.mkdir' : text.includes('stat') ? 'fs.stat' : 'fs.unlink';
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `${name} (callback)`,
        'Effect.promise or fs.promises',
      );
    }
  }

  // MutationObserver -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'MutationObserver' || text.includes('MutationObserver')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new MutationObserver()',
        'Effect.async or Effect.asyncInterrupt for DOM observation',
      );
    }
  }

  // requestIdleCallback -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'requestIdleCallback' || text.endsWith('.requestIdleCallback')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'requestIdleCallback',
        'Effect.async or Effect.sync for idle-time work',
      );
    }
  }

  // BroadcastChannel -> PubSub / Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'BroadcastChannel' || text.includes('BroadcastChannel')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new BroadcastChannel()',
        'PubSub or Effect.async for cross-tab messaging',
      );
    }
  }

  // fs.rename / fs.realpath (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsCallback =
      (text === 'fs.rename' || text === 'fs.realpath' ||
        (text.endsWith('.rename') && text.startsWith('fs.')) ||
        (text.endsWith('.realpath') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    if (isFsCallback) {
      const name = text.includes('realpath') ? 'fs.realpath' : 'fs.rename';
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `${name} (callback)`,
        'Effect.promise or fs.promises',
      );
    }
  }

  // fs.readdir / fs.copyFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsReaddir =
      (text === 'fs.readdir' || (text.endsWith('.readdir') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    const isFsCopyFile =
      (text === 'fs.copyFile' || (text.endsWith('.copyFile') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    if (isFsReaddir) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.readdir (callback)',
        'Effect.promise or fs.promises.readdir',
      );
    }
    if (isFsCopyFile) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.copyFile (callback)',
        'Effect.promise or fs.promises.copyFile',
      );
    }
  }

  // FileReader (browser) -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'FileReader' || text.includes('FileReader')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new FileReader()',
        'Effect.async or FileReader + Effect.asyncInterrupt',
      );
    }
  }

  // fs.mkdtemp / fs.symlink (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isFsMkdtemp =
      (text === 'fs.mkdtemp' || (text.endsWith('.mkdtemp') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    const isFsSymlink =
      (text === 'fs.symlink' || (text.endsWith('.symlink') && text.startsWith('fs.'))) &&
      node.getArguments().length >= 2;
    if (isFsMkdtemp) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.mkdtemp (callback)',
        'Effect.promise or fs.promises.mkdtemp',
      );
    }
    if (isFsSymlink) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'fs.symlink (callback)',
        'Effect.promise or fs.promises.symlink',
      );
    }
  }

  // ResizeObserver / IntersectionObserver -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      text === 'ResizeObserver' ||
      text === 'IntersectionObserver' ||
      text.includes('ResizeObserver') ||
      text.includes('IntersectionObserver')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `new ${text}()`,
        'Effect.async or Effect.asyncInterrupt for DOM observation',
      );
    }
  }

  // child_process.fork -> Worker / Effect
  const hasChildProcessFork = sourceFile.getText().includes('child_process');
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.includes('child_process') && text.endsWith('.fork')) ||
      (hasChildProcessFork && text === 'fork')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'child_process.fork',
        'Worker.make or @effect/platform Worker',
      );
    }
  }

  // AbortController -> Effect.Scoped
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'AbortController' || text.includes('AbortController')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'new AbortController()',
        'Effect.Scoped or Effect.interruptible for cancellation',
      );
    }
  }

  // child_process.exec/spawn -> CommandExecutor
  const fileText = sourceFile.getText();
  const hasChildProcess = fileText.includes('child_process');
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isChildProcessExec =
      (text.endsWith('.exec') || text.endsWith('.execSync') || text.endsWith('.spawn')) &&
      text.includes('child_process');
    const isNamedImportExec =
      hasChildProcess && (text === 'exec' || text === 'execSync' || text === 'spawn');
    if (isChildProcessExec || isNamedImportExec) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'child_process.exec/spawn',
        '@effect/platform CommandExecutor or Effect.promise',
      );
    }
  }

  // process.env -> Config (only direct process.env to avoid duplicates)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const expr = node.getExpression();
    if (expr.getText() === 'process' && node.getName() === 'env') {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'process.env',
        'Config.string or Config.forEffect for typed config',
      );
    }
  }

  // RxJS Observable -> Stream
  const hasRxjs = fileText.includes('rxjs') || fileText.includes('Observable');
  if (hasRxjs) {
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = node.getExpression();
      const text = expr.getText();
      if (text.includes('Observable') || (text.includes('of') && text.includes('rxjs'))) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          'RxJS Observable',
          'Stream from @effect/platform or Effect Stream',
        );
      }
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text.includes('Observable') || text.includes('Subject')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'RxJS Observable/Subject',
        'Stream or PubSub for Effect',
      );
    }
  }

  // requestAnimationFrame -> Effect.sync + queueMicrotask (browser)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'requestAnimationFrame' || text.endsWith('.requestAnimationFrame')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'requestAnimationFrame',
        'Effect.async or Effect.sync + queueMicrotask for scheduling',
      );
    }
  }

  // crypto (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.includes('crypto.') || text.includes('randomBytes') || text.includes('scrypt') || text.includes('pbkdf2')) &&
      node.getArguments().length >= 2
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'crypto (callback)',
        'Effect.promise or crypto.webcrypto / node:crypto promises',
      );
    }
  }

  // createReadStream / createWriteStream -> Stream
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'createReadStream' || text === 'createWriteStream' || text.endsWith('.createReadStream') || text.endsWith('.createWriteStream')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        'Stream.fromReadable or @effect/platform FileSystem/Stream',
      );
    }
  }

  // cluster.fork -> Worker / Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text.includes('cluster') && text.endsWith('.fork')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'cluster.fork',
        'Worker.make or @effect/platform Worker pool',
      );
    }
  }

  // net.createServer / net.connect (callback) -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'createServer' || text === 'connect' || text.endsWith('.createServer') || text.endsWith('.connect')) {
      const full = expr.getText();
      if (full.includes('net') || full.includes('tls')) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          full,
          'Effect.async or @effect/platform Socket/Server',
        );
      }
    }
  }

  // zlib (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text.includes('zlib.') && (text.includes('deflate') || text.includes('inflate') || text.includes('gzip') || text.includes('gunzip'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'zlib (callback)',
        'Effect.promise or zlib.promises',
      );
    }
  }

  // readline.createInterface -> Effect.async / Stream
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'createInterface' || text.endsWith('.createInterface')) {
      if (text.includes('readline')) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          'readline.createInterface',
          'Effect.async or Stream for line-by-line reading',
        );
      }
    }
  }

  // stream.pipeline (callback) -> Effect.promise
  const hasStreamModule = sourceFile.getText().includes('stream');
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isStreamPipeline =
      (text.endsWith('.pipeline') && text.includes('stream')) || (hasStreamModule && text === 'pipeline');
    if (isStreamPipeline) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'stream.pipeline (callback)',
        'Effect.promise or stream.promises.pipeline',
      );
    }
  }

  // events.once -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'once' || text.endsWith('.once')) {
      if (text.includes('events') || sourceFile.getText().includes("from 'events'")) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          'events.once',
          'Effect.async for one-shot event',
        );
      }
    }
  }

  // fs.watch / fs.watchFile (callback) -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'watch' || text === 'watchFile' || text.endsWith('.watch') || text.endsWith('.watchFile')) {
      if (text.includes('fs') || expr.getText().includes('fs.')) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          'fs.watch / fs.watchFile',
          'Effect.async or fs.watch with EventEmitter',
        );
      }
    }
  }

  // vm.runInNewContext / vm.runInContext -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.includes('runInNewContext') || text.includes('runInContext') || text.includes('runInThisContext')) &&
      text.includes('vm')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'vm.runIn*',
        'Effect.sync for isolated code execution',
      );
    }
  }

  // url.parse (deprecated) -> new URL()
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if ((text === 'parse' || text.endsWith('.parse')) && text.includes('url')) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'url.parse (deprecated)',
        'new URL() or URL.parse for standard parsing',
      );
    }
  }

  // child_process.spawnSync -> Effect.promise / CommandExecutor
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (
      (text.endsWith('.spawnSync') && text.includes('child_process')) ||
      (sourceFile.getText().includes('child_process') && text === 'spawnSync')
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'child_process.spawnSync',
        '@effect/platform CommandExecutor or Effect.promise',
      );
    }
  }

  // glob (callback) -> Effect.promise / glob promise API
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text === 'glob' || text.endsWith('.glob')) {
      const fileContent = sourceFile.getText();
      if (fileContent.includes('glob') && node.getArguments().length >= 2) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          'glob (callback)',
          'Effect.promise or glob promise API',
        );
      }
    }
  }

  // assert.throws / expect().rejects (test) -> Effect.runPromiseExit
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const isAssertThrows = text.includes('assert') && text.endsWith('.throws');
    const isExpectRejects = text.endsWith('.rejects') && text.includes('expect');
    if (isAssertThrows || isExpectRejects) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        isExpectRejects ? 'expect().rejects' : 'assert.throws',
        'Effect.runPromiseExit + Exit.match for testing Effect failures',
      );
    }
  }

  // tls.connect / tls.createServer -> Effect.async
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (text.includes('tls') && (text.endsWith('.connect') || text.endsWith('.createServer'))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        'tls.connect / tls.createServer',
        'Effect.async or @effect/platform Socket/TLS',
      );
    }
  }

  return opportunities;
}

/**
 * Scan a directory for migration opportunities.
 */
export async function findMigrationOpportunitiesInProject(
  dirPath: string,
  options?: { extensions?: readonly string[] },
): Promise<MigrationReport> {
  const extensions = options?.extensions ?? ['.ts', '.tsx'];
  const opportunities: MigrationOpportunity[] = [];
  let fileCount = 0;

  async function scan(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'node_modules' && ent.name !== '.git' && ent.name !== 'dist') await scan(full);
      } else if (ent.isFile() && extensions.includes(extname(ent.name))) {
        fileCount++;
        try {
          opportunities.push(...findMigrationOpportunities(full));
        } catch {
          // Skip files that fail to parse (syntax errors, missing deps, etc.)
        }
      }
    }
  }
  await scan(dirPath);

  return { opportunities, fileCount };
}

/**
 * Format migration report as text.
 */
export function formatMigrationReport(report: MigrationReport): string {
  const lines: string[] = [];
  lines.push('Migration Opportunities Found:');
  lines.push('');
  for (const o of report.opportunities) {
    lines.push(`  ${o.filePath}:${o.line}:${o.column}  ${o.pattern}`);
    lines.push(`    →  ${o.suggestion}`);
    if (o.codeSnippet) lines.push(`    Snippet: ${o.codeSnippet.slice(0, 60)}...`);
    lines.push('');
  }
  lines.push(`Total: ${report.opportunities.length} opportunities in ${report.fileCount} files`);
  return lines.join('\n');
}
