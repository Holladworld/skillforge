import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { EXPECTED_AMOUNTS_KOBO, isPaymentType, isValidCoursePrice, isValidPaystackSignature } from "./payment-policy.js";
import { hasActiveSubscription, isFreeCoursePrice, normalizeLearningProgress, normalizeCourseLessons } from "./learning-policy.js";

initializeApp();

const db = getFirestore();
const paystackSecretKey = defineSecret("PAYSTACK_SECRET_KEY");

interface PaystackVerificationResponse {
  status: boolean;
  message?: string;
  data?: {
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    id?: number;
    channel?: string;
    customer?: { email?: string };
  };
}

/**
 * Creates a server-authoritative payment record.
 *
 * The client may choose a supported product type, but cannot choose the user,
 * email, amount, currency, reference, or initial status. This creates the
 * Firestore intent used by the existing Paystack popup integration; it does
 * not itself initialize a transaction with Paystack.
 */
export const createPaymentIntent = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in before starting a payment.");
    }

    const paymentType = request.data?.paymentType;
    if (!isPaymentType(paymentType)) {
      throw new HttpsError(
        "invalid-argument",
        "Choose a supported payment type: monthly or one_on_one.",
      );
    }

    const emailClaim = request.auth?.token?.email;
    if (typeof emailClaim !== "string" || !emailClaim.trim()) {
      throw new HttpsError(
        "failed-precondition",
        "Your account must have an email address before starting a payment.",
      );
    }

    const email = emailClaim.trim().toLowerCase();
    const amount = EXPECTED_AMOUNTS_KOBO[paymentType];
    const reference = `skillforge_${randomUUID().replace(/-/g, "")}`;
    const paymentRef = db.collection("payments").doc();

    await paymentRef.create({
      userId: uid,
      email,
      paymentType,
      amount,
      currency: "NGN",
      reference,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      intentProvider: "paystack",
      intentVersion: 1,
    });

    // Return only the checkout fields the client needs. Price and reference
    // are generated here, never accepted from client input.
    return {
      paymentId: paymentRef.id,
      paymentType,
      amount,
      currency: "NGN",
      email,
      reference,
    };
  },
);

/**
 * A browser callback is not proof of payment. This callable verifies the
 * transaction against Paystack's authenticated API before updating Firestore.
 * It intentionally does not grant one_on_one entitlements; those must be
 * mapped to SkillForge's agreed access policy separately.
 */
