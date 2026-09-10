import test from "node:test";
import assert from "node:assert/strict";
import { BackgroundJobEngine } from "../../packages/runtime-jobs/src/background-job-engine.ts";

test("MAT-017 background job engine fails closed on invalid configuration", () => {
  assert.throws(
    () => new BackgroundJobEngine({ runTick: async () => "idle", pollIntervalMs: 0 }),
    /BACKGROUND_JOB_CONFIGURATION_INVALID/
  );
  assert.throws(
    () =>
      new BackgroundJobEngine({
        runTick: async () => "idle",
        pollIntervalMs: 10,
        maxConsecutiveWorkTicks: 0
      }),
    /BACKGROUND_JOB_CONFIGURATION_INVALID/
  );
});

test("MAT-017 executes ticks single-flight without overlap", async () => {
  const controller = new AbortController();
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const engine = new BackgroundJobEngine({
    pollIntervalMs: 1,
    maxConsecutiveWorkTicks: 10,
    runTick: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (calls === 3) controller.abort();
      return "work";
    }
  });

  const summary = await engine.run(controller.signal);
  assert.equal(calls, 3);
  assert.equal(maxActive, 1);
  assert.equal(summary.ticks, 3);
  assert.equal(summary.workTicks, 3);
  assert.equal(summary.idleTicks, 0);
  assert.equal(summary.stopped, true);
});

test("MAT-017 idle work uses bounded polling and cooperative shutdown", async () => {
  const controller = new AbortController();
  const sleeps: number[] = [];
  let calls = 0;

  const engine = new BackgroundJobEngine({
    pollIntervalMs: 25,
    runTick: async () => {
      calls += 1;
      return "idle";
    },
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      controller.abort();
    }
  });

  const summary = await engine.run(controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, [25]);
  assert.equal(summary.ticks, 1);
  assert.equal(summary.idleTicks, 1);
});

test("MAT-017 rejects concurrent run invocation on one engine instance", async () => {
  const controller = new AbortController();
  let releaseTick!: () => void;
  let tickStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    tickStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseTick = resolve;
  });

  const engine = new BackgroundJobEngine({
    pollIntervalMs: 1,
    runTick: async () => {
      tickStarted();
      await gate;
      controller.abort();
      return "work";
    }
  });

  const firstRun = engine.run(controller.signal);
  await started;
  await assert.rejects(engine.run(new AbortController().signal), /BACKGROUND_JOB_ALREADY_RUNNING/);
  releaseTick();
  await firstRun;
});

test("MAT-017 unexpected infrastructure errors stop the engine and release single-flight state", async () => {
  let fail = true;
  let nextController: AbortController | null = null;
  const engine = new BackgroundJobEngine({
    pollIntervalMs: 1,
    runTick: async () => {
      if (fail) throw new Error("SYNTHETIC_INFRASTRUCTURE_FAILURE");
      nextController?.abort();
      return "work";
    }
  });

  await assert.rejects(engine.run(new AbortController().signal), /SYNTHETIC_INFRASTRUCTURE_FAILURE/);

  fail = false;
  nextController = new AbortController();
  const summary = await engine.run(nextController.signal);
  assert.equal(summary.ticks, 1);
  assert.equal(summary.workTicks, 1);
});
