import { createHmac, timingSafeEqual } from "node:crypto";

export const EXPECTED_AMOUNTS_KOBO = {
  one_on_one: 10_000_000,
  monthly: 1_000_000,
} as const;

export type PaymentType = keyof typeof EXPECTED_AMOUNTS_KOBO;

export function isPaymentType(value: unknown): value is PaymentType {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EXPECTED_AMOUNTS_KOBO, value);
}


/**
 * Accepts the price formats used by the course editor while rejecting empty,
 * negative, non-finite, and malformed prices.
 */
export function isValidCoursePrice(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.length > 100) return false;
  if (raw.toLowerCase() === "free") return true;

  let normalized = raw.replace(/\s+/g, "");
  normalized = normalized
    .replace(/^(?:NGN|USD|EUR|GBP)/i, "")
    .replace(/(?:NGN|USD|EUR|GBP)$/i, "")
    .replace(/^[₦$€£]/, "")
    .replace(/[₦$€£]$/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return false;
  return Number.isFinite(Number(normalized.replace(/,/g, "")));
}


/** Validates Paystack's HMAC-SHA512 webhook signature against the exact raw body. */
export function isValidPaystackSignature(
  rawBody: Uint8Array,
  signature: unknown,
  secret: string,
): boolean {
  if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || !secret) {
    return false;
  }
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
