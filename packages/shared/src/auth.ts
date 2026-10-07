import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

export const Password = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const AuthState = z.object({
  /** True until the first password is set. */
  setupRequired: z.boolean(),
  authenticated: z.boolean(),
});
export type AuthState = z.infer<typeof AuthState>;

export const SetupBody = z.object({ password: Password });
export const LoginBody = z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH) });
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: Password,
});

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;
