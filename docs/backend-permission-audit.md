# SkillForge Frontend Data Operations and Backend Permission Audit

**Audit branch:** `feat/skillforge-development`  
**Audit baseline:** frontend code at `a2fe1c2812350faeedea67ea3f206964bc8ea6a2`, with the initial checkout/backend slice applied on this branch  
**Scope:** frontend routes, AuthContext, Firestore helper operations, course pages, messages, profile/settings, storage helpers, and checkout.  
**Important limitation:** this is a source-code audit, not a live Firebase project/rules audit. No `firestore.rules`, `storage.rules`, existing deployed rules, or Firebase project access configuration were present in the inspected branch. Therefore current server-side enforcement cannot be confirmed.

## Executive summary

The application is currently a client-heavy Firebase app. Firebase Auth handles identity, but most data operations are performed directly by the browser through the Firestore SDK. The route guards in `src/App.tsx` improve navigation UX; they are not security boundaries. Every permission listed below must be enforced by Firestore/Storage rules or trusted Cloud Functions.

### Priority findings

| Priority | Finding | Required action |
|---|---|---|
| Critical | User registration writes the requested role directly to `users/{uid}`. A client must not be able to self-assign instructor/admin privileges. | Trusted account-creation policy; role immutable to clients. Decide whether instructor registration is open or approval-based. |
| Critical | Enrollment creation is client-side and accepts client-supplied student, instructor, and course metadata. | Trusted enrollment function; validate published course, current UID, price/payment entitlement, idempotency, and enrollment eligibility. |
| Critical | Course learning fetches a course document by ID without checking enrollment in the component. | Enforce course/lesson access in server-side rules or a trusted content endpoint. Public course catalog metadata and paid lesson content should be separated if access differs. |
| Critical | Course create/edit writes are client-side; edit uses direct `updateDoc`. | Enforce instructor ownership and allowed fields in rules; consider a callable for publish/status and sensitive course changes. |
| Critical | Browser can create arbitrary payment records with client-supplied amount/status/reference unless rules prevent it. | Prefer callable `createPaymentIntent` that derives UID, price, currency, and reference server-side. Client may never set completed status. |
| High | Profile helper spreads arbitrary fields into `users/{uid}`; it could change role or entitlement unless rules constrain field updates. | Allowlist profile fields only; protect role, subscription, billing, and moderation fields. |
| High | Instructor Students and Messaging call `getAllUsers()`, which reads every user profile. | Replace with narrowly scoped directory/search endpoint or queries returning only safe fields for eligible users. |
| High | Conversation creation and message sending are client-side; message sender ID/name are client-supplied. | Enforce membership and sender UID; use trusted server timestamp and derive sender identity from Auth. Validate message length and member count. |
| High | Storage upload paths must be tied to ownership, type, and size. | Inspect `src/lib/storage.ts` paths and enforce them in Storage rules, with MIME/size limits. |
| High | Forgot Password page only flips local UI state; it does not call Firebase password reset. | Wire Firebase Auth `sendPasswordResetEmail` and handle errors without revealing whether an account exists. |
| High | Learning progress is calculated from local lesson index; no persistent progress write was found in the inspected learning page. | Add per-user/per-course progress model and enforce writes only by that student. |
| Medium | Cohort and broadcast helpers exist in `src/lib/firestore.ts` but were not found in the main route list as used pages. | Confirm intended feature scope before securing or removing them; if retained, restrict cohort management and broadcasts to authorized instructors/admins. |
| Medium | Payment status helper allows client updates to failed/cancelled. | Rules should still prevent arbitrary status changes; preferably let the server reconcile transaction status to avoid a forged callback incorrectly closing a pending transaction. |

## Route and operation inventory

### Authentication and identity

