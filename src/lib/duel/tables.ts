export type TableId = "copper" | "silver" | "gold";
export type Difficulty = "copper" | "silver" | "gold";

export type TableDef = {
  id: TableId | "practice";
  name: string;
  stake: number;
  rakeBps: number;
  difficulty: Difficulty;
  oppRating: number;
  blurb: string;
};

export const ECONOMY = {
  opening: 1000,
  daily: 200,
  payoutMin: 200,
} as const;

export const TABLES: readonly TableDef[] = [
  {
    id: "practice",
    name: "Practice",
    stake: 0,
    rakeBps: 0,
    difficulty: "copper",
    oppRating: 1000,
    blurb: "A free hand on this device. Nothing is raked and nothing is recorded.",
  },
  {
    id: "copper",
    name: "Copper",
    stake: 100,
    rakeBps: 1000,
    difficulty: "copper",
    oppRating: 900,
    blurb: "A loose rival. The house keeps 10% of the pot.",
  },
  {
    id: "silver",
    name: "Silver",
    stake: 400,
    rakeBps: 800,
    difficulty: "silver",
    oppRating: 1100,
    blurb: "A cleaner rival. The house keeps 8%.",
  },
  {
    id: "gold",
    name: "Gold",
    stake: 1000,
    rakeBps: 600,
    difficulty: "gold",
    oppRating: 1340,
    blurb: "The sharp seat. The house keeps 6%.",
  },
];

export function tableById(id: string): TableDef | undefined {
  return TABLES.find((table) => table.id === id);
}

export function potMath(table: TableDef): {
  pot: number;
  rake: number;
  prize: number;
  net: number;
} {
  const pot = table.stake * 2;
  const rake = Math.floor((pot * table.rakeBps) / 10000);
  const prize = pot - rake;
  const net = prize - table.stake;
  return { pot, rake, prize, net };
}

/** Standard Elo step. Positive when the player outplays the table. */
export function eloDelta(rating: number, opp: number, score: number): number {
  const expected = 1 / (1 + 10 ** ((opp - rating) / 400));
  return Math.round(32 * (score - expected));
}
