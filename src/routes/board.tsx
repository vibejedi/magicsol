import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { useLobby } from "@/components/use-lobby";

export const Route = createFileRoute("/board")({ component: BoardPage });

function BoardPage() {
  const { isPending, signedIn, lobby, error } = useLobby();

  return (
    <Shell auric={lobby?.profile.auric}>
      <p className="text-xs tracking-widest text-copper uppercase">Season board</p>
      <h1 className="mt-2 font-display text-4xl">Who cleared the rake</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Ranked profit, then rating. Practice hands never touch this list. Names are the ones you set in the purse.
      </p>
      {isPending ? <div className="mt-6 h-40 animate-pulse rounded-2xl bg-surface" /> : null}
      {!isPending && !signedIn ? (
        <div className="mt-6 max-w-sm">
          <SignInPanel />
        </div>
      ) : null}
      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
      {lobby ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border">
          {lobby.youRank ? (
            <p className="border-b border-border bg-surface px-4 py-3 text-sm text-muted">
              Your rank {lobby.youRank} · rating {lobby.profile.rating} · profit{" "}
              {lobby.profile.profit >= 0 ? "+" : ""}
              {lobby.profile.profit.toLocaleString()}
            </p>
          ) : (
            <p className="border-b border-border bg-surface px-4 py-3 text-sm text-muted">
              Unranked until a bought-in duel ends.
            </p>
          )}
          {lobby.board.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted">The board is quiet. Win a ranked table to stamp a name.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-widest text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-2 py-3 font-medium">Seat</th>
                  <th className="px-2 py-3 font-medium">Profit</th>
                  <th className="px-2 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">W–L</th>
                </tr>
              </thead>
              <tbody>
                {lobby.board.map((row) => (
                  <tr key={`${row.rank}-${row.name}`} className={row.you ? "bg-surface text-ion" : "border-t border-border"}>
                    <td className="px-4 py-3 tabular-nums">{row.rank}</td>
                    <td className="px-2 py-3">{row.name}</td>
                    <td className="px-2 py-3 tabular-nums text-copper">
                      {row.profit >= 0 ? "+" : ""}
                      {row.profit.toLocaleString()}
                    </td>
                    <td className="px-2 py-3 tabular-nums">{row.rating}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.wins}–{row.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </Shell>
  );
}
