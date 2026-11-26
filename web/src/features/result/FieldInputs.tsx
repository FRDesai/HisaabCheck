import type { Checks } from '../../core/types';
import type { FieldKey } from './fields';
import { CHECK_MSG, FIELD_CHECK, FIELDS } from './labels';

/** One red line per failed check. */
export function CheckMessages({ checks }: { checks: Checks | null }) {
  if (!checks) return null;
  return <>{(Object.keys(CHECK_MSG) as (keyof Checks)[]).filter((k) => !checks[k]).map((k) => <p key={k} className="text-red-700 text-sm">⚠ {CHECK_MSG[k]}</p>)}</>;
}

/** The ten bill fields. A field is red when its input is invalid or the check it feeds has failed. */
export default function FieldInputs({ text, invalid, checks, disabled = false, onChange }: {
  text: Record<FieldKey, string>; invalid: FieldKey[]; checks: Checks | null; disabled?: boolean; onChange(key: FieldKey, value: string): void;
}) {
  return (
    <>
      {FIELDS.map(([k, label, type]) => {
        const badInput = invalid.includes(k);
        const bad = badInput || (checks && FIELD_CHECK[k] && !checks[FIELD_CHECK[k]!]);
        return (
          <label key={k} className="block text-sm">{label}
            <input type="text" inputMode={type === 'number' ? 'decimal' : undefined} disabled={disabled}
              className={`mt-1 w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-600 ${bad ? 'border-red-600 bg-red-50' : ''}`} aria-invalid={!!bad}
              value={text[k]} onChange={(ev) => onChange(k, ev.target.value)} />
            {badInput && <span role="alert" className="block text-red-700 text-xs">{type === 'number' ? 'Enter a number, 0 or more' : 'Invalid value'}</span>}
          </label>
        );
      })}
    </>
  );
}
