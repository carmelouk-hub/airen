import { buildPlatformSecurityContext, type RolePermissionResolver } from "../../../packages/authorization/src/index.ts";
import { requirePrincipal, type AuthenticatedPrincipal, type AuthenticationAdapter } from "../../../packages/identity/src/index.ts";

export async function resolvePlatformSecurityContext(input: {
  principal: AuthenticatedPrincipal;
  roles: RolePermissionResolver;
  correlationId?: string;
}) {
  const context = await buildPlatformSecurityContext(input);
  return { context };
}

export async function authenticateAndResolvePlatformSecurityContext(input: {
  request: unknown;
  authentication: AuthenticationAdapter;
  roles: RolePermissionResolver;
  correlationId?: string;
}) {
  const principal = requirePrincipal(await input.authentication.authenticate(input.request));
  const { context } = await resolvePlatformSecurityContext({ principal, roles: input.roles, correlationId: input.correlationId });
  return { principal, context };
}
