# Frontend adjustments required for secure backend integration

**Audience:** Adechris (frontend owner)  
**Rule:** These are recommendations only. The backend audit did not modify any frontend page or component. Agree on these interface changes before implementing the corresponding backend contracts.

## Required frontend handoff

| Priority | File / current behavior | Requested adjustment | Backend contract to coordinate |
|---|---|---|---|
| Critical | `src/contexts/AuthContext.tsx`: registration writes the selected `role` to `users/{uid}` | Keep the current UI if desired, but stop assuming the client-selected role is authoritative. Agree whether instructor signup is open, invite-only, or pending approval. Handle a backend-denied instructor registration. | Trusted profile/role provisioning; role assignment policy |
| Critical | `src/lib/firestore.ts`: `enrollInCourse(studentId, courseId, instructorId, courseData)` writes client-supplied enrollment data | Replace with a call that sends only the target course ID; backend derives the current student UID and course metadata. | `enrollInCourse({ courseId })` |
| Critical | `src/lib/firestore.ts`: `createPayment(paymentData)` lets the client supply amount, currency, status and reference | Replace with a server-created payment intent. Frontend should pass only payment type; use the returned canonical reference/amount for Paystack checkout. | `createPaymentIntent({ paymentType })` |
| Critical | `src/pages/student/CourseLearning.tsx`: fetches course by ID and uses embedded lesson data | Consume a protected content endpoint or an enrollment/entitlement check before rendering protected lesson data. Do not treat route access as authorization. | `getCourseContent({ courseId })` or secure per-course read model |
| High | `src/pages/auth/ForgotPassword.tsx`: submit handler only calls `setSent(true)` | Call Firebase Auth `sendPasswordResetEmail`; display a generic response and handle loading/error state. This is a functional frontend gap, not a Cloud Function requirement. | Firebase Auth client API |
| High | `src/pages/shared/Messages.tsx`: recipient picker calls `getAllUsers()` | Replace global user listing with a limited eligible-contact/directory request; display only safe profile fields returned by the backend. | `listMessageableUsers({ query? })` |
| High | `src/lib/firestore.ts`: `getOrCreateConversation` and `sendMessage` supply IDs/names from the browser | Call secure operations using conversation ID and message text only; backend derives sender UID/name and timestamps. | `getOrCreateConversation({ otherUserId })`, `sendMessage({ conversationId, text })` |
| High | `src/lib/firestore.ts`: `updateUserProfile(uid, data)` accepts arbitrary fields | Send only approved editable profile fields; do not send role, subscription, payment, verification, or admin fields. | `updateMyProfile({ name?, bio?, avatar? })` or equivalent allowlisted write |
| High | `src/pages/instructor/CreateCourse.tsx` / `EditCourse.tsx`: course data and media URLs are supplied from browser | Coordinate course creation/editing with immutable ownership. Backend should validate schema, ownership, publication state and asset references. Do not rely on caller-supplied `instructorId`. | `createCourse`, `updateCourse`, `publishCourse` contracts |
| High | `src/lib/storage.ts`: uploads directly to Cloudinary using unsigned preset `lms_uploads` | Review Cloudinary upload preset with the backend owner. For protected media, use signed uploads and protected delivery. Existing timestamp-based course/lesson IDs need to be reconciled with backend-owned IDs. | Signed upload authorization; asset metadata/ownership |
| High | `src/pages/student/CourseLearning.tsx`: progress appears to remain in local state | Persist progress when a lesson is completed or progress changes, and load it when resuming a course. | `saveLearningProgress({ courseId, completedLessonIds, lastLessonId })`, with server-side validation |
| Medium | Cohort helpers in `src/lib/firestore.ts`: `addStudentToCohort` takes student ID/name and writes enrollment/count separately | If cohorts are part of the active product, use a single trusted operation; UI should handle capacity, duplicate membership and permission errors. | `addStudentToCohort({ cohortId, studentId })` |
| Medium | Broadcast helpers in `src/lib/firestore.ts` | Confirm intended sender/recipient model before exposing the feature; UI should not be able to set privileged sender identity or arbitrary audiences. | `sendBroadcast` with server-derived sender and validated audience |

## Existing client operations that can remain client-side

These normally do not need custom Cloud Functions if the product uses Firebase Auth correctly and security rules enforce ownership:

- Sign in and sign out.
- Reauthenticate and change password through Firebase Auth.
- Read a user's own profile.
- Read a student's own enrollments and progress, where rules constrain access.
- Read published course catalog metadata.
- Subscribe to conversations/messages where Firestore rules verify conversation membership.

The rule is not “move every Firebase SDK call to a function.” Use Firestore direct access for safe, rule-enforceable reads/writes. Use trusted server operations where the operation changes roles, grants access, validates payment, controls membership, or requires atomic multi-document decisions.

## Backend API design contract

Proposed callable names above are not implemented contracts yet. Before frontend integration, agree the request/response schemas, error codes, and access behavior. The backend implementation should not silently break the existing UI; frontend changes should be made by Adechris against an agreed interface.

## Security note

Cloudinary is the current media provider in `src/lib/storage.ts`; Firebase Storage rules do not protect direct Cloudinary uploads. Review the upload preset and whether course videos are publicly deliverable before making paid-course access promises.
