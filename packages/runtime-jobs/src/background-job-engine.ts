import {
  dispatchNextOutboxMessage,
  type OutboxDispatcherDependencies
} from "../../integrations/src/outbox-delivery.ts";

export type BackgroundJobTickResult = "work" | "idle";

export type BackgroundJobRunSummary = Readonly<{
  ticks: number;
  workTicks: number;
  idleTicks: number;
  stopped: true;
}>;

export type BackgroundJobEngineDependencies = Readonly<{
  runTick: () => Promise<BackgroundJobTickResult>;
  pollIntervalMs: number;
  maxConsecutiveWorkTicks?: number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

function configuration(condition: boolean, message: string): void {
  if (!condition) throw new Error(`BACKGROUND_JOB_CONFIGURATION_INVALID: ${message}`);
}

async function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Portable single-flight server-side background job loop.
 *
 * The engine owns cadence and cooperative shutdown only. It never owns domain
 * truth, persistence authority or provider semantics. runTick() is awaited
 * before another tick can start, preventing overlap within one engine instance.
 * Unexpected infrastructure exceptions stop the loop rather than being hidden.
 */
export class BackgroundJobEngine {
  private readonly runTickOperation: () => Promise<BackgroundJobTickResult>;
  private readonly pollIntervalMs: number;
  private readonly maxConsecutiveWorkTicks: number;
  private readonly sleepOperation: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private running = false;

  constructor(dependencies: BackgroundJobEngineDependencies) {
    configuration(
      Number.isInteger(dependencies.pollIntervalMs) &&
        dependencies.pollIntervalMs >= 1 &&
        dependencies.pollIntervalMs <= 300_000,
      "pollIntervalMs must be an integer between 1 and 300000"
    );
    const maxConsecutiveWorkTicks = dependencies.maxConsecutiveWorkTicks ?? 100;
    configuration(
      Number.isInteger(maxConsecutiveWorkTicks) &&
        maxConsecutiveWorkTicks >= 1 &&
        maxConsecutiveWorkTicks <= 10_000,
      "maxConsecutiveWorkTicks must be an integer between 1 and 10000"
    );
    configuration(typeof dependencies.runTick === "function", "runTick is required");

    this.runTickOperation = dependencies.runTick;
    this.pollIntervalMs = dependencies.pollIntervalMs;
    this.maxConsecutiveWorkTicks = maxConsecutiveWorkTicks;
    this.sleepOperation = dependencies.sleep ?? abortableSleep;
  }

  async run(signal: AbortSignal): Promise<BackgroundJobRunSummary> {
    if (this.running) throw new Error("BACKGROUND_JOB_ALREADY_RUNNING");
    this.running = true;

    let ticks = 0;
    let workTicks = 0;
    let idleTicks = 0;
    let consecutiveWorkTicks = 0;

    try {
      while (!signal.aborted) {
        const result = await this.runTickOperation();
        configuration(result === "work" || result === "idle", "runTick returned an invalid result");
        ticks += 1;

        if (result === "work") {
          workTicks += 1;
          consecutiveWorkTicks += 1;
          if (!signal.aborted && consecutiveWorkTicks >= this.maxConsecutiveWorkTicks) {
            consecutiveWorkTicks = 0;
            await this.sleepOperation(this.pollIntervalMs, signal);
          }
        } else {
          idleTicks += 1;
          consecutiveWorkTicks = 0;
          if (!signal.aborted) await this.sleepOperation(this.pollIntervalMs, signal);
        }
      }

      return Object.freeze({ ticks, workTicks, idleTicks, stopped: true });
    } finally {
      this.running = false;
    }
  }
}

/**
 * Adapts the provider-neutral outbox dispatcher to one background-job tick.
 * A provider delivery failure is already converted by the dispatcher into a
 * durable failed/dead-letter transition. Non-terminal failure is treated as
 * idle so the engine waits before retrying instead of hot-looping the adapter.
 */
export function createOutboxDeliveryTick(
  dependencies: OutboxDispatcherDependencies
): () => Promise<BackgroundJobTickResult> {
  return async () => {
    const result = await dispatchNextOutboxMessage(dependencies);
    if (result.status === "empty" || result.status === "failed") return "idle";
    return "work";
  };
}