| Frontend surface / operation | Data access | Required permission / rule |
|---|---|---|
| Register (`AuthContext.register`) | Firebase Auth account creation; client writes `users/{uid}` with name/email/role | Auth user may create only their own profile. UID must equal document ID; email must match verified/auth email. Role must be assigned/validated by trusted policy, not accepted blindly from client. |
| Login / logout | Firebase Auth SDK | Firebase Auth owns authentication. Firestore rules must rely on `request.auth.uid`, not UI state. |
| Auth state / refresh user | Read `users/{uid}` | Signed-in user may read their own full profile; public/instructor directory should use a separate safe projection. |
| Change password | Firebase Auth reauthentication and `updatePassword` | Auth provider enforces reauthentication; do not store passwords in Firestore. |
| Forgot password | Current page only changes local UI state | Connect to Firebase Auth reset email flow; generic response to avoid account enumeration. |
| Route guards | Role check from client-loaded user document | UX only. Rules/functions must independently verify identity and role. |

### Profiles and storage

| Operation | Data access | Required permission / rule |
|---|---|---|
| Save name/bio/avatar (`updateUserProfile`) | Client updates `users/{uid}` using object spread | Only owner may update allowlisted profile fields. Deny changes to `role`, email verification, subscription/payment/entitlement fields, moderation flags, and server-managed timestamps. |
| Upload profile photo | Cloudinary via `uploadProfilePhoto` | Auth UID must own the path; allow image MIME types and strict size limit; deny arbitrary path writes. |
| Upload course thumbnail | Firebase Storage via `uploadCourseImage` | Authenticated instructor must own the course/path; image MIME and size limits. |
| Upload lesson video | Firebase Storage via `uploadVideo` | Course owner only; video MIME allowlist and size limits. Protect download/read access according to course publication/enrollment policy. |

### Courses and lessons

| Operation / surface | Data access | Required permission / rule |
|---|---|---|
| Browse courses | `getCourses()` reads all `courses` | Students/public visitors should read only published catalog fields. Drafts and unpublished lesson assets must not be exposed. |
| Instructor course list/dashboard/analytics | `getInstructorCourses(uid)` filters courses by instructorId | Instructor may read own courses; rules must ensure the stored owner field cannot be forged. |
| Create course | `createCourse(data)` adds client-supplied course document | Authenticated instructor only; server/rules derive owner UID from Auth; validate schema, price, title, lesson fields, publication state and timestamps. |
| Edit course | `EditCourse.tsx` directly reads and updates `courses/{id}` | Only course owner (or explicit admin) may read/edit draft; allowlist editable fields; protect owner ID, sales counts, access status and server-managed fields. |
| Learn course | `CourseLearning.tsx` directly reads `courses/{courseId}` and lessons | Verify published status and active enrollment/entitlement before returning protected lesson content. Client route protection alone is insufficient. |
| Lesson progress | Current page uses `currentLesson` local state and computes percentage from position | Persist progress per UID/course. Student can update only their own progress; completed lesson IDs must belong to that course; server timestamps preferred. |

### Enrollments and learner records

| Operation / surface | Data access | Required permission / rule |
|---|---|---|
| Enroll student | `enrollInCourse(studentId, courseId, instructorId, courseData)` client `setDoc` to `enrollments/{studentId}_{courseId}` | Trusted function should derive student UID, read course owner/status/price, validate access or payment, use deterministic ID for idempotency, and copy only server-validated metadata. |
| Student dashboard/my courses/progress | `getStudentEnrollments(uid)` | Student may read own enrollments. Instructor may read enrollments only for courses they own. |
| Instructor dashboard/analytics/students | `getInstructorEnrollments(uid)` | Instructor can read learner data only for their own courses. Query constraints must align with rule conditions. |
| Course enrollment list | `getCourseEnrollments(courseId)` | Only course owner/admin and the enrolled student where appropriate; avoid exposing all learner records to unrelated instructors/students. |
| Student directory | `getAllUsers()` from instructor Students page | Do not grant global user collection reads to make this work. Use an endpoint/query that returns minimal profile fields for students enrolled in that instructor's courses. |

