import bcrypt from "bcryptjs";
import { isPasswordWithinPolicy } from "./password-policy";

const SALT_ROUNDS = 12;

export function isValidPassword(password: string): boolean {
  return isPasswordWithinPolicy(password);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
