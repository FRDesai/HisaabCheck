import { fetchAndActivate, getAll } from 'firebase/remote-config';
import { rc } from '../firebase';
import { parseConfig } from '../core/config/parseConfig';
import type { Config } from '../core/types';

export async function loadConfig(): Promise<Config> {
  try { await fetchAndActivate(rc); } catch { /* bundled defaults stay active */ }
  const values = Object.fromEntries(Object.entries(getAll(rc)).map(([k, v]) => [k, v.asString()]));
  return parseConfig(values, import.meta.env.PROD);
}
