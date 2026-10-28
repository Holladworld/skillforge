import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function arg(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
}

const projectId = arg("project");
const confirmedProjectId = arg("confirm-project-id");
const apply = process.argv.includes("--apply");

if (!projectId) {
  console.error("Usage: node scripts/migrate-course-content.mjs --project=PROJECT_ID [--apply --confirm-project-id=PROJECT_ID]");
  process.exit(2);
}
if (apply && confirmedProjectId !== projectId) {
  console.error("Refusing to apply: --confirm-project-id must exactly match --project.");
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

console.log(`Project: ${projectId}`);
console.log(`Mode: ${apply ? "APPLY" : "DRY RUN (no writes)"}`);

const courses = await db.collection("courses").get();
let candidates = 0;
let migrated = 0;
let alreadySeparated = 0;
let conflicts = 0;
let empty = 0;

for (const courseDoc of courses.docs) {
  const data = courseDoc.data();
  if (!Array.isArray(data.lessons) || data.lessons.length === 0) {
    empty += 1;
    continue;
  }

  candidates += 1;
  const contentRef = db.collection("course_contents").doc(courseDoc.id);
  const contentSnapshot = await contentRef.get();

  if (contentSnapshot.exists) {
    alreadySeparated += 1;
    console.log(`SKIP ${courseDoc.id}: protected content already exists; legacy lesson field was left untouched for manual reconciliation.`);
    conflicts += 1;
    continue;
  }

  console.log(`${apply ? "MIGRATE" : "WOULD MIGRATE"} ${courseDoc.id}: ${data.lessons.length} lesson(s)`);
  if (!apply) continue;

  const batch = db.batch();
  batch.create(contentRef, {
    courseId: courseDoc.id,
    instructorId: typeof data.instructorId === "string" ? data.instructorId : "",
    lessons: data.lessons,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    migratedAt: FieldValue.serverTimestamp(),
    migrationVersion: 1,
  });
  batch.update(courseDoc.ref, { lessons: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  migrated += 1;
}

console.log(JSON.stringify({
  scanned: courses.size,
  candidates,
  migrated,
  alreadySeparated,
  conflicts,
  noLegacyLessons: empty,
  mode: apply ? "apply" : "dry-run",
}, null, 2));

if (conflicts > 0) {
  console.error("Conflicts require manual review. No existing course_contents document was overwritten.");
  process.exitCode = 1;
}
