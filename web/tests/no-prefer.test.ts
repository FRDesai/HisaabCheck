import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|jsx|mjs)$/.test(p) ? [p] : [];
  });
}
const SRC = join(__dirname, '..', 'src');
const CORE = join(SRC, 'core');
// Static, side-effect, dynamic and require imports of firebase, @firebase/*, react and react-dom.
export const FORBIDDEN_IN_CORE = /(from\s+|import\s*\(?\s*|require\s*\(\s*)['"](@?firebase|react)/;

describe('privacy guards', () => {
  it('scans real files', () => {
    expect(files(SRC).length).toBeGreaterThan(0);
    expect(files(CORE).length).toBeGreaterThan(0);
  });
  it('never uses PREFER_* inference modes', () => {
    const bad = files(SRC).filter((f) => /PREFER_(ON_DEVICE|IN_CLOUD)|prefer_on_device|prefer_in_cloud/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('core imports neither react nor firebase', () => {
    const bad = files(CORE).filter((f) => FORBIDDEN_IN_CORE.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('the core-purity pattern catches every import form', () => {
    for (const src of ["import { x } from 'firebase/app';", "import 'firebase/app';", "await import('react')", 'require("react-dom")',
      "import x from '@firebase/ai';", "import * as R from 'react';", "export { y } from 'firebase/firestore';"]) {
      expect(FORBIDDEN_IN_CORE.test(src), src).toBe(true);
    }
    expect(FORBIDDEN_IN_CORE.test("import { a } from '../types';")).toBe(false);
  });
});
