import { execSync } from 'node:child_process';

/**
 * Parse a source argument that can be:
 * - A file path (./src/foo.ts)
 * - A git ref:path combo (HEAD~1:src/foo.ts or main:src/foo.ts)
 * - A PR URL (https://github.com/org/repo/pull/123)
 */
export function parseSourceArg(arg: string): {
  kind: 'file' | 'git-ref' | 'github-pr';
  filePath?: string;
  ref?: string;
  prUrl?: string;
} {
  // GitHub PR URL
  if (/^https?:\/\/github\.com\/.+\/pull\/\d+/.test(arg)) {
    return { kind: 'github-pr', prUrl: arg };
  }

  // Git ref:path format (e.g. HEAD~1:src/foo.ts, main:src/foo.ts)
  // Exclude Windows absolute paths (C:\..., D:\...) — single letter before colon followed by backslash
  const gitRefMatch = /^([^:]+):(.+)$/.exec(arg);
  if (gitRefMatch?.[1] && gitRefMatch[2] && !arg.startsWith('/') && !arg.startsWith('.')) {
    const isWindowsPath = /^[A-Za-z]$/.test(gitRefMatch[1]) && gitRefMatch[2].startsWith('\\');
    if (!isWindowsPath) {
      return { kind: 'git-ref', ref: gitRefMatch[1], filePath: gitRefMatch[2] };
    }
  }

  // Plain file path
  return { kind: 'file', filePath: arg };
}

/**
 * Resolve a git ref:path to the file contents from that commit.
 * Returns the source text of the file at the given ref.
 */
export function resolveGitSource(ref: string, filePath: string, cwd?: string): string {
  try {
    const result = execSync(`git show ${ref}:${filePath}`, {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve git source ${ref}:${filePath}: ${msg}`, { cause: error });
  }
}

/**
 * Resolve a GitHub PR URL to the base and head refs.
 * Requires `gh` CLI to be installed and authenticated.
 */
export function resolveGitHubPR(
  prUrl: string,
): { baseRef: string; headRef: string; baseBranch: string; headBranch: string } {
  try {
    const result = execSync(
      `gh pr view "${prUrl}" --json baseRefName,headRefName,baseRefOid,headRefOid`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const data = JSON.parse(result) as {
      baseRefName: string;
      headRefName: string;
      baseRefOid: string;
      headRefOid: string;
    };
    return {
      baseRef: data.baseRefOid,
      headRef: data.headRefOid,
      baseBranch: data.baseRefName,
      headBranch: data.headRefName,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve GitHub PR ${prUrl}: ${msg}`, { cause: error });
  }
}
