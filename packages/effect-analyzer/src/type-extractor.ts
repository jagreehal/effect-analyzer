/**
 * Type Signature Extractor
 *
 * Uses ts-morph's TypeChecker to extract Effect type parameters:
 * - A (Success type)
 * - E (Error type)
 * - R (Requirements/Context type)
 */

import type { Type, Node, TypeChecker, VariableDeclaration, CallExpression } from 'ts-morph';
import type {
  EffectTypeSignature,
  ServiceRequirement,
  SourceLocation,
  StreamTypeSignature,
  LayerTypeSignature,
  ScheduleTypeSignature,
  CauseTypeSignature,
} from './types';

// =============================================================================
// Type Extraction
// =============================================================================

/** Regex to parse Effect<A, E, R> from type text when Type API fails */
const EFFECT_TYPE_REGEX_3 = /Effect(?:\.Effect)?<([^,]+),\s*([^,]+),\s*([^>]+)>/;
/** Regex to parse Effect<A, E> (2 params, R defaults to never in Effect v3) */
const EFFECT_TYPE_REGEX_2 = /Effect(?:\.Effect)?<([^,>]+),\s*([^,>]+)>/;

/**
 * Build EffectTypeSignature from type text using regex (fallback when Type API has no type args).
 */
export function effectTypeSignatureFromTypeText(
  typeText: string,
): EffectTypeSignature | undefined {
  const clean = (s: string) =>
    s
      .replace(/import\([^)]+\)\./g, '')
      .replace(/typeof\s+/g, '')
      .trim()
      .substring(0, 200);

  // Try 3-param: Effect<A, E, R>
  const match3 = EFFECT_TYPE_REGEX_3.exec(typeText);
  if (match3) {
    return {
      successType: clean(match3[1]!),
      errorType: clean(match3[2]!),
      requirementsType: clean(match3[3]!),
      isInferred: false,
      typeConfidence: 'inferred',
      rawTypeString: typeText,
    };
  }

  // Try 2-param: Effect<A, E> (R defaults to never in Effect v3)
  const match2 = EFFECT_TYPE_REGEX_2.exec(typeText);
  if (match2) {
    return {
      successType: clean(match2[1]!),
      errorType: clean(match2[2]!),
      requirementsType: 'never',
      isInferred: false,
      typeConfidence: 'inferred',
      rawTypeString: typeText,
    };
  }

  return undefined;
}

/**
 * Extract Effect type signature from a node
 */
export const extractEffectTypeSignature = (
  node: Node,
  _typeChecker: TypeChecker,
): EffectTypeSignature | undefined => {
  // Get the type of the node (can throw when type checker is unavailable)
  let nodeType;
  try {
    nodeType = node.getType();
  } catch {
    return undefined;
  }

  // Check if it's an Effect type
  if (!isEffectType(nodeType)) {
    return undefined;
  }

  // Extract type arguments (A, E, R)
  const typeArgs = extractTypeArguments(nodeType);

  if (typeArgs) {
    const [aType, eType, rType] = typeArgs;
    return {
      successType: typeToString(aType),
      errorType: typeToString(eType),
      requirementsType: typeToString(rType),
      isInferred: true,
      typeConfidence: 'declared',
      rawTypeString: nodeType.getText(),
    };
  }

  // Fallback: parse A, E, R from type text when Type API doesn't provide type args
  const typeText = nodeType.getText();
  const fromText = effectTypeSignatureFromTypeText(typeText);
  if (fromText) return fromText;

  // Fallback: resolve the callee function's return type annotation
  const fromCallee = tryExtractFromCalleeReturnType(node);
  if (fromCallee) return fromCallee;

  return {
    successType: 'unknown',
    errorType: 'never',
    requirementsType: 'never',
    isInferred: false,
    typeConfidence: 'unknown',
    rawTypeString: typeText,
  };
};

/**
 * When a call expression's resolved type lacks type args, try to extract
 * Effect<A, E, R> from the callee function's declared return type annotation.
 *
 * For `yield* validate(input)` where `validate` is declared as:
 *   `const validate = (input: T): Effect.Effect<A, E, R> => ...`
 * We resolve `validate` → get its return type annotation text → parse Effect<A, E, R>.
 */
