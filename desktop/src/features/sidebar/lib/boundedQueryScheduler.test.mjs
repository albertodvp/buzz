import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedQueryScheduler } from "./boundedQueryScheduler.ts";

test("scheduler bounds concurrent sidebar requests", async () => {
  const schedule = createBoundedQueryScheduler(2);
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const task = () =>
    schedule(
      () =>
        new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

  const pending = [task(), task(), task(), task()];
  for (let index = 0; index < pending.length; index += 1) {
    while (releases.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releases.shift()();
  }
  await Promise.all(pending);
  assert.equal(maxActive, 2);
});

test("scheduler drops queued work when its query is cancelled", async () => {
  const schedule = createBoundedQueryScheduler(1);
  let releaseFirst;
  const first = schedule(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const controller = new AbortController();
  let secondStarted = false;
  const second = schedule(
    async () => {
      secondStarted = true;
    },
    { signal: controller.signal },
  );

  controller.abort();
  await assert.rejects(second, (error) => error?.name === "AbortError");
  releaseFirst();
  await first;
  assert.equal(secondStarted, false);
});
