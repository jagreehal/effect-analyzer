import { Effect, Option } from 'effect';
import { analyze } from './dist/analysis.js';
import { resolve } from 'node:path';
const p=resolve('./src/__fixtures__/effect-kitchen-sink.ts');
const irs=await Effect.runPromise(analyze(p).all());
let count=0;
for (const ir of irs){
  const stack=[...ir.root.children];
  while(stack.length){
    const n=stack.pop(); if(!n) continue;
    if(n.type==='effect' && n.semanticRole==='service-call'){count++; console.log('svc',ir.root.programName,n.callee,n.displayName);}
    const ch=Option.getOrElse((await import('./dist/index.js')).getStaticChildren?.(n),()=>[]);
    stack.push(...ch);
  }
}
console.log('count',count);
