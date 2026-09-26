# Auth email (verify & password reset)

## What

Email verification after register and password reset via single-use, TTL-bound tokens. Links open web pages that show distinct UI for **used**, **expired**, and **valid** tokens.

## Who

- API (`apps/api` / `apps/api-python`) issues hashed tokens, sends Brevo mail, and consumes tokens
- Web (`apps/web`) pages: `/verify-email`, `/check-email`, `/forgot-password`, `/reset-password`

## Token UX states (required)

| Status | When | UI |
|--------|------|----|
| **used** | `usedAt` set (successfully consumed) | Copy + **Login** only |
| **expired** | `expiresAt` in the past and not used | Copy + **Resend** / forgot CTA + **Login** |
| **valid** | unused and not expired | Verify action / reset password form |
| **invalid** | unknown / wrong purpose / superseded | Generic invalid + **Login** |

## Data model

- `User.emailVerifiedAt` (`DateTime?`) — null until verified
- `User.pendingEmail` (`String?`) — reserved for future email-change; when set, consuming `email_verify` swaps `email ← pendingEmail`
- `AuthEmailToken`: `userId`, `type` (`email_verify` \| `password_reset`), `tokenHash` (unique), `expiresAt`, `usedAt?`, `createdAt`
- Index: `(userId, type)`
- Raw tokens: `randomBytes` base64url; **only** SHA-256 hashes stored
- Issuing a new token **deletes** previous unused tokens of the same type for that user

## API (`/api/v1/auth/...`)

| Method | Path | Body | Notes |
|--------|------|------|--------|
| POST | `/email-token/inspect` | `{ token, purpose: 'email_verify'\|'password_reset' }` | Non-consuming; `{ status }` |
| POST | `/verify-email` | `{ token }` | Consumes; `{ verified: true }` |
| POST | `/resend-verification` | `{ email }` | Rate-limited; always `{ ok: true }` |
| POST | `/forgot-password` | `{ email }` | Rate-limited; always `{ ok: true }` (no email existence leak) |
| POST | `/reset-password` | `{ token, password }` | Consumes; sets password; revokes all refresh sessions |

### Error codes (consume paths)

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_TOKEN_USED` | 409 | Already consumed |
| `AUTH_TOKEN_EXPIRED` | 410 | Past TTL, unused |
| `AUTH_TOKEN_INVALID` | 400 | Unknown / wrong purpose |

Register still issues session cookies; verification is additive (`emailVerifiedAt` starts null). Verify email is best-effort: register succeeds even if Brevo is disabled or send fails (error logged, never logs raw tokens).

## Mail links

- Verify: `${APP_PUBLIC_URL}/verify-email?token=...`
- Reset: `${APP_PUBLIC_URL}/reset-password?token=...`
- TTL: `AUTH_VERIFY_EMAIL_TTL_MINUTES` (default 60), `AUTH_RESET_PASSWORD_TTL_MINUTES` (default 30)

## Related

- [Email (Brevo)](email-brevo.md)