function tryExtractFromCalleeReturnType(node: Node): EffectTypeSignature | undefined {
  try {
    // Only works for call expressions
    if (!('getExpression' in node)) return undefined;
    const call = node as CallExpression;
    const callee = call.getExpression();

    // Try to get the callee's return type from its signature
    const calleeType = callee.getType();
    const callSignatures = calleeType.getCallSignatures();
    if (callSignatures.length > 0) {
      const returnType = callSignatures[0]!.getReturnType();

      // Try type arguments on the return type
      const returnArgs = extractTypeArguments(returnType);
      if (returnArgs) {
        const [aType, eType, rType] = returnArgs;
        return {
          successType: typeToString(aType),
          errorType: typeToString(eType),
          requirementsType: typeToString(rType),
          isInferred: true,
          typeConfidence: 'inferred',
          rawTypeString: returnType.getText(),
        };
      }

      // Try regex on the return type text
      const returnText = returnType.getText();
      const fromReturnText = effectTypeSignatureFromTypeText(returnText);
      if (fromReturnText) return fromReturnText;
    }

    // Try to resolve the callee to its declaration and read the return type annotation
    const symbol = callee.getSymbol();
    if (!symbol) return undefined;

    for (const decl of symbol.getDeclarations()) {
      // Get the return type annotation text from the declaration
      let returnTypeText: string | undefined;

      if ('getReturnType' in decl) {
        // Function/method declarations
        const declType = (decl as { getReturnType: () => Type }).getReturnType();
        returnTypeText = declType.getText();
      } else if ('getType' in decl) {
        // Variable declarations: get the type of the variable, then its call signatures
        const varType = (decl as { getType: () => Type }).getType();
        const sigs = varType.getCallSignatures();
        if (sigs.length > 0) {
          const retType = sigs[0]!.getReturnType();
          const retArgs = extractTypeArguments(retType);
          if (retArgs) {
            const [aType, eType, rType] = retArgs;
            return {
              successType: typeToString(aType),
              errorType: typeToString(eType),
              requirementsType: typeToString(rType),
              isInferred: true,
              typeConfidence: 'inferred',
              rawTypeString: retType.getText(),
            };
          }
          returnTypeText = retType.getText();
        }
      }

      if (returnTypeText) {
        const fromAnnotation = effectTypeSignatureFromTypeText(returnTypeText);
        if (fromAnnotation) {
          return { ...fromAnnotation, typeConfidence: 'inferred' };
        }
      }
    }
  } catch {
    // Callee resolution can fail for dynamic or unresolvable expressions
  }
  return undefined;
}

/**
 * Check if a type is an Effect type
 */
const isEffectType = (type: Type): boolean => {
  const symbol = type.getSymbol();
  const typeText = type.getText();
  
  // Check by symbol name
  if (symbol) {
    const name = symbol.getName();
    if (name === 'Effect' || name.includes('Effect')) {
      return true;
    }
  }
  
  // Check by type text pattern
  if (typeText.includes('Effect<') || typeText.startsWith('Effect.')) {
    return true;
  }
  
  // Check for Effect interface
  const aliasSymbol = type.getAliasSymbol();
  if (aliasSymbol) {
    const aliasName = aliasSymbol.getName();
    if (aliasName === 'Effect' || aliasName.includes('Effect')) {
      return true;
    }
  }
  
  return false;
};

/**
 * Extract type arguments from an Effect type
 * Returns [A, E, R] or undefined
 */
const extractTypeArguments = (type: Type): [Type, Type, Type] | undefined => {
  try {
    const typeArgs = type.getTypeArguments?.();
    if (!typeArgs || typeArgs.length < 3) {
      const aliasTypeArgs = type.getAliasTypeArguments?.();
      if (aliasTypeArgs && aliasTypeArgs.length >= 3) {
        return [aliasTypeArgs[0]!, aliasTypeArgs[1]!, aliasTypeArgs[2]!];
      }
      return undefined;
    }
    return [typeArgs[0]!, typeArgs[1]!, typeArgs[2]!];
  } catch {
    return undefined;
  }
};

/**
 * Convert a Type to a readable string
 */
const typeToString = (type: Type): string => {
  const text = type.getText();
  
  // Clean up the type string
  return text
    .replace(/import\([^)]+\)\./g, '') // Remove import paths
    .replace(/typeof\s+/g, '') // Remove typeof
    .substring(0, 200); // Limit length
};

// =============================================================================
// Service Requirement Extraction
// =============================================================================

/**
 * Extract service requirements from a Context type
 */
