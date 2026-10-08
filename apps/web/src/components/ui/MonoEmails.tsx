const EMAIL = /([^\s<>"'(),;]+@[^\s<>"'(),;]+\.[^\s<>"'(),;]*[^\s<>"'(),;.])/;

/** Prose with every email address in it set in mono, since an address is an identifier. */
export function MonoEmails({ text }: { text: string }) {
  let offset = 0;
  return (
    <>
      {text.split(EMAIL).map((part, index) => {
        const start = offset;
        offset += part.length;
        // split() puts the captured addresses at the odd positions.
        return index % 2 === 1 ? (
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
