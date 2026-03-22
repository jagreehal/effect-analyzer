/**
 * Schema Validation Path Extractor
 *
 * Extracts Schema.decode/encode operations and their validation error paths:
 * - Identifies which fields can fail validation
 * - Tracks Schema compositions (Struct, Union, Array, etc.)
 * - Detects missing error handling for Schema operations
 */

import type { Node, Type, TypeChecker } from 'ts-morph';
import type {
  SchemaValidationPath,
  SchemaConstraint,
  SchemaOperation,
  SchemaComposition,
  SchemaAnalysis,
  SourceLocation,
} from './types';

// =============================================================================
// Schema Detection
// =============================================================================

/**
 * Check if a node is a Schema operation (decode, encode, etc.)
 */
export const isSchemaOperation = (node: Node): boolean => {
  const text = node.getText();
  return (
    text.includes('Schema.decode') ||
    text.includes('Schema.encode') ||
    text.includes('Schema.decodeUnknown') ||
    text.includes('Schema.encodeUnknown') ||
    text.includes('Schema.decodeEither') ||
    text.includes('Schema.encodeEither') ||
    text.includes('Schema.parse') ||
    text.includes('Schema.assert') ||
    text.includes('JSONSchema.make') ||
    text.includes('Arbitrary.make') ||
    text.includes('Pretty.make') ||
    text.includes('Schema.equivalence')
  );
};

/**
 * Extract the operation type from a Schema call
 */
export const extractSchemaOperationType = (node: Node): SchemaOperation['operation'] | undefined => {
  const text = node.getText();
  
  if (text.includes('decodeUnknown')) return 'decodeUnknown';
  if (text.includes('encodeUnknown')) return 'encodeUnknown';
  if (text.includes('decodeEither')) return 'decode';
  if (text.includes('encodeEither')) return 'encode';
  if (text.includes('decode')) return 'decode';
  if (text.includes('encode')) return 'encode';
  
  return undefined;
};

// =============================================================================
// Validation Path Extraction
// =============================================================================

/**
 * Extract validation paths from a Schema type
 */
export const extractValidationPaths = (
  schemaType: Type,
  basePath = '',
): SchemaValidationPath[] => {
  const paths: SchemaValidationPath[] = [];
  
  const typeText = schemaType.getText();
  const symbol = schemaType.getSymbol();
  
  // Handle Struct types
  if (typeText.includes('Struct<') || (symbol?.getName() === 'Struct')) {
    const properties = schemaType.getProperties();
    
    for (const prop of properties) {
      const propName = prop.getName();
      // Get type from the prop declaration instead
      const propDeclarations = prop.getDeclarations();
      const propType = propDeclarations.length > 0 
        ? propDeclarations[0]!.getType()
        : prop.getTypeAtLocation(propDeclarations[0] ?? schemaType as unknown as Node);
      const propPath = basePath ? `${basePath}.${propName}` : propName;
      
      // Extract constraints from the property type
      const constraints = extractConstraints(propType);
      const isOptional = propType.isNullable() || typeText.includes('Optional<');
      
      paths.push({
        path: propPath,
        schemaType: propType.getText().substring(0, 100),
        constraints,
        isOptional,
      });
      
      // Recursively extract nested paths
      if (isComplexType(propType)) {
        const nestedPaths = extractValidationPaths(propType, propPath);
        paths.push(...nestedPaths);
      }
    }
  }
  
  // Handle Array types
  if (typeText.includes('Array<') || (symbol?.getName() === 'Array')) {
    const elementType = extractArrayElementType(schemaType);
    if (elementType) {
      const itemPath = basePath ? `${basePath}[0]` : '[0]';
      const itemPaths = extractValidationPaths(elementType, itemPath);
      paths.push(...itemPaths);
    }
  }
  
  // Handle Union types
  if (typeText.includes('Union<') || schemaType.isUnion()) {
    // Union validation can fail at any branch
    paths.push({
      path: basePath || 'union',
      schemaType: typeText.substring(0, 100),
      constraints: [{ type: 'union', value: true, description: 'Must match one of union variants' }],
      isOptional: false,
    });
  }
  
  // Handle branded types
  if (typeText.includes('Brand<') || typeText.includes('brand')) {
    const brandMatch = /Brand<["']([^"']+)["']/.exec(typeText);
    const brandName = brandMatch?.[1] || 'unknown';
    
    paths.push({
      path: basePath || 'brand',
      schemaType: typeText.substring(0, 100),
      constraints: [{ type: 'brand', value: brandName, description: `Must satisfy ${brandName} brand constraint` }],
      isOptional: false,
    });
  }
  
  return paths;
};

