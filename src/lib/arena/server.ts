import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { afterYou, runAi } from "@/lib/duel/ai";
import {
  IllegalAction,
  concede,
  createMatch,
  type Action,
  type GameState,
  type Target,
} from "@/lib/duel/engine";
import { ECONOMY, eloDelta, potMath, tableById, type TableDef } from "@/lib/duel/tables";
import { projectPlaying, type MatchView } from "@/lib/duel/view";

export type BoardRow = {
  rank: number;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  profit: number;
  you: boolean;
};

export type Lobby = {
  profile: {
    displayName: string;
    auric: number;
    rating: number;
    wins: number;
    losses: number;
    profit: number;
    withdrawable: number;
    claimedToday: boolean;
  };
  activeMatchId: string | null;
  youRank: number | null;
  board: BoardRow[];
  history: {
    id: string;
    tableId: string;
    stake: number;
    status: string;
    payout: number;
    ratingDelta: number;
    at: string;
  }[];
  ledger: { id: number; kind: string; amount: number; note: string; at: string }[];
  payouts: { id: number; amount: number; status: string; at: string }[];
};

type Sql = Awaited<ReturnType<(typeof import("@/lib/db"))["getSql"]>>;

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function pitName(userId: string): string {
  const slug = userId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "TABLE";
  return `Pit ${slug}`;
}

function parseState(raw: unknown): GameState {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!value || typeof value !== "object") throw new Error("The duel record is unreadable.");
  return value as GameState;
}

function parseTarget(input: unknown): Target | undefined {
  if (input == null) return undefined;
  if (typeof input !== "object") throw new IllegalAction("That play isn't legal.");
  const raw = input as Record<string, unknown>;
  if (raw.kind === "face") return { kind: "face" };
  if (
    raw.kind === "unit" &&
    typeof raw.uid === "string" &&
    raw.uid.length > 0 &&
    raw.uid.length <= 16
  ) {
    return { kind: "unit", uid: raw.uid };
  }
  throw new IllegalAction("That play isn't legal.");
}

function parseAction(input: unknown): Action {
  if (!input || typeof input !== "object") throw new IllegalAction("That play isn't legal.");
  const raw = input as Record<string, unknown>;
  if (raw.type === "end") return { type: "end" };
  const target = parseTarget(raw.target);
  if (raw.type === "play") {
    if (
      typeof raw.handIndex !== "number" ||
      !Number.isInteger(raw.handIndex) ||
      raw.handIndex < 0 ||
      raw.handIndex > 12
    ) {
      throw new IllegalAction("That play isn't legal.");
    }
    return target
      ? { type: "play", handIndex: raw.handIndex, target }
      : { type: "play", handIndex: raw.handIndex };
  }
  if (raw.type === "attack") {
    if (typeof raw.unitUid !== "string" || raw.unitUid.length === 0 || raw.unitUid.length > 16 || !target) {
      throw new IllegalAction("That play isn't legal.");
    }
    return { type: "attack", unitUid: raw.unitUid, target };
  }
  throw new IllegalAction("That play isn't legal.");
}

function cleanName(input: unknown): string {
  if (typeof input !== "string") throw new Error("Name the seat in letters and numbers.");
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 18) throw new Error("Use 2 to 18 characters.");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]*$/.test(name)) {
    throw new Error("Letters, numbers, and spaces only.");
  }
  return name;
}

type ProfileRow = {
  user_id: string;
  display_name: string;
  auric: number | string;
  rating: number | string;
  wins: number | string;
  losses: number | string;
  profit: number | string;
  claimed_today: unknown;
};

async function sqlClient(): Promise<Sql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function ensureProfile(sql: Sql, userId: string): Promise<ProfileRow> {
  const inserted = await sql<{ user_id: string }>`
    insert into profiles (user_id, display_name, auric)
    values (${userId}, ${pitName(userId)}, ${ECONOMY.opening})
    on conflict (user_id) do nothing
    returning user_id
  `;
  if (inserted.length > 0) {
    await sql`
      insert into ledger (user_id, kind, amount, note)
      values (${userId}, 'grant', ${ECONOMY.opening}, 'Opening purse')
    `;
  }
  const rows = await sql<ProfileRow>`
    select user_id, display_name, auric, rating, wins, losses, profit,
           (claimed_on = current_date) as claimed_today
    from profiles
    where user_id = ${userId}
  `;
  const profile = rows[0];
  if (!profile) throw new Error("The purse didn't open.");
  return profile;
}

