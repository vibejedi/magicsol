-- Auric purse, ranked matches, and the play-money ledger.
create table if not exists profiles (
  user_id text primary key,
  display_name text not null,
  auric integer not null default 1000,
  rating integer not null default 1000,
  wins integer not null default 0,
  losses integer not null default 0,
  profit integer not null default 0,
  claimed_on date,
  created_at timestamptz not null default now(),
  constraint profiles_auric_nn check (auric >= 0)
);

create table if not exists matches (
  id text primary key,
  user_id text not null,
  table_id text not null,
  stake integer not null,
  rake_bps integer not null,
  status text not null,
  state text not null,
  payout integer not null default 0,
  rating_delta integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists matches_user_idx on matches (user_id, status);

create table if not exists ledger (
  id serial primary key,
  user_id text not null,
  kind text not null,
  amount integer not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_user_idx on ledger (user_id, id desc);

create table if not exists payouts (
  id serial primary key,
  user_id text not null,
  amount integer not null,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists payouts_user_idx on payouts (user_id, id desc);
