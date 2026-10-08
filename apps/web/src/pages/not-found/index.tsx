import { EmptyState, LinkButton, PageHeader } from "../../components/ui/index.js";

export function Component() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="That page does not exist."
        description="The address may be mistyped, or the page may have moved."
        actions={<LinkButton to="/">Go to the dashboard</LinkButton>}
      />
    </>
  );
}
