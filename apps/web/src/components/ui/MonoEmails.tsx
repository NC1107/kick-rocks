import { Fragment } from "react";

const EMAIL = /([^\s<>"'(),;]+@[^\s<>"'(),;]+\.[^\s<>"'(),;]*[^\s<>"'(),;.])/;

const isCapturedEmail = (index: number): boolean => index % 2 === 1;

/**
 * An address that wraps at its @ and its dots and never inside a word, so a narrow screen breaks
 * `privacy@maplewood.example` into readable pieces instead of cutting a label in two.
 */
export function BreakableAddress({ text }: { text: string }) {
  const pieces = text.split(/(?<=[@.])/);
  return (
    <>
      {pieces.map((piece, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces are static text with no identity
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {piece}
        </Fragment>
      ))}
    </>
  );
}

/** Prose with every email address in it set in mono, since an address is an identifier. */
export function MonoEmails({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split(EMAIL).map((part, index) => {
        const start = offset;
        offset += part.length;
        return isCapturedEmail(index) ? (
          <span key={start} className="font-mono text-meta">
            <BreakableAddress text={part} />
          </span>
        ) : (
          part
        );
      })}
    </>
  );
}
