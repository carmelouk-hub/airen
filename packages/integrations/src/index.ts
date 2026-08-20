import type { TenantContext } from "../../shared-contracts/src/index";
export type VerifiedWebhookEvent<T> = { provider: string; providerEventId: string; receivedAtIso: string; payload: T; };
export interface WebhookAdapter<TPayload, TResult> { verify(rawBody: Uint8Array, headers: Readonly<Record<string, string>>): Promise<VerifiedWebhookEvent<TPayload>>; handle(event: VerifiedWebhookEvent<TPayload>, context: TenantContext): Promise<TResult>; }
// Trusted provider-account -> Tenant/Location routing is mandatory. Payload tenant identifiers are never authoritative.