/**
 * Extract constraints from a type
 */
const extractConstraints = (type: Type): SchemaConstraint[] => {
  const constraints: SchemaConstraint[] = [];
  const typeText = type.getText();
  
  // Pattern constraints (email, uuid, etc.)
  if (typeText.includes('pattern')) {
    constraints.push({
      type: 'pattern',
      value: 'regex',
      description: 'Must match pattern',
    });
  }
  
  // Length constraints
  if (typeText.includes('minLength')) {
    const match = /minLength\((\d+)\)/.exec(typeText);
    if (match) {
      constraints.push({
        type: 'minLength',
        value: parseInt(match[1]!, 10),
        description: `Minimum length: ${match[1]}`,
      });
    }
  }
  
  if (typeText.includes('maxLength')) {
    const match = /maxLength\((\d+)\)/.exec(typeText);
    if (match) {
      constraints.push({
        type: 'maxLength',
        value: parseInt(match[1]!, 10),
        description: `Maximum length: ${match[1]}`,
      });
    }
  }
  
  // Range constraints
  if (typeText.includes('positive')) {
    constraints.push({
      type: 'range',
      value: '> 0',
      description: 'Must be positive',
    });
  }
  
  if (typeText.includes('nonNegative')) {
    constraints.push({
      type: 'range',
      value: '>= 0',
      description: 'Must be non-negative',
    });
  }
  
  // Integer constraint
  if (typeText.includes('int')) {
    constraints.push({
      type: 'type',
      value: 'integer',
      description: 'Must be an integer',
    });
  }
  
  // Trimmed constraint
  if (typeText.includes('trimmed')) {
    constraints.push({
      type: 'transform',
      value: 'trim',
      description: 'Value will be trimmed',
    });
  }
  
  return constraints;
};

/**
 * Check if a type is complex (needs recursive extraction)
 */
const isComplexType = (type: Type): boolean => {
  const typeText = type.getText();
  return (
    typeText.includes('Struct<') ||
    typeText.includes('Array<') ||
    typeText.includes('Option<') ||
    type.getProperties().length > 0
  );
};

/**
 * Extract array element type
 */
const extractArrayElementType = (arrayType: Type): Type | undefined => {
  const typeArgs = arrayType.getTypeArguments();
  if (typeArgs.length > 0) {
    return typeArgs[0];
  }
  
  // Try to extract from Array<T> text
  const typeText = arrayType.getText();
  const match = /Array<(.+)>/.exec(typeText);
  if (match) {
    // Return the array type itself as fallback
    return arrayType;
  }
  
  return undefined;
};

// =============================================================================
// Schema Operation Extraction
// =============================================================================

/**
 * Extract Schema operation from a node
 */
export const extractSchemaOperation = (
  node: Node,
  typeChecker: TypeChecker,
  hasErrorHandling = false,
): SchemaOperation | undefined => {
  const operation = extractSchemaOperationType(node);
  if (!operation) return undefined;
  
  const nodeType = node.getType();
  const typeText = nodeType.getText();
  
  // Try to extract schema name from the call
  const schemaMatch = /Schema\.(decode|encode)[^<]*<([^>]+)>/.exec(typeText);
  const schemaName = schemaMatch?.[2] || 'UnknownSchema';
  
  // Extract source and target types
  const { sourceType, targetType } = extractSourceTargetTypes(nodeType, operation);
  
  // Extract validation paths from the schema type
  const validationPaths = extractValidationPaths(nodeType);
  
  const sourceFile = node.getSourceFile();
  const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
  const location: SourceLocation = {
    filePath: sourceFile.getFilePath(),
    line: line + 1,
    column,
  };
  
  return {
    operation,
    schemaName: schemaName.substring(0, 50),
    sourceType: sourceType.substring(0, 100),
    targetType: targetType.substring(0, 100),
    validationPaths,
    hasErrorHandling,
    location,
  };
};

