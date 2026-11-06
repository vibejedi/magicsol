import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (!isPending && user) return <Navigate to="/" />;
  return (
    <Shell>
      <div className="mx-auto max-w-sm py-10">
        <p className="text-xs tracking-widest text-copper uppercase">Seat</p>
        <h1 className="mt-2 font-display text-4xl">Sign in to stake</h1>
        <p className="mt-3 text-sm text-pretty text-muted">
          Practice is open without an account. The purse, the board, and ranked pots need a name.
        </p>
        <div className="mt-6">
          {isPending ? <div className="h-24 animate-pulse rounded-2xl bg-surface" /> : <SignInPanel />}
        </div>
      </div>
    </Shell>
  );
}
