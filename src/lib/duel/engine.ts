import { DECK_LIST, type CardDef, type Keyword, getCard } from "./cards.ts";

export const STARTING_LIFE = 20;
export const LIFE_CAP = 30;
export const HAND_CAP = 10;
export const BOARD_CAP = 5;
export const ENERGY_CAP = 8;

export type Target = { kind: "face" } | { kind: "unit"; uid: string };

export type Action =
  | { type: "end" }
  | { type: "play"; handIndex: number; target?: Target }
  | { type: "attack"; unitUid: string; target: Target };

export type Unit = {
  uid: string;
  defId: string;
  atk: number;
  hp: number;
  maxHp: number;
  ready: boolean;
  keywords: Keyword[];
};

export type PlayerState = {
  life: number;
  energy: number;
  maxEnergy: number;
  deck: string[];
  hand: string[];
  board: Unit[];
  discard: string[];
};

export type Seat = 0 | 1;

export type GameState = {
  seed: number;
  seq: number;
  turn: Seat;
  winner: Seat | null;
  log: string[];
  players: [PlayerState, PlayerState];
};

export class IllegalAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalAction";
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list: readonly string[], rand: () => number): string[] {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j] ?? copy[i];
    copy[j] = swap;
  }
  return copy;
}

function who(seat: Seat): string {
  return seat === 0 ? "You" : "Rival";
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function pushLog(state: GameState, line: string) {
  state.log.push(line);
  if (state.log.length > 30) state.log.splice(0, state.log.length - 30);
}

function cardOrThrow(id: string): CardDef {
  const card = getCard(id);
  if (!card) throw new IllegalAction("Unknown card.");
  return card;
}

function emptyPlayer(deck: string[]): PlayerState {
  return {
    life: STARTING_LIFE,
    energy: 0,
    maxEnergy: 0,
    deck,
    hand: [],
    board: [],
    discard: [],
  };
}

function draw(state: GameState, seat: Seat, count: number) {
  const player = state.players[seat];
  for (let i = 0; i < count; i += 1) {
    if (state.winner !== null) return;
    const card = player.deck.pop();
    if (!card) {
      state.winner = other(seat);
      pushLog(state, `${who(seat)} has no cards left.`);
      return;
    }
    if (player.hand.length >= HAND_CAP) {
      player.discard.push(card);
      pushLog(state, `${who(seat)} burns a draw.`);
    } else {
      player.hand.push(card);
    }
  }
}

function heal(state: GameState, seat: Seat, amount: number) {
  const player = state.players[seat];
  player.life = Math.min(LIFE_CAP, player.life + amount);
}

function beginTurn(state: GameState, seat: Seat) {
  if (state.winner !== null) return;
  const player = state.players[seat];
  player.maxEnergy = Math.min(ENERGY_CAP, player.maxEnergy + 1);
  player.energy = player.maxEnergy;
  for (const unit of player.board) unit.ready = true;
  pushLog(state, `${who(seat)} · ${player.energy} energy.`);
  draw(state, seat, 1);
}

export function createMatch(seed: number): GameState {
  const rand = mulberry32(seed);
  const state: GameState = {
    seed,
    seq: 1,
    turn: 0,
    winner: null,
    log: [],
    players: [emptyPlayer(shuffle(DECK_LIST, rand)), emptyPlayer(shuffle(DECK_LIST, rand))],
  };
  draw(state, 0, 3);
  draw(state, 1, 3);
  state.players[1].hand.push("stake-coin");
  pushLog(state, "You open. The rival holds the stake coin.");
  beginTurn(state, 0);
  return state;
}

function needsTarget(card: CardDef): boolean {
  return card.spell === "spark" || card.spell === "seize";
}

function targetsFor(state: GameState, seat: Seat, card: CardDef): Target[] {
  const foe = state.players[other(seat)];
  if (card.spell === "spark") {
    const targets: Target[] = [{ kind: "face" }];
    for (const unit of foe.board) targets.push({ kind: "unit", uid: unit.uid });
    return targets;
  }
  if (card.spell === "seize") {
    return foe.board.map((unit) => ({ kind: "unit", uid: unit.uid }));
  }
  return [];
}

export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.winner !== null || state.turn !== seat) return [];
  const player = state.players[seat];
  const foe = state.players[other(seat)];
  const actions: Action[] = [];

  player.hand.forEach((id, handIndex) => {
    const card = getCard(id);
    if (!card || player.energy < card.cost) return;
    if (card.kind === "unit") {
      if (player.board.length >= BOARD_CAP) return;
      actions.push({ type: "play", handIndex });
      return;
    }
    if (needsTarget(card)) {
      for (const target of targetsFor(state, seat, card)) {
        actions.push({ type: "play", handIndex, target });
      }
      return;
    }
    actions.push({ type: "play", handIndex });
  });

  const guards = foe.board.filter((unit) => unit.keywords.includes("guard"));
  const pool = guards.length > 0 ? guards : foe.board;
  for (const unit of player.board) {
    if (!unit.ready || unit.atk <= 0) continue;
    for (const target of pool) {
      actions.push({
        type: "attack",
        unitUid: unit.uid,
        target: { kind: "unit", uid: target.uid },
      });
    }
    if (guards.length === 0) {
      actions.push({ type: "attack", unitUid: unit.uid, target: { kind: "face" } });
    }
  }

  actions.push({ type: "end" });
  return actions;
}

