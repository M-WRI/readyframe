"""Auth email tokens + User email verification columns.

Mirrors Node Prisma migrations:
- 20260925220000_auth_email_tokens
- 20260925230000_user_pending_email
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "20260926120000_auth_email_tokens"
down_revision: str | None = "20260308120000_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3)')
    op.execute('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT')
    op.execute("""
    DO $$ BEGIN
        CREATE TYPE "AuthEmailTokenType" AS ENUM ('email_verify', 'password_reset');
    EXCEPTION
        WHEN duplicate_object THEN null;
        WHEN unique_violation THEN null;
    END $$;
    """)
    op.execute("""
    CREATE TABLE IF NOT EXISTS "AuthEmailToken" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "type" "AuthEmailTokenType" NOT NULL,
        "tokenHash" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "usedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuthEmailToken_pkey" PRIMARY KEY ("id")
    );
    """)
    op.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS "AuthEmailToken_tokenHash_key" '
        'ON "AuthEmailToken"("tokenHash")'
    )
    op.execute(
        'CREATE INDEX IF NOT EXISTS "AuthEmailToken_userId_type_idx" '
        'ON "AuthEmailToken"("userId", "type")'
    )
    op.execute("""
    DO $$ BEGIN
        ALTER TABLE "AuthEmailToken"
            ADD CONSTRAINT "AuthEmailToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;
    """)


def downgrade() -> None:
    op.execute(
        'ALTER TABLE "AuthEmailToken" DROP CONSTRAINT IF EXISTS "AuthEmailToken_userId_fkey"'
    )
    op.execute('DROP TABLE IF EXISTS "AuthEmailToken"')
    op.execute('DROP TYPE IF EXISTS "AuthEmailTokenType"')
    op.execute('ALTER TABLE "User" DROP COLUMN IF EXISTS "pendingEmail"')
    op.execute('ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerifiedAt"')
