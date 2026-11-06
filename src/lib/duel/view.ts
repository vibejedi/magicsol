import type { GameState, Action, Unit } from "./engine.ts";
import { legalActions } from "./engine.ts";
import { potMath, type TableDef } from "./tables.ts";

export type PublicUnit = {
  uid: string;
  defId: string;
  atk: number;
  hp: number;
  maxHp: number;
  ready: boolean;
  keywords: Unit["keywords"];
};

export type MatchView = {
  matchId: string;
  tableId: string;
  tableName: string;
  stake: number;
  prize: number;
  rake: number;
  status: "active" | "won" | "lost";
  winner: "you" | "foe" | null;
  turn: "you" | "foe";
  log: string[];
  you: {
    life: number;
    energy: number;
    maxEnergy: number;
    deckCount: number;
    hand: string[];
    board: PublicUnit[];
  };
  foe: {
    life: number;
    energy: number;
    maxEnergy: number;
    deckCount: number;
    handCount: number;
    board: PublicUnit[];
  };
  actions: Action[];
  payout: number;
  ratingDelta: number;
};

function pub(unit: Unit): PublicUnit {
  return {
    uid: unit.uid,
    defId: unit.defId,
    atk: unit.atk,
    hp: unit.hp,
    maxHp: unit.maxHp,
    ready: unit.ready,
    keywords: unit.keywords,
  };
}

export function projectPlaying(
  state: GameState,
  table: TableDef,
  matchId: string,
  payout = 0,
  ratingDelta = 0,
): MatchView {
  const math = potMath(table);
  const status = state.winner === null ? "active" : state.winner === 0 ? "won" : "lost";
  const you = state.players[0];
  const foe = state.players[1];
  return {
    matchId,
    tableId: table.id,
    tableName: table.name,
    stake: table.stake,
    prize: math.prize,
    rake: math.rake,
    status,
    winner: state.winner === null ? null : state.winner === 0 ? "you" : "foe",
    turn: state.turn === 0 ? "you" : "foe",
    log: state.log.slice(-8),
    you: {
      life: you.life,
      energy: you.energy,
      maxEnergy: you.maxEnergy,
      deckCount: you.deck.length,
      hand: you.hand.slice(),
      board: you.board.map(pub),
    },
    foe: {
      life: foe.life,
      energy: foe.energy,
      maxEnergy: foe.maxEnergy,
      deckCount: foe.deck.length,
      handCount: foe.hand.length,
      board: foe.board.map(pub),
    },
    actions: status === "active" && state.turn === 0 ? legalActions(state, 0) : [],
    payout,
    ratingDelta,
  };
}