type MatchRow = {
  id: string;
  table_id: string;
  stake: number | string;
  status: string;
  state: string;
  payout: number | string;
  rating_delta: number | string;
};

async function readMatch(sql: Sql, userId: string, matchId: string): Promise<MatchRow | null> {
  const rows = await sql<MatchRow>`
    select id, table_id, stake, status, state, payout, rating_delta
    from matches
    where id = ${matchId} and user_id = ${userId}
  `;
  return rows[0] ?? null;
}

function viewOf(row: MatchRow, state: GameState): MatchView {
  const table = tableById(row.table_id);
  if (!table) throw new Error("Unknown table.");
  return projectPlaying(state, table, row.id, num(row.payout), num(row.rating_delta));
}

async function saveActive(sql: Sql, userId: string, matchId: string, state: GameState) {
  await sql`
    update matches
    set state = ${JSON.stringify(state)}
    where id = ${matchId} and user_id = ${userId} and status = 'active'
  `;
}

async function closeMatch(sql: Sql, userId: string, row: MatchRow, state: GameState): Promise<MatchView> {
  const table = tableById(row.table_id);
  if (!table || table.stake <= 0) throw new Error("Unknown table.");
  const won = state.winner === 0;
  const math = potMath(table);
  const payout = won ? math.prize : 0;
  const profile = await ensureProfile(sql, userId);
  const ratingDelta = eloDelta(num(profile.rating), table.oppRating, won ? 1 : 0);
  const status = won ? "won" : "lost";
  const locked = await sql<{ id: string }>`
    update matches
    set status = ${status},
        state = ${JSON.stringify(state)},
        payout = ${payout},
        rating_delta = ${ratingDelta},
        finished_at = now()
    where id = ${row.id} and user_id = ${userId} and status = 'active'
    returning id
  `;
  if (locked.length > 0) {
    if (won) {
      await sql`
        update profiles
        set auric = auric + ${payout},
            wins = wins + 1,
            profit = profit + ${payout - table.stake},
            rating = greatest(100, rating + ${ratingDelta})
        where user_id = ${userId}
      `;
      await sql`
        insert into ledger (user_id, kind, amount, note)
        values (
          ${userId},
          'prize',
          ${payout},
          ${`${table.name} prize. House rake ${math.rake}.`}
        )
      `;
    } else {
      await sql`
        update profiles
        set losses = losses + 1,
            profit = profit - ${table.stake},
            rating = greatest(100, rating + ${ratingDelta})
        where user_id = ${userId}
      `;
    }
  }
  const fresh = await readMatch(sql, userId, row.id);
  if (!fresh) throw new Error("The duel disappeared.");
  return viewOf(fresh, state);
}

async function resume(sql: Sql, userId: string, row: MatchRow): Promise<MatchView> {
  const table = tableById(row.table_id);
  if (!table) throw new Error("Unknown table.");
  let state = parseState(row.state);
  if (row.status === "active" && state.winner === null && state.turn === 1) {
    state = runAi(state, table.difficulty);
  }
  if (row.status === "active" && state.winner !== null) {
    return closeMatch(sql, userId, row, state);
  }
  if (row.status === "active") {
    await saveActive(sql, userId, row.id, state);
    return projectPlaying(state, table, row.id, 0, 0);
  }
  return viewOf(row, state);
}

