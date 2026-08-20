import type { DomainEvent, ResourceScope, SecurityContext } from "../../shared-contracts/src/index.ts";
import { requirePermission } from "../../authorization/src/index.ts";
import { requireEntitlement } from "../../entitlements/src/index.ts";
import { successAudit, type TransactionContext, type UnitOfWork } from "../../audit-events/src/index.ts";
export async function executeGovernedMutation<T>(input: { context: SecurityContext; permissionKey: string; entitlementKey?: string; resourceScope: ResourceScope; actionKey: string; resource?: { type: string; id: string }; unitOfWork: UnitOfWork; mutate: (tx: TransactionContext, context: SecurityContext) => Promise<T>; event?: (result: T) => DomainEvent }): Promise<T> {
  requirePermission(input.context, input.permissionKey, input.resourceScope);
  if (input.entitlementKey) requireEntitlement(input.context, input.entitlementKey);
  return input.unitOfWork.transaction(async (tx) => {
    const result = await input.mutate(tx, input.context);
    await tx.audit(successAudit(input.context, input.actionKey, input.resource));
    if (input.event) { const event = input.event(result); await tx.outbox({ ...event, tenantId: input.context.tenantId, locationId: input.context.locationId, correlationId: input.context.correlationId }); }
    return result;
  });
}
