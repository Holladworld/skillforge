# Backend Phase 4: Cloudinary Media Access Audit

Branch: `feat/skillforge-development`

## Audit result

**Status: media access is not protected yet.** This is a source-code audit only. The live Cloudinary account, upload preset configuration, asset access modes, and existing asset inventory were not inspected.

### Current code paths

- `src/lib/storage.ts` defines the Cloudinary cloud name and the unsigned preset `lms_uploads` in browser code.
- `uploadVideo()` sends the video directly from the browser to Cloudinary's `video/upload` endpoint, sets folder `videos`, and returns `data.secure_url`.
- `src/pages/instructor/CreateCourse.tsx` stores lesson video URLs and currently calls the browser-side `createCourse()`, persisting lessons inside `courses/{courseId}`.
- `src/pages/instructor/EditCourse.tsx` reads embedded lessons directly and writes them back to the course document.
- `src/pages/student/CourseLearning.tsx` reads `courses/{courseId}` directly and uses the saved URL as the HTML video source.
- The new `getCourseLearningContent()` callable checks the user's course-access eligibility before returning lessons from `course_contents/{courseId}`. It does not proxy or sign media delivery URLs.
- No Cloudinary API secret or Cloudinary-specific backend signing implementation was found in the inspected Functions source.

### Security implications

1. HTTPS (`secure_url`) encrypts transport; it does not make a publicly delivered asset private.
2. An unsigned upload preset is designed for browser uploads. Its exact restrictions cannot be inferred from its name; check the live preset's allowed formats, size limits, folder restrictions, overwrite behavior, and whether unsigned uploads are enabled.
3. If existing videos are public-delivery assets, hiding their URLs in Firestore will not revoke access to URLs already copied or shared.
4. A Cloudinary URL signature alone must not be treated as an access-control boundary if the same asset remains available through an unsigned public URL.
5. The current frontend's direct Firestore course read/write paths must be integrated with the protected-content callables before the candidate Firestore rules can safely be deployed.

## Recommended target design

### A. Verify Cloudinary configuration first

In the Cloudinary console, verify the `lms_uploads` preset and inspect a representative video asset's delivery/access type. Do not paste API secrets into chat, frontend files, or `VITE_*` variables.

### B. Protect future uploads

Use a backend-issued upload authorization or signed upload flow. Store Cloudinary's stable asset identifier (public ID), resource type, format, and delivery/access type with the lesson rather than relying solely on a copied URL. Keep thumbnails public if intended; apply the stricter policy to course video and other paid lesson media.

### C. Authorize media delivery

After verifying the account configuration and chosen Cloudinary delivery mode, implement a callable that:
- requires Firebase Authentication;
- loads the course and protected lesson metadata server-side;
- applies the same free-course / active-unexpired-monthly-subscription policy;
- validates that the requested asset belongs to that course;
- issues only a short-lived/signed delivery capability supported by the configured Cloudinary access mode;
- never accepts an arbitrary URL and signs it;
- never returns Cloudinary API credentials to the client.

A signed URL or token is a bearer capability while valid; use an appropriately short lifetime and avoid logging it.

### D. Migrate existing media deliberately

Before changing existing assets, inventory current video URLs and Cloudinary public IDs. Confirm whether the account supports changing existing assets to authenticated/private delivery without breaking playback. Plan for a staged migration and recovery path. Do not bulk-change access modes or delete existing assets until a representative test asset works end-to-end.

### E. Frontend handoff for Adechris (no frontend changes made here)

- Replace browser-side course creation with `createCourseWithProtectedContent()`.
- Replace direct learning-page reads of `courses/{courseId}` with `getCourseLearningContent()`.
- Replace direct course edits that write embedded `lessons` with a server-side course-update contract that writes catalogue metadata and protected lesson data separately.
- Have the video player request authorized media access from the backend rather than relying on a permanent public URL.
- Keep image/thumbnail delivery separate from lesson-video access policy.

## Validation and rollout gates

- [ ] Confirm the live `lms_uploads` preset and a representative video's delivery/access type.
- [ ] Choose and test the Cloudinary private/authenticated delivery mechanism on a non-production test asset.
- [ ] Add unit tests for access policy and asset ownership validation.
- [ ] Add callable integration tests for unauthenticated users, users without course access, entitled users, and arbitrary/foreign asset IDs.
- [ ] Coordinate frontend integration with Adechris.
- [ ] Inventory and back up existing course metadata and media references before any migration.
- [ ] Migrate legacy lesson content and media in a controlled sequence.
- [ ] Run Firestore emulator tests and confirm the currently published rules before any rules deployment.

## Change safety

This audit adds no application-code behavior. No frontend files were modified. No Cloudinary asset, Firebase document, security rule, or deployed function was changed.
