import { AppError, type SecurityContext, type UUID } from "../../../shared-contracts/src/index.ts";
import type { TransactionContext, UnitOfWork } from "../../../audit-events/src/index.ts";
import { executeGovernedMutation } from "../../../platform-core/src/index.ts";
import type { Location } from "../index.ts";

export type CreateLocationInput = Readonly<{ slug: string; name: string; timezone: string }>;
export interface LocationMutationTransaction extends TransactionContext {
  insertLocation(input: { tenantId: UUID; slug: string; name: string; timezone: string }): Promise<Location>;
}
export type LocationCommandUnitOfWork = UnitOfWork<LocationMutationTransaction>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export async function createLocation(input: CreateLocationInput, deps: { context: SecurityContext; unitOfWork: LocationCommandUnitOfWork }): Promise<Location> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const timezone = input.timezone.trim();
  if (!SLUG.test(slug)) throw new AppError("VALIDATION_FAILED", "Invalid location slug");
  if (!name) throw new AppError("VALIDATION_FAILED", "Location name is required");
  if (!timezone) throw new AppError("VALIDATION_FAILED", "Location timezone is required");
  return executeGovernedMutation<Location, LocationMutationTransaction>({
    context: deps.context,
    permissionKey: "tenant.locations.manage",
    entitlementKey: "tenant.multi_location",
    resourceScope: { tenantId: deps.context.tenantId },
    actionKey: "tenant.location.create",
    unitOfWork: deps.unitOfWork,
    resourceFromResult: (location) => ({ type: "Location", id: location.id }),
    mutate: (tx, context) => tx.insertLocation({ tenantId: context.tenantId, slug, name, timezone }),
    event: (location) => ({ eventType: "tenant.location.created", aggregateType: "Location", aggregateId: location.id, payloadVersion: 1, payload: { id: location.id, tenantId: location.tenantId, slug: location.slug, name: location.name } })
  });
}
