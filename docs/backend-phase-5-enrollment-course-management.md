# Backend Phase 5: Enrollment and Protected Course Editing

Branch: `feat/skillforge-development`

## Added callable: `updateCourseWithProtectedContent`

Input:

```ts
{
  courseId: string;
  title: string;
  description: string;
  price: string | number;
  category: string;
  thumbnail: string;
  lessons: Array<{
    id?: string;
    title: string;
    type?: string;
    videoUrl?: string;
    duration?: string;
    content?: string;
    description?: string;
  }>;
}
```

The caller must be authenticated, have `users/{uid}.role == "instructor"`, and own the target course. The callable validates the course ID, metadata lengths, lesson count, lesson fields, unique lesson IDs, and supported video URL formats. It does not accept a replacement instructor ID, student count, rating, or creation timestamp.

The course metadata update and protected lesson update happen in one Firestore transaction. The callable refuses to edit if `course_contents/{courseId}` is missing or malformed; this avoids accidentally recreating content from a legacy document before the migration is reviewed. It returns `{ success, courseId, lessonCount }`.

## Existing enrollment callable

`createEnrollment({ courseId })` remains the trusted enrollment entry point. It derives the student from Firebase Auth, checks the course and profile, permits explicit zero-price courses or users with an active and unexpired monthly subscription, and uses deterministic `{uid}_{courseId}` IDs for idempotency.

## Adechris frontend handoff (no frontend files changed)

- Replace direct `createCourse()` writes with `createCourseWithProtectedContent`.
- Replace direct course edits that write `courses/{courseId}.lessons` with `updateCourseWithProtectedContent`.
- Replace direct enrollment writes with `createEnrollment({ courseId })`.
- Continue to use `getCourseLearningContent`, `saveLearningProgress`, and `getLearningProgress` for the learning flow.
- Handle callable errors (unauthenticated, permission-denied, failed-precondition, invalid-argument) in the UI.
- Course editing through the callable requires that the existing course has already been migrated to `course_contents`; show a clear migration-required message rather than silently falling back to direct writes.
- Do not change Cloudinary upload/delivery behavior in this phase. URL validation and protected Firestore storage do not by themselves make public Cloudinary URLs private.

## Verification and rollout status

- This commit has not been built or tested in the user's local environment. After pulling, run `cd functions && npm test`.
- Callable integration tests against Firestore are still needed for unauthenticated calls, non-instructor callers, non-owner edits, missing content, duplicate lesson IDs, invalid video URLs, and successful atomic metadata/content updates.
- Firestore rules emulator tests remain pending because the local Java runtime is unavailable.
- Candidate `firestore.rules` remains undeployed. Confirm the currently published rules and complete compatibility checks before deploying rules or functions.
- No deployment, live data migration, or frontend modification was performed.
