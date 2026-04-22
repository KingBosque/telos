export type PolicyProtocolStrictness = "permissive" | "strict";

export type PolicyPatchV0 = {
  v: 0;
  protocol?: {
    addKnownEventTypes?: string[];
    setStrictness?: PolicyProtocolStrictness;
  };
  capabilityProfiles?: {
    safe_mode?: {
      allowlistAdd?: string[];
    };
  };
};

export type ArcanePolicyV0 = {
  v: 0;
  protocol: {
    strictness: PolicyProtocolStrictness;
    knownEventTypes: string[];
  };
  sandbox: {
    ttlMsDefault: number;
    maxActiveSandboxPatches: number;
  };
};

export type PolicyOverridePatchV0 = {
  id: string;
  ts: number;
  expiresAt: number;
  scope: { openclawSessionId?: string; nativeThreadId?: string; global?: boolean };
  patch: PolicyPatchV0;
};

export type PolicyOverridesV0 = {
  v: 0;
  patches: PolicyOverridePatchV0[];
};

