import { useState } from "react";
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router";
import { CardFace } from "@/components/card-face";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { useLobby } from "@/components/use-lobby";
import { startMatch } from "@/lib/arena/server";
import { ECONOMY, TABLES, potMath, type TableId } from "@/lib/duel/tables";

export const Route = createFileRoute("/")({ component: Home });

const RULES = [
  { n: "01", text: "Energy grows by one each turn, up to 8, and refills." },
  { n: "02", text: "Guard units must be struck before the player." },
  { n: "03", text: "Haste strikes the turn it lands. Everything else waits." },
  { n: "04", text: "The house matches your buy-in. Winner takes the pot, minus the rake." },
];

function Home() {
  const { isPending, lobby, error, signedIn, refresh } = useLobby();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function sit(tableId: TableId) {
    setNote(null);
    if (lobby?.activeMatchId) {
      void navigate({ to: "/play/$matchId", params: { matchId: lobby.activeMatchId } });
      return;
    }
    setBusy(tableId);
    try {
      const result = await startMatch({ data: tableId });
      if (!result.ok) {
        setNote(result.error);
        if (result.matchId) {
          void navigate({ to: "/play/$matchId", params: { matchId: result.matchId } });
        }
        return;
      }
      await refresh();
      void navigate({ to: "/play/$matchId", params: { matchId: result.matchId } });
    } catch {
      setNote("The table didn't open.");
    } finally {
      setBusy(null);
    }
  }

  const ranked = TABLES.filter((table) => table.id !== "practice");

  return (
    <Shell auric={lobby?.profile.auric}>
      <section className="grid items-end gap-8 py-6 sm:grid-cols-[1.2fr_0.8fr] sm:py-10">
        <div>
          <p className="text-xs tracking-widest text-copper uppercase">Stake table</p>
          <h1 className="mt-2 font-display text-5xl sm:text-6xl">Buy in. Play the hand.</h1>
          <p className="mt-4 max-w-xl text-pretty text-muted">
            Auric is an original duel with a house rake, a public board, and a play-money purse.
            It is not Magic, and it does not run the Phase engine. Chips are not cash.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/scratch"
              className="grid h-12 place-items-center rounded-xl bg-ion px-5 text-sm font-medium text-bg"
            >
              Deal a practice hand
            </Link>
            {lobby?.activeMatchId ? (
              <Link
                to="/play/$matchId"
                params={{ matchId: lobby.activeMatchId }}
                className="grid h-12 place-items-center rounded-xl border border-copper px-5 text-sm text-copper"
              >
                Return to the open duel
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex items-end justify-center sm:justify-end">
          <div className="-rotate-6">
            <CardFace defId="lantern-squire" />
          </div>
          <div className="z-10 -mx-6 -mt-6">
            <CardFace defId="vesper-knight" />
          </div>
          <div className="rotate-6">
            <CardFace defId="pit-colossus" />
          </div>
        </div>
      </section>

      <ol className="grid gap-3 sm:grid-cols-4">
        {RULES.map((rule) => (
          <li key={rule.n} className="rounded-2xl border border-border bg-surface px-4 py-3">
            <span className="font-display text-copper">{rule.n}</span>
            <p className="mt-1 text-sm text-fg">{rule.text}</p>
          </li>
        ))}
      </ol>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl">Tables</h2>
          <p className="text-sm text-muted">Opening purse {ECONOMY.opening.toLocaleString()}</p>
        </div>
        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {note ? <p className="mb-3 text-sm text-danger">{note}</p> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          {ranked.map((table) => {
            const math = potMath(table);
            const short = signedIn && lobby ? Math.max(0, table.stake - lobby.profile.auric) : 0;
            let label = `Sit \u00b7 ${table.stake.toLocaleString()}`;
            if (!signedIn) label = "Sign in to sit";
            else if (lobby?.activeMatchId) label = "Finish the open duel";
            else if (short > 0) label = `Short ${short.toLocaleString()}`;
            else if (busy === table.id) label = "Dealing\u2026";
            return (
              <article key={table.id} className="flex flex-col rounded-2xl border border-border bg-surface p-4">
                <p className="text-xs tracking-widest text-copper uppercase">{table.name}</p>
                <p className="mt-2 font-display text-3xl tabular-nums">{table.stake.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted">{table.blurb}</p>
                <p className="mt-3 text-sm text-fg">
                  Prize {math.prize.toLocaleString()} \u00b7 net {math.net > 0 ? "+" : ""}
                  {math.net.toLocaleString()} if you win
                </p>
                <button
                  type="button"
                  disabled={!signedIn || short > 0 || busy !== null}
                  onClick={() => void sit(table.id as TableId)}
                  className="mt-4 h-12 rounded-xl border border-copper text-sm text-copper disabled:opacity-40"
                >
                  {label}
                </button>
              </article>
            );
          })}
        </div>
        {isPending ? (
          <div className="mt-4 h-12 animate-pulse rounded-xl bg-surface" />
        ) : !signedIn ? (
          <div className="mt-6 max-w-sm">
            <p className="mb-3 text-sm text-muted">
              Ranked pots, the board, and payout requests need a seat with your name on it.
            </p>
            <SignInPanel />
          </div>
        ) : null}
      </section>
    </Shell>
  );
}
