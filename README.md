# Oscar

Adaptive chess web app with:

- React + Vite frontend
- Express API
- Stockfish 18 Lite backend engine
- File-backed multi-user persistence in `data/oscar-db.json`

## Run

```bash
pnpm install
pnpm dev
```

Frontend:

- `http://localhost:5173`

API:

- `http://localhost:3001`

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm start:server
```

## Product Notes

- Every profile starts with adaptive rating `100`.
- Win: rating increases.
- Loss: rating decreases.
- Draw: small adjustment toward stability.
- The displayed rating is an app difficulty score, not an official Elo system.

## Persistence

The app creates `data/oscar-db.json` on first use. That file is intentionally ignored by git.
