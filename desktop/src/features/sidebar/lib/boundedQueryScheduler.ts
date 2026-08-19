type PendingTask = {
  priority: number;
  run: () => void;
};

export type BoundedQueryScheduler = <T>(
  task: () => Promise<T>,
  options?: { priority?: number; signal?: AbortSignal },
) => Promise<T>;

/**
 * Limit background sidebar requests without coupling their lifetime to a
 * particular channel component. Higher-priority queued work runs first.
 */
export function createBoundedQueryScheduler(
  maxConcurrency: number,
): BoundedQueryScheduler {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("maxConcurrency must be a positive integer");
  }

  let activeCount = 0;
  const queue: PendingTask[] = [];

  const drain = () => {
    while (activeCount < maxConcurrency && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      activeCount += 1;
      next.run();
    }
  };

  return <T>(
    task: () => Promise<T>,
    options: { priority?: number; signal?: AbortSignal } = {},
  ) =>
    new Promise<T>((resolve, reject) => {
      const { priority = 0, signal } = options;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const pending: PendingTask = {
        priority,
        run: () => {
          signal?.removeEventListener("abort", abortWhileQueued);
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              activeCount -= 1;
              drain();
            });
        },
      };
      const abortWhileQueued = () => {
        const index = queue.indexOf(pending);
        if (index === -1) return;
        queue.splice(index, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abortWhileQueued, { once: true });

      const insertionIndex = queue.findIndex(
        (queued) => queued.priority < pending.priority,
      );
      if (insertionIndex === -1) queue.push(pending);
      else queue.splice(insertionIndex, 0, pending);
      drain();
    });
}
