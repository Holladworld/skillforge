import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();
const paystackSecretKey = defineSecret("PAYSTACK_SECRET_KEY");

const EXPECTED_AMOUNTS_KOBO = {
  one_on_one: 10_000_000,
  monthly: 1_000_000,
} as const;

type PaymentType = keyof typeof EXPECTED_AMOUNTS_KOBO;

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
 * A browser callback is not proof of payment. This callable verifies the
 * transaction against Paystack's authenticated API before updating Firestore.
 * It intentionally does not grant product entitlements; those must be mapped
 * to SkillForge's agreed access policy separately.
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
    if (payment.paymentType !== "one_on_one" && payment.paymentType !== "monthly") {
      throw new HttpsError("failed-precondition", "Unsupported payment type.");
    }

    const paymentType = payment.paymentType as PaymentType;
    const expectedAmount = EXPECTED_AMOUNTS_KOBO[paymentType];
    if (payment.amount !== expectedAmount || payment.currency !== "NGN") {
      throw new HttpsError("failed-precondition", "Payment amount or currency does not match the expected price.");
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

    const verification = (await response.json()) as PaystackVerificationResponse;
    const transaction = verification.data;
    if (
      !verification.status ||
      !transaction ||
      transaction.status !== "success" ||
      transaction.reference !== reference ||
      transaction.amount !== expectedAmount ||
      transaction.currency !== "NGN"
    ) {
      throw new HttpsError("failed-precondition", "Paystack has not confirmed a matching successful payment.");
    }

    const providerEmail = transaction.customer?.email?.trim().toLowerCase();
    const expectedEmail = typeof payment.email === "string" ? payment.email.trim().toLowerCase() : "";
    if (providerEmail && expectedEmail && providerEmail !== expectedEmail) {
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
      if (latest.userId !== uid || latest.reference !== reference) {
        throw new HttpsError("permission-denied", "Payment ownership changed unexpectedly.");
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
