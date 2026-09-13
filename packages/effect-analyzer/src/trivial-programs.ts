import type { StaticEffectIR } from './types';

/**
 * Programs the CLI hides by default. Class/schema declarations are not
 * workflows; `Effect.runPromise` and friends are how a test or entrypoint
 * *executes* a workflow, not a second workflow.
 */
export const isTrivialProgram = (ir: StaticEffectIR): boolean => {
  const { source, children } = ir.root;
  if (source === 'class' || source === 'classProperty' || source === 'classMethod') {
    return true;
  }
  if (source === 'run') {
    return true;
  }
  if (source === 'direct' && children.length === 1 && children[0]?.type === 'effect') {
    const callee = (children[0] as { callee?: string }).callee ?? '';
    if (callee.startsWith('Schema.') || callee.startsWith('Data.') || callee === 'Service') {
      return true;
    }
  }
  if (source === 'direct' && children.length <= 1) {
    return true;
  }
  return false;
};
