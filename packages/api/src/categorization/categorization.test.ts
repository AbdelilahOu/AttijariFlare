import { describe, expect, it } from "vite-plus/test";

import {
  decideFromNeighbours,
  merchantVectorMetadata,
  MIN_LLM_CONFIDENCE,
  toNeighbourMatch,
  VECTOR_MATCH_THRESHOLD,
} from "./decide";
import { merchantName } from "./merchant";
import {
  buildClassifyMessages,
  type ClassifyCategory,
  mapClassification,
  parseJsonResponse,
} from "./prompt";

// All fixtures are made up.

describe("merchantName", () => {
  it("strips card payment prefixes, dates and card numbers", () => {
    expect(merchantName("PAIEMENT CB 13/10/26 SUPERMARCHE ATLAS AGAD")).toBe(
      "supermarche atlas agad",
    );
    expect(merchantName("PAIEMENT PAR CARTE 4567XXXXXX1234 CAFE NOUR 02/10/2026")).toBe(
      "cafe nour",
    );
    expect(merchantName("ACHAT TPE 123456 PHARMACIE SALAM")).toBe("pharmacie salam");
  });

  it("gives the same merchant for different dates and references", () => {
    const a = merchantName("PAIEMENT ACME RECH HB 05/10/2026");
    const b = merchantName("PAIEMENT ACME RECH HB 21/11/2026");
    expect(a).toBe("acme rech");
    expect(b).toBe(a);
    expect(merchantName("PAIEMENT CB 01/02 LIBRAIRIE ALIF REF987654")).toBe("librairie alif");
  });

  it("collapses every ATM withdrawal into one merchant", () => {
    expect(merchantName("RETRAIT GAB 0123 AGADIR CENTRE 12/10")).toBe("retrait gab");
    expect(merchantName("RETRAIT DAB 98765 RABAT")).toBe("retrait gab");
  });

  it("keeps the direction of transfers and the counterparty", () => {
    expect(merchantName("VIR WEB RECU DE EXEMPLE KARIM")).toBe("virement recu exemple karim");
    expect(merchantName("VIR EMIS WEB VERS EXEMPLE SARA")).toBe("virement emis exemple sara");
    expect(merchantName("VIREMENT EMIS VERS EXEMPLE SARA 0001234567")).toBe(
      "virement emis exemple sara",
    );
  });

  it("handles accents, Arabic and empty input", () => {
    expect(merchantName("Paiement CB Épicerie Élite")).toBe("epicerie elite");
    expect(merchantName("مخبزة الأمل")).toBe("مخبزة الامل");
    expect(merchantName("   ")).toBeNull();
    expect(merchantName("12/10/2026 0001234")).toBeNull();
  });

  it("caps long names", () => {
    expect(merchantName("PAIEMENT CB ONE TWO THREE FOUR FIVE SIX SEVEN")).toBe(
      "one two three four five",
    );
  });
});

describe("decideFromNeighbours", () => {
  const known = new Set(["groceries", "fuel"]);

  it("copies the category of a close confirmed neighbour", () => {
    expect(
      decideFromNeighbours([{ score: 0.93, merchantId: "m1", categoryId: "groceries" }], {
        knownCategoryIds: known,
      }),
    ).toEqual({ categoryId: "groceries", confidence: 0.93 });
  });

  it("ignores matches under the threshold, unknown categories and the merchant itself", () => {
    const below = VECTOR_MATCH_THRESHOLD - 0.01;
    expect(
      decideFromNeighbours(
        [
          { score: below, merchantId: "m1", categoryId: "groceries" },
          { score: 0.99, merchantId: "m2", categoryId: "deleted" },
          { score: 0.99, merchantId: "self", categoryId: "fuel" },
          { score: 0.95, merchantId: "m3", categoryId: null },
        ],
        { knownCategoryIds: known, selfMerchantId: "self" },
      ),
    ).toBeNull();
  });

  it("votes by summed similarity", () => {
    expect(
      decideFromNeighbours(
        [
          { score: 0.9, merchantId: "m1", categoryId: "fuel" },
          { score: 0.86, merchantId: "m2", categoryId: "groceries" },
          { score: 0.85, merchantId: "m3", categoryId: "groceries" },
        ],
        { knownCategoryIds: known },
      ),
    ).toEqual({ categoryId: "groceries", confidence: 0.86 });
  });

  it("accepts a custom threshold", () => {
    expect(
      decideFromNeighbours([{ score: 0.7, merchantId: "m1", categoryId: "fuel" }], {
        knownCategoryIds: known,
        threshold: 0.6,
      }),
    ).toEqual({ categoryId: "fuel", confidence: 0.7 });
  });
});

