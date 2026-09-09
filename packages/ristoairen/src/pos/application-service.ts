import type { SecurityContext, UUID } from "../../../shared-contracts/src/index.ts";
import type { MoneyV1, PosApplicationRepository, PosProductAccessGuard, RefundInputV1, SettlementInputV1, ZReportProjectionV1 } from "./contracts.ts";
import { requirePosWrite, validateRefund, validateSettlement } from "./policy.ts";

export class PosApplicationService {
  constructor(private readonly repo: PosApplicationRepository, private readonly access: PosProductAccessGuard) {}

  async openSession(context: SecurityContext, openingFloat: MoneyV1) {
    requirePosWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.openSession(context, Object.freeze({ ...openingFloat }));
  }

  async settle(context: SecurityContext, input: SettlementInputV1, idempotencyKey: string) {
    requirePosWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.settleOrder(context, validateSettlement(input), idempotencyKey.trim());
  }

  async refund(context: SecurityContext, input: RefundInputV1, idempotencyKey: string) {
    requirePosWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.refundPayment(context, validateRefund(input), idempotencyKey.trim());
  }

  async closeSession(context: SecurityContext, cashRegisterSessionId: UUID, expectedRowVersion: number, idempotencyKey: string): Promise<ZReportProjectionV1> {
    requirePosWrite(context); await this.access.assertRistoAirenAccess(context);
    return this.repo.closeSessionAndGenerateZReport(context, cashRegisterSessionId, expectedRowVersion, idempotencyKey.trim());
  }
}
