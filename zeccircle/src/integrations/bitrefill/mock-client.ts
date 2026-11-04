import { randomBytes } from "node:crypto";
import { BitrefillApiError } from "./client.js";
import type { BitrefillApi, InvoiceProductInput } from "./api.js";
import type { BitrefillBalance, BitrefillInvoice, BitrefillOrder, BitrefillProduct } from "./schemas.js";

/**
 * TEST MODE ONLY. A fake Bitrefill with a small catalogue so the whole bot (limits, approvals,
 * agent, delivery messages) can be exercised without an API key or spending anything.
 * Nothing here talks to the network; every delivered "code" says so.
 *
 * Prices are written as plain numbers in the circle's currency.
 */
const CATALOGUE: BitrefillProduct[] = [
  {
    id: "mock-amazon-in",
    name: "[TEST] Amazon India Gift Card",
    country_code: "IN",
    currency: "INR",
    in_stock: true,
    type: "gift_card",
    packages: [
      { package_id: "mock-amazon-in<&>100", value: "100", price: 1.2 },
      { package_id: "mock-amazon-in<&>500", value: "500", price: 6 },
      { package_id: "mock-amazon-in<&>1000", value: "1000", price: 12 },
    ],
  },
  {
    id: "mock-jio-in",
    name: "[TEST] Jio India Mobile Top-up",
    country_code: "IN",
    currency: "INR",
    in_stock: true,
    type: "phone_refill",
    recipient_type: "phone_number",
    range: { min: 10, max: 5000, step: 1, price_rate: 0.012 },
  },
  {
    id: "mock-steam-us",
    name: "[TEST] Steam US Gift Card",
    country_code: "US",
    currency: "USD",
    in_stock: true,
    type: "gift_card",
    packages: [
      { package_id: "mock-steam-us<&>5", value: "5", price: 5 },
      { package_id: "mock-steam-us<&>10", value: "10", price: 10 },
      { package_id: "mock-steam-us<&>20", value: "20", price: 20 },
    ],
  },
  {
    id: "mock-esim-europe",
    name: "[TEST] eSIM Europe",
    country_code: "EU",
    currency: "USD",
    in_stock: true,
    type: "esim",
    packages: [
      { package_id: "mock-esim-europe<&>1GB, 7 Days", value: "1GB, 7 Days", price: 4.5 },
      { package_id: "mock-esim-europe<&>5GB, 30 Days", value: "5GB, 30 Days", price: 14 },
    ],
  },
];

const PROCESSING_MS = 2_000;

interface MockInvoice {
  invoice: BitrefillInvoice;
  orderId: string;
  productId: string;
  phoneNumber: string | null;
  paidAt: number | null;
}

export class MockBitrefillClient implements BitrefillApi {
  private balance = 100;
  private readonly invoices = new Map<string, MockInvoice>();
  private readonly ordersToInvoice = new Map<string, string>();

  constructor(private readonly currency: string) {}

  async getBalance(): Promise<BitrefillBalance> {
    return { balance: this.balance, currency: this.currency };
  }

  async searchProducts(query: string, limit = 10): Promise<BitrefillProduct[]> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = CATALOGUE.map((p) => {
      const haystack = `${p.id} ${p.name} ${p.country_code ?? ""} ${p.type ?? ""}`.toLowerCase();
      return { p, hits: words.filter((w) => haystack.includes(w)).length };
    })
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    return scored.slice(0, limit).map((x) => x.p);
  }

  async getProduct(productId: string): Promise<BitrefillProduct> {
    const product = CATALOGUE.find((p) => p.id === productId);
    if (!product) throw new BitrefillApiError("Product not found", 404, "not_found");
    return product;
  }

  async createBalanceInvoice(input: InvoiceProductInput): Promise<BitrefillInvoice> {
    const product = await this.getProduct(input.productId);

    let price: number;
    if (input.packageId) {
      const pkg = product.packages?.find((p) => p.package_id === input.packageId);
      if (!pkg || pkg.price === undefined) throw new BitrefillApiError("Unknown package", 400, "invalid_package");
      price = pkg.price;
    } else if (input.value !== undefined && input.value !== null && product.range?.price_rate !== undefined) {
      price = Number(input.value) * product.range.price_rate;
    } else {
      throw new BitrefillApiError("Specify a package or a value", 400, "invalid_product");
    }

    const id = `mock-inv-${randomBytes(4).toString("hex")}`;
    const orderId = `mock-ord-${randomBytes(4).toString("hex")}`;
    const invoice: BitrefillInvoice = {
      id,
      status: "unpaid",
      payment: { method: "balance", currency: this.currency, price: Math.round(price * 100) / 100, status: "unpaid" },
      orders: [{ id: orderId, status: "created" }],
    };
    this.invoices.set(id, { invoice, orderId, productId: product.id, phoneNumber: input.phoneNumber ?? null, paidAt: null });
    this.ordersToInvoice.set(orderId, id);
    return invoice;
  }

  async payInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    const entry = this.require(invoiceId);
    if (entry.paidAt) throw new BitrefillApiError("Invoice not found or already paid", 404, null);
    const price = entry.invoice.payment?.price ?? 0;
    if (price > this.balance) throw new BitrefillApiError("Not enough funds", 403, null);
    this.balance -= price;
    entry.paidAt = Date.now();
    return this.view(entry);
  }

  async getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
    return this.view(this.require(invoiceId));
  }

  async getOrder(orderId: string): Promise<BitrefillOrder> {
    const invoiceId = this.ordersToInvoice.get(orderId);
    const entry = invoiceId ? this.invoices.get(invoiceId) : undefined;
    if (!entry) throw new BitrefillApiError("Order not found", 404, null);

    const base = { id: orderId, status: "delivered", product: { id: entry.productId } };
    // Phone top-ups carry no code: the balance lands on the phone.
    if (entry.phoneNumber) return base;
    return {
      ...base,
      redemption_info: {
        code: `TEST-${randomBytes(4).toString("hex").toUpperCase()}`,
        instructions: "TEST MODE: this is a fake code. Nothing was actually bought.",
      },
    };
  }

  /** Invoices move to "complete" a couple of seconds after being paid, like the real thing. */
  private view(entry: MockInvoice): BitrefillInvoice {
    const done = entry.paidAt !== null && Date.now() - entry.paidAt >= PROCESSING_MS;
    const status = entry.paidAt === null ? "unpaid" : done ? "complete" : "pending";
    return { ...entry.invoice, status, orders: [{ id: entry.orderId, status: done ? "delivered" : "created" }] };
  }

  private require(invoiceId: string): MockInvoice {
    const entry = this.invoices.get(invoiceId);
    if (!entry) throw new BitrefillApiError("Invoice not found", 404, null);
    return entry;
  }
}
