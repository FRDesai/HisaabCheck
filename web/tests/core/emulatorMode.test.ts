import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldUseEmulators, EMULATOR_PROJECT_ID } from '../../src/core/config/emulatorMode';

describe('shouldUseEmulators', () => {
  it('is on only in a dev build with VITE_USE_EMULATORS=true', () => {
    expect(shouldUseEmulators({ DEV: true, VITE_USE_EMULATORS: 'true' })).toBe(true);
  });
  it('is never on in a production build, whatever the variable says', () => {
    expect(shouldUseEmulators({ DEV: false, VITE_USE_EMULATORS: 'true' })).toBe(false);
  });
  it('is off in dev unless the variable is exactly "true"', () => {
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(shouldUseEmulators({ DEV: true, VITE_USE_EMULATORS: v })).toBe(false);
    }
  });
  it('uses a demo- project id, so the emulators never reach a real project', () => {
    expect(EMULATOR_PROJECT_ID.startsWith('demo-')).toBe(true);
  });
  it('firebase.ts guards emulator mode on import.meta.env.DEV directly, so production builds drop it', () => {
    const src = readFileSync(resolve(__dirname, '../../src/firebase.ts'), 'utf8');
    expect(src).toMatch(/import\.meta\.env\.DEV\s*&&\s*shouldUseEmulators\(/);
  });
});