export const extractServiceRequirements = (
  node: Node,
  _typeChecker: TypeChecker,
): ServiceRequirement[] => {
  const requirements: ServiceRequirement[] = [];
  
  // Try to get the type - first from the node, then from type annotation
  let nodeType = node.getType();
  let locationNode: Node = node;
  
  // If node type doesn't have the required info, try to get declared type from variable
  let nodeTypeArgs: readonly Type[] | undefined;
  try {
    nodeTypeArgs = typeof nodeType.getTypeArguments === 'function' ? nodeType.getTypeArguments() : undefined;
  } catch {
    nodeTypeArgs = undefined;
  }
  if (!nodeTypeArgs || nodeTypeArgs.length < 3) {
    const parent = node.getParent();
    if (parent?.getKindName() === 'VariableDeclaration') {
      const varDecl = parent as VariableDeclaration;
      const declaredType = varDecl.getType();
      if (declaredType) {
        nodeType = declaredType;
        locationNode = varDecl;
      }
    }
  }
  
  // Check if type contains Context requirements
  const rType = extractRequirementsType(nodeType);
  if (!rType) return requirements;
  
  // Extract individual services from the Context type
  const services = extractServicesFromContext(rType);
  
  for (const service of services) {
    const sourceFile = locationNode.getSourceFile();
    const { line, column } = sourceFile.getLineAndColumnAtPos(locationNode.getStart());
    const location: SourceLocation = {
      filePath: sourceFile.getFilePath(),
      line,
      column,
    };
    
    requirements.push({
      serviceId: service.id,
      serviceType: service.typeName,
      requiredAt: location,
    });
  }
  
  return requirements;
};

/**
 * Extract the R (requirements) type from an Effect type
 */
const extractRequirementsType = (type: Type): Type | undefined => {
  const typeArgs = extractTypeArguments(type);
  if (!typeArgs) return undefined;
  
  return typeArgs[2]; // R is the third type parameter
};

/**
 * Extract individual service types from a Context type
 */
const extractServicesFromContext = (contextType: Type): { id: string; typeName: string }[] => {
  const services: { id: string; typeName: string }[] = [];
  
  // Check if it's Context<Tag>
  const typeText = contextType.getText();
  
  // Try to extract Tag identifier from Context<Tag>
  const contextMatch = /Context<([^>]+)>/.exec(typeText);
  if (contextMatch) {
    const tagType = contextMatch[1]!;
    services.push({
      id: extractTagIdentifier(tagType),
      typeName: tagType,
    });
  }
  
  // Check for intersection types (Context<A> | Context<B>)
  if (typeText.includes('|')) {
    const parts = splitTopLevelUnion(typeText);
    for (const part of parts) {
      const match = /Context<([^>]+)>/.exec(part);
      if (match) {
        services.push({
          id: extractTagIdentifier(match[1]!),
          typeName: match[1]!,
        });
      }
    }
  }
  
  // Check for never type (no requirements)
  if (typeText === 'never' || typeText === '{}') {
    return [];
  }
  
  return services;
};

/**
 * Extract tag identifier from a Tag type string
 */
const extractTagIdentifier = (tagType: string): string => {
  // Try to extract from Tag<"identifier", ...>
  const match = /Tag<["']([^"']+)["']/.exec(tagType);
  if (match) {
    return match[1]!;
  }
  
  // Fallback: use the type name
  return tagType.split('<')[0]!.trim();
};

// =============================================================================
// Type Transformation Tracking
// =============================================================================

/**
 * Track how an Effect type transforms through a pipe operation
 */
