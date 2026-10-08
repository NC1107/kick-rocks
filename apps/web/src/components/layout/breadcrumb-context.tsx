import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { Crumb } from "./breadcrumb.js";

interface BreadcrumbTailValue {
  tail: Crumb | undefined;
  setTail: (crumb: Crumb | undefined) => void;
}

const BreadcrumbTailContext = createContext<BreadcrumbTailValue>({
  tail: undefined,
  setTail: () => undefined,
});

export function BreadcrumbTailProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<Crumb | undefined>();
  const value = useMemo(() => ({ tail, setTail }), [tail]);
  return <BreadcrumbTailContext value={value}>{children}</BreadcrumbTailContext>;
}

export function useBreadcrumbTailValue(): Crumb | undefined {
  return useContext(BreadcrumbTailContext).tail;
}

/** A detail page names itself in the header trail once it has loaded: `useBreadcrumbTail(name)`. */
export function useBreadcrumbTail(label: string | undefined, mono = false): void {
  const { setTail } = useContext(BreadcrumbTailContext);
  useEffect(() => {
    if (!label) return;
    setTail({ label, mono });
    return () => setTail(undefined);
  }, [label, mono, setTail]);
}
