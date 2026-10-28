import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp } from "firebase/firestore";

const projectId = "demo-skillforge-rules";
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "studentA"), {
      name: "Student A", email: "studentA@example.com", role: "student", createdAt: "2026-01-01"
    });
    await setDoc(doc(db, "users", "studentB"), {
      name: "Student B", email: "studentB@example.com", role: "student", createdAt: "2026-01-01"
    });
    await setDoc(doc(db, "users", "instructorA"), {
      name: "Instructor A", email: "instructorA@example.com", role: "instructor", createdAt: "2026-01-01"
    });
    await setDoc(doc(db, "courses", "courseA"), {
      title: "Course A", description: "Test course", price: "0", category: "Testing",
      lessons: [], instructorId: "instructorA", instructorName: "Instructor A",
      students: 0, rating: 0, thumbnail: "", createdAt: new Date(), updatedAt: new Date()
    });
    await setDoc(doc(db, "enrollments", "studentA_courseA"), {
      studentId: "studentA", courseId: "courseA", instructorId: "instructorA", progress: 0
    });
    await setDoc(doc(db, "payments", "paymentA"), {
      userId: "studentA", paymentType: "monthly", amount: 1000000, currency: "NGN",
      reference: "test-reference", status: "pending"
    });
    await setDoc(doc(db, "conversations", "conversationA"), {
      memberIds: ["studentA", "studentB"],
      members: { studentA: { name: "Student A" }, studentB: { name: "Student B" } },
      lastMessage: "", lastMessageAt: new Date(), createdAt: new Date()
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

test("a user can read their own profile but cannot read another profile or list all users", async () => {
  const db = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(getDoc(doc(db, "users", "studentA")));
  await assertFails(getDoc(doc(db, "users", "studentB")));
  await assertFails(getDocs(collection(db, "users")));
});

test("a new client can create a student profile but cannot self-assign instructor", async () => {
  const db = testEnv.authenticatedContext("newStudent", { email: "new@example.com" }).firestore();
  await assertSucceeds(setDoc(doc(db, "users", "newStudent"), {
    name: "New Student", email: "new@example.com", role: "student", createdAt: "2026-10-28"
  }));
  const instructorDb = testEnv.authenticatedContext("newInstructor", { email: "new@example.com" }).firestore();
  await assertFails(setDoc(doc(instructorDb, "users", "newInstructor"), {
    name: "New Instructor", email: "new@example.com", role: "instructor", createdAt: "2026-10-28"
  }));
});

test("profile updates cannot change role, email, or subscription fields", async () => {
  const db = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(updateDoc(doc(db, "users", "studentA"), { name: "Updated Name" }));
  await assertFails(updateDoc(doc(db, "users", "studentA"), { role: "instructor" }));
  await assertFails(updateDoc(doc(db, "users", "studentA"), { subscriptionStatus: "active" }));
  await assertFails(updateDoc(doc(db, "users", "studentA"), { email: "attacker@example.com" }));
});

test("only an instructor can create a course for their own UID", async () => {
  const instructorDb = testEnv.authenticatedContext("instructorA", { email: "instructorA@example.com" }).firestore();
  await assertSucceeds(setDoc(doc(instructorDb, "courses", "newCourse"), {
    title: "New Course", description: "Description", price: "0", category: "Testing",
    lessons: [], instructorId: "instructorA", instructorName: "Instructor A",
    students: 0, rating: 0, thumbnail: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  const studentDb = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertFails(setDoc(doc(studentDb, "courses", "badCourse"), {
    title: "Bad Course", description: "Description", price: "0", category: "Testing",
    lessons: [], instructorId: "studentA", instructorName: "Student A",
    students: 0, rating: 0, thumbnail: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test("course ownership cannot be transferred or edited by another instructor", async () => {
  const ownerDb = testEnv.authenticatedContext("instructorA", { email: "instructorA@example.com" }).firestore();
  await assertSucceeds(updateDoc(doc(ownerDb, "courses", "courseA"), { title: "Updated title", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(ownerDb, "courses", "courseA"), { instructorId: "studentA" }));
  const otherDb = testEnv.authenticatedContext("studentB", { email: "studentB@example.com" }).firestore();
  await assertFails(updateDoc(doc(otherDb, "courses", "courseA"), { title: "Hijacked" }));
});

test("browser clients cannot create or mutate payment records", async () => {
  const db = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(getDoc(doc(db, "payments", "paymentA")));
  await assertFails(getDoc(doc(db, "payments", "someoneElsesPayment")));
  await assertFails(setDoc(doc(db, "payments", "forged"), {
    userId: "studentA", amount: 1, currency: "NGN", reference: "fake", status: "completed"
  }));
  await assertFails(updateDoc(doc(db, "payments", "paymentA"), { status: "completed" }));
  await assertFails(deleteDoc(doc(db, "payments", "paymentA")));
});

test("enrollment reads are scoped and browser writes are denied until trusted enrollment exists", async () => {
  const studentDb = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(getDoc(doc(studentDb, "enrollments", "studentA_courseA")));
  await assertFails(getDoc(doc(studentDb, "enrollments", "otherEnrollment")));
  await assertFails(setDoc(doc(studentDb, "enrollments", "studentA_courseB"), {
    studentId: "studentA", courseId: "courseB", instructorId: "instructorA", progress: 0
  }));
});

test("conversation membership is required and cannot be changed by members", async () => {
  const memberDb = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(getDoc(doc(memberDb, "conversations", "conversationA")));
  await assertSucceeds(updateDoc(doc(memberDb, "conversations", "conversationA"), {
    lastMessage: "Hello", lastMessageAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(memberDb, "conversations", "conversationA"), {
    memberIds: ["studentA", "studentB", "studentC"]
  }));
  const outsiderDb = testEnv.authenticatedContext("instructorA", { email: "instructorA@example.com" }).firestore();
  await assertFails(getDoc(doc(outsiderDb, "conversations", "conversationA")));
});

test("message sender must match the authenticated user and only members can send", async () => {
  const memberDb = testEnv.authenticatedContext("studentA", { email: "studentA@example.com" }).firestore();
  await assertSucceeds(addDoc(collection(memberDb, "conversations", "conversationA", "messages"), {
    senderId: "studentA", senderName: "Student A", text: "Hello", createdAt: serverTimestamp()
  }));
  await assertFails(addDoc(collection(memberDb, "conversations", "conversationA", "messages"), {
    senderId: "studentB", senderName: "Student B", text: "Spoofed", createdAt: serverTimestamp()
  }));
  const outsiderDb = testEnv.authenticatedContext("instructorA", { email: "instructorA@example.com" }).firestore();
  await assertFails(addDoc(collection(outsiderDb, "conversations", "conversationA", "messages"), {
    senderId: "instructorA", senderName: "Instructor A", text: "Intrusion", createdAt: serverTimestamp()
  }));
});
