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

The caller must be authenticated, have `users/{uid}.role == "instructor"`, have a server-provisioned `instructorApprovedAt` timestamp, and own the target course. The callable validates the course ID, metadata lengths, lesson count, lesson fields, unique lesson IDs, and supported video URL formats. It does not accept a replacement instructor ID, student count, rating, or creation timestamp.

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


## Code-review follow-up

The shared lesson validator now serves both course creation and editing. It rejects duplicate/invalid lesson IDs, malformed field types, oversized lesson content/descriptions, unsupported video URLs, and combined lesson payloads above 700 KB (to leave margin below Firestore's 1 MiB document limit). Course metadata now rejects malformed, negative, and non-finite prices while accepting the price formats used by the current editor.

Enrollment now refuses to create a record until non-empty protected lesson content exists, preventing an enrollment from succeeding for a course that the learning-content callable cannot yet serve. Paystack verification also requires the verified transaction email to match the payment intent email.

New unit tests cover lesson normalization, duplicate IDs, invalid/oversized content, aggregate payload size, and course-price validation. **These newly added tests have not yet been run in the user's local environment.** Firestore callable integration tests and emulator rules tests remain outstanding.

## Trusted instructor provisioning

The current candidate rules allow users to create student profiles only; instructor status must be granted through a trusted administrative path. A guarded script is available at `functions/scripts/provision-instructor.mjs`. It requires an existing profile, a verified Firebase Auth email, and a matching profile email. Both course-management callables require the server-written `instructorApprovedAt` timestamp and a separate `instructor_access/{uid}` approval record, so changing profile fields alone is insufficient. The candidate rules deny browser access to that collection. It defaults to dry-run; writes require both `--apply` and an exact `--confirm-project-id` match. It writes the profile marker and the separate server-only approval record atomically.

Example dry run:

```sh
cd functions
npm run provision:instructor -- --project=PROJECT_ID --uid=FIREBASE_UID
```

Only after reviewing the output should an authorized operator run the same command with `--apply --confirm-project-id=PROJECT_ID`. This script has not been run against any project. Do not provision instructors or deploy the rules/functions until the target project and current published rules are confirmed.
