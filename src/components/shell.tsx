import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LINKS = [
  { to: "/", label: "Pit" },
  { to: "/board", label: "Board" },
  { to: "/purse", label: "Purse" },
] as const;

function lit(path: string, to: string): boolean {
  if (to === "/") return path === "/" || path.startsWith("/scratch") || path.startsWith("/play");
  return path === to;
}

export function Shell({
  children,
  auric,
}: {
  children: ReactNode;
  auric?: number | null;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { user, isPending } = useCurrentUserState();

  return (
    <div className="felt min-h-screen">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-copper font-display text-lg text-copper">
            A
          </span>
          <span className="font-display text-2xl leading-none">Auric</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`rounded-full px-3 py-2 ${
                lit(path, link.to) ? "bg-surface text-copper" : "text-muted"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {typeof auric === "number" ? (
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm tabular-nums text-copper">
              {auric.toLocaleString()} Auric
            </span>
          ) : null}
          <div className="auth-chip">
            {isPending ? (
              <div className="h-8 w-8 animate-pulse rounded-full bg-surface-2" />
            ) : user ? (
              <UserButton />
            ) : (
              <Link to="/login" className="text-sm text-copper">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pb-16">{children}</main>
    </div>
  );
}