export const verifyPaystackPayment = onCall(
  {
    region: "us-central1",
    secrets: [paystackSecretKey],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in to verify this payment.");
    }

    const paymentId = request.data?.paymentId;
    const reference = request.data?.reference;
    if (
      typeof paymentId !== "string" ||
      paymentId.length < 1 ||
      paymentId.length > 200 ||
      typeof reference !== "string" ||
      reference.length < 1 ||
      reference.length > 200
    ) {
      throw new HttpsError("invalid-argument", "A valid payment ID and reference are required.");
    }

    const paymentRef = db.collection("payments").doc(paymentId);
    const paymentSnapshot = await paymentRef.get();
    if (!paymentSnapshot.exists) {
      throw new HttpsError("not-found", "Payment record was not found.");
    }

    const payment = paymentSnapshot.data()!;
    if (payment.userId !== uid) {
      throw new HttpsError("permission-denied", "You cannot verify another user's payment.");
    }
    if (payment.reference !== reference) {
      throw new HttpsError("invalid-argument", "Payment reference does not match the payment record.");
    }
    if (!isPaymentType(payment.paymentType)) {
      throw new HttpsError("failed-precondition", "Unsupported payment type.");
    }

    const paymentType = payment.paymentType;
    const expectedAmount = EXPECTED_AMOUNTS_KOBO[paymentType];
    if (
      payment.amount !== expectedAmount ||
      payment.currency !== "NGN" ||
      payment.intentVersion !== 1 ||
      payment.intentProvider !== "paystack"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Payment intent is invalid or does not match the expected price.",
      );
    }

    if (payment.status === "completed" && payment.verifiedAt) {
      return { success: true, alreadyVerified: true, paymentId };
    }
    if (payment.status !== "pending") {
      throw new HttpsError("failed-precondition", "This payment is not pending verification.");
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${paystackSecretKey.value()}`,
            Accept: "application/json",
          },
        },
      );
    } catch {
      throw new HttpsError("unavailable", "Could not contact the payment provider. Please try again.");
    }

    if (!response.ok) {
      throw new HttpsError("unavailable", "The payment provider could not verify this transaction.");
    }

    let verification: PaystackVerificationResponse;
    try {
      verification = (await response.json()) as PaystackVerificationResponse;
    } catch {
      throw new HttpsError("unavailable", "The payment provider returned an unreadable response.");
    }

    const transaction = verification.data;
    if (
      !verification.status ||
      !transaction ||
      transaction.status !== "success" ||
      transaction.reference !== reference ||
      transaction.amount !== expectedAmount ||
      transaction.currency !== "NGN"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Paystack has not confirmed a matching successful payment.",
      );
    }

    const providerEmail = typeof transaction.customer?.email === "string"
      ? transaction.customer.email.trim().toLowerCase()
      : "";
    const expectedEmail = typeof payment.email === "string" ? payment.email.trim().toLowerCase() : "";
    if (!providerEmail || !expectedEmail || providerEmail !== expectedEmail) {
      throw new HttpsError("failed-precondition", "The payment email does not match the payment record.");
    }

    const userRef = db.collection("users").doc(uid);
    const alreadyVerified = await db.runTransaction(async (transactionWriter) => {
      const latestSnapshot = await transactionWriter.get(paymentRef);
      const userSnapshot = await transactionWriter.get(userRef);
      if (!latestSnapshot.exists) {
        throw new HttpsError("not-found", "Payment record no longer exists.");
      }
      if (!userSnapshot.exists) {
        throw new HttpsError("failed-precondition", "User profile was not found.");
      }

      const latest = latestSnapshot.data()!;
      if (
        latest.userId !== uid ||
        latest.reference !== reference ||
        latest.amount !== expectedAmount ||
        latest.currency !== "NGN" ||
        latest.paymentType !== paymentType ||
        latest.intentVersion !== 1 ||
        latest.intentProvider !== "paystack"
      ) {
        throw new HttpsError("permission-denied", "Payment intent changed unexpectedly.");
      }
      if (latest.status === "completed" && latest.verifiedAt) return true;
      if (latest.status !== "pending") {
        throw new HttpsError("failed-precondition", "Payment status changed during verification.");
      }

      transactionWriter.update(paymentRef, {
        status: "completed",
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        verificationProvider: "paystack",
        paystackTransactionId: transaction.id ?? null,
        paystackChannel: transaction.channel ?? null,
      });

      // The monthly product is described as access to all courses and materials.
      // Extend an existing active period rather than overwriting remaining time.
      if (paymentType === "monthly") {
        const currentExpiry = userSnapshot.get("subscriptionExpiresAt");
        const now = Date.now();
        const existingExpiryMs =
          currentExpiry instanceof Timestamp ? currentExpiry.toMillis() : 0;
        const baseMs = Math.max(now, existingExpiryMs);
        const nextExpiry = Timestamp.fromMillis(baseMs + 30 * 24 * 60 * 60 * 1000);

        transactionWriter.update(userRef, {
          subscriptionStatus: "active",
          subscriptionPlan: "monthly",
          subscriptionExpiresAt: nextExpiry,
          subscriptionUpdatedAt: FieldValue.serverTimestamp(),
        });
      }
      return false;
    });

    return { success: true, alreadyVerified, paymentId };
  },
);


type CourseAccessType = "free_course" | "monthly_subscription";

function parseCourseId(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "A valid course ID is required.");
  }
  const courseId = value.trim();
  if (!courseId || courseId.length > 150 || courseId.includes("/")) {
    throw new HttpsError("invalid-argument", "A valid course ID is required.");
  }
  return courseId;
}

function getCourseAccessType(
  course: FirebaseFirestore.DocumentData,
  user: FirebaseFirestore.DocumentData,
): CourseAccessType | null {
  if (isFreeCoursePrice(course.price)) return "free_course";

  const expiry = user.subscriptionExpiresAt;
  const expiryMillis = expiry instanceof Timestamp ? expiry.toMillis() : Number.NaN;
  if (hasActiveSubscription(user.subscriptionStatus, expiryMillis, Date.now())) {
    return "monthly_subscription";
  }
  return null;
}

async function readCourseAndUser(
  uid: string,
  courseId: string,
): Promise<{
  course: FirebaseFirestore.DocumentData;
  user: FirebaseFirestore.DocumentData;
  accessType: CourseAccessType;
}> {
  const courseRef = db.collection("courses").doc(courseId);
  const userRef = db.collection("users").doc(uid);
  const [courseSnapshot, userSnapshot] = await Promise.all([courseRef.get(), userRef.get()]);

  if (!courseSnapshot.exists) {
    throw new HttpsError("not-found", "Course was not found.");
  }
  if (!userSnapshot.exists) {
    throw new HttpsError("failed-precondition", "Your SkillForge profile was not found.");
  }

  const course = courseSnapshot.data()!;
  const user = userSnapshot.data()!;
  const accessType = getCourseAccessType(course, user);
  if (!accessType) {
    throw new HttpsError(
      "permission-denied",
      "This course requires an active, unexpired monthly subscription.",
    );
  }
  return { course, user, accessType };
}



async function requireApprovedInstructor(uid: string) {
  const [userSnapshot, accessSnapshot] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("instructor_access").doc(uid).get(),
  ]);
  if (
    !userSnapshot.exists ||
    userSnapshot.get("role") !== "instructor" ||
    !(userSnapshot.get("instructorApprovedAt") instanceof Timestamp) ||
    !accessSnapshot.exists ||
    accessSnapshot.get("approved") !== true ||
    !(accessSnapshot.get("approvedAt") instanceof Timestamp)
  ) {
    throw new HttpsError("permission-denied", "Only trusted, approved instructors can manage courses.");
  }
  return userSnapshot;
}

function validateCourseMetadata(
  title: string,
  description: string,
  category: string,
  price: unknown,
  thumbnail: string,
): void {
  if (!title || title.length > 180) {
    throw new HttpsError("invalid-argument", "Course title must contain 1–180 characters.");
  }
  if (description.length > 12000 || !category || category.length > 120) {
    throw new HttpsError("invalid-argument", "Course description or category is invalid.");
  }
  if (!isValidCoursePrice(price)) {
    throw new HttpsError("invalid-argument", "Course price must be a valid non-negative amount or Free.");
  }
  if (thumbnail.length > 2048) {
    throw new HttpsError("invalid-argument", "Course thumbnail URL is too long.");
  }
}

function parseCourseLessons(value: unknown) {
  try {
    return normalizeCourseLessons(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Course lessons are invalid.";
    throw new HttpsError("invalid-argument", message);
  }
}

/**
 * Creates a course with public catalogue metadata separated from protected lessons.
 * This callable is the intended replacement for browser-side createCourse().
 */
export const createCourseWithProtectedContent = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in before publishing a course.");

  const userSnapshot = await requireApprovedInstructor(uid);

  const data = request.data ?? {};
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const category = typeof data.category === "string" ? data.category.trim() : "";
  const price = typeof data.price === "string" || typeof data.price === "number" ? data.price : null;
  const thumbnail = typeof data.thumbnail === "string" ? data.thumbnail.trim() : "";
  validateCourseMetadata(title, description, category, price, thumbnail);
  const lessons = parseCourseLessons(data.lessons);

  const courseRef = db.collection("courses").doc();
  const contentRef = db.collection("course_contents").doc(courseRef.id);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (transactionWriter) => {
    transactionWriter.create(courseRef, {
      title,
      description,
      price,
      category,
      instructorId: uid,
      instructorName: typeof userSnapshot.get("name") === "string" ? userSnapshot.get("name") : "",
      students: 0,
      rating: 0,
      thumbnail,
      createdAt: now,
      updatedAt: now,
    });
    transactionWriter.create(contentRef, {
      courseId: courseRef.id,
      instructorId: uid,
      lessons,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { success: true, courseId: courseRef.id, lessonCount: lessons.length };
});

/**
 * Updates an instructor-owned course and its protected lesson payload atomically.
 * This replaces browser-side edits to courses/{courseId}.lessons.
 */
export const updateCourseWithProtectedContent = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in before editing a course.");

  const courseId = parseCourseId(request.data?.courseId);
  const userSnapshot = await requireApprovedInstructor(uid);

  const data = request.data ?? {};
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const category = typeof data.category === "string" ? data.category.trim() : "";
  const price = typeof data.price === "string" || typeof data.price === "number" ? data.price : null;
  const thumbnail = typeof data.thumbnail === "string" ? data.thumbnail.trim() : "";
  validateCourseMetadata(title, description, category, price, thumbnail);
  const lessons = parseCourseLessons(data.lessons);

  const courseRef = db.collection("courses").doc(courseId);
  const contentRef = db.collection("course_contents").doc(courseId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (transactionWriter) => {
    const [courseSnapshot, contentSnapshot] = await Promise.all([
      transactionWriter.get(courseRef),
      transactionWriter.get(contentRef),
    ]);
    if (!courseSnapshot.exists) throw new HttpsError("not-found", "Course was not found.");
    if (courseSnapshot.get("instructorId") !== uid) {
      throw new HttpsError("permission-denied", "You can only edit your own courses.");
    }
    if (!contentSnapshot.exists || !Array.isArray(contentSnapshot.get("lessons"))) {
      throw new HttpsError("failed-precondition", "Course lessons must be migrated before they can be edited safely.");
    }

    transactionWriter.update(courseRef, {
      title, description, price, category, thumbnail, updatedAt: now,
    });
    transactionWriter.update(contentRef, {
      lessons, updatedAt: now,
    });
  });

  return { success: true, courseId, lessonCount: lessons.length };
});

/**
 * Creates an enrollment from trusted Firestore data. The student UID and all
 * course metadata are derived on the server; repeated calls are idempotent.
 */
export const createEnrollment = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in before enrolling.");
  const courseId = parseCourseId(request.data?.courseId);

  const userRef = db.collection("users").doc(uid);
  const courseRef = db.collection("courses").doc(courseId);
  const contentRef = db.collection("course_contents").doc(courseId);
  const enrollmentRef = db.collection("enrollments").doc(`${uid}_${courseId}`);

  return db.runTransaction(async (transactionWriter) => {
    const [userSnapshot, courseSnapshot, contentSnapshot, enrollmentSnapshot] = await Promise.all([
      transactionWriter.get(userRef),
      transactionWriter.get(courseRef),
      transactionWriter.get(contentRef),
      transactionWriter.get(enrollmentRef),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Your SkillForge profile was not found.");
    }
    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course was not found.");
    }
    if (!contentSnapshot.exists ||
        !Array.isArray(contentSnapshot.get("lessons")) ||
        contentSnapshot.get("lessons").length < 1) {
      throw new HttpsError(
        "failed-precondition",
        "Course lessons must be migrated to protected storage before enrollment.",
      );
    }

    const user = userSnapshot.data()!;
    const course = courseSnapshot.data()!;
    const accessType = getCourseAccessType(course, user);
    if (!accessType) {
      throw new HttpsError(
        "permission-denied",
        "This course requires an active, unexpired monthly subscription.",
      );
    }

    if (enrollmentSnapshot.exists) {
      return { success: true, alreadyEnrolled: true, enrollmentId: enrollmentRef.id, accessType };
    }

    transactionWriter.create(enrollmentRef, {
      studentId: uid,
      courseId,
      instructorId: typeof course.instructorId === "string" ? course.instructorId : "",
      courseTitle: typeof course.title === "string" ? course.title : "",
      courseThumbnail: typeof course.thumbnail === "string" ? course.thumbnail : "",
      instructorName: typeof course.instructorName === "string" ? course.instructorName : "",
      progress: 0,
      accessType,
      enrolledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, alreadyEnrolled: false, enrollmentId: enrollmentRef.id, accessType };
  });
});

/**
 * Access-checked content contract for the learning page. The existing client
 * still reads course documents directly, so this callable is not by itself a
 * complete content-security boundary until that path and media URLs are gated.
 */
export const getCourseLearningContent = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to access course lessons.");
  const courseId = parseCourseId(request.data?.courseId);
  const { course, accessType } = await readCourseAndUser(uid, courseId);
  const contentSnapshot = await db.collection("course_contents").doc(courseId).get();

  if (!contentSnapshot.exists) {
    throw new HttpsError("failed-precondition", "Course lessons have not been migrated to protected storage yet.");
  }
  const lessons = contentSnapshot.get("lessons");
  if (!Array.isArray(lessons)) {
    throw new HttpsError("failed-precondition", "Course lesson content is invalid.");
  }

  return {
    courseId,
    title: typeof course.title === "string" ? course.title : "",
    description: typeof course.description === "string" ? course.description : "",
    category: typeof course.category === "string" ? course.category : "",
    thumbnail: typeof course.thumbnail === "string" ? course.thumbnail : "",
    instructorId: typeof course.instructorId === "string" ? course.instructorId : "",
    instructorName: typeof course.instructorName === "string" ? course.instructorName : "",
    lessons,
    accessType,
  };
});

/** Saves only the authenticated learner's validated progress for an accessible course. */
export const saveLearningProgress = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to save learning progress.");
  const courseId = parseCourseId(request.data?.courseId);
  const userRef = db.collection("users").doc(uid);
  const courseRef = db.collection("courses").doc(courseId);
  const progressRef = db.collection("learning_progress").doc(`${uid}_${courseId}`);
  const enrollmentRef = db.collection("enrollments").doc(`${uid}_${courseId}`);

  return db.runTransaction(async (transactionWriter) => {
    const contentRef = db.collection("course_contents").doc(courseId);
    const [userSnapshot, courseSnapshot, contentSnapshot, progressSnapshot, enrollmentSnapshot] = await Promise.all([
      transactionWriter.get(userRef),
      transactionWriter.get(courseRef),
      transactionWriter.get(contentRef),
      transactionWriter.get(progressRef),
      transactionWriter.get(enrollmentRef),
    ]);

    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Your SkillForge profile was not found.");
    }
    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course was not found.");
    }
    const user = userSnapshot.data()!;
    const course = courseSnapshot.data()!;
    if (!getCourseAccessType(course, user)) {
      throw new HttpsError(
        "permission-denied",
        "You must have access to this course to save learning progress.",
      );
    }

    if (!contentSnapshot.exists || !Array.isArray(contentSnapshot.get("lessons"))) {
      throw new HttpsError("failed-precondition", "Course lessons have not been migrated to protected storage yet.");
    }
    const lessons = contentSnapshot.get("lessons") as unknown[];
    let normalized;
    try {
      normalized = normalizeLearningProgress(
        request.data?.currentLessonIndex,
        request.data?.completedLessonIndexes,
        lessons.length,
      );
    } catch (error) {
      throw new HttpsError(
        "invalid-argument",
        error instanceof Error ? error.message : "Learning progress is invalid.",
      );
    }

    const previous = progressSnapshot.data();
    transactionWriter.set(progressRef, {
      userId: uid,
      courseId,
      currentLessonIndex: normalized.currentLessonIndex,
      completedLessonIndexes: normalized.completedLessonIndexes,
      progressPercent: normalized.progressPercent,
      lessonCount: lessons.length,
      createdAt: previous?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Keep the existing enrollment summary in sync when an enrollment exists.
    if (enrollmentSnapshot.exists) {
      transactionWriter.update(enrollmentRef, {
        progress: normalized.progressPercent,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true, courseId, ...normalized };
  });
});

/** Returns the caller's progress only; does not expose another user's record. */
export const getLearningProgress = onCall({ region: "us-central1" }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to read learning progress.");
  const courseId = parseCourseId(request.data?.courseId);
  await readCourseAndUser(uid, courseId);
  const contentSnapshot = await db.collection("course_contents").doc(courseId).get();
  if (!contentSnapshot.exists || !Array.isArray(contentSnapshot.get("lessons"))) {
    throw new HttpsError("failed-precondition", "Course lessons have not been migrated to protected storage yet.");
  }
  const lessonCount = (contentSnapshot.get("lessons") as unknown[]).length;
  const progressSnapshot = await db.collection("learning_progress").doc(`${uid}_${courseId}`).get();

  if (!progressSnapshot.exists) {
    return {
      courseId,
      currentLessonIndex: 0,
      completedLessonIndexes: [],
      progressPercent: 0,
      lessonCount,
    };
  }

  const progress = progressSnapshot.data()!;
  return {
    courseId,
    currentLessonIndex: progress.currentLessonIndex,
    completedLessonIndexes: progress.completedLessonIndexes,
    progressPercent: progress.progressPercent,
    lessonCount: progress.lessonCount,
  };
});


interface PaystackWebhookEvent {
  event?: string;
  data?: {
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    id?: number;
    channel?: string;
    customer?: { email?: string };
  };
}

/**
 * Processes Paystack charge.success webhooks as a second, idempotent payment
 * confirmation path. Only signed raw request bodies are trusted.
 */
export const paystackWebhook = onRequest(
  { region: "us-central1", secrets: [paystackSecretKey] },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("Method not allowed");
      return;
    }

    const rawBody = request.rawBody;
    const signature = request.get("x-paystack-signature");
    if (!rawBody || !isValidPaystackSignature(rawBody, signature, paystackSecretKey.value())) {
      response.status(401).json({ received: false });
      return;
    }

    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8")) as PaystackWebhookEvent;
    } catch {
      response.status(400).json({ received: false });
      return;
    }

    if (event.event !== "charge.success") {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const providerTransaction = event.data;
    const reference = providerTransaction?.reference;
    if (
      !providerTransaction ||
      typeof reference !== "string" ||
      providerTransaction.status !== "success" ||
      typeof providerTransaction.amount !== "number" ||
      providerTransaction.currency !== "NGN"
    ) {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const paymentQuery = await db.collection("payments")
      .where("reference", "==", reference)
      .limit(1)
      .get();
    if (paymentQuery.empty) {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const paymentRef = paymentQuery.docs[0].ref;
    const initialPayment = paymentQuery.docs[0].data();
    const paymentType = initialPayment.paymentType;
    if (
      !isPaymentType(paymentType) ||
      initialPayment.amount !== EXPECTED_AMOUNTS_KOBO[paymentType] ||
      providerTransaction.amount !== EXPECTED_AMOUNTS_KOBO[paymentType] ||
      initialPayment.currency !== "NGN" ||
      initialPayment.intentVersion !== 1 ||
      initialPayment.intentProvider !== "paystack"
    ) {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const providerEmail = typeof providerTransaction.customer?.email === "string"
      ? providerTransaction.customer.email.trim().toLowerCase()
      : "";
    const expectedEmail = typeof initialPayment.email === "string"
      ? initialPayment.email.trim().toLowerCase()
      : "";
    if (
      typeof initialPayment.userId !== "string" ||
      !initialPayment.userId ||
      !providerEmail ||
      !expectedEmail ||
      providerEmail !== expectedEmail
    ) {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const userRef = db.collection("users").doc(initialPayment.userId);
    const outcome = await db.runTransaction(async (transactionWriter) => {
      const [latestSnapshot, userSnapshot] = await Promise.all([
        transactionWriter.get(paymentRef),
        transactionWriter.get(userRef),
      ]);
      if (!latestSnapshot.exists || !userSnapshot.exists) return "ignored";

      const latest = latestSnapshot.data()!;
      if (latest.status === "completed" && latest.verifiedAt) return "already-completed";
      if (
        latest.status !== "pending" ||
        latest.userId !== initialPayment.userId ||
        latest.reference !== reference ||
        latest.paymentType !== paymentType ||
        latest.email !== initialPayment.email ||
        latest.amount !== EXPECTED_AMOUNTS_KOBO[paymentType] ||
        latest.currency !== "NGN" ||
        latest.intentVersion !== 1 ||
        latest.intentProvider !== "paystack"
      ) {
        return "ignored";
      }

      transactionWriter.update(paymentRef, {
        status: "completed",
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        verificationProvider: "paystack_webhook",
        paystackTransactionId: providerTransaction.id ?? null,
        paystackChannel: providerTransaction.channel ?? null,
      });

      if (paymentType === "monthly") {
        const currentExpiry = userSnapshot.get("subscriptionExpiresAt");
        const existingExpiryMs = currentExpiry instanceof Timestamp ? currentExpiry.toMillis() : 0;
        const nextExpiry = Timestamp.fromMillis(
          Math.max(Date.now(), existingExpiryMs) + 30 * 24 * 60 * 60 * 1000,
        );
        transactionWriter.update(userRef, {
          subscriptionStatus: "active",
          subscriptionPlan: "monthly",
          subscriptionExpiresAt: nextExpiry,
          subscriptionUpdatedAt: FieldValue.serverTimestamp(),
        });
      }

      return "processed";
    });

    response.status(200).json({
      received: true,
      processed: outcome === "processed",
      alreadyCompleted: outcome === "already-completed",
    });
  },
);
