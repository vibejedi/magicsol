import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DuelTable } from "@/components/duel-table";
import { Shell } from "@/components/shell";
import { SignInPanel } from "@/components/sign-in-panel";
import { useLobby } from "@/components/use-lobby";
import { act, forfeitMatch, getMatch, startMatch } from "@/lib/arena/server";
import type { Action } from "@/lib/duel/engine";
import type { TableId } from "@/lib/duel/tables";
import type { MatchView } from "@/lib/duel/view";
import { blip, setMuted, unlockAudio } from "@/lib/sfx";

export const Route = createFileRoute("/play/$matchId")({ component: PlayPage });

function cue(view: MatchView) {
  if (view.status === "won") blip("win");
  else if (view.status === "lost") blip("lose");
  else {
    const last = view.log[view.log.length - 1] ?? "";
    if (last.includes("strike") || last.includes("spark") || last.includes("seize")) blip("hit");
    else if (last.includes("plays") || last.includes("coin")) blip("play");
    else blip("end");
  }
}

function PlayPage() {
  const { matchId } = Route.useParams();
  const navigate = useNavigate();
  const { isPending, signedIn, lobby, refresh } = useLobby();
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [muted, setMute] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancel = false;
    setPending(true);
    getMatch({ data: matchId })
      .then((result) => {
        if (cancel) return;
        if (!result.ok) setError(result.error);
        else setView(result.view);
      })
      .catch(() => {
        if (!cancel) setError("Could not open that duel.");
      })
      .finally(() => {
        if (!cancel) setPending(false);
      });
    return () => {
      cancel = true;
    };
  }, [signedIn, matchId]);

  async function onAction(action: Action) {
    if (!view || pending) return;
    unlockAudio();
    setPending(true);
    setError(null);
    try {
      const result = await act({ data: { matchId, action } });
      if (!result.ok) {
        setError(result.error);
        if (result.view) setView(result.view);
        return;
      }
      setView(result.view);
      cue(result.view);
      if (result.view.status !== "active") void refresh();
    } catch {
      setError("The table didn't answer.");
    } finally {
      setPending(false);
    }
  }

  async function again() {
    if (!view) return;
    if (view.tableId !== "copper" && view.tableId !== "silver" && view.tableId !== "gold") return;
    setPending(true);
    setError(null);
    try {
      const result = await startMatch({ data: view.tableId as TableId });
      if (!result.ok) {
        setError(result.error);
        if (result.matchId) {
          void navigate({ to: "/play/$matchId", params: { matchId: result.matchId } });
        }
        return;
      }
      void navigate({ to: "/play/$matchId", params: { matchId: result.matchId } });
    } catch {
      setError("The table didn't open.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Shell auric={lobby?.profile.auric}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-copper uppercase">{view?.tableName ?? "Duel"}</p>
          <h1 className="font-display text-3xl">The felt</h1>
        </div>
        <button
          type="button"
          className="h-11 rounded-full border border-border px-4 text-sm text-muted"
          onClick={() => {
            const next = !muted;
            setMute(next);
            setMuted(next);
          }}
        >
          {muted ? "Sound off" : "Sound on"}
        </button>
      </div>
      {isPending ? <div className="h-64 animate-pulse rounded-3xl bg-surface" /> : null}
      {!isPending && !signedIn ? (
        <div className="max-w-sm">
          <p className="mb-3 text-sm text-muted">This duel is on a named seat.</p>
          <SignInPanel />
        </div>
      ) : null}
      {signedIn && !view && !error ? <div className="h-64 animate-pulse rounded-3xl bg-surface" /> : null}
      {signedIn && error && !view ? <p className="text-sm text-danger">{error}</p> : null}
      {view ? (
        <DuelTable
          view={view}
          pending={pending}
          error={error}
          onAction={(action) => void onAction(action)}
          onForfeit={() => {
            unlockAudio();
            setPending(true);
            forfeitMatch({ data: matchId })
              .then((result) => {
                if (!result.ok) setError(result.error);
                else {
                  setView(result.view);
                  cue(result.view);
                  void refresh();
                }
              })
              .catch(() => setError("The forfeit didn't land."))
              .finally(() => setPending(false));
          }}
          onAgain={view.stake > 0 ? () => void again() : undefined}
          againLabel="Sit this table again"
        />
      ) : null}
    </Shell>
  );
}
