import { pino } from "pino";
import type { Database } from "../src/db/database.js";
import { freshDatabase } from "./pglite-database.js";
import type { BitrefillApi } from "../src/integrations/bitrefill/api.js";
import type { BitrefillInvoice, BitrefillOrder, BitrefillProduct } from "../src/integrations/bitrefill/schemas.js";
import { AuditRepository } from "../src/repositories/audit.repository.js";
import { CircleRepository } from "../src/repositories/circle.repository.js";
import { InviteRepository } from "../src/repositories/invite.repository.js";
import { MemberRepository } from "../src/repositories/member.repository.js";
import { PurchaseRepository } from "../src/repositories/purchase.repository.js";
import { ZecRepository } from "../src/repositories/zec.repository.js";
import { CircleService } from "../src/services/circle.service.js";
import type { CircleEvent, Notifier } from "../src/services/notifier.js";
import { PurchaseService } from "../src/services/purchase.service.js";
import { NoFundingRail, type FundingRail } from "../src/services/funding/funding-rail.js";
import { MockModeGuard, type PurchaseGuard } from "../src/services/purchase-guard.js";

export const silentLogger = pino({ level: "silent" });

export class RecordingNotifier implements Notifier {
  readonly events: CircleEvent[] = [];
  async notify(event: CircleEvent): Promise<void> {
    this.events.push(event);
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

/** In-memory stand-in for Bitrefill with just enough behaviour for the purchase flow. */
export class FakeBitrefill {
  products = new Map<string, BitrefillProduct>();
  invoices = new Map<string, BitrefillInvoice>();
  balance = 100;
  /** Multiplier applied to the quoted price when an invoice is created (simulates price moves). */
  invoicePriceFactor = 1;
  paidInvoices: string[] = [];
  private seq = 0;

  addProduct(p: BitrefillProduct): void {
    this.products.set(p.id, p);
  }

  async getBalance() {
    return { balance: this.balance, currency: "USD" };
  }

  async searchProducts(): Promise<BitrefillProduct[]> {
    return [...this.products.values()];
  }

  async getProduct(id: string): Promise<BitrefillProduct> {
    const p = this.products.get(id);
    if (!p) {
      const { BitrefillApiError } = await import("../src/integrations/bitrefill/client.js");
      throw new BitrefillApiError("Product not found", 404, null);
    }
    return p;
  }

  async createBalanceInvoice(input: { productId: string; packageId?: string | null; value?: number | string | null }) {
    const product = await this.getProduct(input.productId);
    const pkg = product.packages?.find((p) => (p.package_id ?? p.id) === input.packageId);
    const price = (pkg?.price ?? Number(input.value) * (product.range?.price_rate ?? 1)) * this.invoicePriceFactor;
    const id = `inv_${++this.seq}`;
    const invoice: BitrefillInvoice = {
      id,
      status: "unpaid",
      payment: { method: "balance", currency: "USD", price },
      orders: [{ id: `ord_${this.seq}`, status: "created" }],
    };
    this.invoices.set(id, invoice);
    return invoice;
  }

  async payInvoice(id: string) {
    const invoice = this.invoices.get(id)!;
    const price = invoice.payment?.price ?? 0;
    if (price > this.balance) {
      const { BitrefillApiError } = await import("../src/integrations/bitrefill/client.js");
      throw new BitrefillApiError("Not enough funds", 403, null);
    }
    this.balance -= price;
    this.paidInvoices.push(id);
    invoice.status = "complete";
    return invoice;
  }

  async getInvoice(id: string) {
    return this.invoices.get(id)!;
  }

  async getOrder(id: string): Promise<BitrefillOrder> {
    return { id, status: "delivered", redemption_info: { code: `CODE-${id}` } };
  }
}

export async function buildTestServices(
  options: {
    fundingRail?: (deps: TestDeps) => FundingRail;
    guard?: (deps: TestDeps & { bitrefill: FakeBitrefill }) => PurchaseGuard;
  } = {},
) {
  const db = await freshDatabase();
  const repos = {
    circles: new CircleRepository(db),
    members: new MemberRepository(db),
    invites: new InviteRepository(db),
    purchases: new PurchaseRepository(db),
    audit: new AuditRepository(db),
    zec: new ZecRepository(db, "mock"),
  };
  const notifier = new RecordingNotifier();
  const bitrefill = new FakeBitrefill();

  const circleService = new CircleService({
    db,
    ...repos,
    notifier,
    logger: silentLogger,
    settings: {
      currency: "USD",
      defaultCircleMonthlyLimit: 1000,
      defaultMemberPerPurchaseLimit: 200,
      defaultMemberMonthlyLimit: 500,
      inviteTtlMs: 60 * 60 * 1000,
    },
  });

  const fundingRail = options.fundingRail?.({ db, repos, notifier, circleService }) ?? new NoFundingRail();
  const guard = options.guard?.({ db, repos, notifier, circleService, bitrefill }) ?? new MockModeGuard();
  const purchaseService = new PurchaseService({
    db,
    ...repos,
    circleService,
    fundingRail,
    guard,
    bitrefill: bitrefill as unknown as BitrefillApi,
    notifier,
    logger: silentLogger,
    settings: {
      currency: "USD",
      proposalTtlMs: 30 * 60 * 1000,
      approvalTtlMs: 24 * 60 * 60 * 1000,
      priceTolerancePercent: 5,
      invoicePollIntervalMs: 1,
      invoicePollTimeoutMs: 1_000,
    },
  });

  return { db, repos, notifier, bitrefill, circleService, purchaseService, fundingRail };
}

export interface TestDeps {
  db: Database;
  repos: {
    circles: CircleRepository;
    members: MemberRepository;
    invites: InviteRepository;
    purchases: PurchaseRepository;
    audit: AuditRepository;
    zec: ZecRepository;
  };
  notifier: RecordingNotifier;
  circleService: CircleService;
}

export const OWNER = { telegramId: 1001, displayName: "Owner" };
export const MEMBER = { telegramId: 2002, displayName: "Mom" };
export const STRANGER = { telegramId: 3003, displayName: "Stranger" };

/** Creates a circle with OWNER and an approved MEMBER. */
export async function circleWithMember(services: Awaited<ReturnType<typeof buildTestServices>>) {
  const { circleService } = services;
  await circleService.createCircle(OWNER, "Test Family");
  const { token } = await circleService.createInvite(OWNER.telegramId);
  await circleService.join(MEMBER, token);
  return (await circleService.getMembership(MEMBER.telegramId))!;
}

/** Waits until background purchase execution has settled. */
export async function settle(purchaseService: PurchaseService): Promise<void> {
  await purchaseService.stop();
}
