import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthData, Storage } from './storage.ts';

const MAX_TOKENS = 50;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
export const PIN_PATTERN = /^\S{4,32}$/;

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isLocalAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Owner PIN and remembered owner devices.
 * - No PIN set: every device is owner (first-run behavior).
 * - PIN set: the host computer and devices that entered the PIN are owners; everyone else is a viewer.
 */
export class AccessControl {
  private auth: AuthData;
  private attempts = new Map<string, number[]>();

  constructor(private storage: Storage) {
    this.auth = storage.loadAuth();
  }

  get pinSet(): boolean {
    return this.auth.pin !== null;
  }

  isOwnerToken(token: string | undefined): boolean {
    return !!token && this.auth.tokens.includes(hashToken(token));
  }

  /** Too many wrong PINs from this client recently? */
  private rateLimited(clientKey: string): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(clientKey) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
    this.attempts.set(clientKey, recent);
    return recent.length >= MAX_ATTEMPTS;
  }

  /** Returns a new owner token, or an error message. */
  signIn(pin: string, clientKey: string): { token: string } | { error: string } {
    if (!this.auth.pin) return { error: 'No owner PIN is set.' };
    if (this.rateLimited(clientKey)) return { error: 'Too many attempts. Try again in a minute.' };
    const expected = Buffer.from(this.auth.pin.hash, 'hex');
    const actual = Buffer.from(hashPin(String(pin), this.auth.pin.salt), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      this.attempts.get(clientKey)!.push(Date.now());
      return { error: 'Wrong PIN.' };
    }
    const token = randomBytes(24).toString('hex');
    this.auth.tokens = [...this.auth.tokens, hashToken(token)].slice(-MAX_TOKENS);
    this.storage.saveAuth(this.auth);
    return { token };
  }

  signOut(token: string | undefined) {
    if (!token) return;
    const h = hashToken(token);
    this.auth.tokens = this.auth.tokens.filter((t) => t !== h);
    this.storage.saveAuth(this.auth);
  }

  /**
   * Set, change or remove the PIN. Every remembered owner device is signed out.
   * Returns a fresh token for the device that made the change, or an error.
   */
  setPin(pin: string | null): { token?: string } | { error: string } {
    if (pin !== null && !PIN_PATTERN.test(pin)) return { error: 'Use 4 to 32 characters, without spaces.' };
    this.auth.tokens = [];
    if (pin === null) {
      this.auth.pin = null;
      this.storage.saveAuth(this.auth);
      return {};
    }
    const salt = randomBytes(16).toString('hex');
    this.auth.pin = { salt, hash: hashPin(pin, salt) };
    const token = randomBytes(24).toString('hex');
    this.auth.tokens = [hashToken(token)];
    this.storage.saveAuth(this.auth);
    return { token };
  }
}
