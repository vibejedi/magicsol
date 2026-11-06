import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { useLobby } from "@/components/use-lobby";
import { claimDaily, renameSeat, requestPayout } from "@/lib/arena/server";
import { ECONOMY } from "@/lib/duel/tables";

export const Route = createFileRoute("/purse")({ component: PursePage });

function when(at: string): string {
  return at.slice(0, 16).replace("T", " ");
}

function PursePage() {
  const { isPending, signedIn, lobby, error, refresh } = useLobby();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(String(ECONOMY.payoutMin));
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lobby) setName(lobby.profile.displayName);
  }, [lobby]);

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setNote(null);
    try {
      const result = await task();
      if (!result.ok) setNote(result.error ?? "That didn't land.");
      await refresh();
    } catch (caught) {
      setNote(caught instanceof Error ? caught.message : "That didn't land.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell auric={lobby?.profile.auric}>
      <p className="text-xs tracking-widest text-copper uppercase">Purse</p>
      <h1 className="mt-2 font-display text-4xl">Play money, written down</h1>
      <p className="mt-2 max-w-xl text-sm text-pretty text-muted">
        Withdrawable Auric is ranked profit only — not the opening purse, not the daily stake.
        A payout request is queued on this ledger. Nothing here is cash, a bank transfer, or crypto.
      </p>
      {isPending ? <div className="mt-6 h-32 animate-pulse rounded-2xl bg-surface" /> : null}
      {!isPending && !signedIn ? (
        <div className="mt-6 max-w-sm">
          <SignInPanel />
        </div>
      ) : null}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {note ? <p className="mt-4 text-sm text-danger">{note}</p> : null}
      {lobby ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-xs tracking-widest text-muted uppercase">Balance</p>
              <p className="font-display text-4xl tabular-nums text-copper">
                {lobby.profile.auric.toLocaleString()}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted">Ranked profit</dt>
                  <dd className="tabular-nums">
                    {lobby.profile.profit >= 0 ? "+" : ""}
                    {lobby.profile.profit.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Withdrawable</dt>
                  <dd className="tabular-nums">{lobby.profile.withdrawable.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted">Rating</dt>
                  <dd className="tabular-nums">{lobby.profile.rating}</dd>
                </div>
                <div>
                  <dt className="text-muted">Record</dt>
                  <dd className="tabular-nums">
                    {lobby.profile.wins}–{lobby.profile.losses}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                disabled={busy || lobby.profile.claimedToday}
                onClick={() => void run(() => claimDaily())}
                className="mt-4 h-12 w-full rounded-xl bg-copper text-sm font-medium text-bg disabled:opacity-40"
              >
                {lobby.profile.claimedToday
                  ? "Today's stake is in"
                  : `Take today's ${ECONOMY.daily}`}
              </button>
            </section>
            <section className="rounded-2xl border border-border bg-surface p-4">
              <label className="text-sm text-muted" htmlFor="seat-name">
                Seat name
              </label>
              <input
                id="seat-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={18}
                className="mt-2 h-12 w-full rounded-xl border border-border bg-bg px-3 text-base text-fg"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => renameSeat({ data: name }))}
                className="mt-3 h-11 rounded-xl border border-border px-4 text-sm"
              >
                Save name
              </button>
            </section>
            <section className="rounded-2xl border border-border bg-surface p-4">
              <label className="text-sm text-muted" htmlFor="payout-amount">
                Queue a payout
              </label>
              <input
                id="payout-amount"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
                className="mt-2 h-12 w-full rounded-xl border border-border bg-bg px-3 text-base text-fg tabular-nums"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => requestPayout({ data: Number(amount) }))}
                className="mt-3 h-12 w-full rounded-xl border border-copper text-sm text-copper"
              >
                Queue {Number(amount) || 0} on the ledger
              </button>
              <p className="mt-3 text-xs text-pretty text-muted">
                Minimum {ECONOMY.payoutMin}. Status stays queued. Auric is not a cash balance.
              </p>
            </section>
          </div>
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="font-display text-xl">Ledger</h2>
              <ul className="mt-3 divide-y divide-border">
                {lobby.ledger.map((row) => (
                  <li key={row.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="text-fg">{row.note}</span>
                      <span className="mt-0.5 block text-xs text-muted">{when(row.at)}</span>
                    </span>
                    <span className={`tabular-nums ${row.amount >= 0 ? "text-ion" : "text-danger"}`}>
                      {row.amount >= 0 ? "+" : ""}
                      {row.amount.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="font-display text-xl">Payouts</h2>
              {lobby.payouts.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None queued.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {lobby.payouts.map((row) => (
                    <li key={row.id} className="flex justify-between gap-3">
                      <span className="tabular-nums">{row.amount.toLocaleString()} · {row.status}</span>
                      <span className="text-xs text-muted">{when(row.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border border-border bg-surface p-4">
              <h2 className="font-display text-xl">Duels</h2>
              {lobby.history.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No ranked hands yet.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {lobby.history.map((row) => (
                    <li key={row.id} className="flex justify-between gap-3">
                      <span className="capitalize">
                        {row.tableId} · {row.status}
                      </span>
                      <span className="tabular-nums text-muted">
                        {row.payout > 0 ? `+${row.payout}` : `−${row.stake}`} ·{" "}
                        {row.ratingDelta >= 0 ? "+" : ""}
                        {row.ratingDelta}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      ) : null}
      <p className="mt-8 max-w-xl text-xs text-pretty text-muted">
        Phase is a non-commercial Magic rules project. A paid table on those cards isn't allowed, so Auric
        keeps the part that can be yours: stakes, a board, and a purse, on original rules.
      </p>
    </Shell>
  );
}
