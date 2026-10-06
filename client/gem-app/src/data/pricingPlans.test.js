import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOfferTotalXaf,
  enterpriseOffers,
  formatEuroEquivalent,
  pricingSections,
} from "./pricingPlans.js";

test("B1 and B2 pack prices and certification quantities use the XAF list price", () => {
  const expectedPrices = { starter: 2500, standard: 5900, intensif: 8900 };

  for (const section of pricingSections) {
    assert.equal(section.plans.length, 3);
    for (const plan of section.plans) {
      assert.equal(plan.priceXaf, expectedPrices[plan.planKey], `${section.level} ${plan.planKey}`);
      for (const certificationCount of [1, 2, 3, 4]) {
        assert.equal(
          calculateOfferTotalXaf(plan, certificationCount),
          expectedPrices[plan.planKey] * certificationCount,
          `${section.level} ${plan.planKey} x ${certificationCount} certifications`
        );
      }
    }
  }
});

test("enterprise prices stay fixed while full certification access is selected", () => {
  assert.deepEqual(enterpriseOffers.map((offer) => offer.priceXaf), [150000, 600000, 1000000]);

  for (const offer of enterpriseOffers) {
    assert.equal(calculateOfferTotalXaf({ ...offer, isEnterprise: true }, 4), offer.priceXaf);
  }
});

test("EUR is formatted as a converted secondary amount", () => {
  assert.equal(formatEuroEquivalent(2500), "€3,81");
});
