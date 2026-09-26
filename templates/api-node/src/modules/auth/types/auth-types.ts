import type { AuthUser } from "@repo/contracts";

export type AuthUserSerializable = {
  id: string;
  email: string;
  role: "user" | "admin";
  emailVerifiedAt: Date | null;
  pendingEmail: string | null;
  createdAt: Date;
};

export function toAuthUser(user: AuthUserSerializable): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    pendingEmail: user.pendingEmail,
    createdAt: user.createdAt.toISOString(),
  };
}
