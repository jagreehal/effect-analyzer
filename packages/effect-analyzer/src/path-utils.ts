/**
 * Small browser-safe path helpers for source-mode analysis.
 *
 * They intentionally normalize to forward slashes so synthetic browser paths
 * and real Node paths behave consistently for relative import lookups.
 */

export const PATH_SEPARATOR = '/';

const normalizeSlashes = (value: string): string =>
  value.replace(/\\/g, PATH_SEPARATOR);

export const normalizePath = (value: string): string => {
  const normalized = normalizeSlashes(value);
  const isAbsolute = normalized.startsWith(PATH_SEPARATOR);
  const parts = normalized.split(PATH_SEPARATOR);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }

  if (isAbsolute) {
    return `${PATH_SEPARATOR}${stack.join(PATH_SEPARATOR)}` || PATH_SEPARATOR;
  }

  return stack.join(PATH_SEPARATOR) || '.';
};

export const dirnamePath = (value: string): string => {
  const normalized = normalizePath(value);
  if (normalized === '.' || normalized === PATH_SEPARATOR) {
    return '.';
  }
  const lastSeparator = normalized.lastIndexOf(PATH_SEPARATOR);
  if (lastSeparator <= 0) {
    return normalized.startsWith(PATH_SEPARATOR) ? PATH_SEPARATOR : '.';
  }
  return normalized.slice(0, lastSeparator);
};

export const joinPath = (...parts: readonly string[]): string =>
  normalizePath(parts.filter((part) => part.length > 0).join(PATH_SEPARATOR));

export const resolvePath = (...parts: readonly string[]): string =>
  normalizePath(parts.filter((part) => part.length > 0).join(PATH_SEPARATOR));

export const hasPathPrefix = (value: string, prefix: string): boolean => {
  const normalizedValue = normalizePath(value);
  const normalizedPrefix = normalizePath(prefix);
  return (
    normalizedValue === normalizedPrefix ||
    normalizedValue.startsWith(`${normalizedPrefix}${PATH_SEPARATOR}`)
  );
};
