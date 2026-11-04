import { describe, expect, it } from "vitest";
import { phoneAppearsIn } from "../src/agent/tools.js";
import { normalizeIndianMobile } from "../src/lib/phone.js";
import { QuoteError, quoteProduct, requiresPhoneNumber } from "../src/integrations/bitrefill/pricing.js";
import type { BitrefillProduct } from "../src/integrations/bitrefill/schemas.js";
import { formatMoney, majorToMinorCeil, parseAmountToMinor } from "../src/lib/money.js";

describe("money", () => {
  it("parses decimal amounts to minor units", () => {
    expect(parseAmountToMinor("2")).toBe(200);
    expect(parseAmountToMinor("1.5")).toBe(150);
    expect(parseAmountToMinor("0.05")).toBe(5);
    expect(parseAmountToMinor(" 10.25 ")).toBe(1025);
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "-1", "1.234", "abc", "1,5", "1e3"]) {
      expect(() => parseAmountToMinor(bad)).toThrow();
    }
  });

  it("rounds API prices up without float drift", () => {
    expect(majorToMinorCeil(1.1)).toBe(110);
    expect(majorToMinorCeil(1.001)).toBe(101);
    expect(majorToMinorCeil(0.29)).toBe(29);
  });

  it("formats money", () => {
    expect(formatMoney(150, "USD")).toBe("$1.50");
  });
});

const packaged: BitrefillProduct = {
  id: "amazon-in",
  name: "Amazon India",
  currency: "INR",
  in_stock: true,
  packages: [
    { package_id: "amazon-in<&>100", value: "100", price: 1.21 },
    { id: "amazon-in<&>500", value: 500, price: 6.02 },
  ],
};

const ranged: BitrefillProduct = {
  id: "jio-india",
  name: "Jio India",
  currency: "INR",
  recipient_type: "phone_number",
  range: { min: 10, max: 5000, step: 1, price_rate: 0.0121 },
};

describe("quoteProduct", () => {
  it("quotes a package by package_id or id", () => {
    expect(quoteProduct(packaged, { packageId: "amazon-in<&>100" }, "USD")).toMatchObject({ costMinor: 121, value: "100" });
    expect(quoteProduct(packaged, { packageId: "amazon-in<&>500" }, "USD").costMinor).toBe(602);
  });

  it("quotes a ranged value using price_rate", () => {
    const q = quoteProduct(ranged, { value: 199 }, "USD");
    expect(q).toMatchObject({ packageId: null, rangedValue: 199, value: "199" });
    expect(q.costMinor).toBe(241); // 199 * 0.0121 = 2.4079 -> 2.41
  });

  it("rejects values outside the range or off-step", () => {
    expect(() => quoteProduct(ranged, { value: 5 }, "USD")).toThrow(QuoteError);
    expect(() => quoteProduct({ ...ranged, range: { min: 10, max: 100, step: 5, price_rate: 1 } }, { value: 12 }, "USD")).toThrow(
      QuoteError,
    );
  });

  it("rejects unknown packages and out-of-stock products", () => {
    expect(() => quoteProduct(packaged, { packageId: "nope" }, "USD")).toThrow(QuoteError);
    expect(() => quoteProduct({ ...packaged, in_stock: false }, { packageId: "amazon-in<&>100" }, "USD")).toThrow(QuoteError);
  });

  it("refuses to guess a price when the rate is unknown and currencies differ", () => {
    const noRate = { ...ranged, range: { min: 10, max: 100 } };
    expect(() => quoteProduct(noRate, { value: 20 }, "USD")).toThrow(QuoteError);
    expect(quoteProduct({ ...noRate, currency: "USD" }, { value: 20 }, "USD").costMinor).toBe(2000);
  });

  it("detects products that need a phone number", () => {
    expect(requiresPhoneNumber(ranged)).toBe(true);
    expect(requiresPhoneNumber(packaged)).toBe(false);
  });
});

describe("phone number guard", () => {
  it("accepts a number the member typed, in any formatting", () => {
    expect(phoneAppearsIn("+919812345678", ["recharge 98123 45678 please"])).toBe(true);
  });

  it("rejects a number the member never typed", () => {
    expect(phoneAppearsIn("+919812345678", ["recharge my mom's phone"])).toBe(false);
  });

  it("normalizes Indian mobile numbers: gaps removed, 91 country code added", () => {
    for (const typed of ["+91 98765 43210", "98765 43210", "9876543210", "098765-43210", "+91-98765-43210", "(98765) 43210", "91 9876543210"]) {
      expect(normalizeIndianMobile(typed)).toBe("919876543210");
    }
  });

  it("rejects things that are not Indian mobile numbers", () => {
    for (const bad of ["12345", "5876543210", "+1 415 555 0100", "98765abcde", "", "919876543210999"]) {
      expect(normalizeIndianMobile(bad)).toBeNull();
    }
  });
});
