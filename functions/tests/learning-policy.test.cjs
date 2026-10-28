const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isFreeCoursePrice,
  hasActiveSubscription,
  normalizeLearningProgress,
} = require("../lib/learning-policy.js");

test("recognizes only explicit zero-price courses as free", () => {
  for (const price of [0, "0", "0.00", "$0", "₦0.00", "NGN 0", "Free"]) {
    assert.equal(isFreeCoursePrice(price), true, String(price));
  }
  for (const price of ["", null, undefined, "$49.99", "49.99", "free trial", NaN, -1]) {
    assert.equal(isFreeCoursePrice(price), false, String(price));
  }
});

test("subscription must be active and not expired", () => {
  const now = 1_800_000_000_000;
  assert.equal(hasActiveSubscription("active", now + 1, now), true);
  assert.equal(hasActiveSubscription("active", now, now), false);
  assert.equal(hasActiveSubscription("active", now - 1, now), false);
  assert.equal(hasActiveSubscription("expired", now + 1, now), false);
  assert.equal(hasActiveSubscription("active", "later", now), false);
});

test("normalizes duplicate completed indexes and derives progress server-side", () => {
  assert.deepEqual(
    normalizeLearningProgress(1, [0, 1, 1], 4),
    { currentLessonIndex: 1, completedLessonIndexes: [0, 1], progressPercent: 50 },
  );
});

test("rejects out-of-range and malformed lesson indexes", () => {
  assert.throws(() => normalizeLearningProgress(-1, [], 4), /Current lesson index/);
  assert.throws(() => normalizeLearningProgress(4, [], 4), /Current lesson index/);
  assert.throws(() => normalizeLearningProgress(0, [4], 4), /completed lesson index/);
  assert.throws(() => normalizeLearningProgress(0, "0", 4), /valid list/);
  assert.throws(() => normalizeLearningProgress(0, [], 0), /lesson count/);
});
