import { useEffect, useState } from 'react';
import { setOwnerPin, signIn, signOut, useAccess, useStore } from '../store.ts';
import { Button, Dialog, TextInput } from './ui.tsx';

/** Owner PIN entry for bandmates' devices. Closes itself once the device becomes owner. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState('');
  const error = useStore((s) => s.authError);
  const { isOwner } = useAccess();
  useEffect(() => {
    if (isOwner) onClose();
  }, [isOwner, onClose]);
  const submit = () => pin && signIn(pin);
  return (
    <Dialog title="Owner sign-in" onClose={onClose}>
      <p className="mt-0 mb-4 text-[15px] text-muted">Enter the owner PIN to control the show from this device.</p>
      <TextInput
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        aria-label="Owner PIN"
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && (
        <p role="alert" className="mt-3 mb-0 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!pin}>
          Sign in
        </Button>
      </div>
    </Dialog>
  );
}

/** Owner: set, change or remove the PIN. */
export function PinDialog({ onClose }: { onClose: () => void }) {
  const { pinSet } = useAccess();
  const error = useStore((s) => s.authError);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const mismatch = confirm.length > 0 && pin !== confirm;
  const valid = /^\S{4,32}$/.test(pin) && pin === confirm;

  // Close once the server accepted the change (no error came back).
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => !useStore.getState().authError && onClose(), 400);
    return () => clearTimeout(t);
  }, [submitted, onClose]);

  return (
    <Dialog title={pinSet ? 'Change owner PIN' : 'Set an owner PIN'} onClose={onClose}>
      <p className="mt-0 mb-4 text-[15px] text-muted">
        {pinSet
          ? 'Every other owner device will need to enter the new PIN.'
          : 'Once a PIN is set, other devices open as viewers with the permissions you choose. This computer always stays owner.'}
      </p>
      <div className="flex flex-col gap-3">
        <TextInput autoFocus type="password" inputMode="numeric" autoComplete="new-password" aria-label="New PIN" placeholder="New PIN (4 or more characters)" value={pin} onChange={(e) => setPin(e.target.value)} />
        <TextInput
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          aria-label="Confirm PIN"
          placeholder="Confirm PIN"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && valid && (setOwnerPin(pin), setSubmitted(true))}
        />
      </div>
      {(mismatch || error) && (
        <p role="alert" className="mt-3 mb-0 text-sm text-danger">
          {mismatch ? 'The PINs don’t match.' : error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2.5">
        {pinSet && (
          <Button
            variant="ghost"
            className="mr-auto !text-danger"
            onClick={() => {
              if (confirm_('Remove the PIN? Every device will have full control again.')) {
                setOwnerPin(null);
                setSubmitted(true);
              }
            }}
          >
            Remove PIN
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => {
            setOwnerPin(pin);
            setSubmitted(true);
          }}
        >
          Save PIN
        </Button>
      </div>
    </Dialog>
  );
}

function confirm_(text: string) {
  return window.confirm(text);
}

/** Pill in the nav showing this device's role. */
export function RoleBadge() {
  const { isOwner, pinSet } = useAccess();
  const [open, setOpen] = useState(false);
  if (!pinSet) return null;
  if (isOwner) {
    return (
      <button
        type="button"
        title="Signed in as owner. Click to sign out this device."
        onClick={() => window.confirm('Sign out this device? It will become a viewer.') && signOut()}
        className="min-h-9 shrink-0 rounded-full bg-fg/[0.07] px-3 text-xs font-semibold text-fg"
      >
        Owner
      </button>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-9 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-onaccent">
        Viewer · Sign in
      </button>
      {open && <SignInDialog onClose={() => setOpen(false)} />}
    </>
  );
}
