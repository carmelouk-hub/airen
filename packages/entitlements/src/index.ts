import { AppError, type SecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
export interface EntitlementRepository { enabledForTenant(tenantId: UUID): Promise<readonly string[]>; }
export function requireEntitlement(context: SecurityContext, entitlementKey: string): void { if (!context.entitlements.includes(entitlementKey)) throw new AppError("ENTITLEMENT_REQUIRED", `Missing entitlement: ${entitlementKey}`); }