### Messaging

| Operation | Data access | Required permission / rule |
|---|---|---|
| Find/create conversation | Reads conversations with `memberIds array-contains userId`, then client `addDoc` with member IDs/names | Requester must be authenticated and included in members; validate other user is eligible for contact; prevent duplicate conversation creation and arbitrary third-party membership. |
| Subscribe to conversations | Real-time query by `memberIds` | Only members may read; rules verify Auth UID is in `memberIds`. |
| Subscribe to messages | Reads `conversations/{id}/messages` ordered by creation time | Only conversation members may read messages. |
| Send message | Client `addDoc` with senderId/name/text, then updates parent lastMessage fields | Only members may write; sender UID must equal Auth UID; validate text/length; server timestamps and safe parent preview updates should be server-managed or tightly validated. Avoid separate writes that can leave parent preview inconsistent. |
| Recipient selection | `getAllUsers()` | Replace broad profile read with eligible contacts/limited directory. |

### Payments and entitlements

| Operation | Data access | Required permission / rule |
|---|---|---|
| Create pending payment | Client `addDoc` to `payments` with amount, currency, type, email, reference and status | Prefer callable that derives UID and canonical amount/currency/type and creates a unique pending payment. If temporary client creation remains, rules must restrict owner, allowed fields and pending-only status. |
| Verify success | `verifyPaystackPayment` callable in `functions/src/index.ts` | Authenticated owner only; server secret from Functions secret; independently verify Paystack reference, success, amount, currency and email. Server alone sets completed/verified fields. |
| Mark failed/cancelled | Client helper updates payment status from browser callback | Do not trust callback for final state; server should reconcile via provider verification/webhook. At minimum, clients must not set completed, verifiedAt, transaction IDs, or entitlements. |
| Read payment history | `getUserPayments(uid)` | User may read only own payment records; no arbitrary UID access. |
| Lookup by reference | `getPaymentByReference(reference)` | No public arbitrary-reference lookup; if needed, enforce owner through callable and return minimal result. |
| Monthly subscription | Verification callable updates `users/{uid}` subscription fields after verified monthly payment | Server-managed entitlement only. Course/content rules must check active, unexpired subscription or enrollment. One-on-one payment must not automatically grant a monthly subscription. |

### Cohorts and broadcasts (helper functions present)

| Operation | Data access | Required permission / rule |
|---|---|---|
| Create/list cohorts | `createCohort`, `getCohorts`, `getInstructorCohorts` | Define who may create cohorts; instructor may edit/read own cohorts; published cohort visibility can be broader. |
| Add student to cohort | Client updates cohort count and creates `cohort_enrollments` record in separate writes | Trusted atomic function; validate cohort owner/status/capacity, student identity, duplicates; update count transactionally. |
| Read cohort members | `getCohortStudents`, `getStudentCohorts` | Student reads own memberships; cohort owner reads members of own cohorts. |
| Send/read broadcasts | Client `addDoc` to `broadcasts`; `getBroadcasts` reads all | Define admin-only vs instructor-to-own-cohort audience; never trust client-supplied sender identity or recipient list. Use server-side authorization and targeted delivery. |



## Frontend boundary and handoff to Adechris

**Ownership rule:** this branch's remaining implementation work is backend-only. Do not edit existing frontend files to accommodate backend implementation. If an existing UI or client call must change, report it to the project owner with the exact file, current behavior, and proposed adjustment so Adechris can make the frontend change.

### Frontend changes to discuss with Adechris (not implemented here)

