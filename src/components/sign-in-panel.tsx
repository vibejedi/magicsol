import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";

export function SignInPanel() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      {GROK_PROVIDERS.map((provider, index) => (
        <button
          key={provider.providerId}
          type="button"
          onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
          className={
            index === 0
              ? "h-12 rounded-xl bg-copper px-4 text-base font-medium text-bg"
              : "h-12 rounded-xl border border-border bg-surface px-4 text-base font-medium text-fg"
          }
        >
          Continue with {provider.label}
        </button>
      ))}
    </div>
  );
}
