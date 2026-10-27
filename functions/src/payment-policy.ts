export const EXPECTED_AMOUNTS_KOBO = {
  one_on_one: 10_000_000,
  monthly: 1_000_000,
} as const;

export type PaymentType = keyof typeof EXPECTED_AMOUNTS_KOBO;

export function isPaymentType(value: unknown): value is PaymentType {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EXPECTED_AMOUNTS_KOBO, value);
}