function sameTarget(a?: Target, b?: Target): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "unit" && b.kind === "unit") return a.uid === b.uid;
  return a.kind === "face";
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "end" && b.type === "end") return true;
  if (a.type === "play" && b.type === "play") {
    return a.handIndex === b.handIndex && sameTarget(a.target, b.target);
  }
  if (a.type === "attack" && b.type === "attack") {
    return a.unitUid === b.unitUid && sameTarget(a.target, b.target);
  }
  return false;
}

function findOn(board: Unit[], uid: string): Unit | undefined {
  return board.find((unit) => unit.uid === uid);
}

function reap(state: GameState) {
  for (const seat of [0, 1] as const) {
    const player = state.players[seat];
    const stay: Unit[] = [];
    for (const unit of player.board) {
      if (unit.hp <= 0) {
        player.discard.push(unit.defId);
        pushLog(state, `${cardOrThrow(unit.defId).name} falls.`);
      } else {
        stay.push(unit);
      }
    }
    player.board = stay;
  }
  if (state.winner !== null) return;
  for (const seat of [0, 1] as const) {
    if (state.players[seat].life <= 0) {
      state.winner = other(seat);
      pushLog(state, `${who(seat)} breaks.`);
      return;
    }
  }
}

function summon(state: GameState, seat: Seat, card: CardDef) {
  const keywords = card.keywords ? [...card.keywords] : [];
  state.seq += 1;
  state.players[seat].board.push({
    uid: `u${state.seq}`,
    defId: card.id,
    atk: card.atk ?? 0,
    hp: card.hp ?? 0,
    maxHp: card.hp ?? 0,
    ready: keywords.includes("haste"),
    keywords,
  });
}

function resolveSpell(state: GameState, seat: Seat, card: CardDef, target?: Target) {
  const foe = state.players[other(seat)];
  if (card.spell === "coin") {
    state.players[seat].energy += 1;
    pushLog(state, `${who(seat)} flips the stake coin.`);
    return;
  }
  if (card.spell === "mend") {
    heal(state, seat, 5);
    pushLog(state, `${who(seat)} mends 5.`);
    return;
  }
  if (card.spell === "spark") {
    if (!target) throw new IllegalAction("Spark needs a target.");
    if (target.kind === "face") {
      foe.life -= 2;
      pushLog(state, `${who(seat)} sparks the rival for 2.`);
    } else {
      const unit = findOn(foe.board, target.uid);
      if (!unit) throw new IllegalAction("That unit is gone.");
      unit.hp -= 2;
      pushLog(state, `${who(seat)} sparks ${cardOrThrow(unit.defId).name} for 2.`);
    }
    return;
  }
  if (card.spell === "seize") {
    if (!target || target.kind !== "unit") throw new IllegalAction("Seize needs a unit.");
    const unit = findOn(foe.board, target.uid);
    if (!unit) throw new IllegalAction("That unit is gone.");
    unit.hp -= 3;
    pushLog(state, `${who(seat)} seizes ${cardOrThrow(unit.defId).name}.`);
    draw(state, seat, 1);
  }
}

function perform(state: GameState, seat: Seat, action: Action) {
  const player = state.players[seat];
  if (action.type === "end") {
    state.turn = other(seat);
    beginTurn(state, state.turn);
    return;
  }
  if (action.type === "play") {
    const id = player.hand[action.handIndex];
    if (!id) throw new IllegalAction("That card isn't in hand.");
    const card = cardOrThrow(id);
    if (player.energy < card.cost) throw new IllegalAction("Not enough energy.");
    if (card.kind === "unit" && player.board.length >= BOARD_CAP) {
      throw new IllegalAction("The lane is full.");
    }
    player.energy -= card.cost;
    player.hand.splice(action.handIndex, 1);
    pushLog(state, `${who(seat)} plays ${card.name}.`);
    if (card.kind === "unit") {
      summon(state, seat, card);
      if (card.onPlay === "draw1") draw(state, seat, 1);
      if (card.onPlay === "heal3") {
        heal(state, seat, 3);
        pushLog(state, `${who(seat)} restores 3.`);
      }
    } else {
      resolveSpell(state, seat, card, action.target);
    }
    reap(state);
    return;
  }
  const attacker = findOn(player.board, action.unitUid);
  if (!attacker || !attacker.ready) throw new IllegalAction("That unit can't strike.");
  const foe = state.players[other(seat)];
  attacker.ready = false;
  if (action.target.kind === "face") {
    foe.life -= attacker.atk;
    pushLog(state, `${who(seat)} strikes for ${attacker.atk}.`);
  } else {
    const defender = findOn(foe.board, action.target.uid);
    if (!defender) throw new IllegalAction("That unit is gone.");
    defender.hp -= attacker.atk;
    attacker.hp -= defender.atk;
    pushLog(state, `${who(seat)} strikes ${cardOrThrow(defender.defId).name}.`);
  }
  reap(state);
}

export function applyAction(prev: GameState, seat: Seat, action: Action): GameState {
  if (prev.winner !== null) throw new IllegalAction("The duel is over.");
  if (prev.turn !== seat) throw new IllegalAction("Not your turn.");
  const legal = legalActions(prev, seat);
  if (!legal.some((candidate) => sameAction(candidate, action))) {
    throw new IllegalAction("That play isn't legal.");
  }
  const state = structuredClone(prev);
  perform(state, seat, action);
  return state;
}

export function concede(prev: GameState, loser: Seat): GameState {
  if (prev.winner !== null) return structuredClone(prev);
  const state = structuredClone(prev);
  state.winner = other(loser);
  pushLog(state, loser === 0 ? "You forfeit the pot." : "Rival forfeits.");
  return state;
}
