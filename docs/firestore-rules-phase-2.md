# Firestore authorization — Phase 2 (staged)

Branch: `feat/skillforge-development`

## Scope and rollout boundary

This is a proposed repository ruleset and Emulator Suite test pack. It has **not** been published to Firebase. The Firebase Console previously showed a rules editor in a "Develop/Test" view; that alone does not establish whether the pasted rules were published. Inspect the live published version and compare it before any deployment.

The rules deliberately use least privilege for sensitive collections:
- Users can read only their own full profile; collection listing is denied.
- Client profile creation permits the `student` role only. Instructor role provisioning must be trusted/admin-controlled; the current registration UI offers self-selected instructor role and will need a handoff to Adechris or an approval flow before this ruleset can be rolled out.
- Instructors can create courses only for their own UID and edit/delete only their own courses. Authenticated course catalogue reads remain allowed for compatibility with the existing browser flow. This does not yet protect lesson arrays/media embedded in course documents; Phase 3 must split or securely deliver protected content.
- Payment documents are readable only by their owner and are server-write-only. Firebase Admin SDK callables bypass Firestore rules. The browser's existing direct payment writes will fail under these rules, so Phase 1 frontend integration must be completed before rollout.
- Enrollment reads are scoped to the student or the course owner; browser writes are denied until a trusted enrollment callable is implemented in Phase 3.
- Conversation members may read conversations/messages. Client conversation updates may change only last-message preview fields; message sender UID must match Auth.
- Cohorts, cohort enrollments, broadcasts and all unreviewed collections are denied by default. Their current browser helpers need backend contracts before these features can be enabled securely.

## Run the tests

Requires Firebase CLI and the npm package dependencies installed in the project root.

```sh
npm install
npm run test:rules
```

The test script starts the Firestore emulator temporarily and runs `rules-tests/firestore.rules.test.mjs`. The tests use a demo project ID and do not connect to or modify the live `mylms-c74a7` project.

## Rollout gates

Do not deploy until:
1. Live published rules have been confirmed and compared with this candidate.
2. Emulator tests pass.
3. Instructor role provisioning is defined; public self-assignment is not allowed.
4. Adechris has integrated the payment intent/verification callables, because browser writes to `payments` are denied.
5. A trusted enrollment operation exists, because browser enrollment writes are denied.
6. Existing application paths for cohorts/broadcasts and user directory are either migrated to safe backend contracts or explicitly disabled.
7. Course lesson/media protection is designed in Phase 3.
