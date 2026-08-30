import type { UUID } from "../../shared-contracts/src/index.ts";
import type {
  AirenOSSessionCredentialVerifier,
  AirenOSSessionIssueRequest,
  AirenOSSessionIssuer,
  IssuedAirenOSSession,
  VerifiedAirenOSSession
} from "./session-authority.ts";

export type AirenOSSessionRecord = Readonly<{
  sessionId: string;
  identityId: UUID;
  issuedAtIso: string;
  expiresAtIso: string;
}>;

export interface AirenOSSessionLifecycleStore {
  register(record: AirenOSSessionRecord): Promise<void>;
  resolveActive(sessionId: string, identityId: UUID): Promise<AirenOSSessionRecord | null>;
  revoke(sessionId: string, identityId: UUID, reason: string): Promise<boolean>;
  revokeAllForIdentity(identityId: UUID, reason: string): Promise<number>;
}

export class PersistentAirenOSSessionIssuer implements AirenOSSessionIssuer {
  private readonly issuer: AirenOSSessionIssuer;
  private readonly sessions: AirenOSSessionLifecycleStore;

  constructor(issuer: AirenOSSessionIssuer, sessions: AirenOSSessionLifecycleStore) {
    this.issuer = issuer;
    this.sessions = sessions;
  }

  async issue(input: AirenOSSessionIssueRequest): Promise<IssuedAirenOSSession> {
    const issued = await this.issuer.issue(input);
    await this.sessions.register({
      sessionId: issued.sessionId,
      identityId: input.identityId,
      issuedAtIso: issued.issuedAtIso,
      expiresAtIso: issued.expiresAtIso
    });
    return issued;
  }
}

export class RevocationAwareAirenOSSessionVerifier implements AirenOSSessionCredentialVerifier {
  private readonly verifier: AirenOSSessionCredentialVerifier;
  private readonly sessions: AirenOSSessionLifecycleStore;

  constructor(verifier: AirenOSSessionCredentialVerifier, sessions: AirenOSSessionLifecycleStore) {
    this.verifier = verifier;
    this.sessions = sessions;
  }

  async verify(request: unknown): Promise<VerifiedAirenOSSession | null> {
    const verified = await this.verifier.verify(request);
    if (!verified) return null;
    const active = await this.sessions.resolveActive(verified.sessionId, verified.identityId);
    if (!active) return null;
    if (active.issuedAtIso !== verified.issuedAtIso || active.expiresAtIso !== verified.expiresAtIso) return null;
    return verified;
  }
}

export class AirenOSSessionRevocationService {
  private readonly sessions: AirenOSSessionLifecycleStore;

  constructor(sessions: AirenOSSessionLifecycleStore) {
    this.sessions = sessions;
  }

  async revokeSession(sessionId: string, identityId: UUID, reason: string): Promise<boolean> {
    return this.sessions.revoke(sessionId, identityId, normalizeReason(reason));
  }

  async revokeAllSessions(identityId: UUID, reason: string): Promise<number> {
    return this.sessions.revokeAllForIdentity(identityId, normalizeReason(reason));
  }
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new Error("AIRenOS session revocation reason is required");
  if (normalized.length > 256) throw new Error("AIRenOS session revocation reason must not exceed 256 characters");
  return normalized;
}
