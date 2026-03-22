/**
 * Fixture for migration assistant - patterns to detect
 */

// EventEmitter -> PubSub (use global EventEmitter for fixture)
declare const EventEmitter: new () => { on: (e: string, h: (x: unknown) => void) => void; emit: (e: string, x: unknown) => void };
const emitter = new EventEmitter();
emitter.on('data', (x) => console.log(x));
emitter.emit('data', 1);

// class-based DI
class DatabaseService {
  constructor() {}
}

class UserRepository {
  private db = new DatabaseService();
}

// async/await -> Effect
async function fetchUser() {
  return { id: 1 };
}

// Promise.then -> Effect.flatMap
Promise.resolve(1).then((x) => x + 1);

// throw -> Effect.fail
function fail() {
  throw new Error('oops');
}

// util.promisify -> Effect.tryPromise
import { promisify } from 'util';
const readFile = promisify(require('fs').readFile);

// new Promise -> Effect.async
const p = new Promise<number>((resolve) => resolve(1));

// for await -> Stream
async function* gen() {
  yield 1;
}
async function consume() {
  for await (const x of gen()) {
    console.log(x);
  }
}

// sync fs -> Effect.promise
import * as fs from 'fs';
const data = fs.readFileSync('file.txt', 'utf-8');
fs.writeFileSync('out.txt', data);

// process.env -> Config
const port = process.env.PORT ?? '3000';

// process.nextTick -> Effect.sync
process.nextTick(() => console.log('deferred'));

// AbortController -> Effect.Scoped
const ac = new AbortController();

// child_process.exec -> CommandExecutor
import { exec } from 'child_process';
exec('ls', (err, stdout) => {});

// setImmediate -> Effect.sync
setImmediate(() => console.log('deferred'));

// XMLHttpRequest -> HttpClient
const xhr = new XMLHttpRequest();

// Worker -> Effect Worker
const w = new Worker('./worker.js');

// fs.exists (callback) -> Effect.promise
import * as fs from 'fs';
fs.exists('/tmp/foo', (exists) => {});

// http.request -> HttpClient
import * as http from 'http';
http.request('http://example.com', (res) => {});

// dns (callback) -> Effect.promise
import * as dns from 'dns';
dns.lookup('example.com', (err, addr) => {});

// requestAnimationFrame (browser)
declare const requestAnimationFrame: (cb: () => void) => number;
requestAnimationFrame(() => {});

// crypto (callback)
import * as crypto from 'crypto';
crypto.randomBytes(16, (err, buf) => {});

// createReadStream
import * as fs from 'fs';
const r = fs.createReadStream('file.txt');

// cluster.fork
import * as cluster from 'cluster';
if (cluster.isPrimary) cluster.fork();

// net.createServer
import * as net from 'net';
net.createServer((sock) => {});

// zlib (callback)
import * as zlib from 'zlib';
zlib.gzip(Buffer.from('x'), (err, out) => {});

// readline.createInterface
import * as readline from 'readline';
const rl = readline.createInterface({ input: process.stdin });

// stream.pipeline (callback)
import { pipeline } from 'stream';
pipeline(process.stdin, process.stdout, (err) => {});

// events.once
import { once } from 'events';
once(process, 'exit');

// fs.watch
fs.watch('/tmp', (ev, name) => {});

// vm.runInNewContext
import * as vm from 'vm';
vm.runInNewContext('1 + 1', {});

// url.parse (deprecated)
import * as url from 'url';
url.parse('http://example.com');

// child_process.spawnSync
import { spawnSync } from 'child_process';
spawnSync('ls', []);

// glob (callback)
declare function glob(pat: string, cb: (err: Error | null, files: string[]) => void): void;
glob('*.ts', (err, files) => {});

// tls
import * as tls from 'tls';
tls.connect(443, 'host', () => {});

// Promise.catch -> Effect.catchAll
Promise.resolve(1).then((x) => x + 1).catch((e) => console.error(e));

// addEventListener -> Effect.async
declare const el: HTMLElement;
el.addEventListener('click', () => {});

// fs.readFile (callback)
fs.readFile('file.txt', (err, data) => {});

// queueMicrotask -> Effect.sync
queueMicrotask(() => console.log('micro'));

// WebSocket -> Effect.async
const ws = new WebSocket('ws://localhost');

// MessageChannel -> Effect.async
const channel = new MessageChannel();

// fs.appendFile (callback)
fs.appendFile('log.txt', 'line\n', () => {});

// Promise.finally -> Effect.ensuring
Promise.resolve(1).finally(() => {});

// fs.mkdir / fs.stat / fs.unlink (callback)
fs.mkdir('/tmp/foo', (err) => {});
fs.stat('file.txt', (err, stats) => {});
fs.unlink('file.txt', (err) => {});

// MutationObserver -> Effect.async
declare const MutationObserver: new (cb: () => void) => { observe: (el: HTMLElement) => void };
new MutationObserver(() => {});

// requestIdleCallback -> Effect.async
declare const requestIdleCallback: (cb: () => void) => number;
requestIdleCallback(() => {});

// BroadcastChannel -> PubSub
declare const BroadcastChannel: new (name: string) => { postMessage: (m: unknown) => void };
new BroadcastChannel('channel');

// fs.rename / fs.realpath (callback)
fs.rename('a', 'b', (err) => {});
fs.realpath('path', (err, p) => {});

// fs.readdir / fs.copyFile (callback)
fs.readdir('/tmp', (err, files) => {});
fs.copyFile('a', 'b', (err) => {});

// FileReader (browser)
declare const FileReader: new () => { readAsText: (blob: Blob) => void };
new FileReader();

// child_process.fork
import { fork } from 'child_process';
fork('./worker.js');

// fs.mkdtemp / fs.symlink (callback)
fs.mkdtemp('/tmp/foo', (err, path) => {});
fs.symlink('target', 'link', (err) => {});

// ResizeObserver / IntersectionObserver
declare const ResizeObserver: new (cb: () => void) => { observe: (el: HTMLElement) => void };
declare const IntersectionObserver: new (cb: () => void) => { observe: (el: HTMLElement) => void };
new ResizeObserver(() => {});
new IntersectionObserver(() => {});

// assert.throws / expect().rejects (test) -> Effect.runPromiseExit
import assert from 'assert';
assert.throws(() => { throw new Error('x'); });
