# Stripe Checkout Testing Checklist

## Prerequisites
- [ ] Stripe test mode enabled (use `pk_test_*` and `sk_test_*` keys)
- [ ] Supabase Edge Functions deployed
- [ ] All `VITE_STRIPE_PRICE_*` environment variables configured
- [ ] Test user account created in Clerk

## Test Environment
- URL: `http://localhost:5173` (dev) or `https://escapesuite.dev` (staging)
- Stripe test card: `4242 4242 4242 4242`, any future date, any CVC

---

## Individual SaaS Plans

### 1. Pro Monthly Checkout (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Ensure "Individual" tab is active
- [ ] Click "Upgrade Now" on Pro Monthly card
- [ ] **Expected**: Redirect to Stripe checkout with $9/month subscription
- [ ] Complete payment with test card
- [ ] **Expected**: Redirect to `/dashboard?success=true`
- [ ] **Expected**: Dashboard shows "Pro Monthly" status

### 2. Pro Annual Checkout (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Click "Upgrade Now" on Pro Annual card
- [ ] **Expected**: Redirect to Stripe checkout with $79/year subscription
- [ ] Cancel checkout (click back)
- [ ] **Expected**: Redirect to `/?canceled=true`

### 3. Founding Member Checkout (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Click "Become a Founder" button
- [ ] **Expected**: Redirect to Stripe checkout with $149 one-time payment
- [ ] **Expected**: Mode is "payment" not "subscription"

### 4. SaaS Checkout (Signed Out)
- [ ] Sign out
- [ ] Navigate to `/pricing`
- [ ] Click any "Get Started" button
- [ ] **Expected**: Redirect to `/sign-up`

---

## Team Plans

### 5. Team Plan Checkout - Monthly (5 seats)
- [ ] Sign in
- [ ] Navigate to `/pricing`
- [ ] Click "Teams" tab
- [ ] Select "Team" plan ($7/seat)
- [ ] Set slider to 5 seats
- [ ] Ensure "Monthly" billing is selected
- [ ] Click "Start Team Plan"
- [ ] **Expected**: Redirect to Stripe checkout with 5 x $7/mo = $35/month subscription
- [ ] Complete payment
- [ ] **Expected**: Redirect to `/team/:slug?success=true`

### 6. Team Plan Checkout - Annual (10 seats)
- [ ] Select "Team" plan
- [ ] Set slider to 10 seats
- [ ] Select "Annual" billing (Save 17% badge)
- [ ] **Expected**: Total shows $700/yr (10 x $70/yr)
- [ ] Click "Start Team Plan"
- [ ] **Expected**: Redirect to Stripe checkout with annual subscription

### 7. Enterprise Plan Checkout (25 seats)
- [ ] Select "Enterprise" plan ($12/seat)
- [ ] Set slider to 25 seats
- [ ] Click "Start Team Plan"
- [ ] **Expected**: Redirect to Stripe checkout with 25 x $12/mo subscription

---

## Standalone Licenses

### 7. ESCAPECRAFT Standard License (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Click "Standalone License" tab
- [ ] Select "ESCAPECRAFT" product
- [ ] Select "Standard" tier ($49)
- [ ] Click "Purchase License"
- [ ] **Expected**: Redirect to Stripe checkout with $49 one-time payment
- [ ] Complete payment
- [ ] **Expected**: Redirect to `/portal/downloads?purchase=success`
- [ ] **Expected**: License email sent (check Supabase logs)

### 8. ESCAPEARTIST Pro License (Signed In)
- [ ] Select "ESCAPEARTIST" product
- [ ] Select "Pro" tier ($129)
- [ ] Click "Purchase License"
- [ ] **Expected**: Redirect to Stripe checkout with $129 one-time payment

### 9. Suite Bundle Lifetime License (Signed In)
- [ ] Select "Suite Bundle" product
- [ ] Select "Lifetime" tier ($349)
- [ ] Click "Purchase License"
- [ ] **Expected**: Redirect to Stripe checkout with $349 one-time payment

### 10. Standalone License (Signed Out)
- [ ] Sign out
- [ ] Navigate to `/pricing?tab=standalone`
- [ ] Select any product/tier
- [ ] Click "Purchase License"
- [ ] **Expected**: Redirect to `/sign-up?redirect=/pricing?tab=standalone`
- [ ] Sign up/sign in
- [ ] **Expected**: Redirect back to pricing page with standalone tab active

---

## Subscription Management

### 11. Customer Portal Access
- [ ] Sign in with an active subscription
- [ ] Navigate to `/dashboard`
- [ ] Click "Manage Subscription"
- [ ] **Expected**: Redirect to Stripe customer portal
- [ ] **Expected**: Can cancel, update payment method, view invoices

### 12. Subscription Cancellation
- [ ] In Stripe portal, click "Cancel subscription"
- [ ] **Expected**: Subscription marked as canceled
- [ ] **Expected**: Access continues until period end

---

## Error Scenarios

### 13. Invalid Price ID
- [ ] Temporarily remove `VITE_STRIPE_PRICE_PRO_MONTHLY` from .env
- [ ] Attempt Pro Monthly checkout
- [ ] **Expected**: Error message displayed (not silent failure)

### 14. Stripe API Error
- [ ] Use invalid Stripe secret key in Supabase
- [ ] Attempt any checkout
- [ ] **Expected**: User-friendly error message

### 15. Network Failure
- [ ] Disable network after clicking checkout button
- [ ] **Expected**: Error message displayed

---

## Browser Console Checks
For each checkout attempt, check browser console for:
- [ ] No CORS errors
- [ ] No 4xx/5xx errors before redirect
- [ ] Network request to Edge Function succeeds

---

## Results Summary

| Test | Status | Notes |
|------|--------|-------|
| 1. Pro Monthly | | |
| 2. Pro Annual | | |
| 3. Founding Member | | |
| 4. SaaS Signed Out | | |
| 5. Team Monthly | | |
| 6. Team Annual | | |
| 7. Enterprise Plan | | |
| 8. CRAFT Standard | | |
| 9. ARTIST Pro | | |
| 10. Suite Lifetime | | |
| 11. Standalone Signed Out | | |
| 12. Customer Portal | | |
| 13. Cancellation | | |
| 14. Invalid Price ID | | |
| 15. API Error | | |
| 16. Network Failure | | |
