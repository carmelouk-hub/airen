import { randomBytes } from "node:crypto";

export type AirenOSSessionHandoffPayload = Readonly<{
  accessToken: string;
  sessionId: string;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

type StoredHandoff = Readonly<{
  payload: AirenOSSessionHandoffPayload;
  expiresAtMs: number;
}>;

export class InMemorySingleUseSessionHandoffStore {
  readonly #records = new Map<string, StoredHandoff>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlMs = 90_000, now: () => number = Date.now) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
      throw new Error("Session handoff TTL must be between 1 and 300 seconds");
    }
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  issue(payload: AirenOSSessionHandoffPayload): Readonly<{ handoff: string; expiresAtIso: string }> {
    this.#purgeExpired();
    const handoff = randomBytes(32).toString("base64url");
    const expiresAtMs = this.#now() + this.#ttlMs;
    this.#records.set(handoff, Object.freeze({ payload: Object.freeze({ ...payload }), expiresAtMs }));
    return Object.freeze({ handoff, expiresAtIso: new Date(expiresAtMs).toISOString() });
  }

  redeem(handoff: string): AirenOSSessionHandoffPayload | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(handoff)) return null;
    const record = this.#records.get(handoff);
    if (!record) return null;

    // Consume before evaluating/returning so every handoff is single-use even on expiry.
    this.#records.delete(handoff);
    if (record.expiresAtMs <= this.#now()) return null;
    return record.payload;
  }

  #purgeExpired(): void {
    const now = this.#now();
    for (const [handoff, record] of this.#records) {
      if (record.expiresAtMs <= now) this.#records.delete(handoff);
    }
  }
}
