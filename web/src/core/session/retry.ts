/**
 * Runs `attempt` now and, each time it fails, once more after the next delay in `delaysMs`; then gives up quietly.
 * `onDone` gets the first successful value. The returned function cancels any pending timer and drops a late answer.
 */
export function retryWithDelays<T>(attempt: () => Promise<T>, delaysMs: readonly number[], onDone: (value: T) => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (i: number) => {
    attempt().then(
      (v) => { if (!cancelled) onDone(v); },
      () => {
        if (cancelled || i >= delaysMs.length) return;
        timer = setTimeout(() => run(i + 1), delaysMs[i]);
      },
    );
  };
  run(0);
  return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); };
}