| Frontend file / area | Why a change may be needed | Suggested handoff |
|---|---|---|
| `src/pages/auth/ForgotPassword.tsx` | Current page appears to show a local success state without invoking Firebase Auth. | Connect the existing form to `sendPasswordResetEmail`; show a generic response and handle errors without account enumeration. |
| `src/pages/student/CourseLearning.tsx` | It reads a course document directly and uses local lesson-position state for progress. | Route protected lesson retrieval through the approved backend access flow, and call the backend progress operation when progress changes. Preserve the existing UI. |
| `src/pages/auth/Register.tsx` and `src/contexts/AuthContext.tsx` | Registration currently offers student/instructor role selection and writes the selected role from the client. | Keep the existing UI if desired, but role assignment must be decided by server policy. If instructors require approval, explain the approval state in the UI. |
| `src/pages/instructor/CreateCourse.tsx`, `src/pages/instructor/EditCourse.tsx` | These pages write course documents from the browser. | Replace direct trusted writes with calls to backend course operations once their API contract is agreed; keep form layout and visual design unchanged. |
| `src/components/Checkout.tsx` | The previous implementation trusted the browser callback for completion. | Use the server verification flow; do not grant access based only on the callback. Coordinate any required client integration with Adechris. |
| `src/pages/shared/Messages.tsx` | Conversation/message fields are currently client-supplied, and recipient selection appears to read all users. | Use the authorized contact list and messaging operations from the backend; do not expose the whole user collection. |
| Instructor/student course and progress pages | These depend on the current Firestore helper return shapes. | Agree the backend response shapes before changing client calls. If a response contract changes, document the exact adjustment for Adechris rather than editing frontend here. |

No frontend changes should be made as part of the remaining backend tasks. Existing UI can continue to be used while backend interfaces are designed; integration changes should be handed off, not silently applied.

## Recommended authorization model

1. **Identity:** every protected operation requires Firebase Auth; use `request.auth.uid` as the source of identity.
2. **Roles:** `student` and `instructor` are not user-editable profile fields. Any admin role must be assigned only by trusted administrators/server.
3. **Ownership:** instructors may modify only courses/cohorts whose immutable owner ID equals their UID.
4. **Published content:** browse access may expose published course summaries; lesson content/media requires active enrollment or a valid active subscription, unless the product explicitly marks a lesson as free.
5. **Enrollment:** only a trusted function creates paid enrollments or changes membership; operations must be idempotent and atomic.
6. **Payments:** browser may initiate checkout, but only trusted server logic can mark payment completed or write entitlements. Price/type/currency are canonical server constants.
7. **Student privacy:** a student reads their own profile, payments, enrollments and progress. An instructor reads only learner records associated with their courses.
8. **Messaging:** conversation members only; sender UID comes from Auth; recipients must satisfy product contact rules.
9. **Storage:** UID/course ownership, MIME, size, and access status enforced in Storage rules. Do not assume a hard-to-guess download URL is authorization.
10. **Server-managed fields:** clients cannot set roles, subscription state, payment verification metadata, course ownership, cohort counts, or privileged audit fields.

## Suggested implementation sequence

1. Confirm the intended product policy for open instructor registration, free/public lessons, course pricing, and the meaning of the one-on-one payment.
2. Obtain read-only access to the actual Firebase project and inspect existing Firestore/Storage rules, Auth providers, indexes, and existing data schema. Do not deploy over existing rules blindly.
3. Add tests/emulator setup and implement Firestore/Storage rules from the matrix.
4. Add callable functions for payment intent creation, enrollment, course publication/ownership-sensitive writes, progress updates, cohort membership, and messaging operations as required by the final policy.
5. Refactor client helpers to use those functions where trusted validation is required.
6. Run typecheck/build/lint and Emulator Suite tests for allowed and denied cases before any deployment.

## Audit status

- Frontend operation inventory: **PARTIAL — reviewed main routed pages and `src/lib/firestore.ts` helpers; nested components and all potential unused modules still require a repository-wide second pass.**
- Current deployed security rules: **UNKNOWN — not present in branch and not inspected in Firebase console.**
- Security enforcement: **NOT VERIFIED.**
- Deployment: **NOT PERFORMED.**
