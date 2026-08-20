import type { UUID } from "../../shared-contracts/src/index";
export type Tenant = { id: UUID; slug: string; name: string; legalName?: string; status: "active" | "suspended" | "archived"; defaultLocale: string; timezone: string; currency: string; };
export type Location = { id: UUID; tenantId: UUID; slug: string; name: string; status: "active" | "inactive" | "suspended" | "archived"; timezone: string; currency: string; };
export type TenantDomain = { id: UUID; tenantId: UUID; locationId?: UUID; hostname: string; status: "pending" | "verified" | "active" | "disabled" | "error"; };
export interface TenantDomainResolver { resolve(hostname: string): Promise<TenantDomain | null>; }
