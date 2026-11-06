import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DuelTable } from "@/components/duel-table";
import { Shell } from "@/components/shell";
import { useLobby } from "@/components/use-lobby";
import { afterYou } from "@/lib/duel/ai";
import { concede, createMatch, type Action, type GameState } from "@/lib/duel/engine";
import { tableById } from "@/lib/duel/tables";
import { projectPlaying } from "@/lib/duel/view";
import { blip, setMuted, unlockAudio } from "@/lib/sfx";

export const Route = createFileRoute("/scratch")({ component: ScratchPage });

const practice = tableById("practice");

function cue(status: string, log: string[]) {
  if (status === "won") blip("win");
  else if (status === "lost") blip("lose");
  else {
    const last = log[log.length - 1] ?? "";
    if (last.includes("strike") || last.includes("spark") || last.includes("seize")) blip("hit");
    else if (last.includes("plays") || last.includes("coin")) blip("play");
    else blip("end");
  }
}

function ScratchPage() {
  const { lobby } = useLobby();
  const [state, setState] = useState<GameState>(() => createMatch(4041));
  const [muted, setMute] = useState(false);
  if (!practice) return null;
  const view = projectPlaying(state, practice, "scratch");

  function commit(next: GameState) {
    setState(next);
    cue(next.winner === null ? "active" : next.winner === 0 ? "won" : "lost", next.log);
  }

  function onAction(action: Action) {
    unlockAudio();
    if (state.winner !== null || state.turn !== 0) return;
    commit(afterYou(state, action, "copper"));
  }

  return (
    <Shell auric={lobby?.profile.auric}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-copper uppercase">Practice</p>
          <h1 className="font-display text-3xl">A free hand</h1>
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
      <DuelTable
        view={view}
        onAction={onAction}
        onForfeit={() => {
          unlockAudio();
          commit(concede(state, 0));
        }}
        onAgain={() => {
          unlockAudio();
          setState(createMatch(Math.floor(Math.random() * 1_000_000_000)));
        }}
        againLabel="Deal again"
      />
    </Shell>
  );
}
