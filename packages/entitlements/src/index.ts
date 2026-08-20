export type EntitlementValue = boolean | number | string | Record<string, unknown>;
export interface EntitlementResolver { resolve(tenantId: string, entitlementKey: string): Promise<EntitlementValue | undefined>; }
// Entitlements grant product eligibility, not resource authorization.
