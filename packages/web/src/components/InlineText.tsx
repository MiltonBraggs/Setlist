import { Fragment } from 'react';
import { parseInline, type InlineToken } from '@setlist/core';

/** Render `**bold**` / `*italic*` tokens. */
export function InlinePieces({ pieces }: { pieces: InlineToken[] }) {
  return (
    <>
      {pieces.map((t, i) =>
        t.bold ? <strong key={i}>{t.text}</strong> : t.italic ? <em key={i}>{t.text}</em> : <Fragment key={i}>{t.text}</Fragment>,
      )}
    </>
  );
}

/** Render a string with `**bold**` / `*italic*` markup. */
export function InlineText({ text }: { text: string }) {
  return <InlinePieces pieces={parseInline(text)} />;
}
