# Backend Phase 3: Enrollment, Learning Access, and Progress

Branch: `feat/skillforge-development`

## Implemented callable contracts

### `createEnrollment({ courseId })`

Requires Firebase Authentication. The callable derives the student UID from the auth context and reads the course and user profile from Firestore. It permits enrollment only when the course has an explicit zero price or the user's monthly subscription is active and unexpired. It uses the existing deterministic document ID `{uid}_{courseId}`, so repeated requests do not create duplicate enrollment records.

The enrollment document preserves the current frontend's fields:
- `studentId`, `courseId`, `instructorId`
- `courseTitle`, `courseThumbnail`, `instructorName`
- `progress`, `enrolledAt`

It also records `accessType` and `updatedAt`. Client-supplied user IDs, instructor IDs, title, thumbnail, price, and status are not trusted.

### `getCourseLearningContent({ courseId })`

Requires authentication and verifies that the course is free or the caller has an active, unexpired monthly subscription. It returns catalogue metadata from `courses/{courseId}` and lesson data from the separate `course_contents/{courseId}` document. A completed `one_on_one` payment does not grant course access. It fails closed if the protected content document is missing or malformed.

### `saveLearningProgress({ courseId, currentLessonIndex, completedLessonIndexes })`

Requires authentication and the same course-access check. The server validates all lesson indexes against the actual course lesson count, deduplicates completed indexes, calculates the progress percentage, and writes to `learning_progress/{uid}_{courseId}`. The client cannot supply the stored UID or calculated percentage.

### `getLearningProgress({ courseId })`

Returns only the authenticated user's progress record for the requested course.

## Important rollout and security limitations

- These functions use the Admin SDK, so Firestore rules do not authorize their internal reads/writes. Callable authentication and explicit checks are required.
- The candidate rules now treat `courses/{courseId}` as catalogue metadata and deny browser reads/writes to `course_contents/{courseId}`. The new `createCourseWithProtectedContent` callable writes catalogue metadata and lessons separately. These candidate rules are not deployed.
- Existing course documents may still have embedded `lessons`. The guarded migration script `functions/scripts/migrate-course-content.mjs` supports dry-run by default and only writes when both `--apply` and an exactly matching `--confirm-project-id` are supplied. Run a dry-run and inspect the target project before applying any migration. Existing `course_contents` documents are never overwritten; conflicts cause a non-zero exit and require manual reconciliation.
- Adechris must route course publishing and learning-page reads through `createCourseWithProtectedContent` and `getCourseLearningContent`; the current browser-side `createCourse` and direct `getDoc(courses/{id})` learning path are not compatible with the intended protected-content rules.
- Public Cloudinary video URLs still need a separate access-control strategy. Separating lesson documents prevents direct Firestore reads, but it does not make already-public video URLs private.
- The existing frontend enrollment helper must call `createEnrollment({ courseId })`; it must stop writing the enrollment document directly. This is a handoff only; frontend files have not been changed.
- The Firestore rules candidate has not been emulator-tested because Java is not installed, and it has not been deployed. Do not deploy it until the emulator tests pass and the live published rules are confirmed.
- No Firebase deployment or live data migration was performed.