describe("vector metadata", () => {
  it("marks merchants with a default category as confirmed", () => {
    expect(merchantVectorMetadata({ id: "m1", userId: "u1", defaultCategoryId: null })).toEqual({
      user_id: "u1",
      merchant_id: "m1",
      category_id: "",
      confirmed: false,
    });
    expect(merchantVectorMetadata({ id: "m1", userId: "u1", defaultCategoryId: "c1" })).toEqual({
      user_id: "u1",
      merchant_id: "m1",
      category_id: "c1",
      confirmed: true,
    });
  });

  it("reads matches back, tolerating missing metadata", () => {
    expect(
      toNeighbourMatch({ score: 0.9, metadata: { merchant_id: "m1", category_id: "" } }),
    ).toEqual({ score: 0.9, merchantId: "m1", categoryId: null });
    expect(toNeighbourMatch({ score: 0.5 })).toEqual({
      score: 0.5,
      merchantId: null,
      categoryId: null,
    });
  });
});

describe("LLM classification", () => {
  const categories: ClassifyCategory[] = [
    { id: "c-groceries", name: "Groceries", kind: "expense" },
    { id: "c-transfers-in", name: "Transfers in", kind: "transfer" },
    { id: "c-telecom", name: "Télécom", kind: "expense" },
  ];

  it("lists the categories and one line per item", () => {
    const [system, user] = buildClassifyMessages({
      categories,
      items: [
        {
          merchant: "supermarche atlas",
          example: "PAIEMENT CB SUPERMARCHE ATLAS",
          type: "card_payment",
          direction: "debit",
        },
      ],
    });
    expect(system?.role).toBe("system");
    expect(user?.content).toContain("- Groceries (expense)");
    expect(user?.content).toContain('"i":0');
    expect(user?.content).toContain('"direction":"debit"');
  });

  it("maps names to ids case and accent insensitively", () => {
    expect(
      mapClassification(
        {
          items: [
            { i: 0, category: "groceries", confidence: 0.9 },
            { i: 1, category: "TELECOM", confidence: "0.8" },
            { i: 2, category: "transfers in", confidence: 2 },
          ],
        },
        { categories, itemCount: 3 },
      ),
    ).toEqual([
      { index: 0, categoryId: "c-groceries", confidence: 0.9 },
      { index: 1, categoryId: "c-telecom", confidence: 0.8 },
      { index: 2, categoryId: "c-transfers-in", confidence: 1 },
    ]);
  });

  it("drops unknown names, bad indexes, duplicates, low confidence and malformed entries", () => {
    expect(
      mapClassification(
        {
          items: [
            { i: 0, category: "Gambling", confidence: 0.9 },
            { i: 5, category: "Groceries", confidence: 0.9 },
            { i: 1, category: "Groceries", confidence: MIN_LLM_CONFIDENCE - 0.1 },
            { i: 2, category: "Groceries", confidence: 0.7 },
            { i: 2, category: "Télécom", confidence: 0.9 },
            "nonsense",
            { category: "Groceries" },
          ],
        },
        { categories, itemCount: 3 },
      ),
    ).toEqual([{ index: 2, categoryId: "c-groceries", confidence: 0.7 }]);
    expect(mapClassification({ nope: true }, { categories, itemCount: 3 })).toEqual([]);
  });

  it("parses JSON wrapped in prose", () => {
    expect(parseJsonResponse('Here you go: {"items": []} done')).toEqual({ items: [] });
    expect(parseJsonResponse("no json")).toBeNull();
    expect(parseJsonResponse({ items: [] })).toEqual({ items: [] });
  });
});
