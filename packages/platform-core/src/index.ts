import type { DomainEvent, ResourceScope, SecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePermission } from "../../authorization/src/index.ts";
import { requireEntitlement } from "../../entitlements/src/index.ts";
import { successAudit, type TransactionContext, type UnitOfWork } from "../../audit-events/src/index.ts";
export { loadFoundationRuntimeEnvironment, parseSecretRef, runtimeEnvironmentDiagnostics, type FoundationRuntimeEnvironment } from "./runtime-environment.ts";
export * from "./product-registry.ts";
export * from "./organization-control-plane.ts";
export * from "./product-access.ts";
export * from "./product-attachments.ts";
export async function executeGovernedMutation<T, TTx extends TransactionContext = TransactionContext>(input: { context: SecurityContext; permissionKey: string; entitlementKey?: string; resourceScope: ResourceScope; actionKey: string; resource?: { type: string; id: string }; resourceFromResult?: (result: T) => { type: string; id: string }; unitOfWork: UnitOfWork<TTx>; mutate: (tx: TTx, context: SecurityContext) => Promise<T>; event?: (result: T) => DomainEvent }): Promise<T> {
  requirePermission(input.context, input.permissionKey, input.resourceScope);
  if (input.entitlementKey) requireEntitlement(input.context, input.entitlementKey);
  return input.unitOfWork.transaction(async (tx) => {
    const result = await input.mutate(tx, input.context);
    const auditResource = input.resourceFromResult ? input.resourceFromResult(result) : input.resource;
    await tx.audit(successAudit(input.context, input.actionKey, auditResource));
    if (input.event) { const event = input.event(result); await tx.outbox({ ...event, tenantId: input.context.tenantId, locationId: input.context.locationId, correlationId: input.context.correlationId }); }
    return result;
  }, input.context);
}
