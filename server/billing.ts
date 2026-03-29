import Stripe from 'stripe'
import { updateAccount } from './store.js'
import type { AccountRecord } from './types.js'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? ''
const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
const premiumPriceId = process.env.STRIPE_PREMIUM_PRICE_ID ?? ''
const configuredCheckoutUrl = process.env.STRIPE_CHECKOUT_URL ?? ''
const configuredPortalUrl = process.env.STRIPE_CUSTOMER_PORTAL_URL ?? ''

function getStripeClient() {
  if (!stripeSecretKey) {
    return null
  }

  return new Stripe(stripeSecretKey)
}

export function isBillingConfigured() {
  return Boolean(getStripeClient() || configuredCheckoutUrl)
}

export async function createCheckoutUrl(account: AccountRecord) {
  const stripe = getStripeClient()
  if (stripe && premiumPriceId) {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: account.email,
      client_reference_id: account.id,
      success_url: `${appUrl}?billing=success`,
      cancel_url: `${appUrl}?billing=cancelled`,
      line_items: [
        {
          price: premiumPriceId,
          quantity: 1,
        },
      ],
      metadata: {
        accountId: account.id,
      },
    })

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.')
    }

    return session.url
  }

  if (configuredCheckoutUrl) {
    return configuredCheckoutUrl
  }

  throw new Error('Billing is not configured yet.')
}

export async function createPortalUrl(account: AccountRecord) {
  const stripe = getStripeClient()
  if (stripe && account.stripeCustomerId) {
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: appUrl,
    })

    return session.url
  }

  if (configuredPortalUrl) {
    return configuredPortalUrl
  }

  throw new Error('Billing portal is not configured yet.')
}

export async function applyStripeSubscriptionUpdate(
  accountId: string,
  data: {
    plan: AccountRecord['plan']
    subscriptionStatus: AccountRecord['subscriptionStatus']
    stripeCustomerId?: string | null
    stripeSubscriptionId?: string | null
  },
) {
  return updateAccount(accountId, (account) => ({
    ...account,
    plan: data.plan,
    subscriptionStatus: data.subscriptionStatus,
    stripeCustomerId: data.stripeCustomerId ?? account.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId ?? account.stripeSubscriptionId,
    updatedAt: new Date().toISOString(),
  }))
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET ?? ''
}

export function constructStripeEvent(payload: Buffer, signature: string) {
  const stripe = getStripeClient()
  const webhookSecret = getStripeWebhookSecret()

  if (!stripe || !webhookSecret) {
    throw new Error('Stripe webhooks are not configured yet.')
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
}