/**
 * Extract source and target types based on operation
 */
const extractSourceTargetTypes = (
  type: Type,
  operation: SchemaOperation['operation'],
): { sourceType: string; targetType: string } => {
  const typeText = type.getText();
  
  // For decode: source is encoded type, target is decoded type
  // For encode: source is decoded type, target is encoded type
  
  if (operation === 'decode' || operation === 'decodeUnknown') {
    return {
      sourceType: 'unknown',
      targetType: typeText.substring(0, 100),
    };
  } else {
    return {
      sourceType: typeText.substring(0, 100),
      targetType: 'unknown',
    };
  }
};

// =============================================================================
// Schema Analysis
// =============================================================================

/**
 * Analyze all Schema operations in a program
 */
export const analyzeSchemaOperations = (
  nodes: Node[],
  typeChecker: TypeChecker,
): SchemaAnalysis => {
  const operations: SchemaOperation[] = [];
  const compositions: SchemaComposition[] = [];
  const unhandledOperations: SchemaOperation[] = [];
  
  for (const node of nodes) {
    if (isSchemaOperation(node)) {
      // Check if this operation has error handling (catchTag('ParseError'))
      const hasErrorHandling = checkForErrorHandling(node);
      
      const operation = extractSchemaOperation(node, typeChecker, hasErrorHandling);
      if (operation) {
        operations.push(operation);
        
        if (!hasErrorHandling) {
          unhandledOperations.push(operation);
        }
      }
    }
    
    // Look for Schema compositions (Struct, Union, etc.)
    const composition = extractSchemaComposition(node);
    if (composition) {
      compositions.push(composition);
    }
  }
  
  return {
    operations,
    compositions,
    unhandledOperations,
  };
};

/**
 * Check if a Schema operation has error handling
 */
const checkForErrorHandling = (node: Node): boolean => {
  // Walk up the AST to find if there's a catchTag('ParseError') or catchAll
  let current: Node | undefined = node;
  
  while (current) {
    const text = current.getText();
    
    if (
      text.includes('catchTag') &&
      (text.includes('ParseError') || text.includes('"ParseError"'))
    ) {
      return true;
    }
    
    if (text.includes('catchAll')) {
      return true;
    }
    
    if (text.includes('orElse')) {
      return true;
    }
    
    current = current.getParent();
  }
  
  return false;
};

/**
 * Extract Schema composition information
 */
