import type { LucideIcon } from "lucide-react";
import {
  Axe,
  Building2,
  Coins,
  Crosshair,
  Crown,
  Feather,
  Flame,
  Heart,
  Hexagon,
  Shield,
  ShieldCheck,
  Sparkle,
  Sun,
  Swords,
  Zap,
} from "lucide-react";
import { lookupCard } from "@/lib/duel/cards";

const ICONS: Record<string, LucideIcon> = {
  "cinder-moth": Flame,
  "lantern-squire": Shield,
  "rake-hound": Zap,
  "ash-courier": Feather,
  "pike-line": Swords,
  spark: Sparkle,
  mend: Heart,
  "glass-warden": ShieldCheck,
  "vesper-knight": Crown,
  seize: Crosshair,
  "auric-saint": Sun,
  "bell-tower": Building2,
  "duel-marshal": Axe,
  "pit-colossus": Hexagon,
  "stake-coin": Coins,
};

export function CardBack({ className = "" }: { className?: string }) {
  return (
    <div
      className={`grid h-16 w-11 place-items-center rounded-lg border border-copper/50 bg-surface ${className}`}
      aria-hidden="true"
    >
      <span className="h-3 w-3 rotate-45 border border-copper" />
    </div>
  );
}

export function CardFace({
  defId,
  atk,
  hp,
  dim = false,
  selected = false,
  targetable = false,
  ready = false,
  wounded = false,
  onClick,
  label,
}: {
  defId: string;
  atk?: number;
  hp?: number;
  dim?: boolean;
  selected?: boolean;
  targetable?: boolean;
  ready?: boolean;
  wounded?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const card = lookupCard(defId);
  const Icon = ICONS[defId] ?? Sparkle;
  const ring = selected
    ? "ring-2 ring-ion"
    : targetable
      ? "ring-2 ring-copper"
      : "ring-1 ring-border";
  const body = (
    <>
      <span className="absolute top-2 left-2 grid h-6 w-6 place-items-center rounded-full bg-copper font-display text-xs text-bg">
        {card.cost}
      </span>
      {ready ? (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-ion" title="Ready" />
      ) : null}
      <Icon className="h-8 w-8 text-copper" strokeWidth={1.5} aria-hidden="true" />
      <span className="px-1 text-center font-display text-sm leading-tight text-fg">{card.name}</span>
      <span className="line-clamp-3 px-1 text-center text-xs leading-snug text-muted">{card.text}</span>
      {card.kind === "unit" ? (
        <span className="mt-auto flex w-full items-center justify-between px-1 pt-1 font-display text-sm tabular-nums">
          <span className="text-copper">{atk ?? card.atk}</span>
          <span className={wounded ? "text-danger" : "text-fg"}>{hp ?? card.hp}</span>
        </span>
      ) : (
        <span className="mt-auto text-xs tracking-widest text-muted uppercase">Spell</span>
      )}
    </>
  );
  const className = `relative flex h-36 w-24 shrink-0 flex-col items-center gap-1 rounded-xl bg-surface-2 p-2 text-left sm:h-40 sm:w-28 ${ring} ${
    dim ? "opacity-45" : ""
  } ${onClick ? "hover:-translate-y-0.5" : ""}`;
  if (!onClick) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-pressed={selected}
      aria-label={label ?? `${card.name}, cost ${card.cost}. ${card.text}`}
    >
      {body}
    </button>
  );
}
