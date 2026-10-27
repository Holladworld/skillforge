const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPECTED_AMOUNTS_KOBO,
  isPaymentType,
} = require("../lib/payment-policy.js");

test("keeps the approved payment prices in kobo", () => {
  assert.equal(EXPECTED_AMOUNTS_KOBO.one_on_one, 10_000_000);
  assert.equal(EXPECTED_AMOUNTS_KOBO.monthly, 1_000_000);
});

test("accepts only the two supported payment types", () => {
  assert.equal(isPaymentType("one_on_one"), true);
  assert.equal(isPaymentType("monthly"), true);
  assert.equal(isPaymentType("annual"), false);
  assert.equal(isPaymentType(""), false);
  assert.equal(isPaymentType(null), false);
  assert.equal(isPaymentType({ paymentType: "monthly" }), false);
  assert.equal(isPaymentType(undefined), false);
});

test("does not treat inherited object properties as valid payment types", () => {
  assert.equal(isPaymentType("toString"), false);
  assert.equal(isPaymentType("constructor"), false);
});
