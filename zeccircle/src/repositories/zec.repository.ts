import type { Database } from "../db/database.js";
import type { ZcashNetwork } from "../integrations/zcash/wallet.js";
import { nowIso } from "../lib/time.js";

export type DepositStatus = "seen" | "confirmed";
export type PaymentStatus = "reserved" | "sending" | "sent" | "released" | "failed";

/** Payment statuses whose amount is no longer available to the circle. */
const COMMITTED_PAYMENT_STATUSES = "('reserved', 'sending', 'sent')";

export interface FundingRequest {
  code: string;
  circleId: number;
  requestedByTelegramId: number;
  createdAt: string;
}

export interface ZecDeposit {
  id: number;
  txid: string;
  outputPool: number;
  outputIndex: number;
  amountZat: number;
  memo: string | null;
  fundingCode: string | null;
  circleId: number | null;
  minedHeight: number | null;
  status: DepositStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ZecPayment {
  id: number;
  purchaseId: number;
  circleId: number;
  amountZat: number;
  priceMinorPerZec: number;
  toAddress: string;
  status: PaymentStatus;
  txid: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DepositRow {
  id: number;
  txid: string;
  output_pool: number;
  output_index: number;
  amount_zat: number;
  memo: string | null;
  funding_code: string | null;
  circle_id: number | null;
  mined_height: number | null;
  status: DepositStatus;
  created_at: string;
  confirmed_at: string | null;
}

interface PaymentRow {
  id: number;
  purchase_id: number;
  circle_id: number;
  amount_zat: number;
  price_minor_per_zec: number;
  to_address: string;
  status: PaymentStatus;
  txid: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const toDeposit = (r: DepositRow): ZecDeposit => ({
  id: r.id,
  txid: r.txid,
  outputPool: r.output_pool,
  outputIndex: r.output_index,
  amountZat: r.amount_zat,
  memo: r.memo,
  fundingCode: r.funding_code,
  circleId: r.circle_id,
  minedHeight: r.mined_height,
  status: r.status,
  createdAt: r.created_at,
  confirmedAt: r.confirmed_at,
});

const toPayment = (r: PaymentRow): ZecPayment => ({
  id: r.id,
  purchaseId: r.purchase_id,
  circleId: r.circle_id,
  amountZat: r.amount_zat,
  priceMinorPerZec: r.price_minor_per_zec,
  toAddress: r.to_address,
  status: r.status,
  txid: r.txid,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Deposits, payments and deposit addresses are all tagged with the network they belong to, and every
 * read here is limited to this repository's network. A circle's testnet money can never show up as
 * mainnet money (or the other way round) when the bot's mode changes.
 */
export class ZecRepository {
  constructor(
    private readonly db: Database,
    private readonly network: ZcashNetwork = "test",
  ) {}

  // ---------------------------------------------------------------- funding requests

  async createFundingRequest(code: string, circleId: number, telegramId: number): Promise<FundingRequest> {
    const createdAt = nowIso();
    await this.db.query(
      "INSERT INTO zec_funding_requests (code, circle_id, requested_by_telegram_id, created_at) VALUES (?, ?, ?, ?)",
      [code, circleId, telegramId, createdAt],
    );
    return { code, circleId, requestedByTelegramId: telegramId, createdAt };
  }

  async findFundingRequest(code: string): Promise<FundingRequest | null> {
    const { rows } = await this.db.query<{ code: string; circle_id: number; requested_by_telegram_id: number; created_at: string }>(
      "SELECT * FROM zec_funding_requests WHERE code = ?",
      [code],
    );
    const r = rows[0];
    return r ? { code: r.code, circleId: r.circle_id, requestedByTelegramId: r.requested_by_telegram_id, createdAt: r.created_at } : null;
  }

  // ---------------------------------------------------------------- per-circle addresses

  async findCircleAddress(circleId: number): Promise<string | null> {
    const { rows } = await this.db.query<{ address: string }>("SELECT address FROM zec_circle_addresses WHERE circle_id = ? AND network = ?", [circleId, this.network]);
    return rows[0]?.address ?? null;
  }

  async findCircleByAddress(address: string): Promise<number | null> {
    const { rows } = await this.db.query<{ circle_id: number }>("SELECT circle_id FROM zec_circle_addresses WHERE address = ? AND network = ?", [address, this.network]);
    return rows[0]?.circle_id ?? null;
  }

  /** Stores the circle's address unless it already has one; returns whichever address is stored. */
  async saveCircleAddress(circleId: number, address: string): Promise<string> {
    await this.db.query(
      "INSERT INTO zec_circle_addresses (circle_id, network, address, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (circle_id, network) DO NOTHING",
      [circleId, this.network, address, nowIso()],
    );
    return (await this.findCircleAddress(circleId))!;
  }

  // ---------------------------------------------------------------- deposits

  /** Inserts a newly seen deposit; returns null if this output was already recorded. */
  async insertDeposit(d: {
    txid: string;
    outputPool: number;
    outputIndex: number;
    amountZat: number;
    memo: string | null;
    fundingCode: string | null;
    circleId: number | null;
    minedHeight: number | null;
  }): Promise<ZecDeposit | null> {
    const { rows } = await this.db.query<DepositRow>(
      `INSERT INTO zec_deposits (txid, output_pool, output_index, amount_zat, memo, funding_code, circle_id,
         mined_height, status, created_at, network)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seen', ?, '${this.network}')
       ON CONFLICT (txid, output_pool, output_index) DO NOTHING
       RETURNING *`,
      [d.txid, d.outputPool, d.outputIndex, d.amountZat, d.memo, d.fundingCode, d.circleId, d.minedHeight, nowIso()],
    );
    return rows[0] ? toDeposit(rows[0]) : null;
  }

  async listSeenDeposits(): Promise<ZecDeposit[]> {
    const { rows } = await this.db.query<DepositRow>("SELECT * FROM zec_deposits WHERE status = 'seen' AND network = ? ORDER BY id", [this.network]);
    return rows.map(toDeposit);
  }

  async updateDepositHeight(id: number, minedHeight: number | null): Promise<void> {
    await this.db.query("UPDATE zec_deposits SET mined_height = ? WHERE id = ?", [minedHeight, id]);
  }

  /** Compare-and-set seen -> confirmed. */
  async confirmDeposit(id: number): Promise<boolean> {
    const result = await this.db.query("UPDATE zec_deposits SET status = 'confirmed', confirmed_at = ? WHERE id = ? AND status = 'seen'", [
      nowIso(),
      id,
    ]);
    return result.rowCount === 1;
  }

  async listDepositsByCircle(circleId: number, limit: number): Promise<ZecDeposit[]> {
    const { rows } = await this.db.query<DepositRow>("SELECT * FROM zec_deposits WHERE circle_id = ? AND network = ? ORDER BY id DESC LIMIT ?", [
      circleId,
      this.network,
      limit,
    ]);
    return rows.map(toDeposit);
  }

  // ---------------------------------------------------------------- payments

  async createPayment(p: {
    purchaseId: number;
    circleId: number;
    amountZat: number;
    priceMinorPerZec: number;
    toAddress: string;
  }): Promise<ZecPayment> {
    const now = nowIso();
    const { rows } = await this.db.query<PaymentRow>(
      `INSERT INTO zec_payments (purchase_id, circle_id, amount_zat, price_minor_per_zec, to_address, status, created_at, updated_at, network)
       VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, '${this.network}') RETURNING *`,
      [p.purchaseId, p.circleId, p.amountZat, p.priceMinorPerZec, p.toAddress, now, now],
    );
    return toPayment(rows[0]!);
  }

  async findPaymentByPurchase(purchaseId: number): Promise<ZecPayment | null> {
    const { rows } = await this.db.query<PaymentRow>("SELECT * FROM zec_payments WHERE purchase_id = ?", [purchaseId]);
    return rows[0] ? toPayment(rows[0]) : null;
  }

  async listPaymentsByStatus(status: PaymentStatus): Promise<ZecPayment[]> {
    const { rows } = await this.db.query<PaymentRow>("SELECT * FROM zec_payments WHERE status = ? ORDER BY id", [status]);
    return rows.map(toPayment);
  }

  async transitionPayment(
    id: number,
    from: PaymentStatus[],
    to: PaymentStatus,
    extra: { txid?: string; error?: string } = {},
  ): Promise<boolean> {
    const placeholders = from.map(() => "?").join(", ");
    const result = await this.db.query(
      `UPDATE zec_payments SET status = ?, updated_at = ?, txid = COALESCE(?, txid), error = COALESCE(?, error)
       WHERE id = ? AND status IN (${placeholders})`,
      [to, nowIso(), extra.txid ?? null, extra.error ?? null, id, ...from],
    );
    return result.rowCount === 1;
  }

  /** Records what a payment actually sent (amount can differ from the reservation, e.g. a swap quote). */
  async completePayment(id: number, fields: { txid: string; amountZat: number; toAddress: string }): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE zec_payments SET status = 'sent', txid = ?, amount_zat = ?, to_address = ?, updated_at = ?
       WHERE id = ? AND status IN ('sending', 'failed')`,
      [fields.txid, fields.amountZat, fields.toAddress, nowIso(), id],
    );
    return result.rowCount === 1;
  }

  // ---------------------------------------------------------------- balances

  async confirmedDepositsZat(circleId: number): Promise<number> {
    const { rows } = await this.db.query<{ t: number }>(
      "SELECT COALESCE(SUM(amount_zat), 0) AS t FROM zec_deposits WHERE circle_id = ? AND status = 'confirmed' AND network = ?",
      [circleId, this.network],
    );
    return rows[0]!.t;
  }

  async pendingDepositsZat(circleId: number): Promise<number> {
    const { rows } = await this.db.query<{ t: number }>(
      "SELECT COALESCE(SUM(amount_zat), 0) AS t FROM zec_deposits WHERE circle_id = ? AND status = 'seen' AND network = ?",
      [circleId, this.network],
    );
    return rows[0]!.t;
  }

  async committedPaymentsZat(circleId: number): Promise<number> {
    const { rows } = await this.db.query<{ t: number }>(
      `SELECT COALESCE(SUM(amount_zat), 0) AS t FROM zec_payments WHERE circle_id = ? AND network = ? AND status IN ${COMMITTED_PAYMENT_STATUSES}`,
      [circleId, this.network],
    );
    return rows[0]!.t;
  }
}
