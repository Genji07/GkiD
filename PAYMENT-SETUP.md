# GkiD FPX setup (guardian-managed)

This repository contains a starter backend only. It is NOT live and it must not accept real payments until the account owner completes setup and tests it.

## Prices
- Monthly: RM4.99, manual renewal every 30 days (not automatic recurring billing).
- Lifetime: RM29.99, one-time payment.

## Security first
A ToyyibPay secret was pasted into chat earlier. Treat it as compromised. The adult account owner must revoke/regenerate it before any testing. Do not commit secrets, paste them into chat, or place them in browser JavaScript.

## Required adult-managed setup
1. The parent/guardian owns and manages the merchant account and checks eligibility, fees, settlement and terms with ToyyibPay.
2. Create a ToyyibPay category in the merchant dashboard and keep its category code private.
3. Create a Cloudflare Worker and a KV namespace named for payments. Bind the namespace as `PAYMENTS`.
4. Deploy `payment-worker.js` as the Worker entry point.
5. Add Worker secret `TOYYIBPAY_SECRET` using the newly rotated secret.
6. Add Worker variables `TOYYIBPAY_CATEGORY` and `APP_ORIGIN=https://genji07.github.io`.
7. Configure the frontend API base to the deployed Worker URL only after the backend has been reviewed and tested.
8. Use ToyyibPay sandbox first. Test successful, failed, pending and duplicate callbacks before considering production.

## API
- `POST /api/create-checkout` JSON: `{"plan":"monthly"}` or `{"plan":"lifetime"}`.
- `POST /api/toyyibpay-callback`: server callback configured on each bill.
- `GET /api/payment-status?order_id=...`: checks the order against ToyyibPay.

## Important limitations
- This is a payment-bill and verification starter, not a complete membership system.
- The PWA currently has no user accounts or secure account-to-purchase binding. A verified order does not yet unlock Premium safely across devices.
- Monthly means manual renewal after 30 days; it does not auto-charge.
- Lifetime means one payment, subject to published terms and continued service availability.
- Keep GkiD Basic free. Do not collect children's names, birth dates, voice recordings or other unnecessary child data.
- Do not publish live checkout buttons until a guardian has deployed, audited and sandbox-tested the backend and a secure account/entitlement system exists.
