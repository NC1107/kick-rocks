const EMAIL = /([^\s<>"'(),;]+@[^\s<>"'(),;]+\.[^\s<>"'(),;]*[^\s<>"'(),;.])/;

const isCapturedEmail = (index: number): boolean => index % 2 === 1;

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
            {part}
          </span>
        ) : (
          part
        );
      })}
    </>
  );
}
