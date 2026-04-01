# Oscar

Chess web app with:

- React + Vite frontend
- Express API
- Stockfish-backed gameplay
- Supabase-backed auth and data
- Stripe-ready billing hooks

## Local Development

1. Install dependencies:

```bash
pnpm install
```

2. Create a local env file from `.env.example` and set:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
APP_URL=http://localhost:3001
```

3. In the Supabase SQL editor, run:

```sql
-- contents of supabase/schema.sql
```

4. Optional: migrate current local JSON data:

```bash
pnpm migrate:supabase
```

5. Start the app:

```bash
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

## Supabase

Oscar expects these env vars:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_publishable_or_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Notes:

- `VITE_SUPABASE_ANON_KEY` is safe for browser use.
- `SUPABASE_SERVICE_ROLE_KEY` must remain server-only.
- Oscar uses Supabase Auth plus app tables in `supabase/schema.sql`.
- Guest mode is implemented as Supabase anonymous auth.

## Billing And Plans

Supported environment variables:

```bash
FREE_DAILY_GAME_CAP=5
FREE_RATING_CAP=2000
PREMIUM_EMAILS=you@example.com,friend@example.com
APP_URL=https://your-render-url.onrender.com
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_PREMIUM_PRICE_ID=price_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CHECKOUT_URL=https://buy.stripe.com/...
STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/...
```

## Render Settings

Recommended deploy:

- Root Directory: leave blank
- Build Command: `pnpm install --frozen-lockfile && pnpm build`
- Start Command: `pnpm start`
- Health Check Path: `/healthz`

Required Render env vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL=https://your-app.onrender.com`

Optional env vars:

- `FREE_DAILY_GAME_CAP`
- `FREE_RATING_CAP`
- Stripe env vars if billing is enabled

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start
pnpm migrate:supabase
```
