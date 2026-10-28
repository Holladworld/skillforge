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

Requires authentication and verifies that the course is free or the caller has an active, unexpired monthly subscription before returning course details and lesson data. A completed `one_on_one` payment does not grant course access.

### `saveLearningProgress({ courseId, currentLessonIndex, completedLessonIndexes })`

Requires authentication and the same course-access check. The server validates all lesson indexes against the actual course lesson count, deduplicates completed indexes, calculates the progress percentage, and writes to `learning_progress/{uid}_{courseId}`. The client cannot supply the stored UID or calculated percentage.

### `getLearningProgress({ courseId })`

Returns only the authenticated user's progress record for the requested course.

## Important rollout and security limitations

- These functions use the Admin SDK, so Firestore rules do not authorize their internal reads/writes. Callable authentication and explicit checks are required.
- The current frontend still reads `courses/{courseId}` directly and embeds lesson data/video URLs in the course document. The current candidate rules allow signed-in reads of course documents. Therefore **the new access callable does not yet secure the existing direct-read path**.
- Before claiming lesson protection, Adechris must route learning-page reads/progress through these callables, and the data/rules design must prevent direct reads of protected lesson payloads. Public Cloudinary video URLs also need a separate access-control strategy; a callable cannot make an already-public URL private.
- The existing frontend enrollment helper must call `createEnrollment({ courseId })`; it must stop writing the enrollment document directly. This is a handoff only; frontend files have not been changed.
- The Firestore rules candidate has not been emulator-tested because Java is not installed, and it has not been deployed. Do not deploy it until the emulator tests pass and the live published rules are confirmed.
- No Firebase deployment or live data migration was performed.
