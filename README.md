# Oscar

Chess web app with:

- React + Vite frontend
- Express API
- Stockfish-backed gameplay
- Account sessions with free vs premium gating
- File-backed persistence for v1

## Local Development

```bash
pnpm install
pnpm dev
```

Frontend:

- `http://localhost:5173`

API:

- `http://localhost:3001`

## Production

Build:

```bash
pnpm build
```

Start:

```bash
pnpm start
```

The production server:

- serves the built frontend from `dist/`
- exposes API routes under `/api`
- exposes health checks at `/healthz`

## Storage

By default, Oscar stores data in:

```bash
./data/oscar-db.json
```

You can override the storage directory with:

```bash
DATA_DIR=/var/data
```

This is recommended for a Render persistent disk.

## Billing And Plans

Oscar now supports:

- free accounts
- premium Best Move gating
- daily free game caps
- Stripe-ready checkout and billing portal endpoints

Supported environment variables:

```bash
FREE_DAILY_GAME_CAP=5
FREE_RATING_CAP=2000
PREMIUM_EMAILS=you@example.com,friend@example.com
APP_URL=https://your-render-url.onrender.com
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_PREMIUM_PRICE_ID=price_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CHECKOUT_URL=https://buy.stripe.com/...          # optional fallback
STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/... # optional fallback
```

Notes:

- `PREMIUM_EMAILS` is a useful bootstrap override if you want to grant premium before Stripe is fully wired.
- If `STRIPE_SECRET_KEY` and `STRIPE_PREMIUM_PRICE_ID` are set, Oscar will create real Stripe subscription checkout sessions.
- If Stripe is not fully configured, you can still use hosted Stripe links with `STRIPE_CHECKOUT_URL` and `STRIPE_CUSTOMER_PORTAL_URL`.

## Render Settings

Recommended first deploy:

- Root Directory: leave blank
- Build Command: `pnpm install --frozen-lockfile && pnpm build`
- Start Command: `pnpm start`
- Health Check Path: `/healthz`

Recommended env vars on Render:

- `APP_URL=https://your-app.onrender.com`
- `FREE_DAILY_GAME_CAP=5`
- `FREE_RATING_CAP=2000`

If using a persistent disk on a paid Render instance:

- mount path: `/var/data`
- environment variable: `DATA_DIR=/var/data`

For Stripe production:

- add `STRIPE_SECRET_KEY`
- add `STRIPE_PREMIUM_PRICE_ID`
- add `STRIPE_WEBHOOK_SECRET`
- configure Stripe webhook target:
  - `https://your-app.onrender.com/api/stripe/webhook`

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start
```
