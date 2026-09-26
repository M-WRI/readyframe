# Deploy guide (Step 2 stub)

## Goal

Push to `main` → CI green → deploy web + API + Postgres with **minimal ops**.

Default security model: **same-origin** — browser talks to one host; `/api` is reverse-proxied to the API so httpOnly cookies stay simple and solid.

## CI (already in repo)

GitHub Actions workflow: `.github/workflows/ci.yml`

Runs on every PR and push to `main`:

1. `pnpm install --frozen-lockfile`
2. format check (Biome)
3. lint / typecheck / test / build (Turbo)

Dependabot: `.github/dependabot.yml` (npm, GitHub Actions; pip path reserved for FastAPI template).

## Local Postgres

Preferred (Docker Desktop / OrbStack / Colima):

```bash
docker compose up -d
# DATABASE_URL=postgresql://asa:asa@localhost:5432/asa  (from root .env)
```

No Docker? Use a free hosted Postgres (Neon, Supabase, Railway) and put its connection string in root `.env` as `DATABASE_URL`, or install Postgres via Homebrew (`brew install postgresql@16` and create role/db `asa`).

API DB scripts load the **repo root** `.env` (`cp .env.example .env`), same as `pnpm --filter @repo/api dev`.

### FastAPI track (`apps/api-python`)

Requires [uv](https://docs.astral.sh/uv/) (installer puts it in `~/.local/bin`). Package scripts prepend that path automatically.

```bash
# If schema already applied by Prisma:
pnpm --filter @repo/api-python db:stamp
# Or apply via Alembic:
pnpm --filter @repo/api-python db:migrate

pnpm --filter @repo/api-python dev
# Schema sync vs packages/contracts:
pnpm --filter @repo/api-python schema:sync
```

Node and Python backends share the same Postgres table layout; run **one** API at a time on `API_PORT` (default 3000).

## Deploy preference (wizard later)

| Choice | When | Notes |
|--------|------|--------|
| **paas** (recommended) | Least ops | Web: Cloudflare Pages or Vercel. API: Fly.io or Railway (Dockerfile). DB: managed Postgres (Neon, Railway, Supabase, Fly). Put a reverse proxy or host rewrite so `/api` is same-origin. |
| **docker-compose** | One VPS | Use `docker-compose.prod.yml` + Caddy/Traefik for TLS and `/api` → API. |
| **ci-only** | Deploy later | Pipelines only; no host wiring yet. |

## Secrets (never commit)

- `DATABASE_URL`
- `JWT_SECRET` (min length enforced at API boot)
- `POSTGRES_PASSWORD` (compose/prod)
- `BREVO_API_KEY` (when `BREVO_ENABLED=true`)
- Cookie / CORS settings only if you deviate from same-origin

See root [`.env.example`](../.env.example) for Brevo + auth email TTL placeholders. Feature docs: [`features/email-brevo.md`](features/email-brevo.md), [`features/auth-email.md`](features/auth-email.md).

## Readiness (later steps)

- Liveness: `GET /api/v1/health`
- Readiness: DB ping endpoint (added with APIs)

## Out of scope for Step 2

Real API/web images and migrations on release are in place for both tracks. Quality gates (contract / coverage / axe) are enforced in CI (Step 9).
