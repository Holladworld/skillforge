import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

function arg(name) {
  const prefix = "--" + name + "=";
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
}

const projectId = arg("project");
const uid = arg("uid");
const confirmedProjectId = arg("confirm-project-id");
const apply = process.argv.includes("--apply");

if (!projectId || !uid) {
  console.error("Usage: node scripts/provision-instructor.mjs --project=PROJECT_ID --uid=FIREBASE_UID [--apply --confirm-project-id=PROJECT_ID]");
  process.exit(2);
}
if (apply && confirmedProjectId !== projectId) {
  console.error("Refusing to apply: --confirm-project-id must exactly match --project.");
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

const authUser = await auth.getUser(uid);
if (!authUser.email || !authUser.emailVerified) {
  console.error("Refusing to provision: the Firebase Auth account must have a verified email address.");
  process.exit(2);
}

const userRef = db.collection("users").doc(uid);
const accessRef = db.collection("instructor_access").doc(uid);
const [userSnapshot, accessSnapshot] = await Promise.all([userRef.get(), accessRef.get()]);
if (!userSnapshot.exists) {
  console.error("Refusing to provision: the user Firestore profile does not exist.");
  process.exit(2);
}

const profile = userSnapshot.data();
const access = accessSnapshot.exists ? accessSnapshot.data() : undefined;
if (typeof profile.email !== "string" || profile.email.trim().toLowerCase() !== authUser.email.trim().toLowerCase()) {
  console.error("Refusing to provision: the profile email does not match Firebase Authentication.");
  process.exit(2);
}
if (profile.role !== "student" && profile.role !== "instructor") {
  console.error("Refusing to provision: the profile has an unexpected role; review it manually.");
  process.exit(2);
}

console.log("Project: " + projectId);
console.log("UID: " + uid);
console.log("Verified email: " + authUser.email);
console.log("Current role: " + profile.role);
console.log("Mode: " + (apply ? "APPLY" : "DRY RUN (no writes)"));

const alreadyApproved =
  profile.role === "instructor" &&
  profile.instructorApprovedAt instanceof Timestamp &&
  access?.approved === true &&
  access.approvedAt instanceof Timestamp;

if (alreadyApproved) {
  console.log("No change needed: this profile is already approved as an instructor.");
} else if (!apply) {
  console.log("Would set role to instructor, record instructorApprovedAt, and create the trusted instructor_access approval record.");
} else {
  const batch = db.batch();
  batch.update(userRef, {
    role: "instructor",
    instructorApprovedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(accessRef, {
    approved: true,
    approvedAt: FieldValue.serverTimestamp(),
    approvedEmail: authUser.email,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  console.log("Instructor role provisioned with a trusted approval record. No frontend or deployment changes were made.");
}
