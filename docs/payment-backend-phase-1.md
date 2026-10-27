# Payment backend Phase 1

Branch: `feat/skillforge-development`

## Implemented callable contract

### `createPaymentIntent({ paymentType })`

Requires Firebase Authentication. Supported `paymentType` values are `monthly` and `one_on_one`.

The callable derives all trusted fields server-side:
- `userId`: authenticated Firebase UID
- `email`: authenticated token email, normalized to lowercase
- `amount`: fixed server-side price in kobo
- `currency`: `NGN`
- `reference`: generated on the server
- `status`: `pending`

Response fields: `paymentId`, `paymentType`, `amount`, `currency`, `email`, and `reference`.

Do not pass a client-supplied user ID, email, amount, currency, reference, or status. Extra client properties are ignored.

Prices currently match the existing frontend constants:
- `one_on_one`: 10,000,000 kobo (₦100,000)
- `monthly`: 1,000,000 kobo (₦10,000)

This callable creates the authoritative Firestore payment intent. It does not itself initialize a transaction with Paystack; the existing Paystack popup must use the returned reference, email, and amount.

### `verifyPaystackPayment({ paymentId, reference })`

Requires Firebase Authentication and the `PAYSTACK_SECRET_KEY` Secret Manager secret. It checks payment ownership and the server-created intent marker, then verifies the transaction through Paystack's authenticated API. It validates successful status, reference, amount, currency, and (when Paystack supplies it) customer email. A transaction updates the payment record and monthly subscription expiry atomically. Repeated successful verification is idempotent.

The callable currently extends monthly subscription expiry by 30 days. It does not define the product-access policy for `one_on_one`.

## Critical rollout gates (not yet complete)

1. **Firestore security rules are still required.** The browser must not be allowed to create or change trusted payment fields, mark a payment completed, or write subscription/entitlement fields. The existing frontend directly creates payment documents and updates payment status; while that client flow remains and rules are unverified, this is not a secure end-to-end checkout.
2. Update the frontend through Adechris to call `createPaymentIntent`, use the returned checkout fields, and call `verifyPaystackPayment` after the Paystack callback. A browser callback alone must never mark payment as completed.
3. Test callable behavior and Firestore rules in the Firebase Emulator Suite, including unauthenticated requests, unsupported payment types, cross-user verification, mismatched amount/reference/currency, provider failures, and repeated verification.
4. Confirm the intended entitlement and renewal policy before launch, especially what `one_on_one` unlocks and whether the existing monthly plan semantics are correct.
5. Do not deploy until the live Firestore rules/configuration have been inspected and a staged test passes.

## Local checks

From `functions/` run:

```sh
npm install
npm test
```

The test command compiles TypeScript and runs the payment-policy unit tests. These tests do not call Paystack or Firebase and do not replace emulator/integration tests.
