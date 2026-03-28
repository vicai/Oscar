# Oscar

Adaptive chess web app with:

- React + Vite frontend
- Express API
- Stockfish 18 Lite backend engine
- File-backed multi-user persistence

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

## Persistence

By default, Oscar stores data in:

```bash
./data/oscar-db.json
```

You can override the storage directory with:

```bash
DATA_DIR=/var/data
```

This is recommended for Render persistent disks.

## Render Settings

Recommended first deploy:

- Root Directory: leave blank
- Build Command: `pnpm install --frozen-lockfile && pnpm build`
- Start Command: `pnpm start`
- Health Check Path: `/healthz`

If using a persistent disk on a paid Render instance:

- mount path: `/var/data`
- environment variable: `DATA_DIR=/var/data`

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start
```
