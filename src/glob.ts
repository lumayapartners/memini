// Minimal glob matcher for repo-relative paths (forward slashes).
// Supports: `**` (any depth), `*` (within a segment), `?` (single char).
// Workspace/user-scope memories reference files by pattern since absolute
// layouts differ per repo — e.g. `vercel.json` or `config/**/*.yml`.
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` or trailing `**`
        re += pattern[i + 2] === '/' ? '(?:[^/]+/)*' : '.*';
        i += pattern[i + 2] === '/' ? 3 : 2;
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(pattern: string, path: string): boolean {
  // a bare filename pattern (no slash) matches that name at any depth,
  // so workspace memories about `vercel.json` cover every repo's vercel.json
  if (!pattern.includes('/')) {
    return globToRegExp(`**/${pattern}`).test(path) || globToRegExp(pattern).test(path);
  }
  return globToRegExp(pattern).test(path);
}
