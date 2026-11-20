import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const SRC = join(__dirname, '..', 'src');

describe('privacy guards', () => {
  it('never uses PREFER_* inference modes', () => {
    const bad = files(SRC).filter((f) => /PREFER_(ON_DEVICE|IN_CLOUD)|prefer_on_device|prefer_in_cloud/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('core imports neither react nor firebase', () => {
    const bad = files(join(SRC, 'core')).filter((f) => /from ['"](react|firebase)/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
