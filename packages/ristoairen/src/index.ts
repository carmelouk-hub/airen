import type { SecurityContext } from "../../shared-contracts/src/index.ts";

export type RistoTenantConfig = { schemaVersion: number; config: Readonly<Record<string, unknown>> };

export interface RistoApplicationService<TInput, TResult> {
  execute(input: TInput, context: SecurityContext): Promise<TResult>;
}

export * from "./booking/index.ts";
export * from "./airenpay/index.ts";
