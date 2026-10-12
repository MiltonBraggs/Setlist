import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessControl, isLocalAddress } from '../src/access.ts';
import { Storage } from '../src/storage.ts';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setlist-access-'));
  storage = new Storage(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('AccessControl', () => {
  it('starts without a PIN', () => {
    const access = new AccessControl(storage);
    expect(access.pinSet).toBe(false);
    expect(access.signIn('1234', 'a')).toEqual({ error: 'No owner PIN is set.' });
  });

  it('sets a PIN, signs in, and remembers devices across restarts', () => {
    const access = new AccessControl(storage);
    const set = access.setPin('2468');
    expect('token' in set && set.token).toBeTruthy();
    expect(access.pinSet).toBe(true);

    expect(access.signIn('0000', 'phone')).toEqual({ error: 'Wrong PIN.' });
    const ok = access.signIn('2468', 'phone');
    expect('token' in ok).toBe(true);
    const token = (ok as { token: string }).token;
    expect(access.isOwnerToken(token)).toBe(true);
    expect(access.isOwnerToken('nope')).toBe(false);

    // Survives a restart, and the PIN itself is never stored in plain text.
    const reloaded = new AccessControl(new Storage(dir));
    expect(reloaded.isOwnerToken(token)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'auth.json'), 'utf8')).not.toContain('2468');
  });

  it('signs everyone out when the PIN changes or is removed', () => {
    const access = new AccessControl(storage);
    access.setPin('2468');
    const token = (access.signIn('2468', 'phone') as { token: string }).token;
    access.setPin('1357');
    expect(access.isOwnerToken(token)).toBe(false);
    access.setPin(null);
    expect(access.pinSet).toBe(false);
  });

  it('signs a device out', () => {
    const access = new AccessControl(storage);
    access.setPin('2468');
    const token = (access.signIn('2468', 'phone') as { token: string }).token;
    access.signOut(token);
    expect(access.isOwnerToken(token)).toBe(false);
  });

  it('rejects weak PINs and limits guessing', () => {
    const access = new AccessControl(storage);
    expect(access.setPin('12')).toEqual({ error: 'Use 4 to 32 characters, without spaces.' });
    access.setPin('2468');
    for (let i = 0; i < 5; i++) expect(access.signIn('0000', 'attacker')).toEqual({ error: 'Wrong PIN.' });
    expect(access.signIn('2468', 'attacker')).toEqual({ error: 'Too many attempts. Try again in a minute.' });
    expect('token' in access.signIn('2468', 'someone-else')).toBe(true);
  });

  it('recognises the host computer', () => {
    expect(isLocalAddress('127.0.0.1')).toBe(true);
    expect(isLocalAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalAddress('192.168.1.20')).toBe(false);
  });
});