const extractSchemaComposition = (node: Node): SchemaComposition | undefined => {
  const text = node.getText();
  
  // Check for Schema struct definitions
  if (text.includes('Schema.Struct')) {
    const schemaName = extractSchemaName(node) || 'AnonymousStruct';
    
    return {
      schemaName,
      compositionType: 'struct',
      children: [],
      validationPaths: [],
    };
  }
  
  // Check for Schema union definitions
  if (text.includes('Schema.Union')) {
    const schemaName = extractSchemaName(node) || 'AnonymousUnion';
    
    return {
      schemaName,
      compositionType: 'union',
      children: [],
      validationPaths: [],
    };
  }
  
  // Check for Schema array definitions
  if (text.includes('Schema.Array')) {
    const schemaName = extractSchemaName(node) || 'AnonymousArray';
    
    return {
      schemaName,
      compositionType: 'array',
      children: [],
      validationPaths: [],
    };
  }

  if (text.includes('Schema.Record')) {
    const schemaName = extractSchemaName(node) || 'AnonymousRecord';
    return {
      schemaName,
      compositionType: 'record',
      children: [],
      validationPaths: [],
    };
  }

  if (text.includes('Schema.Tuple')) {
    const schemaName = extractSchemaName(node) || 'AnonymousTuple';
    return {
      schemaName,
      compositionType: 'tuple',
      children: [],
      validationPaths: [],
    };
  }

  if (
    text.includes('Schema.Class') ||
    text.includes('Schema.TaggedClass') ||
    text.includes('Schema.TaggedError') ||
    text.includes('Schema.TaggedRequest')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousSchemaClass';
    return {
      schemaName,
      compositionType: 'class',
      children: [],
      validationPaths: [],
    };
  }

  if (text.includes('Schema.suspend')) {
    const schemaName = extractSchemaName(node) || 'AnonymousRecursive';
    return {
      schemaName,
      compositionType: 'recursive',
      children: [],
      validationPaths: [],
    };
  }

  // Optional / nullable wrappers
  if (text.includes('Schema.optional') || text.includes('.pipe(Schema.optional')) {
    const schemaName = extractSchemaName(node) || 'AnonymousOptional';
    return {
      schemaName,
      compositionType: 'optional',
      children: [],
      validationPaths: [],
    };
  }

  if (
    text.includes('Schema.NullOr') ||
    text.includes('Schema.NullishOr') ||
    text.includes('Schema.UndefinedOr') ||
    text.includes('Schema.OptionFromNullOr') ||
    text.includes('Schema.OptionFromUndefinedOr')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousNullable';
    return {
      schemaName,
      compositionType: 'nullable',
      children: [],
      validationPaths: [],
    };
  }

  // Transform / compose / pipe schemas
  if (
    text.includes('Schema.transform') ||
    text.includes('Schema.transformOrFail') ||
    text.includes('Schema.compose') ||
    text.includes('Schema.pluck') ||
    text.includes('Schema.rename')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousTransform';
    return {
      schemaName,
      compositionType: 'transform',
      children: [],
      validationPaths: [],
    };
  }

  // Filter / predicate schemas
  if (
    text.includes('Schema.filter') ||
    text.includes('Schema.filterEffect') ||
    text.includes('.pipe(Schema.filter')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousFilter';
    return {
      schemaName,
      compositionType: 'filter',
      children: [],
      validationPaths: [],
    };
  }

  // Brand schemas
  if (
    text.includes('Schema.brand') ||
    text.includes('Schema.fromBrand') ||
    text.includes('.pipe(Schema.brand')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousBrand';
    return {
      schemaName,
      compositionType: 'brand',
      children: [],
      validationPaths: [],
    };
  }

  // Literal / enum / template
  if (text.includes('Schema.Literal')) {
    const schemaName = extractSchemaName(node) || 'AnonymousLiteral';
    return {
      schemaName,
      compositionType: 'literal',
      children: [],
      validationPaths: [],
    };
  }

  if (text.includes('Schema.Enums')) {
    const schemaName = extractSchemaName(node) || 'AnonymousEnum';
    return {
      schemaName,
      compositionType: 'enum',
      children: [],
      validationPaths: [],
    };
  }

  // Date/Time schemas
  if (
    text.includes('Schema.Date') ||
    text.includes('Schema.DateFromString') ||
    text.includes('Schema.DateFromNumber') ||
    text.includes('Schema.Instant') ||
    text.includes('Schema.InstantFromString')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousDateTime';
    return {
      schemaName,
      compositionType: 'datetime',
      children: [],
      validationPaths: [],
    };
  }

  // Effect types (Cause, Exit, etc.)
  if (
    text.includes('Schema.CauseFromSelf') ||
    text.includes('Schema.ExitFromSelf') ||
    text.includes('Schema.ExitFromUnknown')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousEffectType';
    return {
      schemaName,
      compositionType: 'effect-type',
      children: [],
      validationPaths: [],
    };
  }

  // Serializable / SerializableWithResult (GAP 7)
  if (
    text.includes('Schema.Serializable') ||
    text.includes('Schema.SerializableWithResult')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousSerializable';
    return {
      schemaName,
      compositionType: 'serializable',
      children: [],
      validationPaths: [],
    };
  }

  // String / number refinements (Trim, UUID, NonEmptyString, Int, Positive, etc.)
  if (
    text.includes('Schema.Trim') ||
    text.includes('Schema.UUID') ||
    text.includes('Schema.ULID') ||
    text.includes('Schema.URL') ||
    text.includes('Schema.NonEmptyString') ||
    text.includes('Schema.NonEmptyTrimmedString') ||
    text.includes('Schema.Lowercase') ||
    text.includes('Schema.Uppercase') ||
    text.includes('Schema.Capitalized') ||
    text.includes('Schema.Uncapitalized') ||
    text.includes('Schema.Int') ||
    text.includes('Schema.Positive') ||
    text.includes('Schema.NonPositive') ||
    text.includes('Schema.Negative') ||
    text.includes('Schema.NonNegative') ||
    text.includes('Schema.Between') ||
    text.includes('Schema.GreaterThan') ||
    text.includes('Schema.LessThan') ||
    text.includes('Schema.GreaterThanOrEqualTo') ||
    text.includes('Schema.LessThanOrEqualTo') ||
    text.includes('Schema.MultipleOf') ||
    text.includes('Schema.Finite') ||
    text.includes('Schema.TemplateLiteral') ||
    text.includes('Schema.minLength') ||
    text.includes('Schema.maxLength') ||
    text.includes('Schema.pattern') ||
    text.includes('Schema.startsWith') ||
    text.includes('Schema.endsWith') ||
    text.includes('Schema.includes')
  ) {
    const schemaName = extractSchemaName(node) || 'AnonymousRefinement';
    return {
      schemaName,
      compositionType: 'refinement',
      children: [],
      validationPaths: [],
    };
  }

  return undefined;
};