export const trackTypeTransformation = (
  inputType: EffectTypeSignature,
  operation: string,
  outputType: EffectTypeSignature,
): { operation: string; typeChange: string } => {
  const changes: string[] = [];
  
  if (inputType.successType !== outputType.successType) {
    changes.push(`${inputType.successType} → ${outputType.successType}`);
  }
  
  if (inputType.errorType !== outputType.errorType) {
    changes.push(`${inputType.errorType} → ${outputType.errorType}`);
  }
  
  if (inputType.requirementsType !== outputType.requirementsType) {
    changes.push(`${inputType.requirementsType} → ${outputType.requirementsType}`);
  }
  
  return {
    operation,
    typeChange: changes.length > 0 ? changes.join(', ') : 'no change',
  };
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Split a type string on top-level `|` only, respecting angle brackets and string literals.
 * e.g. `Envelope<"A" | "B"> | FooError` → `["Envelope<\"A\" | \"B\">", "FooError"]`
 */
export function splitTopLevelUnion(typeText: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;      // angle bracket depth
  let inString: string | null = null;

  for (let i = 0; i < typeText.length; i++) {
    const ch = typeText[i]!;

    if (inString) {
      current += ch;
      if (ch === inString && typeText[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '<' || ch === '(') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === '>' || ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }

    if (ch === '|' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  const last = current.trim();
  if (last) parts.push(last);

  return parts.filter(Boolean);
}

/**
 * Format type signature for display
 */
export const formatTypeSignature = (sig: EffectTypeSignature): string => {
  return `Effect<${sig.successType}, ${sig.errorType}, ${sig.requirementsType}>`;
};

// =============================================================================
// Stream / Layer / Schedule / Cause type extraction (21.3)
// =============================================================================

const cleanTypeArg = (s: string): string =>
  s
    .replace(/import\([^)]+\)\./g, '')
    .replace(/typeof\s+/g, '')
    .trim()
    .substring(0, 200);

/** Regexes for type args when Type API has no type arguments */
const STREAM_TYPE_REGEX = /Stream<([^,]+),\s*([^,]+),\s*([^>]+)>/;
const LAYER_TYPE_REGEX = /Layer<([^,]+),\s*([^,]+),\s*([^>]+)>/;
const SCHEDULE_TYPE_REGEX = /Schedule<([^,]+),\s*([^,]+),\s*([^>]+)>/;
const CAUSE_TYPE_REGEX = /Cause<([^>]+)>/;

/**
 * Extract Stream<A, E, R> type args from a node's type (regex fallback).
 */
export function extractStreamTypeSignature(node: Node): StreamTypeSignature | undefined {
  const typeText = node.getType().getText();
  const match = STREAM_TYPE_REGEX.exec(typeText);
  if (!match) return undefined;
  return {
    successType: cleanTypeArg(match[1]!),
    errorType: cleanTypeArg(match[2]!),
    requirementsType: cleanTypeArg(match[3]!),
    rawTypeString: typeText,
  };
}

/**
 * Extract Layer<ROut, E, RIn> type args from a node's type (regex fallback).
 */
export function extractLayerTypeSignature(node: Node): LayerTypeSignature | undefined {
  const typeText = node.getType().getText();
  const match = LAYER_TYPE_REGEX.exec(typeText);
  if (!match) return undefined;
  return {
    providedType: cleanTypeArg(match[1]!),
    errorType: cleanTypeArg(match[2]!),
    requiredType: cleanTypeArg(match[3]!),
    rawTypeString: typeText,
  };
}

/**
 * Extract Schedule<Out, In, R> type args from a node's type (regex fallback).
 */
export function extractScheduleTypeSignature(node: Node): ScheduleTypeSignature | undefined {
  const typeText = node.getType().getText();
  const match = SCHEDULE_TYPE_REGEX.exec(typeText);
  if (!match) return undefined;
  return {
    outputType: cleanTypeArg(match[1]!),
    inputType: cleanTypeArg(match[2]!),
    requirementsType: cleanTypeArg(match[3]!),
    rawTypeString: typeText,
  };
}

/**
 * Extract Cause<E> type arg from a node's type (regex fallback).
 */
export function extractCauseTypeSignature(node: Node): CauseTypeSignature | undefined {
  const typeText = node.getType().getText();
  const match = CAUSE_TYPE_REGEX.exec(typeText);
  if (!match) return undefined;
  return {
    errorType: cleanTypeArg(match[1]!),
    rawTypeString: typeText,
  };
}

// =============================================================================
// Schema
// =============================================================================

/**
 * Check if a type is a Schema type
 */
export const isSchemaType = (type: Type): boolean => {
  const symbol = type.getSymbol();
  if (symbol) {
    const name = symbol.getName();
    return name === 'Schema' || name.includes('Schema');
  }
  
  const typeText = type.getText();
  return typeText.includes('Schema<') || typeText.startsWith('Schema.');
};

/**
 * Extract Schema validation information
 */
export const extractSchemaInfo = (type: Type): { encoded: string; decoded: string } | undefined => {
  if (!isSchemaType(type)) return undefined;
  
  const typeArgs = type.getTypeArguments();
  if (typeArgs.length >= 2) {
    return {
      encoded: typeToString(typeArgs[1]!),
      decoded: typeToString(typeArgs[0]!),
    };
  }
  
  return undefined;
};
