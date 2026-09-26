# readyframe

Production-minded monorepo starter **and** app generator: Vite React web, dual backends (Fastify + FastAPI), shared contracts/UI/auth/i18n, Cursor agents/rules, and CI quality gates toward ~9/10.

**Repository:** [github.com/M-WRI/readyframe](https://github.com/M-WRI/readyframe)

**Architecture:** contracts-first modular monolith — see [`docs/architecture.md`](docs/architecture.md).

## Prerequisites

- Node.js **22+** (`.nvmrc`)
- **pnpm** 9: `corepack enable && corepack prepare pnpm@9.15.9 --activate`
- **Postgres** (Docker Compose, Homebrew, or hosted)
- **uv** + Python 3.12 only if you use the FastAPI track (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

---

## How to: run this repo (downloaded / cloned)

If you cloned **this** project and want to develop it as your app, you do **not** need `create-readyframe`. Install and run:

```bash
git clone git@github.com:M-WRI/readyframe.git
cd readyframe
cp .env.example .env
pnpm install
docker compose up -d    # or point DATABASE_URL at your Postgres
```

Run **one** API on `:3000` (web proxies `/api` → that origin):

```bash
# Node (Fastify + Prisma)
pnpm --filter @repo/api db:migrate
pnpm --filter @repo/api dev

# OR Python (FastAPI) — stamp if Prisma already migrated the schema
pnpm --filter @repo/api-python db:stamp
pnpm --filter @repo/api-python dev

# Web (separate terminal)
pnpm --filter @repo/web dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000` (`GET /api/v1/health`)

Full gate: `pnpm check`.

---

## How to: create a new app

Use this when you want a **separate** project folder (not nested under `apps/` of this repo). Prefer scaffolding as a **sibling** directory.

### A. From this repo (`pnpm create-readyframe`)

```bash
cd readyframe
pnpm install

# Interactive
pnpm create-readyframe --outDir ..

# Non-interactive (sibling folder ../my-app)
pnpm create-readyframe -- my-app --backend node --locales de --deploy paas --yes --outDir ..
```

### B. From npm (`npx`) — after the CLI is published

```bash
npx create-readyframe@latest my-app
# Non-interactive:
npx create-readyframe@latest my-app --backend node --locales de --deploy paas --yes
```

### After scaffold

```bash
cd my-app          # or ../my-app
cp .env.example .env
pnpm install
docker compose up -d
# Node track:
pnpm --filter @repo/api db:migrate && pnpm --filter @repo/api dev
# Web:
pnpm --filter @repo/web dev
```

| Flag | Values | Default |
|------|--------|---------|
| (name) | kebab-case project folder | prompted |
| `--backend` | `node` \| `fastapi` | prompted |
| `--locale` | default locale | `en` |
| `--locales` | extra locales, comma-separated | none |
| `--deploy` | `paas` \| `docker-compose` \| `ci-only` | prompted / `paas` with `--yes` |
| `--yes` | skip prompts (needs name + `--backend`) | off |
| `--outDir` | parent directory for the project | cwd (`INIT_CWD` for `pnpm create-readyframe`) |

Generated apps include **one** backend only, plus `.cursor/rules` and specialized agents.

---

## Version log

| Version | Date | Key features |
|---------|------|----------------|
| **1.4.0** | 2026-09-26 | Brevo transactional email + auth verify/reset (dual-backend), `.env.example` Brevo/TTL vars, auth email web pages |
| **1.3.0** | 2026-09-09 | Expand fail-rubric + agent guidance (cache isolation, pagination completeness, idempotency scoping, dual-backend drift) |
| **1.2.0** | 2026-09-09 | Rebrand to **readyframe** / `create-readyframe` (GitHub + npm) |
| **1.1.0** | 2026-09-08 | Quality hardening: credential-bound idempotent register, atomic register/refresh transactions, ApiError-shaped HTTP (429/404/405/400), semantic contract schema sync (UUID/date-time AuthUser), auth UI field/network errors + ≥80% coverage scope, isolated Postgres HTTP/DB regression tests, strict BCP-47 locale validation, create-app TS/lint isolation from packed templates, fail-rubric ↔ CI mapping, single-track generated rules/agents |
| **1.0.0** | 2026-09-08 | Initial release: Vite/React web, Fastify+Prisma and FastAPI+SQLModel tracks, `@repo/contracts` ApiError + JSON Schema, httpOnly cookie auth + RBAC + Idempotency-Key, `@repo/ui` / i18n / auth packages, CI + coverage floors + axe, CLI with bundled templates, Cursor fail-rubric + parallel agents |

---

## Apps & packages

| Path | Role |
|------|------|
| `apps/web` | Vite React SPA — auth routes, CSP, no prod sourcemaps, `/api` proxy |
| `apps/api` | Fastify + Prisma + Postgres |
| `apps/api-python` | FastAPI + SQLModel + Alembic (behavior mirror) |
| `packages/contracts` | ApiError, auth/RBAC DTOs, JSON Schema |
| `packages/ui` | Tokens + seed atoms |
| `packages/i18n` | Auth/error catalogs |
| `packages/auth` | Cookie client, forms, guards, axe smoke |
| `packages/create-readyframe` | Published as `create-readyframe` (`npx` / `pnpm create-readyframe`) |
| `templates/*` | Folded copies for the generator |
| `.cursor/agents/` | One-purpose subagents for parallel work |

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm create-readyframe` | Wizard / flags → new app from `templates/` |
| `pnpm check` | format + lint + typecheck + test + axe + build + contract + templates |
| `pnpm templates:sync` / `templates:check` | Rewrite / verify `templates/` vs working tree |
| `pnpm test:a11y` | axe smoke on auth forms |
| `pnpm check:contracts` | Zod→JSON Schema drift + Python schema sync |

After changing apps/packages/root config: `pnpm templates:sync`.

## Quality & security

CI enforces format, lint, typecheck, coverage floors, axe, build (no prod sourcemaps), contract drift, templates sync, generator smoke, and Python Ruff/mypy/pytest.

Defaults: httpOnly cookies only; `/api/v1`; request-id; auth rate limits; Idempotency-Key on register; roles `user` \| `admin`. Brevo verify/reset: [`docs/features/`](docs/features/). See [`.env.example`](.env.example), [`docs/architecture.md`](docs/architecture.md), and [`docs/deploy.md`](docs/deploy.md).

## Publish the CLI

```bash
pnpm templates:sync
pnpm --filter create-readyframe pack
npm login
pnpm --filter create-readyframe publish --access public
```
