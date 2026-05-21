/**
 * Heuristics for inferring service / runtime-primitive types from raw AST text.
 *
 * These are best-effort guesses used to label nodes in the IR (e.g. mark a
 * call as `serviceCall` when the receiver looks like a service). They never
 * fall back to the rest of the analyzer pipeline, which is why they live in
 * their own module.
 *
 * Extracted from effect-analysis.ts as part of the strangler-fig cleanup.
 * Behaviour is preserved exactly.
 */

import type { PropertyAccessExpression, ArrowFunction, FunctionExpression } from 'ts-morph';
import type { StaticEffectNode } from './types';
import {
  BUILT_IN_TYPE_NAMES,
  KNOWN_EFFECT_NAMESPACES,
} from './analysis-patterns';

export const isPromiseLikeText = (text: string): boolean =>
  /\bPromise(?:<.*>)?\b/.test(text) || /\bthen\s*\(/.test(text);

const EFFECT_RUNTIME_PRIMITIVE_PREFIXES = [
  'Ref.',
  'SynchronizedRef.',
  'FiberRef.',
  'TxRef.',
  'TRef.',
  'Queue.',
  'TQueue.',
  'TxQueue.',
  'PubSub.',
  'TPubSub.',
  'Deferred.',
  'TDeferred.',
  'Semaphore.',
  'TSemaphore.',
  'SubscriptionRef.',
  'Mailbox.',
];

export const isEffectRuntimePrimitive = (text: string): boolean =>
  EFFECT_RUNTIME_PRIMITIVE_PREFIXES.some((prefix) => text.startsWith(prefix));

export const isLikelyServiceStreamProperty = (propertyName: string): boolean =>
  propertyName === 'stream' || propertyName.startsWith('stream');

const normalizeInferredServiceType = (typeName: string): string =>
  typeName.endsWith('Shape') ? typeName.slice(0, -'Shape'.length) : typeName;

const inferServiceTypeFromObjectName = (objectName: string): string | undefined => {
  if (!/^[a-zA-Z_$][\w$]*$/.test(objectName)) return undefined;
  if (objectName.length === 0) return undefined;
  const inferred = objectName[0]!.toUpperCase() + objectName.slice(1);
  if (BUILT_IN_TYPE_NAMES.has(inferred) || KNOWN_EFFECT_NAMESPACES.has(inferred)) {
    return undefined;
  }
  return inferred;
};

export const tryResolveServicePropertyAccess = (
  node: PropertyAccessExpression,
): StaticEffectNode['serviceCall'] => {
  const objectName = node.getExpression().getText();
  const methodName = node.getName();
  const firstSegment = objectName.split('.')[0] ?? objectName;
  const fallback = inferServiceTypeFromObjectName(objectName);
  if (KNOWN_EFFECT_NAMESPACES.has(firstSegment)) return undefined;

  try {
    const type = node.getExpression().getType();
    const symbol = type.getSymbol() ?? type.getAliasSymbol();
    if (!symbol) return fallback ? { serviceType: fallback, methodName, objectName } : undefined;
    const typeName = normalizeInferredServiceType(symbol.getName());
    if (
      !typeName ||
      typeName === '__type' ||
      typeName === 'unknown' ||
      typeName === 'any' ||
      BUILT_IN_TYPE_NAMES.has(typeName)
    ) {
      return fallback ? { serviceType: fallback, methodName, objectName } : undefined;
    }
    return { serviceType: typeName, methodName, objectName };
  } catch {
    return fallback ? { serviceType: fallback, methodName, objectName } : undefined;
  }
};

export const classifyUseCallbackKind = (
  fnNode: ArrowFunction | FunctionExpression,
): 'promise' | 'effect' | 'unknown' => {
  const body = fnNode.getBody();
  const bodyText = body.getText();
  if (
    bodyText.includes('Effect.') ||
    bodyText.includes('yield*') ||
    bodyText.includes('.pipe(')
  ) {
    return 'effect';
  }

  if (isPromiseLikeText(bodyText)) {
    return 'promise';
  }

  try {
    const fnTypeText = fnNode.getType().getText();
    if (fnTypeText.includes('Effect<') || fnTypeText.includes('Effect.Effect<')) {
      return 'effect';
    }
    if (isPromiseLikeText(fnTypeText)) {
      return 'promise';
    }
  } catch {
    // best-effort classification only
  }

  return 'unknown';
};
