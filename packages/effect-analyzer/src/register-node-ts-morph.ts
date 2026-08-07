import { createRequire } from 'node:module';
import { setTsMorphLoader } from './ts-morph-loader';

/** Current module location in both ESM and bundled CommonJS builds. */
export const nodeModuleLocation =
  typeof __filename === 'string' ? __filename : import.meta.url;

setTsMorphLoader(() => {
  const require = createRequire(nodeModuleLocation);
  return require('ts-morph') as typeof import('ts-morph');
});
