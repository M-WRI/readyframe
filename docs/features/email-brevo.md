# Email (Brevo)

## What

Transactional email via [Brevo](https://developers.brevo.com/) HTTP API (`POST /v3/smtp/email`). Used for auth verify/reset and other product mail.

## Who

API (`apps/api` or `apps/api-python`) sends mail. Developers configure Brevo in the **repo root** `.env` (never commit it).

## Config (root `.env`)

| Variable | Purpose |
|----------|---------|
| `BREVO_ENABLED` | `true` to send; `false` = no-op (CI/local default) |
| `BREVO_API_KEY` | Brevo API key |
| `BREVO_SENDER_EMAIL` | Verified sender in Brevo |
| `BREVO_SENDER_NAME` | Display name (default `App`) |
| `APP_PUBLIC_URL` | SPA origin for verify/reset links |

See [`.env.example`](../../.env.example).

## Code

- Node: [`apps/api/src/lib/mailer/`](../../apps/api/src/lib/mailer/) — `createMailer`, templates (`smoke`, `welcome`, `verify_email`, `reset_password`)
- Python: [`apps/api-python/app/lib/mailer/`](../../apps/api-python/app/lib/mailer/) — same behavior
- Logs are secret-safe: no API key; recipient shown as `***@domain`

## Brevo IP authorization (important)

New Brevo accounts often email **you** (the account owner) to authorize the sending IP the first time API sends mail. That is **not** part of your product emails.

1. Open the Brevo “authorize IP” mail and approve **your** machine/server IP once.
2. Or in Brevo dashboard: Security / authorized IPs — add your current public IP.
3. After that, users only receive your templates (verify / reset), not Brevo trust prompts.

Never build an in-app flow asking end users to confirm IPs.

## Errors

- `MAIL_SEND_FAILED` (502) when Brevo returns a non-OK status — `errors.common.mailSendFailed`

## Related

- [Auth email (verify / reset)](auth-email.md)
