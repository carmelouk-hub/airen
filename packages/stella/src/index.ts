import type { TenantContext } from "../../shared-contracts/src/index";
export type StellaCapabilityDefinition = { key: string; permissionKey: string; requiresApproval: boolean; inputSchemaVersion: string; };
export interface StellaCapability<TInput, TResult> { readonly definition: StellaCapabilityDefinition; execute(input: TInput, context: TenantContext): Promise<TResult>; }
// Raw entity CRUD tools do not belong in this registry.
