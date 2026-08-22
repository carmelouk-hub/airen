import { AppError, type UUID } from "../../shared-contracts/src/index.ts";

export type AuthenticatedPrincipal = Readonly<{
  identityId: UUID;
  providerKey: string;
  providerSubject: string;
  platformRoles: readonly string[];
  sessionId?: string;
  authenticatedAtIso?: string;
  expiresAtIso?: string;
}>;

export type VerifiedAuthSession = Readonly<{
  providerKey: string;
  providerSubject: string;
  sessionId: string;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

export type AuthenticationIdentityRecord = Readonly<{
  identityId: UUID;
  status: string;
  platformRoles: readonly string[];
}>;

export interface SessionCredentialVerifier {
  verify(request: unknown): Promise<VerifiedAuthSession | null>;
}

export interface AuthenticationIdentityDirectory {
  resolveProviderIdentity(providerKey: string, providerSubject: string): Promise<AuthenticationIdentityRecord | null>;
}

export interface AuthenticationAdapter {
  authenticate(request: unknown): Promise<AuthenticatedPrincipal | null>;
}

export class ProviderNeutralAuthenticationAdapter implements AuthenticationAdapter {
  private readonly verifier: SessionCredentialVerifier;
  private readonly identities: AuthenticationIdentityDirectory;

  constructor(verifier: SessionCredentialVerifier, identities: AuthenticationIdentityDirectory) {
    this.verifier = verifier;
    this.identities = identities;
  }

  async authenticate(request: unknown): Promise<AuthenticatedPrincipal | null> {
    const verified = await this.verifier.verify(request);
    if (!verified) return null;
    const identity = await this.identities.resolveProviderIdentity(verified.providerKey, verified.providerSubject);
    if (!identity || identity.status !== "active") return null;
    return {
      identityId: identity.identityId,
      providerKey: verified.providerKey,
      providerSubject: verified.providerSubject,
      platformRoles: identity.platformRoles,
      sessionId: verified.sessionId,
      authenticatedAtIso: verified.issuedAtIso,
      expiresAtIso: verified.expiresAtIso
    };
  }
}

export function requirePrincipal(principal: AuthenticatedPrincipal | null): AuthenticatedPrincipal {
  if (!principal) throw new AppError("AUTHENTICATION_REQUIRED", "Authenticated principal is required");
  return principal;
}
