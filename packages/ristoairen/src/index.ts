import type { TenantContext } from "../../shared-contracts/src/index";
export type RistoTenantConfig = { schemaVersion: number; config: Readonly<Record<string, unknown>>; };
export interface RistoApplicationService<TInput, TResult> { execute(input: TInput, context: TenantContext): Promise<TResult>; }
