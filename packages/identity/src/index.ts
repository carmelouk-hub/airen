export type Identity = { id: string; primaryEmail?: string; displayName?: string; status: "active" | "invited" | "disabled" | "archived"; };
export type ProviderSubjectLink = { providerKey: string; providerSubject: string; identityId: string; };
