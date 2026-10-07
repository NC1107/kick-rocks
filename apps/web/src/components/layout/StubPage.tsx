import type { RouteDef } from "@kickrocks/shared";
import { Construction } from "lucide-react";
import { Card, DescriptionList, EmptyState, PageHeader } from "../ui/index.js";

export interface StubPageProps {
  title: string;
  description: string;
  /** The page's own file, so its owner knows where to start. */
  file: string;
  /** The mock handler file for this page's data. */
  mock?: string;
  routes?: readonly Pick<RouteDef, "method" | "path">[];
  /** The route's own parameters, such as the id in /targets/:id. */
  params?: Readonly<Record<string, string | undefined>>;
}

/** A placeholder for a page another module builds. Its owner replaces the file's contents. */
export function StubPage({ title, description, file, mock, routes, params }: StubPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="Not built yet"
        description="This page is a placeholder. Replace the component in the file below; the route, navigation, and mock API are already in place."
      />
      <Card className="mt-6">
        <DescriptionList
          items={[
            { term: "Page file", description: <code className="font-mono text-sm">{file}</code> },
            ...Object.entries(params ?? {}).map(([name, value]) => ({
              term: `Route parameter ${name}`,
              description: <code className="font-mono text-sm">{value}</code>,
            })),
            ...(mock
              ? [
                  {
                    term: "Mock handlers",
                    description: <code className="font-mono text-sm">{mock}</code>,
                  },
                ]
              : []),
            ...(routes?.length
              ? [
                  {
                    term: "API routes",
                    description: (
                      <ul className="m-0 list-none p-0">
                        {routes.map((route) => (
                          <li key={`${route.method} ${route.path}`}>
                            <code className="font-mono text-sm">
                              {route.method} /api{route.path}
                            </code>
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
