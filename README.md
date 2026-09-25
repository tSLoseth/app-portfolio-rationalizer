# Application Portfolio Rationalizer

TIME × 6R × cloud business case × migration roadmap for a fictional 150-system portfolio
(*Nordlys Gruppen ASA (fiktiv)*). Deterministic, tested rule engine; every cost parameter is
labelled with a source or marked as an estimate.

> Work in progress — see `PLAN.md` for scope and steps.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dashboard (Vite) |
| `npm run build` | Typecheck and build static site to `dist/` |
| `npm test` | Run the engine tests (vitest) |
| `npm run generate` | Regenerate `data/portfolio.json` from the fixed seed |
| `npm run typecheck` | TypeScript only |

## Layout

- `src/model` — shared types (the data contract)
- `src/engine` — TIME, 6R, cost and roadmap rules
- `src/ui` — React dashboard
- `data/` — generated portfolio + assumptions
- `scripts/` — generator and build-time scripts
