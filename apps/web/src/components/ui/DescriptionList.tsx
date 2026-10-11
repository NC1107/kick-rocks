import type { ReactNode } from "react";
import { FactList } from "./FactList.js";

export interface DescriptionItem {
  term: string;
  description: ReactNode;
}

/** Labelled facts about one thing, without a box. A FactList with the older item shape. */
export function DescriptionList({
  items,
  className,
}: {
  items: readonly DescriptionItem[];
  className?: string;
}) {
  return (
    <FactList
      bordered={false}
      {...(className ? { className } : {})}
      items={items.map((item) => ({ term: item.term, value: item.description }))}
    />
  );
}
