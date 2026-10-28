export function isFreeCoursePrice(price: unknown): boolean {
  if (typeof price === "number") {
    return Number.isFinite(price) && price === 0;
  }
  if (typeof price !== "string") return false;

  const value = price.trim().toLowerCase();
  if (value === "free") return true;
  if (!value) return false;

  const normalized = value
    .replace(/[\s,₦$€£]/g, "")
    .replace(/^(ngn|usd|eur|gbp)/, "");

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return false;
  return Number(normalized) === 0;
}

export function hasActiveSubscription(
  status: unknown,
  expiryMillis: unknown,
  nowMillis: number,
): boolean {
  return status === "active" &&
    typeof expiryMillis === "number" &&
    Number.isFinite(expiryMillis) &&
    expiryMillis > nowMillis;
}

export interface NormalizedLearningProgress {
  currentLessonIndex: number;
  completedLessonIndexes: number[];
  progressPercent: number;
}

export function normalizeLearningProgress(
  currentLessonIndex: unknown,
  completedLessonIndexes: unknown,
  lessonCount: number,
): NormalizedLearningProgress {
  if (!Number.isInteger(lessonCount) || lessonCount < 1 || lessonCount > 500) {
    throw new Error("Course lesson count is invalid.");
  }
  if (
    !Number.isInteger(currentLessonIndex) ||
    (currentLessonIndex as number) < 0 ||
    (currentLessonIndex as number) >= lessonCount
  ) {
    throw new Error("Current lesson index is outside this course.");
  }
  if (!Array.isArray(completedLessonIndexes) || completedLessonIndexes.length > lessonCount) {
    throw new Error("Completed lesson indexes must be a valid list.");
  }

  const uniqueIndexes = new Set<number>();
  for (const index of completedLessonIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= lessonCount) {
      throw new Error("A completed lesson index is outside this course.");
    }
    uniqueIndexes.add(index);
  }

  const completed = [...uniqueIndexes].sort((a, b) => a - b);
  return {
    currentLessonIndex: currentLessonIndex as number,
    completedLessonIndexes: completed,
    progressPercent: Math.round((completed.length / lessonCount) * 100),
  };
}
