# Architecture

readyframe is a **contracts-first monorepo** with **modular layered APIs** and a thin React SPA. It is a modular monolith (optionally dual-language), not microservices and not a React Query meta-framework.

## Big picture

```
apps/web (Vite React SPA)
    │  same-origin /api proxy
    ▼
one API at a time ── apps/api (Fastify + Prisma)
                  └─ apps/api-python (FastAPI + SQLModel)
    ▲
shared Postgres schema
    ▲
packages/contracts  (DTOs, ApiError, JSON Schema)
packages/auth · ui · i18n
```

This repo keeps **both** API tracks so behavior can stay in parity. Generated apps (`create-readyframe`) include **one** backend only.

## Style of architecture

| Choice | What we mean |
|--------|----------------|
| **Monorepo** | pnpm workspaces + Turborepo: apps and shared packages in one repo |
| **Contracts-first** | `@repo/contracts` is the source of truth for request/response shapes and `ApiError` before UI or API changes |
| **Modular monolith** | One deployable API per track; features live in modules with clear layers, not separate services |
| **Layered modules** | router → controller (thin) → **service** (business logic) → model/store |
| **SPA + BFF-ish edge** | Browser talks only to same origin; Vite (dev) / reverse proxy (prod) forwards `/api` |
| **Cookie sessions** | httpOnly access/refresh cookies; no tokens in `localStorage` / `sessionStorage` |
| **Dual backend tracks** | Same contracts and schema; pick Node or Python without forking the product model |

## Why these choices

- **Contracts first** — frontend, Node API, and Python API share one vocabulary (`errorCode`, `errorKey`, DTOs). Schema export catches drift in CI.
- **Logic in services** — pages and route handlers stay thin; auth, idempotency, and domain rules are unit-testable. Matches the fail-rubric.
- **Modular monolith** — clear module boundaries without microservice ops cost while the product is early.
- **Same-origin cookies** — XSS cannot read session tokens; CSRF surface is constrained by same-site defaults and intentional cookie flags.
- **Dual tracks** — teams can start on Fastify or FastAPI with the same auth/health/`ApiError` behavior; `dual-backend` work keeps them aligned.
- **Shared packages** — `@repo/auth`, `@repo/ui`, `@repo/i18n` ship with the generator so scaffolds start production-shaped, not empty.

## Backend module layers

For non-trivial features (both tracks):

1. **router** — HTTP wiring, status codes, cookies, rate limits  
2. **controller / handlers** — parse input, call service, map response  
3. **service** — business logic (hashing, tokens, idempotency, domain rules)  
4. **model / store** — Prisma or SQLModel persistence  

Trivial one-liners may call a service directly; empty ceremony folders are discouraged.

API surface conventions: `/api/v1/...`, `x-request-id`, redacted logs, global + auth rate limits, security headers. Bounded lists use deterministic order, `limit`, and `nextCursor`.

## Frontend

- Vite React SPA with TanStack Query for server state  
- Auth forms, provider, and guards live in `@repo/auth` (not ad-hoc page logic)  
- User-facing copy goes through `@repo/i18n`  
- On login / logout / identity-changing refresh, clear prior-account React Query caches so private data cannot leak across users  
- Transactional email (Brevo) for verify/reset — see [`docs/features/email-brevo.md`](features/email-brevo.md) and [`docs/features/auth-email.md`](features/auth-email.md)

## Generator vs this repo

| This monorepo | Generated app |
|---------------|---------------|
| Known-good reference + both API tracks | Single backend (`node` or `fastapi`) |
| `templates:*` sync and `create-readyframe` CLI | No generator / template-sync scripts |
| Dual-backend parity agents/rules | Backend rule rewritten to one track |

Source of truth for scaffolds is the working tree → `pnpm templates:sync` → `templates/` → published `create-readyframe`.

## Quality bar

Opinionated gates (fail-rubric, coverage floors, axe, contract schema sync, CI) exist so architecture choices stay enforced, not optional folklore. See [`.cursor/rules/fail-rubric.mdc`](../.cursor/rules/fail-rubric.mdc) and [`rule-to-check-mapping.mdc`](../.cursor/rules/rule-to-check-mapping.mdc).

Deploy notes: [`deploy.md`](deploy.md).
