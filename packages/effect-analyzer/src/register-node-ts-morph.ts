import { createRequire } from 'node:module';
import { setTsMorphLoader } from './ts-morph-loader';

setTsMorphLoader(() => {
  const requireTarget =
    typeof __filename === 'string' ? __filename : import.meta.url;
  const require = createRequire(requireTarget);
  return require('ts-morph') as typeof import('ts-morph');
});