/**
 * Extract schema name from variable declaration
 */
const extractSchemaName = (node: Node): string | undefined => {
  const parent = node.getParent();
  
  if (parent) {
    const text = parent.getText();
    const match = /(?:const|let|var)\s+(\w+)\s*=/.exec(text);
    if (match) {
      return match[1];
    }
  }
  
  return undefined;
};

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format schema analysis as a readable report
 */
export const formatSchemaReport = (analysis: SchemaAnalysis): string => {
  const lines: string[] = [];
  
  lines.push('# Schema Analysis Report');
  lines.push('');
  
  // Operations
  lines.push(`## Schema Operations (${analysis.operations.length})`);
  lines.push('');
  
  for (const op of analysis.operations) {
    lines.push(`### ${op.operation}: ${op.schemaName}`);
    lines.push(`- **Source Type**: ${op.sourceType}`);
    lines.push(`- **Target Type**: ${op.targetType}`);
    lines.push(`- **Error Handling**: ${op.hasErrorHandling ? '✅' : '❌ Missing'}`);
    
    if (op.location) {
      lines.push(`- **Location**: ${op.location.filePath}:${op.location.line}`);
    }
    
    if (op.validationPaths.length > 0) {
      lines.push('');
      lines.push('**Validation Paths:**');
      for (const path of op.validationPaths) {
        const optional = path.isOptional ? ' (optional)' : '';
        lines.push(`- \`${path.path}\`${optional}`);
        
        for (const constraint of path.constraints) {
          lines.push(`  - ${constraint.description}`);
        }
      }
    }
    
    lines.push('');
  }
  
  // Unhandled operations
  if (analysis.unhandledOperations.length > 0) {
    lines.push(`## ⚠️ Unhandled Schema Operations (${analysis.unhandledOperations.length})`);
    lines.push('');
    lines.push('The following Schema operations are missing error handling:');
    lines.push('');
    
    for (const op of analysis.unhandledOperations) {
      lines.push(`- ${op.operation}(${op.schemaName}) at ${op.location?.filePath}:${op.location?.line}`);
    }
    
    lines.push('');
    lines.push('💡 **Suggestion**: Add `.pipe(Effect.catchTag("ParseError", handler))` to handle validation errors');
    lines.push('');
  }
  
  // Compositions
  if (analysis.compositions.length > 0) {
    lines.push(`## Schema Compositions (${analysis.compositions.length})`);
    lines.push('');
    
    for (const comp of analysis.compositions) {
      lines.push(`- **${comp.schemaName}** (${comp.compositionType})`);
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
};

/**
 * Extract schema validation summary for quick overview
 */
export const extractSchemaSummary = (analysis: SchemaAnalysis): {
  totalOperations: number;
  unhandledOperations: number;
  totalValidationPaths: number;
  schemasWithConstraints: number;
} => {
  const totalValidationPaths = analysis.operations.reduce(
    (sum, op) => sum + op.validationPaths.length,
    0,
  );
  
  const schemasWithConstraints = analysis.operations.filter(
    op => op.validationPaths.some(p => p.constraints.length > 0),
  ).length;
  
  return {
    totalOperations: analysis.operations.length,
    unhandledOperations: analysis.unhandledOperations.length,
    totalValidationPaths,
    schemasWithConstraints,
  };
};