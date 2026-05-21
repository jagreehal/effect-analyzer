import { Effect } from 'effect';
import { resolve } from 'node:path';
import { analyze } from './dist/index.js';
const p=resolve('./src/__fixtures__/lint-issues-extra.ts');
const irs=await Effect.runPromise(analyze(p).all());
const ir=irs.find(x=>x.root.programName==='provideMergeChainProgram');
console.log('found',!!ir, 'source',ir?.root.source);
console.log(JSON.stringify(ir?.root.children,null,2));
