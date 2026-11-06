import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterYou, chooseAiAction } from "./ai.ts";
import {
  IllegalAction,
  applyAction,
  createMatch,
  legalActions,
  type GameState,
  type Unit,
} from "./engine.ts";
import { eloDelta, potMath, tableById } from "./tables.ts";

function unit(partial: Partial<Unit> & Pick<Unit, "uid" | "defId" | "atk" | "hp">): Unit {
  return {
    maxHp: partial.hp,
    ready: true,
    keywords: [],
    ...partial,
  };
}

function rig(seed = 7): GameState {
  const state = createMatch(seed);
  state.log = [];
  return state;
}

describe("auric rules", () => {
  it("opens with one energy, four cards, and a rival stake coin", () => {
    const state = createMatch(11);
    assert.equal(state.turn, 0);
    assert.equal(state.players[0].energy, 1);
    assert.equal(state.players[0].maxEnergy, 1);
    assert.equal(state.players[0].hand.length, 4);
    assert.equal(state.players[1].hand.includes("stake-coin"), true);
    assert.equal(state.players[0].life, 20);
    const again = createMatch(11);
    assert.deepEqual(again.players[0].deck, state.players[0].deck);
    assert.deepEqual(again.players[0].hand, state.players[0].hand);
  });

  it("lets haste strike face the turn it is played", () => {
    const state = rig();
    state.players[0].hand = ["cinder-moth"];
    state.players[0].energy = 1;
    const played = applyAction(state, 0, { type: "play", handIndex: 0 });
    const moth = played.players[0].board[0];
    assert.ok(moth);
    assert.equal(moth.ready, true);
    const hit = applyAction(played, 0, {
      type: "attack",
      unitUid: moth.uid,
      target: { kind: "face" },
    });
    assert.equal(hit.players[1].life, 18);
    assert.equal(state.players[1].life, 20);
  });

  it("holds a guard in front of the player", () => {
    const state = rig();
    state.players[0].board = [unit({ uid: "a", defId: "cinder-moth", atk: 2, hp: 1, keywords: ["haste"] })];
    state.players[1].board = [
      unit({ uid: "g", defId: "lantern-squire", atk: 1, hp: 2, keywords: ["guard"] }),
    ];
    const attacks = legalActions(state, 0).filter((action) => action.type === "attack");
    assert.ok(attacks.length > 0);
    assert.ok(attacks.every((action) => action.type === "attack" && action.target.kind === "unit"));
    assert.throws(
      () =>
        applyAction(state, 0, {
          type: "attack",
          unitUid: "a",
          target: { kind: "face" },
        }),
      IllegalAction,
    );
  });

  it("trades units at the same time", () => {
    const state = rig();
    state.players[0].board = [unit({ uid: "a", defId: "cinder-moth", atk: 2, hp: 1 })];
    state.players[1].board = [unit({ uid: "b", defId: "cinder-moth", atk: 2, hp: 1 })];
    const next = applyAction(state, 0, {
      type: "attack",
      unitUid: "a",
      target: { kind: "unit", uid: "b" },
    });
    assert.equal(next.players[0].board.length, 0);
    assert.equal(next.players[1].board.length, 0);
  });

  it("refuses a summoning-sick unit, a full lane, and a poor purse of energy", () => {
    const state = rig();
    state.players[0].hand = ["lantern-squire", "duel-marshal"];
    state.players[0].energy = 3;
    const played = applyAction(state, 0, { type: "play", handIndex: 0 });
    const squire = played.players[0].board[0];
    assert.equal(squire?.ready, false);
    assert.equal(
      legalActions(played, 0).some((action) => action.type === "attack"),
      false,
    );
    const rich = rig();
    rich.players[0].hand = ["duel-marshal"];
    rich.players[0].energy = 3;
    assert.throws(() => applyAction(rich, 0, { type: "play", handIndex: 0 }), IllegalAction);
    const full = rig();
    full.players[0].energy = 5;
    full.players[0].hand = ["pike-line"];
    full.players[0].board = [0, 1, 2, 3, 4].map((n) =>
      unit({ uid: `b${n}`, defId: "pike-line", atk: 1, hp: 1 }),
    );
    assert.throws(() => applyAction(full, 0, { type: "play", handIndex: 0 }), IllegalAction);
  });

  it("sparks, mends with a cap, and flips the stake coin", () => {
    const state = rig();
    state.players[0].hand = ["spark"];
    state.players[0].energy = 1;
    const sparked = applyAction(state, 0, {
      type: "play",
      handIndex: 0,
      target: { kind: "face" },
    });
    assert.equal(sparked.players[1].life, 18);
    const mending = rig();
    mending.players[0].life = 28;
    mending.players[0].hand = ["mend"];
    mending.players[0].energy = 2;
    const mended = applyAction(mending, 0, { type: "play", handIndex: 0 });
    assert.equal(mended.players[0].life, 30);
    const coin = rig();
    coin.turn = 1;
    coin.players[1].hand = ["stake-coin"];
    coin.players[1].energy = 1;
    coin.players[1].maxEnergy = 1;
    const flipped = applyAction(coin, 1, { type: "play", handIndex: 0 });
    assert.equal(flipped.players[1].energy, 2);
  });

  it("decks a player out when their turn would draw from nothing", () => {
    const state = rig();
    state.turn = 1;
    state.players[0].deck = [];
    state.players[1].hand = [];
    state.players[1].energy = 1;
    const next = applyAction(state, 1, { type: "end" });
    assert.equal(next.winner, 1);
  });

  it("prices the rake and the rating step", () => {
    const copper = tableById("copper");
    assert.ok(copper);
    assert.deepEqual(potMath(copper), { pot: 200, rake: 20, prize: 180, net: 80 });
    assert.equal(eloDelta(1000, 1000, 1), 16);
    assert.equal(eloDelta(1000, 1000, 0), -16);
  });

  it("finishes seeded games, and a clean seat beats the loose table", () => {
    let skilledWins = 0;
    let plies = 0;
    const games = 24;
    for (let seed = 1; seed <= games; seed += 1) {
      let state = createMatch(seed);
      let rngState = seed * 997;
      const rng = () => {
        rngState = (rngState * 1664525 + 1013904223) >>> 0;
        return rngState / 4294967296;
      };
      let guard = 0;
      while (state.winner === null && guard < 300) {
        const seat = state.turn;
        const action = chooseAiAction(state, seat === 0 ? "gold" : "copper", rng);
        state = applyAction(state, seat, action);
        guard += 1;
      }
      assert.notEqual(state.winner, null, `seed ${seed} did not finish`);
      if (state.winner === 0) skilledWins += 1;
      plies += guard;
    }
    assert.ok(skilledWins >= 16, `clean seat only won ${skilledWins}/${games}`);
    assert.ok(plies / games < 180, "games ran too long");
    const practice = tableById("practice");
    assert.ok(practice);
    const ended = afterYou(createMatch(3), { type: "end" }, practice.difficulty, () => 0.99);
    assert.equal(ended.turn === 0 || ended.winner !== null, true);
  });
});
