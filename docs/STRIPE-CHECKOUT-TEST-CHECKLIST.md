# Stripe Checkout Testing Checklist

## Prerequisites
- [ ] Stripe test mode enabled (use `pk_test_*` and `sk_test_*` keys)
- [ ] Supabase Edge Functions deployed
- [ ] Server-side Stripe Price IDs configured as Edge Function secrets
      (`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `STRIPE_PRICE_SITE_TEAM`, `STRIPE_PRICE_SITE_ORG`)
- [ ] Test user account created via Supabase Auth

## Test Environment
- URL: `http://localhost:5173` (dev) or `https://escapesuite.dev` (staging)
- Stripe test card: `4242 4242 4242 4242`, any future date, any CVC

---

## Individual Pro Plan (connected SaaS side door)

### 1. Pro Monthly Checkout (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Ensure the Individual Pro section is visible
- [ ] Click "Upgrade Now" on Pro Monthly card
- [ ] **Expected**: Redirect to Stripe checkout with $9/month subscription (7-day free trial)
- [ ] Complete payment with test card
- [ ] **Expected**: Redirect to `/dashboard?success=true`
- [ ] **Expected**: Dashboard shows "Pro Monthly" status

### 2. Pro Annual Checkout (Signed In)
- [ ] Navigate to `/pricing`
- [ ] Click "Upgrade Now" on Pro Annual card
- [ ] **Expected**: Redirect to Stripe checkout with $89/year subscription (7-day free trial)
- [ ] Cancel checkout (click back)
- [ ] **Expected**: Redirect to `/?canceled=true`

### 3. Pro Checkout (Signed Out)
- [ ] Sign out
- [ ] Navigate to `/pricing`
- [ ] Click any "Get Started" button
- [ ] **Expected**: Redirect to `/sign-up`

> Removed flows — must NOT appear and should not be tested: Founding Member ($149 one-time),
> per-seat Team/Enterprise SaaS checkout, and the multi-SKU consumer standalone grid.

---

## Site License (air-gapped/offline, per-org annual)

### 4. Site License — Team Band ($2,400/yr, Signed In)
- [ ] Navigate to `/pricing`
- [ ] In the Site License section, select the **Team** band ($2,400/yr, ~up to 25)
- [ ] Click "Get Team License"
- [ ] **Expected**: `create-site-license-checkout` → Stripe checkout, $2,400/year subscription
- [ ] Complete payment
- [ ] **Expected**: Redirect to `/dashboard?tab=downloads&purchase=success`
- [ ] **Expected**: License email sent via Resend (check Supabase logs)

### 5. Site License — Organization Band ($9,600/yr, Signed In)
- [ ] Select the **Organization** band ($9,600/yr, ~up to 250)
- [ ] Click "Get Organization License"
- [ ] **Expected**: `create-site-license-checkout` → Stripe checkout, $9,600/year subscription

### 6. Enterprise / Site (Contact us)
- [ ] Select the **Enterprise / Site** band
- [ ] **Expected**: No self-serve checkout — a "Contact us" mailto to `sales@escapesuite.io`

### 7. Site License (Signed Out)
- [ ] Sign out
- [ ] Navigate to `/pricing`
- [ ] Select a Site License band → click "Get ... License"
- [ ] **Expected**: Redirect to `/sign-up` (then back to pricing after auth)

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
- [ ] Temporarily unset the `STRIPE_PRICE_PRO_MONTHLY` Edge Function secret
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
| 3. Pro Signed Out | | |
| 4. Site License — Team | | |
| 5. Site License — Organization | | |
| 6. Enterprise / Site (Contact us) | | |
| 7. Site License Signed Out | | |
| 11. Customer Portal | | |
| 12. Cancellation | | |
| 13. Invalid Price ID | | |
| 14. API Error | | |
| 15. Network Failure | | |
