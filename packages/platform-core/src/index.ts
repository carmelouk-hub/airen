export type PlatformRoleKey = "platform_super_admin" | "platform_support" | string;
export type ProvisionTenantInput = { tenant: { slug: string; name: string; legalName?: string }; primaryLocation: { slug: string; name: string; timezone: string; currency: string }; ownerIdentityId: string; planSlug?: string; };
export interface TenantProvisioningService { provision(input: ProvisionTenantInput, idempotencyKey: string): Promise<{ tenantId: string; locationId: string }>; }
