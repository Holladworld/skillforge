import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
const userSnapshot = await userRef.get();
if (!userSnapshot.exists) {
  console.error("Refusing to provision: the user Firestore profile does not exist.");
  process.exit(2);
}

const profile = userSnapshot.data();
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

if (profile.role === "instructor") {
  console.log("No change needed: this profile is already an instructor.");
} else if (!apply) {
  console.log("Would set role to instructor and record instructorApprovedAt.");
} else {
  await userRef.update({
    role: "instructor",
    instructorApprovedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log("Instructor role provisioned. No frontend or deployment changes were made.");
}
