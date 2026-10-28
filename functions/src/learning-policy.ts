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

export type LessonMediaProvider = "youtube" | "cloudinary";

export interface NormalizedLessonMedia {
  provider: LessonMediaProvider;
  videoUrl: string;
  videoId?: string;
}

/**
 * Accepts supported YouTube links and HTTPS Cloudinary video delivery URLs.
 * YouTube links are normalized to a privacy-enhanced embed URL; this does not
 * make the underlying YouTube video private or prevent link sharing.
 */
export function normalizeLessonVideoUrl(value: unknown): NormalizedLessonMedia | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.length > 2048) throw new Error("Lesson video URL is too long.");

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Lesson video URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Lesson video URL must be a valid HTTPS URL.");
  }

  const host = url.hostname.toLowerCase();
  const youtubeHosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "www.youtube-nocookie.com",
    "youtube-nocookie.com",
  ]);

  if (youtubeHosts.has(host)) {
    let videoId = "";
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/);
      videoId = match?.[1] ?? "";
    }

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      throw new Error("Use a valid YouTube watch, share, shorts, or embed URL.");
    }

    return {
      provider: "youtube",
      videoId,
      videoUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  }

  if (host === "res.cloudinary.com") {
    const segments = url.pathname.split("/").filter(Boolean);
    const videoUploadIndex = segments.findIndex((segment, index) =>
      segment === "video" && segments[index + 1] === "upload"
    );
    if (segments.length < 5 || segments[0] !== "drj7eidzs" || videoUploadIndex < 0) {
      throw new Error("Use a Cloudinary HTTPS video delivery URL.");
    }
    return { provider: "cloudinary", videoUrl: url.toString() };
  }

  throw new Error("Lesson videos must use a supported YouTube or Cloudinary URL.");
}


export interface NormalizedCourseLesson {
  id: string;
  title: string;
  type: string;
  mediaProvider?: LessonMediaProvider;
  videoUrl?: string;
  youtubeVideoId?: string;
  duration?: string;
  content?: string;
  description?: string;
}

/**
 * Validates and normalizes lesson data before it is stored in one Firestore
 * document. The aggregate byte limit leaves room below Firestore's 1 MiB
 * document-size ceiling for course-content metadata and serialization overhead.
 */
export function normalizeCourseLessons(value: unknown): NormalizedCourseLesson[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new Error("A course must contain between 1 and 500 lessons.");
  }

  const seenIds = new Set<string>();
  const lessons = value.map((lesson: unknown, index: number): NormalizedCourseLesson => {
    if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
      throw new Error(`Lesson ${index + 1} is invalid.`);
    }
    const item = lesson as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const type = item.type === undefined ? "video" : item.type;
    const id = item.id === undefined ? `lesson_${index + 1}` : item.id;
    const videoUrl = item.videoUrl === undefined ? "" : item.videoUrl;
    const duration = item.duration === undefined ? "" : item.duration;

    if (!title || title.length > 180) {
      throw new Error(`Lesson ${index + 1} title must contain 1–180 characters.`);
    }
    if (typeof type !== "string" || !type.trim() || type.length > 40) {
      throw new Error(`Lesson ${index + 1} type is invalid.`);
    }
    if (typeof id !== "string" || !id.trim() || id.trim().length > 150) {
      throw new Error(`Lesson ${index + 1} ID is invalid.`);
    }
    const normalizedId = id.trim();
    if (seenIds.has(normalizedId)) {
      throw new Error(`Lesson ID "${normalizedId}" is duplicated.`);
    }
    seenIds.add(normalizedId);

    if (typeof videoUrl !== "string" || videoUrl.trim().length > 2048) {
      throw new Error(`Lesson ${index + 1} video URL is invalid or too long.`);
    }
    if (typeof duration !== "string" || duration.length > 100) {
      throw new Error(`Lesson ${index + 1} duration is invalid or too long.`);
    }
    if (item.content !== undefined &&
        (typeof item.content !== "string" || item.content.length > 50000)) {
      throw new Error(`Lesson ${index + 1} content must be text of at most 50000 characters.`);
    }
    if (item.description !== undefined &&
        (typeof item.description !== "string" || item.description.length > 12000)) {
      throw new Error(`Lesson ${index + 1} description must be text of at most 12000 characters.`);
    }

    const normalized: NormalizedCourseLesson = {
      id: normalizedId,
      title,
      type: type.trim(),
    };
    const cleanVideoUrl = videoUrl.trim();
    if (cleanVideoUrl) {
      let media: NormalizedLessonMedia;
      try {
        const parsed = normalizeLessonVideoUrl(cleanVideoUrl);
        if (!parsed) throw new Error("Video URL is empty.");
        media = parsed;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Video URL is invalid.";
        throw new Error(`Lesson ${index + 1}: ${message}`);
      }
      normalized.mediaProvider = media.provider;
      normalized.videoUrl = media.videoUrl;
      if (media.videoId) normalized.youtubeVideoId = media.videoId;
    }
    if (duration) normalized.duration = duration;
    if (typeof item.content === "string") normalized.content = item.content;
    if (typeof item.description === "string") normalized.description = item.description;
    return normalized;
  });

  const serializedBytes = new TextEncoder().encode(JSON.stringify(lessons)).length;
  if (serializedBytes > 700_000) {
    throw new Error("Lesson content is too large to store safely in one course document (700 KB maximum).");
  }

  return lessons;
}
