import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CardBack, CardFace } from "@/components/card-face";
import type { Action, Target } from "@/lib/duel/engine";
import type { MatchView, PublicUnit } from "@/lib/duel/view";
import { watchAudio } from "@/lib/sfx";

type Aim = { kind: "play"; handIndex: number } | { kind: "attack"; unitUid: string } | null;

function sameTarget(action: Action, target: Target): boolean {
  if (action.type === "end" || !("target" in action) || !action.target) return false;
  if (action.target.kind !== target.kind) return false;
  if (action.target.kind === "unit" && target.kind === "unit") return action.target.uid === target.uid;
  return true;
}

function Pips({ energy, max }: { energy: number; max: number }) {
  return (
    <div className="flex gap-1" aria-label={`${energy} of ${max} energy`}>
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          className={`h-1.5 w-3 rounded-full ${
            index < energy ? "bg-copper" : index < max ? "bg-copper/35" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function Life({ value, shake = false }: { value: number; shake?: boolean }) {
  return (
    <p className={`font-display text-4xl tabular-nums ${value <= 8 ? "text-danger" : "text-fg"} ${shake ? "hit" : ""}`}>
      {value}
    </p>
  );
}

export function DuelTable({
  view,
  pending = false,
  error,
  onAction,
  onForfeit,
  onAgain,
  againLabel = "Sit again",
}: {
  view: MatchView;
  pending?: boolean;
  error?: string | null;
  onAction: (action: Action) => void;
  onForfeit: () => void;
  onAgain?: () => void;
  againLabel?: string;
}) {
  const [aim, setAim] = useState<Aim>(null);
  const [armForfeit, setArmForfeit] = useState(false);
  const [shakeYou, setShakeYou] = useState(false);
  const prevLife = useRef(view.you.life);

  useEffect(() => watchAudio(), []);

  useEffect(() => {
    if (view.you.life < prevLife.current) {
      setShakeYou(true);
      const timer = window.setTimeout(() => setShakeYou(false), 220);
      prevLife.current = view.you.life;
      return () => window.clearTimeout(timer);
    }
    prevLife.current = view.you.life;
  }, [view.you.life]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAim(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const yourTurn = view.status === "active" && view.turn === "you" && !pending;

  function playable(index: number): boolean {
    return view.actions.some((action) => action.type === "play" && action.handIndex === index);
  }

  function clickHand(index: number) {
    if (!yourTurn) return;
    const options = view.actions.filter(
      (action): action is Extract<Action, { type: "play" }> =>
        action.type === "play" && action.handIndex === index,
    );
    if (options.length === 0) return;
    if (options.length === 1 && !options[0]?.target) {
      setAim(null);
      onAction(options[0]);
      return;
    }
    setAim({ kind: "play", handIndex: index });
  }

  function clickOwn(unit: PublicUnit) {
    if (!yourTurn || !unit.ready) return;
    const attacks = view.actions.filter(
      (action) => action.type === "attack" && action.unitUid === unit.uid,
    );
    if (attacks.length === 0) return;
    setAim({ kind: "attack", unitUid: unit.uid });
  }

  function clickTarget(target: Target) {
    if (!aim || !yourTurn) return;
    const match = view.actions.find((action) => {
      if (aim.kind === "play") {
        return action.type === "play" && action.handIndex === aim.handIndex && sameTarget(action, target);
      }
      return action.type === "attack" && action.unitUid === aim.unitUid && sameTarget(action, target);
    });
    if (!match) return;
    setAim(null);
    onAction(match);
  }

  function targetableUnit(uid: string): boolean {
    if (!aim) return false;
    return view.actions.some((action) => {
      if (aim.kind === "play" && action.type === "play" && action.handIndex === aim.handIndex) {
        return action.target?.kind === "unit" && action.target.uid === uid;
      }
      if (aim.kind === "attack" && action.type === "attack" && action.unitUid === aim.unitUid) {
        return action.target.kind === "unit" && action.target.uid === uid;
      }
      return false;
    });
  }

  const faceTarget =
    aim !== null &&
    view.actions.some((action) => {
      if (aim.kind === "play") {
        return action.type === "play" && action.handIndex === aim.handIndex && action.target?.kind === "face";
      }
      return action.type === "attack" && action.unitUid === aim.unitUid && action.target.kind === "face";
    });

  const last = view.log[view.log.length - 1] ?? "The felt is quiet.";

  return (
    <section className={`min-w-0 rounded-3xl border border-border bg-bg/70 p-3 sm:p-5 ${pending ? "opacity-80" : ""}`}>
      {view.status !== "active" ? (
        <div className="mb-4 rounded-2xl border border-copper/40 bg-surface px-4 py-4">
          <p className="text-xs tracking-widest text-copper uppercase">
            {view.tableName}
            {view.stake > 0 ? ` · ${view.stake} in` : ""}
          </p>
          <h2 className="font-display text-3xl">
            {view.status === "won" ? "The pot is yours" : "The pot stays"}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted">
            {view.stake === 0
              ? "No chips moved. Ranked tables are the ones that hit the purse."
              : view.status === "won"
                ? `You take ${view.payout.toLocaleString()}. The house keeps ${view.rake.toLocaleString()}. Rating ${view.ratingDelta >= 0 ? "+" : ""}${view.ratingDelta}.`
                : `The ${view.stake.toLocaleString()} buy-in stays down. Rating ${view.ratingDelta >= 0 ? "+" : ""}${view.ratingDelta}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onAgain ? (
              <button
                type="button"
                onClick={onAgain}
                className="h-11 rounded-xl bg-ion px-4 text-sm font-medium text-bg"
              >
                {againLabel}
              </button>
            ) : null}
            <Link to="/" className="grid h-11 place-items-center rounded-xl border border-border px-4 text-sm">
              Back to the pit
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">The house</p>
          <Life value={view.foe.life} />
          <Pips energy={view.foe.energy} max={view.foe.maxEnergy} />
        </div>
        <div className="text-right text-xs text-muted">
          <p>{view.foe.deckCount} in deck</p>
          <p>{view.foe.handCount} in hand</p>
        </div>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {Array.from({ length: Math.min(view.foe.handCount, 8) }, (_, index) => (
          <CardBack key={index} />
        ))}
      </div>

      <div className="flex min-h-24 gap-2 overflow-x-auto pb-2">
        {view.foe.board.length === 0 ? (
          <p className="py-6 text-sm text-muted">No units across the table.</p>
        ) : (
          view.foe.board.map((unit) => (
            <CardFace
              key={unit.uid}
              defId={unit.defId}
              atk={unit.atk}
              hp={unit.hp}
              wounded={unit.hp < unit.maxHp}
              targetable={targetableUnit(unit.uid)}
              onClick={aim && targetableUnit(unit.uid) ? () => clickTarget({ kind: "unit", uid: unit.uid }) : undefined}
            />
          ))
        )}
      </div>

      <div className="my-3 flex flex-wrap items-center justify-between gap-2 border-y border-border py-3">
        <p className="min-h-6 text-sm text-fg" aria-live="polite">
          {pending ? "The house is playing…" : last}
        </p>
        <button
          type="button"
          disabled={!faceTarget}
          onClick={() => clickTarget({ kind: "face" })}
          className={`h-11 rounded-full border px-4 text-sm ${
            faceTarget ? "border-copper text-copper" : "border-border text-muted"
          }`}
        >
          Rival life
        </button>
      </div>

      {aim ? (
        <p className="mb-2 text-sm text-copper">
          Choose a target.{" "}
          <button type="button" className="underline" onClick={() => setAim(null)}>
            Cancel
          </button>
        </p>
      ) : null}
      {error ? <p className="mb-2 text-sm text-danger">{error}</p> : null}

      <div className="mb-3 flex min-h-24 gap-2 overflow-x-auto pb-2">
        {view.you.board.length === 0 ? (
          <p className="py-6 text-sm text-muted">Your lane is empty.</p>
        ) : (
          view.you.board.map((unit) => {
            const can = yourTurn && view.actions.some((action) => action.type === "attack" && action.unitUid === unit.uid);
            return (
              <CardFace
                key={unit.uid}
                defId={unit.defId}
                atk={unit.atk}
                hp={unit.hp}
                wounded={unit.hp < unit.maxHp}
                ready={unit.ready && view.status === "active"}
                selected={aim?.kind === "attack" && aim.unitUid === unit.uid}
                dim={!can && yourTurn && unit.ready === false}
                onClick={can ? () => clickOwn(unit) : undefined}
              />
            );
          })
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3">
        {view.you.hand.map((id, index) => (
          <CardFace
            key={`${id}-${index}`}
            defId={id}
            dim={!playable(index)}
            selected={aim?.kind === "play" && aim.handIndex === index}
            onClick={yourTurn && playable(index) ? () => clickHand(index) : undefined}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">You · {view.you.deckCount} left</p>
          <Life value={view.you.life} shake={shakeYou} />
          <Pips energy={view.you.energy} max={view.you.maxEnergy} />
        </div>
        <div className="flex flex-wrap gap-2">
          {view.status === "active" ? (
            armForfeit ? (
              <>
                <button
                  type="button"
                  onClick={onForfeit}
                  disabled={pending}
                  className="h-11 rounded-xl border border-danger px-4 text-sm text-danger"
                >
                  {view.stake > 0 ? "Forfeit the buy-in" : "Forfeit the hand"}
                </button>
                <button type="button" onClick={() => setArmForfeit(false)} className="h-11 px-3 text-sm text-muted">
                  Keep playing
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setArmForfeit(true)} className="h-11 px-3 text-sm text-muted">
                Forfeit
              </button>
            )
          ) : null}
          <button
            type="button"
            disabled={!yourTurn}
            onClick={() => {
              setAim(null);
              onAction({ type: "end" });
            }}
            className="h-12 rounded-xl bg-copper px-5 text-sm font-medium text-bg disabled:opacity-40"
          >
            {pending ? "Waiting" : "End turn"}
          </button>
        </div>
      </div>
      {view.stake > 0 && view.status === "active" ? (
        <p className="mt-3 text-xs text-muted">
          {view.tableName} pot {(view.stake * 2).toLocaleString()} · prize {view.prize.toLocaleString()} after a{" "}
          {view.rake.toLocaleString()} rake. Guards first. Haste strikes immediately.
        </p>
      ) : view.status === "active" ? (
        <p className="mt-3 text-xs text-muted">
          Guards must be struck before the player. Haste strikes the turn it lands. Energy grows and refills.
        </p>
      ) : null}
    </section>
  );
}
