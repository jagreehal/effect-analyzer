/**
 * ESLint rule: ban inline type assertions like `x as import('module').Type`.
 * Use a named type import at the top instead.
 */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Disallow inline type assertions using import() (e.g. `x as import('ts-morph').Node`). Use a named type import at the top of the file instead.",
    },
    schema: [],
    messages: {
      useNamedImport:
        "Use a named type import instead of inline 'as import(...)'. Example: import type { TypeName } from 'module'; ... x as TypeName",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program(node) {
        const text = sourceCode.getText(node);
        const pattern = /\s+as\s+import\s*\(/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const index = match.index;
          const line = text.slice(0, index).split('\n').length;
          const lineStart = text.lastIndexOf('\n', index);
          const column = index - lineStart - 1;
          context.report({
            node,
            loc: { start: { line, column }, end: { line, column: column + match[0].length } },
            messageId: 'useNamedImport',
          });
        }
      },
    };
  },
};