export const getLobby = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Lobby> => {
    const sql = await sqlClient();
    const userId = context.userId;
    const profile = await ensureProfile(sql, userId);
    const auric = num(profile.auric);
    const rating = num(profile.rating);
    const wins = num(profile.wins);
    const losses = num(profile.losses);
    const profit = num(profile.profit);
    const active = await sql<{ id: string }>`
      select id from matches
      where user_id = ${userId} and status = 'active'
      order by created_at desc
      limit 1
    `;
    const boardRows = await sql<{
      display_name: string;
      rating: number | string;
      wins: number | string;
      losses: number | string;
      profit: number | string;
      user_id: string;
    }>`
      select user_id, display_name, rating, wins, losses, profit
      from profiles
      where wins + losses > 0
      order by profit desc, rating desc, display_name asc
      limit 20
    `;
    const board: BoardRow[] = boardRows.map((row, index) => ({
      rank: index + 1,
      name: row.display_name,
      rating: num(row.rating),
      wins: num(row.wins),
      losses: num(row.losses),
      profit: num(row.profit),
      you: row.user_id === userId,
    }));
    let youRank: number | null = null;
    if (wins + losses > 0) {
      const mine = board.find((row) => row.you);
      if (mine) youRank = mine.rank;
      else {
        const counted = await sql<{ better: number | string }>`
          select count(*) as better
          from profiles
          where wins + losses > 0
            and (
              profit > ${profit}
              or (profit = ${profit} and rating > ${rating})
              or (profit = ${profit} and rating = ${rating} and display_name < ${profile.display_name})
            )
        `;
        youRank = num(counted[0]?.better) + 1;
      }
    }
    const history = await sql<{
      id: string;
      table_id: string;
      stake: number | string;
      status: string;
      payout: number | string;
      rating_delta: number | string;
      at: string;
    }>`
      select id, table_id, stake, status, payout, rating_delta, created_at::text as at
      from matches
      where user_id = ${userId} and status in ('won', 'lost')
      order by created_at desc
      limit 12
    `;
    const ledger = await sql<{
      id: number | string;
      kind: string;
      amount: number | string;
      note: string;
      at: string;
    }>`
      select id, kind, amount, note, created_at::text as at
      from ledger
      where user_id = ${userId}
      order by id desc
      limit 16
    `;
    const payouts = await sql<{
      id: number | string;
      amount: number | string;
      status: string;
      at: string;
    }>`
      select id, amount, status, created_at::text as at
      from payouts
      where user_id = ${userId}
      order by id desc
      limit 8
    `;
    return {
      profile: {
        displayName: profile.display_name,
        auric,
        rating,
        wins,
        losses,
        profit,
        withdrawable: Math.max(0, profit),
        claimedToday: flag(profile.claimed_today),
      },
      activeMatchId: active[0]?.id ?? null,
      youRank,
      board,
      history: history.map((row) => ({
        id: row.id,
        tableId: row.table_id,
        stake: num(row.stake),
        status: row.status,
        payout: num(row.payout),
        ratingDelta: num(row.rating_delta),
        at: row.at,
      })),
      ledger: ledger.map((row) => ({
        id: num(row.id),
        kind: row.kind,
        amount: num(row.amount),
        note: row.note,
        at: row.at,
      })),
      payouts: payouts.map((row) => ({
        id: num(row.id),
        amount: num(row.amount),
        status: row.status,
        at: row.at,
      })),
    };
  });

export const startMatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((tableId: unknown) => {
    if (tableId !== "copper" && tableId !== "silver" && tableId !== "gold") {
      throw new Error("Pick a ranked table.");
    }
    return tableId;
  })
  .handler(async ({ context, data: tableId }) => {
    const sql = await sqlClient();
    const userId = context.userId;
    const table = tableById(tableId);
    if (!table || table.stake <= 0) return { ok: false as const, error: "Pick a ranked table." };
    const open = await sql<{ id: string }>`
      select id from matches
      where user_id = ${userId} and status = 'active'
      limit 1
    `;
    if (open[0]) {
      return {
        ok: false as const,
        error: "Finish the open duel before you sit again.",
        matchId: open[0].id,
      };
    }
    await ensureProfile(sql, userId);
    const paid = await sql<{ auric: number | string }>`
      update profiles
      set auric = auric - ${table.stake}
      where user_id = ${userId} and auric >= ${table.stake}
      returning auric
    `;
    if (!paid[0]) return { ok: false as const, error: "Not enough Auric for that table." };
    const matchId = crypto.randomUUID();
    const state = createMatch(Math.floor(Math.random() * 1_000_000_000));
    try {
      await sql`
        insert into matches (id, user_id, table_id, stake, rake_bps, status, state)
        values (
          ${matchId},
          ${userId},
          ${table.id},
          ${table.stake},
          ${table.rakeBps},
          'active',
          ${JSON.stringify(state)}
        )
      `;
      await sql`
        insert into ledger (user_id, kind, amount, note)
        values (${userId}, 'stake', ${-table.stake}, ${`${table.name} buy-in`})
      `;
    } catch (error) {
      await sql`delete from matches where id = ${matchId} and user_id = ${userId}`;
      await sql`
        update profiles set auric = auric + ${table.stake} where user_id = ${userId}
      `;
      throw error;
    }
    return { ok: true as const, matchId };
  });

export const getMatch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((matchId: unknown) => {
    if (typeof matchId !== "string" || !/^[0-9a-f-]{36}$/i.test(matchId)) {
      throw new Error("That duel isn't yours.");
    }
    return matchId;
  })
  .handler(async ({ context, data: matchId }) => {
    const sql = await sqlClient();
    const row = await readMatch(sql, context.userId, matchId);
    if (!row) return { ok: false as const, error: "That duel isn't yours." };
    const view = await resume(sql, context.userId, row);
    return { ok: true as const, view };
  });

