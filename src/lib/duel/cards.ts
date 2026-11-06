export type Keyword = "guard" | "haste";

export type CardDef = {
  id: string;
  name: string;
  cost: number;
  kind: "unit" | "spell";
  atk?: number;
  hp?: number;
  keywords?: Keyword[];
  text: string;
  /** Targeted or untargeted spell. Units leave this empty. */
  spell?: "spark" | "seize" | "mend" | "coin";
  onPlay?: "draw1" | "heal3";
};

const LIST: CardDef[] = [
  {
    id: "cinder-moth",
    name: "Cinder Moth",
    cost: 1,
    kind: "unit",
    atk: 2,
    hp: 1,
    keywords: ["haste"],
    text: "Haste. Strikes the turn it lands.",
  },
  {
    id: "lantern-squire",
    name: "Lantern Squire",
    cost: 1,
    kind: "unit",
    atk: 1,
    hp: 2,
    keywords: ["guard"],
    text: "Guard. Must be struck before you.",
  },
  {
    id: "rake-hound",
    name: "Rake Hound",
    cost: 2,
    kind: "unit",
    atk: 3,
    hp: 1,
    keywords: ["haste"],
    text: "Haste. A cheap bite at the pot.",
  },
  {
    id: "ash-courier",
    name: "Ash Courier",
    cost: 2,
    kind: "unit",
    atk: 2,
    hp: 2,
    onPlay: "draw1",
    text: "On play: draw a card.",
  },
  {
    id: "pike-line",
    name: "Pike Line",
    cost: 2,
    kind: "unit",
    atk: 2,
    hp: 3,
    keywords: ["guard"],
    text: "Guard. Holds the lane.",
  },
  {
    id: "spark",
    name: "Spark",
    cost: 1,
    kind: "spell",
    spell: "spark",
    text: "Deal 2 to a unit or the rival.",
  },
  {
    id: "mend",
    name: "Mend",
    cost: 2,
    kind: "spell",
    spell: "mend",
    text: "Restore 5 life.",
  },
  {
    id: "glass-warden",
    name: "Glass Warden",
    cost: 3,
    kind: "unit",
    atk: 3,
    hp: 4,
    keywords: ["guard"],
    text: "Guard. A clear wall.",
  },
  {
    id: "vesper-knight",
    name: "Vesper Knight",
    cost: 3,
    kind: "unit",
    atk: 4,
    hp: 3,
    text: "A straight hitter.",
  },
  {
    id: "seize",
    name: "Seize",
    cost: 3,
    kind: "spell",
    spell: "seize",
    text: "Deal 3 to a unit. Draw a card.",
  },
  {
    id: "auric-saint",
    name: "Auric Saint",
    cost: 4,
    kind: "unit",
    atk: 3,
    hp: 5,
    onPlay: "heal3",
    text: "On play: restore 3 life.",
  },
  {
    id: "bell-tower",
    name: "Bell Tower",
    cost: 4,
    kind: "unit",
    atk: 2,
    hp: 7,
    keywords: ["guard"],
    text: "Guard. Slow, and very tall.",
  },
  {
    id: "duel-marshal",
    name: "Duel Marshal",
    cost: 5,
    kind: "unit",
    atk: 5,
    hp: 5,
    text: "The table's closer.",
  },
  {
    id: "pit-colossus",
    name: "Pit Colossus",
    cost: 7,
    kind: "unit",
    atk: 8,
    hp: 8,
    text: "Arrives late. Ends arguments.",
  },
  {
    id: "stake-coin",
    name: "Stake Coin",
    cost: 0,
    kind: "spell",
    spell: "coin",
    text: "Gain 1 energy. The house's courtesy to the seat that waits.",
  },
];

const MAP = new Map(LIST.map((card) => [card.id, card]));

export const DECK_LIST: readonly string[] = [
  "cinder-moth",
  "cinder-moth",
  "lantern-squire",
  "lantern-squire",
  "rake-hound",
  "rake-hound",
  "ash-courier",
  "ash-courier",
  "pike-line",
  "pike-line",
  "spark",
  "spark",
  "mend",
  "glass-warden",
  "vesper-knight",
  "vesper-knight",
  "seize",
  "auric-saint",
  "bell-tower",
  "duel-marshal",
  "pit-colossus",
];

export function getCard(id: string): CardDef | undefined {
  return MAP.get(id);
}

const FALLBACK: CardDef = {
  id: "unknown",
  name: "Blank",
  cost: 0,
  kind: "spell",
  text: "",
};

export function lookupCard(id: string): CardDef {
  return MAP.get(id) ?? { ...FALLBACK, id, name: id };
}
