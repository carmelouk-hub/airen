import { AppError, type UUID } from "../../shared-contracts/src/index.ts";
export type AuthenticatedPrincipal = Readonly<{ identityId: UUID; providerKey: string; providerSubject: string; platformRoles: readonly string[] }>;
export interface AuthenticationAdapter { authenticate(request: unknown): Promise<AuthenticatedPrincipal | null>; }
export function requirePrincipal(principal: AuthenticatedPrincipal | null): AuthenticatedPrincipal { if (!principal) throw new AppError("AUTHENTICATION_REQUIRED", "Authenticated principal is required"); return principal; }
