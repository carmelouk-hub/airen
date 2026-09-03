import { AppError, type UUID } from "../../shared-contracts/src/index.ts";
import type { AuthenticatedPrincipal, AuthenticationAdapter, AuthenticationIdentityDirectory } from "./index.ts";

export type VerifiedUpstreamIdentity = Readonly<{
  providerKey: string;
  providerSubject: string;
  authenticatedAtIso: string;
  providerSessionId?: string;
}>;

export interface UpstreamIdentityCredentialVerifier {
  verify(request: unknown): Promise<VerifiedUpstreamIdentity | null>;
}

export type AirenOSSessionIssueRequest = Readonly<{
  identityId: UUID;
  upstreamProviderKey: string;
  upstreamProviderSubject: string;
  authenticatedAtIso: string;
}>;

export type IssuedAirenOSSession = Readonly<{
  accessToken: string;
  tokenType: "Bearer";
  sessionId: string;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

export interface AirenOSSessionIssuer {
  issue(input: AirenOSSessionIssueRequest): Promise<IssuedAirenOSSession>;
}

export class AirenOSIdentitySessionAuthority {
  private readonly upstream: UpstreamIdentityCredentialVerifier;
  private readonly identities: AuthenticationIdentityDirectory;
  private readonly sessions: AirenOSSessionIssuer;

  constructor(upstream: UpstreamIdentityCredentialVerifier, identities: AuthenticationIdentityDirectory, sessions: AirenOSSessionIssuer) {
    this.upstream = upstream;
    this.identities = identities;
    this.sessions = sessions;
  }

  async establishSession(request: unknown): Promise<IssuedAirenOSSession> {
    const verified = await this.upstream.verify(request);
    if (!verified) throw new AppError("AUTHENTICATION_REQUIRED", "A verified upstream identity is required");
    const identity = await this.identities.resolveProviderIdentity(verified.providerKey, verified.providerSubject);
    if (!identity || identity.status !== "active") {
      throw new AppError("AUTHENTICATION_REQUIRED", "Upstream identity is not linked to an active AIRenOS Identity");
    }
    return this.sessions.issue({
      identityId: identity.identityId,
      upstreamProviderKey: verified.providerKey,
      upstreamProviderSubject: verified.providerSubject,
      authenticatedAtIso: verified.authenticatedAtIso
    });
  }
}

export type VerifiedAirenOSSession = Readonly<{
  issuer: string;
  audience: string;
  identityId: UUID;
  sessionId: string;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

export interface AirenOSSessionCredentialVerifier {
  verify(request: unknown): Promise<VerifiedAirenOSSession | null>;
}

export interface AirenOSIdentityDirectory {
  resolveIdentity(identityId: UUID): Promise<Readonly<{ identityId: UUID; status: string; platformRoles: readonly string[] }> | null>;
}

export class AirenOSSessionAuthenticationAdapter implements AuthenticationAdapter {
  private readonly verifier: AirenOSSessionCredentialVerifier;
  private readonly identities: AirenOSIdentityDirectory;

  constructor(verifier: AirenOSSessionCredentialVerifier, identities: AirenOSIdentityDirectory) {
    this.verifier = verifier;
    this.identities = identities;
  }

  async authenticate(request: unknown): Promise<AuthenticatedPrincipal | null> {
    const verified = await this.verifier.verify(request);
    if (!verified) return null;
    const identity = await this.identities.resolveIdentity(verified.identityId);
    if (!identity || identity.status !== "active") return null;
    return {
      identityId: identity.identityId,
      providerKey: verified.issuer,
      providerSubject: verified.identityId,
      platformRoles: identity.platformRoles,
      sessionId: verified.sessionId,
      authenticatedAtIso: verified.issuedAtIso,
      expiresAtIso: verified.expiresAtIso
    };
  }
}
