import type { UUID, TenantContext } from "../../shared-contracts/src/index";
export type TenantMembership = { id: UUID; tenantId: UUID; identityId: UUID; roleKey: string; status: "invited" | "active" | "suspended" | "revoked"; };
export type LocationMembership = { tenantMembershipId: UUID; locationId: UUID; roleOverride?: string; };
export interface PolicyDecision { allowed: boolean; reasonCode?: string; }
export interface AuthorizationPolicy { decide(context: TenantContext, permissionKey: string, resource?: { tenantId?: UUID; locationId?: UUID }): Promise<PolicyDecision>; }
