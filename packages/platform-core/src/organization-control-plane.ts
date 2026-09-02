import { AppError, type PlatformSecurityContext, type UUID } from "../../shared-contracts/src/index.ts";
import { requirePlatformPermission, type MembershipRepository, type TenantMembership } from "../../authorization/src/index.ts";

export type OrganizationStatus = "active" | "suspended" | "archived";
export type OrganizationMembershipStatus = "invited" | "active" | "suspended" | "revoked";

export type Organization = Readonly<{
  id: UUID;
  slug: string;
  name: string;
  legalName?: string;
  status: OrganizationStatus;
}>;

export type OrganizationMembership = Readonly<{
  id: UUID;
  organizationId: UUID;
  identityId: UUID;
  roleKey: string;
  status: OrganizationMembershipStatus;
}>;

export type OrganizationProvisioningResult = Readonly<{
  organization: Organization;
  initialMembershipId: UUID;
  replayed: boolean;
}>;

export type OrganizationTenantBindingResult = Readonly<{
  organizationId: UUID;
  tenantId: UUID;
  replayed: boolean;
}>;

export interface OrganizationControlPlaneTransaction {
  provisionOrganization(input: {
    idempotencyKey: string;
    slug: string;
    name: string;
    legalName?: string;
  }): Promise<OrganizationProvisioningResult>;
  bindTenant(input: {
    idempotencyKey: string;
    organizationId: UUID;
    tenantId: UUID;
  }): Promise<OrganizationTenantBindingResult>;
}

export interface OrganizationControlPlaneUnitOfWork {
  transaction<T>(fn: (tx: OrganizationControlPlaneTransaction) => Promise<T>, context: PlatformSecurityContext): Promise<T>;
}

export interface OrganizationContextRepository {
  findActiveOrganizationForTenant(tenantId: UUID): Promise<Organization | null>;
  findActiveMembership(organizationId: UUID, identityId: UUID): Promise<OrganizationMembership | null>;
}

export type OrganizationTenantContext = Readonly<{
  organization: Organization;
  organizationMembership: OrganizationMembership;
  tenantMembership: TenantMembership;
}>;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: UUID, label: string): UUID {
  const normalized = value.trim();
  if (!UUID_VALUE.test(normalized)) throw new AppError("VALIDATION_FAILED", `${label} must be a UUID`);
  return normalized;
}

export async function provisionOrganization(input: Readonly<{
  idempotencyKey: string;
  slug: string;
  name: string;
  legalName?: string;
}>, deps: Readonly<{
  context: PlatformSecurityContext;
  unitOfWork: OrganizationControlPlaneUnitOfWork;
}>): Promise<OrganizationProvisioningResult> {
  requirePlatformPermission(deps.context, "platform.organizations.provision");
  const idempotencyKey = input.idempotencyKey.trim();
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const legalName = input.legalName?.trim() || undefined;
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid organization provisioning idempotency key");
  if (!SLUG.test(slug)) throw new AppError("VALIDATION_FAILED", "Invalid organization slug");
  if (!name) throw new AppError("VALIDATION_FAILED", "Organization name is required");
  return deps.unitOfWork.transaction((tx) => tx.provisionOrganization({ idempotencyKey, slug, name, legalName }), deps.context);
}

export async function bindTenantToOrganization(input: Readonly<{
  idempotencyKey: string;
  organizationId: UUID;
  tenantId: UUID;
}>, deps: Readonly<{
  context: PlatformSecurityContext;
  unitOfWork: OrganizationControlPlaneUnitOfWork;
}>): Promise<OrganizationTenantBindingResult> {
  requirePlatformPermission(deps.context, "platform.organizations.bind_tenant");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new AppError("VALIDATION_FAILED", "Invalid organization tenant binding idempotency key");
  const organizationId = requiredUuid(input.organizationId, "organizationId");
  const tenantId = requiredUuid(input.tenantId, "tenantId");
  return deps.unitOfWork.transaction((tx) => tx.bindTenant({ idempotencyKey, organizationId, tenantId }), deps.context);
}

export async function resolveOrganizationTenantContext(input: Readonly<{
  identityId: UUID;
  tenantId: UUID;
}>, deps: Readonly<{
  organizations: OrganizationContextRepository;
  memberships: Pick<MembershipRepository, "findTenantMembership">;
}>): Promise<OrganizationTenantContext> {
  const identityId = requiredUuid(input.identityId, "identityId");
  const tenantId = requiredUuid(input.tenantId, "tenantId");
  const organization = await deps.organizations.findActiveOrganizationForTenant(tenantId);
  if (!organization || organization.status !== "active") throw new AppError("MEMBERSHIP_REQUIRED", "Active Organization binding is required for Tenant access");
  const organizationMembership = await deps.organizations.findActiveMembership(organization.id, identityId);
  if (!organizationMembership || organizationMembership.status !== "active") throw new AppError("MEMBERSHIP_REQUIRED", "Active Organization membership is required");
  const tenantMembership = await deps.memberships.findTenantMembership(tenantId, identityId);
  if (!tenantMembership || tenantMembership.status !== "active") throw new AppError("MEMBERSHIP_REQUIRED", "Active Tenant membership is required");
  return { organization, organizationMembership, tenantMembership };
}
