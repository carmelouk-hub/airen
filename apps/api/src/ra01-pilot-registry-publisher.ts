import { AppError, type SecurityContext } from "../../../packages/shared-contracts/src/index.ts";
import type { CurrentTenantEffectiveEntitlementResolver } from "../../../packages/entitlements/src/index.ts";
import type { RistoairenExperienceHandoffProjection } from "../../../packages/platform-core/src/index.ts";

export const PILOT_ATTACHMENT_REGISTRY_PATH = "/pilot/internal/airenos/v1/base44/attachment/delegations" as const;
export const PILOT_FOUNDATION_CREDENTIAL_HEADER = "x-airenos-foundation-service-credential" as const;

type FetchLike = typeof fetch;
type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type AttachmentProjectionPublisher = Readonly<{
  publish(projection: RistoairenExperienceHandoffProjection): Promise<void>;
}>;

function required(input: EnvironmentInput, key: string): string {
  const value=input[key]?.trim();
  if(!value) throw new AppError("RUNTIME_CONFIGURATION_INVALID", `Missing required Foundation Attachment runtime field: ${key}`, { field:key });
  return value;
}

function pilotRegistryUrl(input: EnvironmentInput): string {
  const raw=required(input,"AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL");
  let url:URL;
  try { url=new URL(raw); } catch { throw new AppError("RUNTIME_CONFIGURATION_INVALID","AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL must be an absolute HTTPS URL",{field:"AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL"}); }
  if(url.protocol!=="https:" || url.username || url.password || url.hash || url.search || url.pathname!==PILOT_ATTACHMENT_REGISTRY_PATH){
    throw new AppError("RUNTIME_CONFIGURATION_INVALID",`AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL must be a clean HTTPS URL ending exactly in ${PILOT_ATTACHMENT_REGISTRY_PATH}`,{field:"AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL"});
  }
  return url.toString();
}

function publisherContext(projection:RistoairenExperienceHandoffProjection): SecurityContext {
  return Object.freeze({
    correlationId: projection.sourceCorrelationId,
    actorIdentityId: projection.actorIdentityId,
    platformRoles: Object.freeze([]),
    platformPermissions: Object.freeze([]),
    tenantId: projection.tenantId,
    locationId: projection.locationId,
    permissions: Object.freeze([projection.permissionKey]),
    entitlements: Object.freeze([]),
  });
}

export function createPilotAttachmentProjectionPublisher(input: Readonly<{
  environment?: EnvironmentInput;
  entitlements: CurrentTenantEffectiveEntitlementResolver;
  fetchImpl?: FetchLike;
}>): AttachmentProjectionPublisher {
  const environment=input.environment ?? process.env;
  const registryUrl=pilotRegistryUrl(environment);
  const serviceCredential=required(environment,"AIRENOS_FOUNDATION_REGISTRY_SERVICE_CREDENTIAL");
  const fetchImpl=input.fetchImpl ?? globalThis.fetch;
  if(typeof fetchImpl!=="function") throw new AppError("RUNTIME_CONFIGURATION_INVALID","Foundation Attachment runtime requires fetch",{field:"fetch"});

  return Object.freeze({
    async publish(projection:RistoairenExperienceHandoffProjection):Promise<void> {
      if(projection.productCode!=="ristoairen" || projection.permissionKey!=="ristoairen.access"){
        throw new AppError("PERMISSION_DENIED","RISTOAIREN attachment projection authority mismatch");
      }
      const effective=await input.entitlements.resolveCurrentTenantEntitlements(publisherContext(projection));
      const keys=new Set(effective.map((entry)=>entry.entitlementKey));
      if(!keys.has("vertical.ristoairen") || !keys.has("availability.enabled")){
        throw new AppError("ENTITLEMENT_REQUIRED","Effective RISTOAIREN and Availability entitlements are required for Base44 read delegation");
      }

      let response:Response;
      try {
        response=await fetchImpl(registryUrl,{
          method:"POST",
          headers:{
            "content-type":"application/json",
            [PILOT_FOUNDATION_CREDENTIAL_HEADER]:serviceCredential,
          },
          body:JSON.stringify({
            sourceCorrelationId:projection.sourceCorrelationId,
            subjectId:projection.actorIdentityId,
            actorId:projection.actorIdentityId,
            tenantId:projection.tenantId,
            locationId:projection.locationId,
            productCode:"ristoairen",
            productAccess:"ALLOWED",
            attachmentPermissionKey:"ristoairen.access",
            productionEnabled:false,
            platformRoles:[],
            platformPermissions:[],
            entitlements:["vertical.ristoairen","availability.enabled"],
            sessionMetadata:{source:"airenos-foundation-ra01"},
            expiresAtIso:projection.projectionExpiresAtIso,
          }),
          redirect:"error",
          cache:"no-store",
        });
      } catch {
        throw new AppError("INTERNAL_ERROR","Pilot attachment registry is unavailable");
      }

      if(response.status!==201){
        throw new AppError("INTERNAL_ERROR","Pilot attachment registry rejected the authoritative projection");
      }
      let body:unknown;
      try { body=await response.json(); } catch { throw new AppError("INTERNAL_ERROR","Pilot attachment registry returned an invalid response"); }
      if(!body || typeof body!=="object" || (body as Record<string,unknown>).ok!==true || (body as Record<string,unknown>).state!=="REGISTERED"){
        throw new AppError("INTERNAL_ERROR","Pilot attachment registry did not confirm registration");
      }
    },
  });
}
