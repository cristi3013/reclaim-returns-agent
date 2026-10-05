-- Reclaim · Supabase schema. Paste into the Supabase SQL editor once.
-- The backend keeps cases in memory as the working copy and writes through to these tables,
-- so a restart (or a second instance) starts from the same state.

create table if not exists public.cases (
  id          text primary key,
  status      text not null,
  invoice     text,
  customer    text,
  received_at timestamptz,
  updated_at  timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists cases_status_idx on public.cases (status);
create index if not exists cases_received_idx on public.cases (received_at);

create table if not exists public.settings (
  id          text primary key default 'default',
  data        jsonb not null,
  last_run_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.eval_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  passed      int not null,
  total       int not null,
  results     jsonb not null
);

-- Audit of every SAP write, flattened for reporting (the full event trail stays inside cases.data).
create table if not exists public.sap_writes (
  id          text primary key,
  case_id     text not null references public.cases (id) on delete cascade,
  doc_type    text not null,
  doc_number  text not null,
  released    boolean not null default false,
  payload     jsonb not null,
  response    jsonb not null,
  created_at  timestamptz not null default now()
);

-- The backend uses the secret (service) key, which bypasses row level security. Keep RLS on so the
-- publishable key cannot read anything.
alter table public.cases      enable row level security;
alter table public.settings   enable row level security;
alter table public.eval_runs  enable row level security;
alter table public.sap_writes enable row level security;
