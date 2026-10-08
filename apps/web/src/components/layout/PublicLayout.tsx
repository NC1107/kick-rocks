import { Outlet } from "react-router";
import { Logo } from "./Logo.js";
import { ThemeToggle } from "./ThemeToggle.js";

/** The frame for /setup and /login: one centered column, no navigation. */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col px-gutter py-6">
      <header className="flex justify-end">
        <ThemeToggle />
      </header>
      <main id="main" className="m-auto flex w-full max-w-sm flex-col gap-6 py-10">
        <Logo className="self-center" />
        <Outlet />
      </main>
    </div>
  );
}
