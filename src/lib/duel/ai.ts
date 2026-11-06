import { applyAction, legalActions, type Action, type GameState, type Seat } from "./engine.ts";
import type { Difficulty } from "./tables.ts";

const NOISE: Record<Difficulty, number> = {
  copper: 0.55,
  silver: 0.08,
  gold: 0,
};

function power(units: GameState["players"][number]["board"]): number {
  return units.reduce((sum, unit) => {
    const guard = unit.keywords.includes("guard") ? 2 : 0;
    return sum + unit.atk * 2 + unit.hp + guard;
  }, 0);
}

function evaluate(state: GameState, seat: Seat, difficulty: Difficulty): number {
  if (state.winner === seat) return 1_000_000;
  if (state.winner !== null) return -1_000_000;
  const me = state.players[seat];
  const opp = state.players[seat === 0 ? 1 : 0];
  const lifeWeight = difficulty === "gold" ? 5 : 4;
  return (
    (me.life - opp.life) * lifeWeight +
    power(me.board) -
    power(opp.board) * (difficulty === "gold" ? 1.2 : 1.05) +
    me.hand.length * 3 -
    opp.hand.length * 2 +
    me.deck.length * 0.15 +
    me.energy * 0.35
  );
}

function urgency(action: Action): number {
  if (action.type === "attack" && action.target.kind === "face") return 3;
  if (action.type === "attack") return 2;
  if (action.type === "play") return 1;
  return 0;
}

export function chooseAiAction(
  state: GameState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): Action {
  const seat = state.turn;
  const actions = legalActions(state, seat);
  const end = actions.find((action) => action.type === "end") ?? { type: "end" as const };
  if (actions.length === 0) return end;
  if (rng() < NOISE[difficulty]) {
    const messy = actions.filter((action) => action.type !== "end");
    if (messy.length > 0) {
      return messy[Math.floor(rng() * messy.length)] ?? end;
    }
  }
  let best: Action = end;
  let bestScore = -Infinity;
  for (const action of actions) {
    const next = applyAction(state, seat, action);
    const score = evaluate(next, seat, difficulty);
    if (score > bestScore + 1e-9) {
      best = action;
      bestScore = score;
    } else if (Math.abs(score - bestScore) <= 1e-9 && urgency(action) > urgency(best)) {
      best = action;
    }
  }
  return best;
}

/** Plays the rival's whole turn. The stored match is always yours, or over. */
export function runAi(
  state: GameState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): GameState {
  let next = state;
  let guard = 0;
  while (next.winner === null && next.turn === 1 && guard < 40) {
    const action = chooseAiAction(next, difficulty, rng);
    next = applyAction(next, 1, action);
    guard += 1;
    if (action.type === "end") break;
  }
  if (next.winner === null && next.turn === 1) {
    const end = legalActions(next, 1).find((action) => action.type === "end");
    if (end) next = applyAction(next, 1, end);
  }
  return next;
}

/** Human action, then the rival's full turn if it became theirs. */
export function afterYou(
  state: GameState,
  action: Action,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): GameState {
  let next = applyAction(state, 0, action);
  if (next.winner === null && next.turn === 1) next = runAi(next, difficulty, rng);
  return next;
}
