# Backend Phase 3: Enrollment, Learning Access, and Progress

Branch: `feat/skillforge-development`

## Implemented callable contracts

### `createCourseWithProtectedContent({ title, description, price, category, thumbnail, lessons })`

Requires Firebase Authentication and a server-side `users/{uid}.role == "instructor"` profile. It writes only catalogue metadata to `courses/{courseId}` and stores lesson payloads in the server-only `course_contents/{courseId}` document. It does not trust a client-supplied instructor UID or instructor name. Lesson video URLs may use either supported YouTube URL forms (watch, share, shorts, live, or embed) or HTTPS Cloudinary video delivery URLs. The backend validates the host and format; YouTube links are normalized to the privacy-enhanced embed URL and stored with `mediaProvider: "youtube"` and `youtubeVideoId`. Cloudinary lessons are stored with `mediaProvider: "cloudinary"`. Adechris must render YouTube lessons with an iframe and Cloudinary lessons with the existing video player, and replace the existing browser-side `createCourse()` call with this callable before the stricter rules can be deployed.

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

## Legacy content migration (not run)

From the `functions` directory, first run a read-only dry run against the intended Firebase project:

```sh
npm run migrate:course-content -- --project=YOUR_PROJECT_ID
```

Review the output and confirm the project ID before any write. Only after an explicit approval to migrate that project, the write mode requires both flags:

```sh
npm run migrate:course-content -- --project=YOUR_PROJECT_ID --apply --confirm-project-id=YOUR_PROJECT_ID
```

The script uses Application Default Credentials. It does not deploy rules/functions. It copies legacy lesson arrays into `course_contents/{courseId}` and removes the embedded `lessons` field in one batch per course. Existing content documents are never overwritten; conflicts stop the script with a non-zero exit code. Do not run apply mode against production until the dry-run inventory and backup/recovery plan have been reviewed.

## Important rollout and security limitations

- These functions use the Admin SDK, so Firestore rules do not authorize their internal reads/writes. Callable authentication and explicit checks are required.
- The candidate rules now treat `courses/{courseId}` as catalogue metadata and deny browser reads/writes to `course_contents/{courseId}`. The new `createCourseWithProtectedContent` callable writes catalogue metadata and lessons separately. These candidate rules are not deployed.
- Existing course documents may still have embedded `lessons`. The guarded migration script `functions/scripts/migrate-course-content.mjs` supports dry-run by default and only writes when both `--apply` and an exactly matching `--confirm-project-id` are supplied. Run a dry-run and inspect the target project before applying any migration. Existing `course_contents` documents are never overwritten; conflicts cause a non-zero exit and require manual reconciliation.
- Adechris must route course publishing and learning-page reads through `createCourseWithProtectedContent` and `getCourseLearningContent`; the current browser-side `createCourse` and direct `getDoc(courses/{id})` learning path are not compatible with the intended protected-content rules.
- Public Cloudinary video URLs still need a separate access-control strategy. Separating lesson documents prevents direct Firestore reads, but it does not make already-public video URLs private. YouTube videos are also shareable and are not made private by embedding; the normalized embed URL is a playback format, not an entitlement boundary.
- The existing frontend enrollment helper must call `createEnrollment({ courseId })`; it must stop writing the enrollment document directly. This is a handoff only; frontend files have not been changed.
- The Firestore rules candidate has not been emulator-tested because Java is not installed, and it has not been deployed. Do not deploy it until the emulator tests pass and the live published rules are confirmed.
- No Firebase deployment or live data migration was performed.

## Lesson video source support

The backend accepts both of these source types for lesson video URLs:

- **YouTube:** standard watch links, `youtu.be` share links, Shorts, live links, and supported embed links. The stored lesson has `mediaProvider: "youtube"`, `youtubeVideoId`, and a normalized privacy-enhanced embed URL.
- **Cloudinary:** HTTPS URLs from the existing SkillForge Cloudinary cloud (`drj7eidzs`) that use the video upload/delivery path. URLs from other Cloudinary cloud names are rejected. The stored lesson has `mediaProvider: "cloudinary"` and the validated delivery URL.

The backend rejects unsupported hosts, non-HTTPS URLs, malformed YouTube IDs, and Cloudinary image/non-video paths. A blank video URL remains allowed for non-video/text lesson types.

**Frontend handoff:** Adechris must branch the player by `mediaProvider`: render YouTube with an iframe using the returned embed URL (or video ID), and render Cloudinary with the existing video element. The frontend has not been modified. YouTube privacy-enhanced embedding does not prevent viewers from sharing the video or accessing it outside SkillForge. Cloudinary URL validation is not media access control; authenticated delivery remains a separate Phase 4 task.
