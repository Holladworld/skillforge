const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isFreeCoursePrice,
  hasActiveSubscription,
  normalizeLearningProgress,
  normalizeLessonVideoUrl,
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

test("normalizes supported YouTube lesson URLs to privacy-enhanced embeds", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk?t=30",
    "https://youtube.com/shorts/abcdefghijk",
    "https://www.youtube-nocookie.com/embed/abcdefghijk",
  ]) {
    assert.deepEqual(normalizeLessonVideoUrl(url), {
      provider: "youtube",
      videoId: "abcdefghijk",
      videoUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
    });
  }
});

test("accepts HTTPS Cloudinary video delivery URLs", () => {
  assert.deepEqual(
    normalizeLessonVideoUrl("https://res.cloudinary.com/drj7eidzs/video/upload/v123/videos/lesson.mp4"),
    {
      provider: "cloudinary",
      videoUrl: "https://res.cloudinary.com/drj7eidzs/video/upload/v123/videos/lesson.mp4",
    },
  );
  assert.equal(normalizeLessonVideoUrl(""), null);
});

test("rejects unsupported or malformed lesson video URLs", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://youtu.be/abcdefghijk",
    "https://youtube.com/watch?v=invalid",
    "https://youtube.com.evil.example/watch?v=abcdefghijk",
    "https://example.com/video.mp4",
    "https://res.cloudinary.com/example/video/upload/v123/videos/lesson.mp4",
    "https://res.cloudinary.com/example/image/upload/picture.jpg",
  ]) {
    assert.throws(() => normalizeLessonVideoUrl(url));
  }
});


test("normalizes course lessons and generates stable default IDs", () => {
  const { normalizeCourseLessons } = require("../lib/learning-policy.js");
  assert.deepEqual(normalizeCourseLessons([
    { title: "  Welcome  ", videoUrl: "https://youtu.be/abcdefghijk" },
    { id: "lesson-2", title: "Reading", type: "text", content: "Hello" },
  ]), [
    {
      id: "lesson_1",
      title: "Welcome",
      type: "video",
      mediaProvider: "youtube",
      videoUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
      youtubeVideoId: "abcdefghijk",
    },
    { id: "lesson-2", title: "Reading", type: "text", content: "Hello" },
  ]);
});

test("rejects duplicate or malformed course lesson fields instead of silently dropping them", () => {
  const { normalizeCourseLessons } = require("../lib/learning-policy.js");
  assert.throws(() => normalizeCourseLessons([
    { id: "same", title: "First" },
    { id: "same", title: "Second" },
  ]), /duplicated/);
  assert.throws(() => normalizeCourseLessons([{ title: "Too much content", content: "x".repeat(50001) }]), /content/);
  assert.throws(() => normalizeCourseLessons([{ title: "Too much description", description: "x".repeat(12001) }]), /description/);
  assert.throws(() => normalizeCourseLessons([{ title: "Wrong type", content: 123 }]), /content/);
  assert.throws(() => normalizeCourseLessons([{ title: "Wrong ID", id: 12 }]), /ID/);
  assert.throws(() => normalizeCourseLessons([]), /between 1 and 500/);
});

test("rejects course lesson payloads that exceed the safe Firestore document budget", () => {
  const { normalizeCourseLessons } = require("../lib/learning-policy.js");
  const oversized = Array.from({ length: 15 }, (_, i) => ({
    id: \`lesson_\${i}\`,
    title: \`Lesson \${i}\`,
    content: "x".repeat(49000),
  }));
  assert.throws(() => normalizeCourseLessons(oversized), /700 KB maximum/);
});
