import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

interface VerifyPaymentRequest {
  paymentId: string;
  reference: string;
}

interface VerifyPaymentResponse {
  success: boolean;
  alreadyVerified: boolean;
  paymentId: string;
}

/** Verify payment status through the trusted server-side Paystack API call. */
export const verifyPaystackPayment = async (
  paymentId: string,
  reference: string,
): Promise<VerifyPaymentResponse> => {
  const verify = httpsCallable<VerifyPaymentRequest, VerifyPaymentResponse>(
    functions,
    "verifyPaystackPayment",
  );
  const result = await verify({ paymentId, reference });
  return result.data;
};
