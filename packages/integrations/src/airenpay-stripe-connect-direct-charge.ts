import {
  assertTrustedProviderConnectionV1,
  type AirenPayTrustedProviderConnectionV1
} from "../../airenpay/src/index.ts";

export type AirenPayApplicationFeePolicyV1 = Readonly<{
  enabled: boolean;
  amountMinor?: number;
}>;

export type StripeConnectDirectChargeCreateInput = Readonly<{
  trustedConnection: AirenPayTrustedProviderConnectionV1;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  applicationFee: AirenPayApplicationFeePolicyV1;
}>;

export type StripeConnectDirectChargeProviderCommand = Readonly<{
  connectedAccountReference: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
  applicationFeeMinor?: number;
}>;

export type StripeConnectDirectChargeSnapshot = Readonly<{
  connectedAccountReference: string;
  paymentIntentId: string;
  status: string;
  amountMinor: number;
  currency: string;
  applicationFeeMinor?: number;
  livemode: boolean;
}>;

export interface StripeConnectDirectChargeTransport {
  createPaymentIntent(command: StripeConnectDirectChargeProviderCommand): Promise<StripeConnectDirectChargeSnapshot>;
  retrievePaymentIntent(
    connectedAccountReference: string,
    paymentIntentId: string
  ): Promise<StripeConnectDirectChargeSnapshot>;
}

export type StripeConnectDirectChargeEvidence = Readonly<{
  synchronous: StripeConnectDirectChargeSnapshot;
  readBack: StripeConnectDirectChargeSnapshot;
}>;

function assertPositiveInteger(value: number, code: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(code);
}

function assertTrustedDirectChargeConnection(connection: AirenPayTrustedProviderConnectionV1): void {
  assertTrustedProviderConnectionV1(connection);
  if (connection.gateway.providerType !== "stripe") throw new Error("AIRENPAY_DIRECT_CHARGE_STRIPE_REQUIRED");
  if (connection.gateway.mode !== "TEST") throw new Error("AIRENPAY_DIRECT_CHARGE_TEST_ONLY");
  if (connection.gateway.status !== "ACTIVE") throw new Error("AIRENPAY_DIRECT_CHARGE_CONNECTION_INACTIVE");
  if (connection.profile.fundsFlowProfile !== "DIRECT_CHARGES") {
    throw new Error("AIRENPAY_DIRECT_CHARGE_FUNDS_FLOW_REQUIRED");
  }
  if (connection.profile.readinessState !== "READY") throw new Error("AIRENPAY_DIRECT_CHARGE_PROVIDER_NOT_READY");
  if (!connection.gateway.providerAccountReference.trim()) throw new Error("AIRENPAY_DIRECT_CHARGE_ACCOUNT_REQUIRED");
}

function normalizeApplicationFee(policy: AirenPayApplicationFeePolicyV1, amountMinor: number): number | undefined {
  if (!policy.enabled) {
    if (policy.amountMinor != null && policy.amountMinor !== 0) {
      throw new Error("AIRENPAY_DIRECT_CHARGE_FEE_DISABLED");
    }
    return undefined;
  }
  if (policy.amountMinor == null) throw new Error("AIRENPAY_DIRECT_CHARGE_FEE_AMOUNT_REQUIRED");
  assertPositiveInteger(policy.amountMinor, "AIRENPAY_DIRECT_CHARGE_FEE_AMOUNT_INVALID");
  if (policy.amountMinor >= amountMinor) throw new Error("AIRENPAY_DIRECT_CHARGE_FEE_EXCEEDS_AMOUNT");
  return policy.amountMinor;
}

function assertSnapshotScope(
  snapshot: StripeConnectDirectChargeSnapshot,
  connectedAccountReference: string,
  expectedLivemode = false
): void {
  if (snapshot.connectedAccountReference !== connectedAccountReference) {
    throw new Error("AIRENPAY_DIRECT_CHARGE_ACCOUNT_SCOPE_MISMATCH");
  }
  if (snapshot.livemode !== expectedLivemode) throw new Error("AIRENPAY_DIRECT_CHARGE_LIVE_FORBIDDEN");
}

export class AirenPayStripeConnectDirectChargeAdapter {
  private readonly transport: StripeConnectDirectChargeTransport;

  constructor(transport: StripeConnectDirectChargeTransport) {
    this.transport = transport;
  }

  async createSandboxDirectCharge(
    input: StripeConnectDirectChargeCreateInput
  ): Promise<StripeConnectDirectChargeEvidence> {
    assertTrustedDirectChargeConnection(input.trustedConnection);
    assertPositiveInteger(input.amountMinor, "AIRENPAY_DIRECT_CHARGE_AMOUNT_INVALID");
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("AIRENPAY_DIRECT_CHARGE_CURRENCY_INVALID");
    if (!input.idempotencyKey.trim()) throw new Error("AIRENPAY_DIRECT_CHARGE_IDEMPOTENCY_REQUIRED");
    if (!input.correlationId.trim()) throw new Error("AIRENPAY_DIRECT_CHARGE_CORRELATION_REQUIRED");

    const connectedAccountReference = input.trustedConnection.gateway.providerAccountReference;
    const applicationFeeMinor = normalizeApplicationFee(input.applicationFee, input.amountMinor);
    const command: StripeConnectDirectChargeProviderCommand = Object.freeze({
      connectedAccountReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      ...(applicationFeeMinor == null ? {} : { applicationFeeMinor })
    });

    const synchronous = await this.transport.createPaymentIntent(command);
    assertSnapshotScope(synchronous, connectedAccountReference);
    const readBack = await this.transport.retrievePaymentIntent(connectedAccountReference, synchronous.paymentIntentId);
    assertSnapshotScope(readBack, connectedAccountReference);
    if (readBack.paymentIntentId !== synchronous.paymentIntentId) {
      throw new Error("AIRENPAY_DIRECT_CHARGE_READBACK_ID_MISMATCH");
    }

    return Object.freeze({ synchronous, readBack });
  }
}
