import { Effect } from 'effect';
import { analyze } from './dist/analysis.js';

const src1 = `
import { Layer, Context } from "effect";
class FetchHttpClient extends Context.Tag("FetchHttpClient")<FetchHttpClient, { readonly get: () => void }>() {}
class RpcSerialization extends Context.Tag("RpcSerialization")<RpcSerialization, { readonly json: () => void }>() {}
class RpcClient extends Context.Tag("RpcClient")<RpcClient, { readonly call: () => void }>() {}
const clientLayer = Layer.succeed(RpcClient, { call: () => {} }).pipe(
  Layer.provide([
    Layer.succeed(FetchHttpClient, { get: () => {} }),
    Layer.succeed(RpcSerialization, { json: () => {} })
  ])
);`;

const src2 = `
import { Layer, Effect } from "effect";
export const TracingLayer = Layer.unwrapEffect(
  Effect.gen(function*() {
    return Layer.empty;
  })
);`;

for (const [name, src] of [['s1',src1],['s2',src2]]) {
  const irs = await Effect.runPromise(analyze.source(src).all());
  const ir = irs[0];
  console.log('\n===',name,'programs',irs.map(x=>x.root.programName));
  console.log('root source', ir.root.source, 'children', ir.root.children.map(c=>c.type+':'+(c.callee??c.name??'')));
  console.log(JSON.stringify(ir.root.children, null, 2));
}
