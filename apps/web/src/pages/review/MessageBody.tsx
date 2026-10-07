import { API_ROUTES } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { Alert, Button, SkeletonText } from "../../components/ui/index.js";

function FullText({ messageId }: { messageId: string }) {
  const query = useApiQuery(API_ROUTES.messageGet, { params: { id: messageId } });
  if (query.isPending) return <SkeletonText lines={4} />;
  if (query.isError) {
    return (
      <Alert intent="danger" title="Could not load the message">
        {errorMessage(query.error)}
      </Alert>
    );
  }
  return (
    <pre className="m-0 whitespace-pre-wrap break-words rounded-md bg-sunken p-3 font-sans text-base text-ink">
      {query.data.text ?? "This message has no text."}
    </pre>
  );
}

/** The start of a message, with a button to read all of it and another at the top to fold it away. */
export function MessageBody({ messageId, snippet }: { messageId: string; snippet: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = (
    <Button
      size="sm"
      variant="secondary"
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
    >
      {expanded ? "Show less" : "Read the whole message"}
    </Button>
  );
  return (
    <div className="flex flex-col items-start gap-2">
      {expanded ? toggle : null}
      {expanded ? (
        <div className="w-full">
          <FullText messageId={messageId} />
        </div>
      ) : snippet ? (
        <p className="break-words text-base text-ink">{snippet}</p>
      ) : null}
      {toggle}
    </div>
  );
}