async function play(
  userId: string,
  matchId: string,
  action: Action | null,
): Promise<{ ok: true; view: MatchView } | { ok: false; error: string; view?: MatchView }> {
  const sql = await sqlClient();
  const row = await readMatch(sql, userId, matchId);
  if (!row) return { ok: false, error: "That duel isn't yours." };
  const table: TableDef | undefined = tableById(row.table_id);
  if (!table) return { ok: false, error: "Unknown table." };
  if (row.status !== "active") {
    return { ok: true, view: viewOf(row, parseState(row.state)) };
  }
  let state = parseState(row.state);
  const rivalWasUp = state.winner === null && state.turn === 1;
  if (rivalWasUp) state = runAi(state, table.difficulty);
  if (state.winner !== null) {
    return { ok: true, view: await closeMatch(sql, userId, row, state) };
  }
  if (rivalWasUp || !action) {
    await saveActive(sql, userId, row.id, state);
    return { ok: true, view: projectPlaying(state, table, row.id) };
  }
  try {
    state = afterYou(state, action, table.difficulty);
  } catch (error) {
    if (error instanceof IllegalAction) return { ok: false, error: error.message };
    throw error;
  }
  if (state.winner !== null) {
    return { ok: true, view: await closeMatch(sql, userId, row, state) };
  }
  await saveActive(sql, userId, row.id, state);
  return { ok: true, view: projectPlaying(state, table, row.id) };
}

export const act = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Bad request.");
    const body = input as { matchId?: unknown; action?: unknown };
    if (typeof body.matchId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.matchId)) {
      throw new Error("Bad request.");
    }
    return { matchId: body.matchId, action: parseAction(body.action) };
  })
  .handler(async ({ context, data }) => play(context.userId, data.matchId, data.action));

export const forfeitMatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((matchId: unknown) => {
    if (typeof matchId !== "string" || !/^[0-9a-f-]{36}$/i.test(matchId)) {
      throw new Error("That duel isn't yours.");
    }
    return matchId;
  })
  .handler(async ({ context, data: matchId }) => {
    const sql = await sqlClient();
    const row = await readMatch(sql, context.userId, matchId);
    if (!row) return { ok: false as const, error: "That duel isn't yours." };
    if (row.status !== "active") {
      return { ok: true as const, view: viewOf(row, parseState(row.state)) };
    }
    const state = concede(parseState(row.state), 0);
    const view = await closeMatch(sql, context.userId, row, state);
    return { ok: true as const, view };
  });

export const renameSeat = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((name: unknown) => cleanName(name))
  .handler(async ({ context, data: name }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, context.userId);
    await sql`
      update profiles set display_name = ${name} where user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const claimDaily = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, context.userId);
    const rows = await sql<{ auric: number | string }>`
      update profiles
      set auric = auric + ${ECONOMY.daily}, claimed_on = current_date
      where user_id = ${context.userId}
        and (claimed_on is null or claimed_on < current_date)
      returning auric
    `;
    if (!rows[0]) return { ok: false as const, error: "Today's stake is already in the purse." };
    await sql`
      insert into ledger (user_id, kind, amount, note)
      values (${context.userId}, 'claim', ${ECONOMY.daily}, 'Daily stake')
    `;
    return { ok: true as const, auric: num(rows[0].auric) };
  });

export const requestPayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((amount: unknown) => {
    const value = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isInteger(value) || value < ECONOMY.payoutMin) {
      throw new Error(`Queue at least ${ECONOMY.payoutMin} Auric.`);
    }
    return value;
  })
  .handler(async ({ context, data: amount }) => {
    const sql = await sqlClient();
    await ensureProfile(sql, context.userId);
    const rows = await sql<{ auric: number | string }>`
      update profiles
      set auric = auric - ${amount}, profit = profit - ${amount}
      where user_id = ${context.userId}
        and auric >= ${amount}
        and profit >= ${amount}
      returning auric
    `;
    if (!rows[0]) {
      return {
        ok: false as const,
        error: "Only ranked profit can be queued, and the purse has to cover it.",
      };
    }
    await sql`
      insert into payouts (user_id, amount, status)
      values (${context.userId}, ${amount}, 'queued')
    `;
    await sql`
      insert into ledger (user_id, kind, amount, note)
      values (
        ${context.userId},
        'payout',
        ${-amount},
        'Payout queued. Play-money ledger only — no cash moves.'
      )
    `;
    return { ok: true as const };
  });
