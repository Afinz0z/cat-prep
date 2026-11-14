-- CAT prep group site: database.
-- Paste the whole file into the Supabase SQL editor and press Run.
-- Running it again is safe: tables and data are kept, functions are replaced.
--
-- Every table lives in the "private" schema, which the website cannot read.
-- The website only calls the public cat_* functions below. Each one checks
-- who is signed in, so nobody can read answer keys or other people's attempts.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- tables

create table if not exists private.config (
  key text primary key,
  value text not null
);

create table if not exists private.members (
  user_id uuid primary key,
  name text not null,
  slot smallint not null default 2 check (slot between 1 and 3),
  joined_at timestamptz not null default now(),
  is_admin boolean not null default false,
  team text check (team in ('A', 'B')),
  goal_score int,
  goal_pct numeric(4, 1),
  settings jsonb not null default '{}'
);
create unique index if not exists members_name_lower on private.members (lower(name));

-- sections: [{name, minutes, questions: [{id, type}]}]
-- key: {questionId: {answer, min, max, tolerance, display, solution}}
create table if not exists private.tests (
  test_id text primary key,
  title text not null,
  sections jsonb not null,
  key jsonb not null
);

create table if not exists private.attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null references private.tests (test_id),
  client_attempt_id text,
  started_at text,
  submitted_at timestamptz not null default now(),
  sections jsonb not null,
  questions jsonb not null,
  totals jsonb not null,
  by_section jsonb not null,
  retries jsonb not null default '[]',
  revealed_at timestamptz,
  unique (user_id, client_attempt_id)
);
create index if not exists attempts_user_test on private.attempts (user_id, test_id, submitted_at);
create index if not exists attempts_test on private.attempts (test_id);

create table if not exists private.days (
  user_id uuid not null references private.members (user_id) on delete cascade,
  day date not null,
  focus_min int not null default 0,
  target_min int,
  sleep_min int,
  primary key (user_id, day)
);
-- Water tracking was taken out on 14 Nov 2026.
alter table private.days drop column if exists water;

create table if not exists private.tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  day date not null,
  body text not null,
  done_at timestamptz
);
create index if not exists tasks_user_day on private.tasks (user_id, day);

create table if not exists private.topic_status (
  user_id uuid not null references private.members (user_id) on delete cascade,
  topic_id text not null,
  status text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- The first time someone reaches a level on a topic. Points come from here,
-- so moving a topic down and up again earns nothing extra.
create table if not exists private.topic_events (
  user_id uuid not null references private.members (user_id) on delete cascade,
  topic_id text not null,
  level smallint not null,
  at timestamptz not null default now(),
  primary key (user_id, topic_id, level)
);

create table if not exists private.videos_watched (
  user_id uuid not null references private.members (user_id) on delete cascade,
  video_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists private.mocks (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  taken_on date not null,
  source text not null,
  varc int not null,
  dilr int not null,
  qa int not null,
  paper_id text,
  at_slot_time boolean not null default false,
  -- {attempted: {varc, dilr, qa}, wrong: {varc, dilr, qa}, causes: {code: marks}, note}
  analysis jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists mocks_user on private.mocks (user_id);
create index if not exists mocks_paper on private.mocks (paper_id);

create table if not exists private.chat (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- Approaches posted on one question of a site test.
create table if not exists private.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null references private.tests (test_id),
  question_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists posts_question on private.posts (test_id, question_id, id);

create table if not exists private.post_votes (
  post_id bigint not null references private.posts (id) on delete cascade,
  user_id uuid not null references private.members (user_id) on delete cascade,
  at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists private.chat_likes (
  message_id bigint not null references private.chat (id) on delete cascade,
  user_id uuid not null references private.members (user_id) on delete cascade,
  primary key (message_id, user_id)
);

-- What each person is doing right now, for the "studying now" list.
create table if not exists private.presence (
  user_id uuid primary key references private.members (user_id) on delete cascade,
  mode text not null,
  since timestamptz not null default now(),
  until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists private.nudges (
  from_user uuid not null references private.members (user_id) on delete cascade,
  to_user uuid not null references private.members (user_id) on delete cascade,
  day date not null,
  at timestamptz not null default now(),
  primary key (from_user, to_user, day)
);

-- Wrong or blank questions come back after 1, 3 and 7 days.
create table if not exists private.reviews (
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null references private.tests (test_id),
  question_id text not null,
  stage smallint not null default 0,
  due_on date not null,
  cleared_at timestamptz,
  primary key (user_id, test_id, question_id)
);

create table if not exists private.review_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  question_id text not null,
  answer text,
  result text not null,
  at timestamptz not null default now()
);

-- Best score per day in each mental maths drill.
create table if not exists private.speed (
  user_id uuid not null references private.members (user_id) on delete cascade,
  kind text not null,
  day date not null,
  best int not null,
  rounds int not null default 1,
  primary key (user_id, kind, day)
);

create table if not exists private.rooms (
  id bigint generated always as identity primary key,
  host uuid not null references private.members (user_id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  minutes int not null,
  created_at timestamptz not null default now()
);

create table if not exists private.room_members (
  room_id bigint not null references private.rooms (id) on delete cascade,
  user_id uuid not null references private.members (user_id) on delete cascade,
  primary key (room_id, user_id)
);

create table if not exists private.bookmarks (
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null references private.tests (test_id),
  question_id text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, test_id, question_id)
);

-- ---------------------------------------------------------------- tables added 14 Nov 2026

-- kind and topic come from the test file. owner is set on mixed sets and
-- Sunday retests, which are made for one person.
alter table private.tests add column if not exists kind text;
alter table private.tests add column if not exists topic text;
alter table private.tests add column if not exists owner uuid references private.members (user_id) on delete cascade;

alter table private.members add column if not exists goal_sec jsonb not null default '{}';
alter table private.members add column if not exists rules text not null default '';
alter table private.members add column if not exists iims text not null default '';
alter table private.members add column if not exists buddy uuid references private.members (user_id) on delete set null;

-- Profiles and PINs. Each phone or iPad signs in with its own Supabase
-- anonymous account (no email) and is linked to one profile at a time by the
-- profile's PIN. Profiles don't point at Supabase's account table, so deleting
-- a device account never deletes a profile or its results.
alter table private.members add column if not exists pin_hash text;
alter table private.members drop constraint if exists members_user_id_fkey;
create table if not exists private.devices (
  auth_uid uuid primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists devices_user on private.devices (user_id);

alter table private.days add column if not exists bed_time text;
alter table private.days add column if not exists wake_time text;
alter table private.days add column if not exists plan_total smallint;
alter table private.days add column if not exists plan_text text;
alter table private.days add column if not exists breaks_taken smallint not null default 0;
alter table private.days add column if not exists breaks_skipped smallint not null default 0;

alter table private.mocks add column if not exists analysed_at timestamptz;
alter table private.chat add column if not exists paper_id text;

-- The first day each topic left "not started". Mixed sets use it.
create table if not exists private.topic_starts (
  user_id uuid not null references private.members (user_id) on delete cascade,
  topic_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- Ticks on the blocks of Today's plan.
create table if not exists private.plan_ticks (
  user_id uuid not null references private.members (user_id) on delete cascade,
  day date not null,
  block_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, day, block_id)
);

-- Each batch of minutes the study timer sends, with the time it arrived.
create table if not exists private.focus_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  at timestamptz not null default now(),
  minutes smallint not null
);
create index if not exists focus_log_user_at on private.focus_log (user_id, at);

-- Formula cards recalled from memory, spaced like the review queue.
create table if not exists private.recall (
  user_id uuid not null references private.members (user_id) on delete cascade,
  card_id text not null,
  stage smallint not null default 0,
  due_on date not null,
  hits int not null default 0,
  misses int not null default 0,
  cleared_at timestamptz,
  primary key (user_id, card_id)
);

-- One line on why an answer is right, written before the solution shows.
create table if not exists private.explanations (
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  question_id text not null,
  body text not null,
  at timestamptz not null default now(),
  primary key (user_id, test_id, question_id)
);

-- Which of the seven causes lost a question on a site test.
create table if not exists private.question_causes (
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  question_id text not null,
  cause text not null check (cause in ('c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7')),
  at timestamptz not null default now(),
  primary key (user_id, test_id, question_id)
);

create table if not exists private.checkins (
  user_id uuid not null references private.members (user_id) on delete cascade,
  day date not null,
  hours numeric(4, 1),
  best text not null default '',
  worst text not null default '',
  fix text not null default '',
  at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Debrief threads, one per calendar paper. Readable once you've logged the paper.
create table if not exists private.paper_posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  paper_id text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Where each person is in a calendar paper at slot time.
create table if not exists private.paper_status (
  user_id uuid not null references private.members (user_id) on delete cascade,
  paper_id text not null,
  day date not null,
  state text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id, day)
);

-- Papers on the calendar. owner null: a group paper the admin set.
create table if not exists private.calendar (
  id bigint generated always as identity primary key,
  day date not null,
  at_time text not null default '12:30',
  paper_id text,
  title text not null,
  kind text not null default 'free',
  link text,
  owner uuid references private.members (user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists private.reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  question_id text not null,
  body text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists private.rc_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  at timestamptz not null default now(),
  words int not null,
  seconds int not null,
  right_n smallint not null,
  total_n smallint not null,
  source text not null default ''
);

create table if not exists private.spend (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  item text not null,
  amount int not null,
  on_day date not null,
  created_at timestamptz not null default now()
);

-- Short recorded explanations on a test question, as base64 audio.
create table if not exists private.voice_notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  question_id text not null,
  mime text not null,
  data text not null,
  seconds smallint not null,
  created_at timestamptz not null default now()
);

-- Pen strokes on the shared whiteboards.
create table if not exists private.strokes (
  id bigint generated always as identity primary key,
  board text not null,
  user_id uuid not null references private.members (user_id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists strokes_board on private.strokes (board, id);

-- Two people on one DILR set with one clock.
create table if not exists private.cosolve (
  id bigint generated always as identity primary key,
  host uuid not null references private.members (user_id) on delete cascade,
  partner uuid not null references private.members (user_id) on delete cascade,
  test_id text not null,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

-- Days run on Indian time, whatever the server's clock says.
create or replace function private.ist_day(ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select ((ts at time zone 'UTC') + interval '5 hours 30 minutes')::date
$$;

create or replace function private.today() returns date
language sql stable set search_path = '' as $$
  select private.ist_day(now())
$$;

create or replace function private.week_start(d date) returns date
language sql immutable set search_path = '' as $$
  select d - (extract(isodow from d)::int - 1)
$$;

-- The signed-in device. This is the only place that reads auth.uid().
create or replace function private.device() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  d uuid := auth.uid();
begin
  if d is null then
    raise exception 'Sign in first.';
  end if;
  return d;
end $$;

-- The profile this device is on, or null before someone picks one.
create or replace function private.uid() returns uuid
language sql stable security definer set search_path = '' as $$
  select user_id from private.devices where auth_uid = private.device()
$$;

create or replace function private.member() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.uid();
begin
  if u is null or not exists (select 1 from private.members where user_id = u) then
    raise exception 'Pick your profile first.';
  end if;
  return u;
end $$;

create or replace function private.check_code(p_code text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  code text;
begin
  select value into code from private.config where key = 'join_code';
  if code is null or upper(btrim(coalesce(p_code, ''))) <> upper(btrim(code)) then
    raise exception 'That group code is wrong. Ask whoever runs the group for it.';
  end if;
end $$;

create or replace function private.check_pin(p_pin text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'Use 4 digits for the PIN.';
  end if;
end $$;

create or replace function private.hash_pin(p_user uuid, p_pin text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_user::text || ':' || coalesce(p_pin, ''), 'UTF8')), 'hex')
$$;

create or replace function private.num(v jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(v) when 'number' then (v #>> '{}')::numeric else null end
$$;

-- A typed or chosen answer as text, or null when blank.
create or replace function private.clean_answer(v jsonb) returns text
language sql immutable set search_path = '' as $$
  select nullif(left(btrim(case jsonb_typeof(v)
    when 'string' then v #>> '{}'
    when 'number' then v #>> '{}'
    else null end), 40), '')
$$;

-- A type-in answer as a number, or null if it isn't one. Commas, %, the rupee
-- sign and spaces are ignored, as on the real exam.
create or replace function private.norm_tita(t text) returns numeric
language plpgsql immutable set search_path = '' as $$
declare
  s text;
begin
  if t is null then
    return null;
  end if;
  s := regexp_replace(btrim(t), '[,%₹ ]', '', 'g');
  if s !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' then
    return null;
  end if;
  return s::numeric;
end $$;

-- "correct", "wrong" or "skipped".
create or replace function private.grade(q_type text, k jsonb, ans text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v numeric;
  tol numeric;
begin
  if ans is null or btrim(ans) = '' then
    return 'skipped';
  end if;
  if q_type = 'mcq' then
    return case when upper(btrim(ans)) = upper(btrim(k ->> 'answer')) then 'correct' else 'wrong' end;
  end if;
  v := private.norm_tita(ans);
  if v is null then
    return 'wrong';
  end if;
  if k ? 'min' and k ? 'max' then
    return case when v between (k ->> 'min')::numeric - 0.000001 and (k ->> 'max')::numeric + 0.000001
      then 'correct' else 'wrong' end;
  end if;
  tol := coalesce((k ->> 'tolerance')::numeric, 0.000001);
  return case when abs(v - (k ->> 'answer')::numeric) <= tol then 'correct' else 'wrong' end;
end $$;

-- CAT marking: +3 right, -1 wrong MCQ, 0 for a wrong type-in or a blank.
create or replace function private.marks(q_type text, result text) returns int
language sql immutable set search_path = '' as $$
  select case
    when result = 'correct' then 3
    when result = 'wrong' and q_type = 'mcq' then -1
    else 0 end
$$;

create or replace function private.tally(m int, c int, w int, s int) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'marks', m, 'correct', c, 'wrong', w, 'skipped', s, 'attempted', c + w,
    'accuracy', case when c + w > 0 then round(c::numeric / (c + w), 3) else null end)
$$;

create or replace function private.attempt_json(p_id bigint, u uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attemptId', a.id,
    'testId', a.test_id,
    'testTitle', t.title,
    'startedAt', a.started_at,
    'submittedAt', a.submitted_at,
    'sections', a.sections,
    'questions', a.questions,
    'totals', a.totals,
    'bySection', a.by_section,
    'retries', a.retries,
    'revealedAt', a.revealed_at,
    'reveal', case when a.revealed_at is null then null else (
      select jsonb_object_agg(q ->> 'id', jsonb_build_object(
        'answer', coalesce(t.key -> (q ->> 'id') -> 'display', t.key -> (q ->> 'id') -> 'answer'),
        'solution', coalesce(t.key -> (q ->> 'id') ->> 'solution', '')))
      from jsonb_array_elements(a.questions) q) end)
  from private.attempts a
  join private.tests t on t.test_id = a.test_id
  where a.id = p_id and a.user_id = u
$$;

-- The first attempt someone made at a test. Rankings and threads use this one,
-- so retaking a test after seeing the answers changes nothing.
create or replace function private.first_attempt(u uuid, p_test text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from private.attempts
  where user_id = u and test_id = p_test
  order by submitted_at, id
  limit 1
$$;

create or replace function private.first_result(u uuid, p_test text, p_question text) returns text
language sql stable security definer set search_path = '' as $$
  select q ->> 'result'
  from private.attempts a, jsonb_array_elements(a.questions) q
  where a.id = private.first_attempt(u, p_test) and q ->> 'id' = p_question
$$;

-- How a day counts for the streak: 1 for a study day (an hour or more of
-- focus), 0 for a saved day, -1 for a break in the streak. A day under an
-- hour is saved when you logged sleep that day and studied 2 hours or more
-- the next day, so one bad day doesn't wipe the streak.
create or replace function private.streak_day(u uuid, d date) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from private.days where user_id = u and day = d and focus_min >= 60) then 1
    when exists (select 1 from private.days where user_id = u and day = d and sleep_min is not null)
      and exists (select 1 from private.days where user_id = u and day = d + 1 and focus_min >= 120) then 0
    else -1 end
$$;

create or replace function private.streak(u uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  d date := private.today();
  n int := 0;
  s int;
begin
  -- Today still counts as unbroken until it's over.
  if private.streak_day(u, d) < 1 then
    d := d - 1;
  end if;
  loop
    s := private.streak_day(u, d);
    exit when s < 0 or d < date '2026-01-01';
    n := n + s;
    d := d - 1;
  end loop;
  return n;
end $$;

create or replace function private.check_text(body text, max_len int, what text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  t text := btrim(coalesce(body, ''));
begin
  if t = '' then
    raise exception '% is empty.', what;
  end if;
  if char_length(t) > max_len then
    raise exception '% is too long (% characters at most).', what, max_len;
  end if;
  return t;
end $$;

-- Whether someone has logged a given paper on the Mocks page.
create or replace function private.logged_paper(u uuid, p_paper text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.mocks where user_id = u and paper_id = p_paper)
$$;

-- Every question on the site with its topic and question type.
create or replace function private.qinfo() returns table (test_id text, qid text, topic text, qtype text, kind text, owner uuid)
language sql stable security definer set search_path = '' as $$
  select t.test_id, q ->> 'id', coalesce(q ->> 'topic', t.topic), q ->> 'qtype', t.kind, t.owner
  from private.tests t, jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'questions') q
$$;

-- One person's results by topic: first attempts at shared tests, every
-- mixed set and retest, and every review answer. Blanks count as not solved.
create or replace function private.topic_results(u uuid) returns table (topic text, solved int, total int, sets int)
language sql stable security definer set search_path = '' as $$
  with res as (
    select a.id aid, a.test_id, q ->> 'id' qid, q ->> 'result' result
    from private.attempts a, jsonb_array_elements(a.questions) q
    where a.user_id = u and a.id = private.first_attempt(u, a.test_id)
    union all
    select null, test_id, question_id, result from private.review_log where user_id = u
  )
  select qi.topic, (count(*) filter (where res.result = 'correct'))::int, count(*)::int,
    (count(distinct res.aid) filter (where qi.kind = 'practice' or qi.owner is not null))::int
  from res join private.qinfo() qi on qi.test_id = res.test_id and qi.qid = res.qid
  where qi.topic is not null
  group by qi.topic
$$;

-- ---------------------------------------------------------------- profile

create or replace function public.cat_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.uid();
begin
  return jsonb_build_object('member', (
    select jsonb_build_object('name', m.name, 'slot', m.slot, 'joinedAt', m.joined_at, 'isAdmin', m.is_admin,
      'team', m.team, 'goalScore', m.goal_score, 'goalPct', m.goal_pct, 'goalSec', m.goal_sec,
      'rules', m.rules, 'iims', m.iims, 'buddy', b.name, 'settings', m.settings)
    from private.members m left join private.members b on b.user_id = m.buddy
    where m.user_id = u));
end $$;

create or replace function public.cat_set_profile(p_name text, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  n text := btrim(coalesce(p_name, ''));
begin
  if n !~ '^[[:alnum:] ._-]{2,20}$' then
    raise exception 'Pick a name of 2 to 20 letters or numbers.';
  end if;
  if p_slot is null or p_slot not between 1 and 3 then
    raise exception 'Pick slot 1, 2 or 3.';
  end if;
  if exists (select 1 from private.members where lower(name) = lower(n) and user_id <> u) then
    raise exception 'Someone in the group already uses that name.';
  end if;
  update private.members set name = n, slot = p_slot where user_id = u;
  return public.cat_me();
end $$;

drop function if exists public.cat_join(text, text, int);

-- Make a profile and put this device on it.
create or replace function public.cat_join(p_code text, p_name text, p_slot int, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d uuid := private.device();
  u uuid;
  n text := btrim(coalesce(p_name, ''));
begin
  perform private.check_code(p_code);
  -- A second tap on the button, or a device already on a profile.
  if private.uid() is not null then
    return public.cat_me();
  end if;
  if n !~ '^[[:alnum:] ._-]{2,20}$' then
    raise exception 'Pick a name of 2 to 20 letters or numbers.';
  end if;
  if p_slot is null or p_slot not between 1 and 3 then
    raise exception 'Pick slot 1, 2 or 3.';
  end if;
  perform private.check_pin(p_pin);
  if exists (select 1 from private.members where lower(name) = lower(n)) then
    raise exception 'Someone in the group already uses that name.';
  end if;
  -- A device's first profile takes the device's id; a further one gets a new id.
  u := case when exists (select 1 from private.members where user_id = d) then gen_random_uuid() else d end;
  -- The first person to join runs the group.
  insert into private.members (user_id, name, slot, is_admin, pin_hash)
  values (u, n, p_slot, not exists (select 1 from private.members), private.hash_pin(u, p_pin));
  insert into private.devices (auth_uid, user_id) values (d, u)
  on conflict (auth_uid) do update set user_id = excluded.user_id, linked_at = now();
  return public.cat_me();
end $$;

-- The profiles to pick from on this device, once it has the group code.
create or replace function public.cat_profile_list(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.device();
  perform private.check_code(p_code);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', user_id, 'name', name, 'isAdmin', is_admin) order by joined_at), '[]')
    from private.members);
end $$;

-- Put this device on a profile, with the profile's PIN.
create or replace function public.cat_unlock(p_code text, p_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d uuid := private.device();
  h text;
begin
  perform private.check_code(p_code);
  select pin_hash into h from private.members where user_id = p_id;
  if not found then
    raise exception 'That profile is no longer in the group.';
  end if;
  if h is null or h <> private.hash_pin(p_id, p_pin) then
    raise exception 'That PIN is wrong. Try again.';
  end if;
  insert into private.devices (auth_uid, user_id) values (d, p_id)
  on conflict (auth_uid) do update set user_id = excluded.user_id, linked_at = now();
  return public.cat_me();
end $$;

-- Take this device off its profile. Other devices stay where they are.
create or replace function public.cat_lock() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.devices where auth_uid = private.device();
  return jsonb_build_object('member', null);
end $$;

create or replace function public.cat_change_pin(p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if not exists (select 1 from private.members where user_id = u and pin_hash = private.hash_pin(u, p_old)) then
    raise exception 'That PIN is wrong. Type the PIN you use now.';
  end if;
  perform private.check_pin(p_new);
  update private.members set pin_hash = private.hash_pin(u, p_new) where user_id = u;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- tests

create or replace function public.cat_submit(p_attempt jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t private.tests%rowtype;
  client_id text := nullif(left(coalesce(p_attempt ->> 'clientAttemptId', ''), 64), '');
  existing bigint;
  incoming jsonb;
  sent jsonb;
  sec jsonb;
  q jsonb;
  got jsonb;
  ans text;
  res text;
  n int;
  si int := 0;
  m int; c int; w int; s int;
  tm int := 0; tc int := 0; tw int := 0; ts int := 0;
  questions jsonb := '[]';
  sections jsonb := '[]';
  by_section jsonb := '{}';
  new_id bigint;
begin
  select * into t from private.tests where test_id = p_attempt ->> 'testId';
  if not found then
    raise exception 'That test is not on the site.';
  end if;
  if t.owner is not null and t.owner <> u then
    raise exception 'That set was made for someone else.';
  end if;
  if client_id is not null then
    select id into existing from private.attempts where user_id = u and client_attempt_id = client_id;
    if existing is not null then
      return private.attempt_json(existing, u);
    end if;
  end if;

  select coalesce(jsonb_object_agg(x ->> 'id', x), '{}') into incoming
  from jsonb_array_elements(case when jsonb_typeof(p_attempt -> 'questions') = 'array'
    then p_attempt -> 'questions' else '[]' end) x
  where jsonb_typeof(x) = 'object' and x ? 'id';
  sent := case when jsonb_typeof(p_attempt -> 'sections') = 'array' then p_attempt -> 'sections' else '[]' end;

  for sec in select value from jsonb_array_elements(t.sections) loop
    m := 0; c := 0; w := 0; s := 0; n := 0;
    for q in select value from jsonb_array_elements(sec -> 'questions') loop
      n := n + 1;
      got := coalesce(incoming -> (q ->> 'id'), '{}');
      ans := private.clean_answer(got -> 'answer');
      res := private.grade(q ->> 'type', t.key -> (q ->> 'id'), ans);
      m := m + private.marks(q ->> 'type', res);
      if res = 'correct' then c := c + 1; elsif res = 'wrong' then w := w + 1; else s := s + 1; end if;
      questions := questions || jsonb_build_object(
        'id', q ->> 'id',
        'section', sec ->> 'name',
        'number', n,
        'type', q ->> 'type',
        'answer', ans,
        'status', left(coalesce(got ->> 'status', 'notVisited'), 24),
        'timeSpentSec', round(least(greatest(coalesce(private.num(got -> 'timeSpentSec'), 0), 0), 36000), 1),
        'visits', least(greatest(coalesce(private.num(got -> 'visits'), 0), 0), 9999)::int,
        'result', res,
        'topic', coalesce(q ->> 'topic', t.topic),
        -- how sure you were, and when in the section you last saved the answer
        'conf', case when got ->> 'conf' in ('sure', 'unsure', 'guess') then got ->> 'conf' end,
        'atSec', case when private.num(got -> 'atSec') is not null
          then least(greatest(private.num(got -> 'atSec'), 0), 36000)::int end);
    end loop;
    by_section := by_section || jsonb_build_object(sec ->> 'name', private.tally(m, c, w, s));
    sections := sections || jsonb_build_object(
      'name', sec ->> 'name',
      'minutes', (sec ->> 'minutes')::int,
      'timeUsedSec', least(greatest(coalesce(private.num(sent -> si -> 'timeUsedSec'), 0), 0), 36000)::int,
      'endedBy', left(coalesce(sent -> si ->> 'endedBy', ''), 12));
    si := si + 1;
    tm := tm + m; tc := tc + c; tw := tw + w; ts := ts + s;
  end loop;

  insert into private.attempts (user_id, test_id, client_attempt_id, started_at, sections, questions, totals, by_section)
  values (u, t.test_id, client_id, left(p_attempt ->> 'startedAt', 40), sections, questions,
    private.tally(tm, tc, tw, ts), by_section)
  on conflict (user_id, client_attempt_id) do nothing
  returning id into new_id;
  if new_id is null then
    select id into new_id from private.attempts where user_id = u and client_attempt_id = client_id;
  end if;
  -- Wrong and blank questions from a first attempt go into the review queue.
  -- A mixed set or retest files them under the test they came from, and
  -- reopens one you had cleared.
  if t.owner is not null then
    insert into private.reviews (user_id, test_id, question_id, due_on)
    select u, split_part(qq ->> 'id', '~', 1), split_part(qq ->> 'id', '~', 2), private.today() + 1
    from jsonb_array_elements(questions) qq
    where qq ->> 'result' <> 'correct'
      and exists (select 1 from private.tests s where s.test_id = split_part(qq ->> 'id', '~', 1))
    on conflict (user_id, test_id, question_id) do update
      set stage = 0, due_on = excluded.due_on, cleared_at = null
      where private.reviews.cleared_at is not null;
  elsif private.first_attempt(u, t.test_id) = new_id then
    insert into private.reviews (user_id, test_id, question_id, due_on)
    select u, t.test_id, qq ->> 'id', private.today() + 1
    from jsonb_array_elements(questions) qq
    where qq ->> 'result' <> 'correct'
    on conflict do nothing;
  end if;
  return private.attempt_json(new_id, u);
end $$;

create or replace function public.cat_attempt(p_attempt_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  r jsonb := private.attempt_json(p_attempt_id, u);
begin
  if r is null then
    raise exception 'No attempt of yours with that number.';
  end if;
  return r;
end $$;

create or replace function public.cat_attempts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', a.id, 'testId', a.test_id, 'testTitle', t.title, 'kind', t.kind, 'topic', t.topic,
    'composed', t.owner is not null,
    'submittedAt', a.submitted_at, 'totals', a.totals) order by a.submitted_at desc), '[]')
  from private.attempts a
  join private.tests t on t.test_id = a.test_id
  where a.user_id = private.member()
$$;

create or replace function public.cat_retry(p_attempt_id bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  a private.attempts%rowtype;
  k jsonb;
  q jsonb;
  ans text;
  answers jsonb := '{}';
  results jsonb := '{}';
begin
  select * into a from private.attempts where id = p_attempt_id and user_id = u for update;
  if not found then
    raise exception 'No attempt of yours with that number.';
  end if;
  if a.revealed_at is not null then
    raise exception 'The answers are already shown, so retries are closed.';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Send the retry answers as a list.';
  end if;
  select key into k from private.tests where test_id = a.test_id;
  for q in select value from jsonb_array_elements(a.questions) loop
    continue when q ->> 'result' = 'correct' or not (p_answers ? (q ->> 'id'));
    ans := private.clean_answer(p_answers -> (q ->> 'id'));
    continue when ans is null;
    answers := answers || jsonb_build_object(q ->> 'id', ans);
    results := results || jsonb_build_object(q ->> 'id', private.grade(q ->> 'type', k -> (q ->> 'id'), ans));
  end loop;
  if results = '{}' then
    raise exception 'Type at least one answer first.';
  end if;
  update private.attempts
  set retries = retries || jsonb_build_array(jsonb_build_object('at', now(), 'answers', answers, 'results', results))
  where id = a.id;
  return private.attempt_json(a.id, u);
end $$;

create or replace function public.cat_reveal(p_attempt_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  update private.attempts set revealed_at = coalesce(revealed_at, now())
  where id = p_attempt_id and user_id = u;
  if not found then
    raise exception 'No attempt of yours with that number.';
  end if;
  return private.attempt_json(p_attempt_id, u);
end $$;

-- ---------------------------------------------------------------- today: focus, tasks

create or replace function public.cat_today() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'day', private.today(),
    'focusMin', coalesce((select focus_min from private.days where user_id = private.member() and day = private.today()), 0),
    'targetMin', (select target_min from private.days where user_id = private.member() and day = private.today()),
    'sleepMin', (select sleep_min from private.days where user_id = private.member() and day = private.today()),
    'streak', private.streak(private.member()),
    'reviewsDue', (select count(*) from private.reviews
      where user_id = private.member() and cleared_at is null and due_on <= private.today()),
    'nudges', coalesce((select jsonb_agg(jsonb_build_object('from', m.name, 'at', n.at) order by n.at)
      from private.nudges n join private.members m on m.user_id = n.from_user
      where n.to_user = private.member() and n.day = private.today()), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', body, 'done', done_at is not null) order by id)
      from private.tasks where user_id = private.member() and day = private.today()), '[]'),
    'bedTime', (select bed_time from private.days where user_id = private.member() and day = private.today()),
    'wakeTime', (select wake_time from private.days where user_id = private.member() and day = private.today()),
    'planText', (select plan_text from private.days where user_id = private.member() and day = private.today()),
    'planTicks', coalesce((select jsonb_agg(block_id order by at) from private.plan_ticks
      where user_id = private.member() and day = private.today()), '[]'),
    'checkin', (select jsonb_build_object('hours', hours, 'best', best, 'worst', worst, 'fix', fix)
      from private.checkins where user_id = private.member() and day = private.today()),
    'breaks', (select jsonb_build_object('taken', breaks_taken, 'skipped', breaks_skipped)
      from private.days where user_id = private.member() and day = private.today()),
    'notice', (select jsonb_build_object('text', n.value, 'at', a.value)
      from private.config n left join private.config a on a.key = 'notice_at'
      where n.key = 'notice' and n.value <> ''))
$$;

-- Minutes from the study timer. At most 60 per call and 14 hours a day.
create or replace function public.cat_add_focus(p_minutes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  m int := least(greatest(coalesce(p_minutes, 0), 0), 60);
begin
  insert into private.days (user_id, day, focus_min) values (u, private.today(), m)
  on conflict (user_id, day) do update set focus_min = least(private.days.focus_min + excluded.focus_min, 840);
  if m > 0 then
    insert into private.focus_log (user_id, minutes) values (u, m);
  end if;
  return public.cat_today();
end $$;

drop function if exists public.cat_water(int);

create or replace function public.cat_task_add(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 120, 'The task');
begin
  if (select count(*) from private.tasks where user_id = u and day = private.today()) >= 8 then
    raise exception 'Eight tasks is the limit for one day.';
  end if;
  insert into private.tasks (user_id, day, body) values (u, private.today(), t);
  return public.cat_today();
end $$;

create or replace function public.cat_task_done(p_task_id bigint, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  update private.tasks
  set done_at = case when p_done then coalesce(done_at, now()) else null end
  where id = p_task_id and user_id = u and day = private.today();
  return public.cat_today();
end $$;

create or replace function public.cat_task_delete(p_task_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  delete from private.tasks where id = p_task_id and user_id = u and day = private.today();
  return public.cat_today();
end $$;

-- ---------------------------------------------------------------- topics and videos

create or replace function public.cat_progress() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'topics', coalesce((select jsonb_object_agg(topic_id, status) from private.topic_status
      where user_id = private.member()), '{}'),
    'videos', coalesce((select jsonb_agg(video_id order by at) from private.videos_watched
      where user_id = private.member()), '[]'),
    'members', (select count(*) from private.members),
    'starts', coalesce((select jsonb_object_agg(topic_id, private.ist_day(at)) from private.topic_starts
      where user_id = private.member()), '{}'),
    'group', coalesce((select jsonb_object_agg(topic_id, jsonb_build_object('basic', b, 'catLevel', c)) from (
      select topic_id, count(*) filter (where level = 1) b, count(*) filter (where level = 2) c
      from private.topic_events group by topic_id) x), '{}'))
$$;

create or replace function public.cat_topic_set(p_topic text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if coalesce(p_topic, '') !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Unknown topic.';
  end if;
  if p_status not in ('not-started', 'learning', 'basic', 'cat-level', 'revise') then
    raise exception 'Unknown status.';
  end if;
  insert into private.topic_status (user_id, topic_id, status) values (u, p_topic, p_status)
  on conflict (user_id, topic_id) do update set status = excluded.status, updated_at = now();
  if p_status <> 'not-started' then
    insert into private.topic_starts (user_id, topic_id) values (u, p_topic) on conflict do nothing;
  end if;
  if p_status in ('basic', 'cat-level') then
    insert into private.topic_events (user_id, topic_id, level) values (u, p_topic, 1) on conflict do nothing;
  end if;
  if p_status = 'cat-level' then
    insert into private.topic_events (user_id, topic_id, level) values (u, p_topic, 2) on conflict do nothing;
  end if;
  return public.cat_progress();
end $$;

create or replace function public.cat_video_set(p_video text, p_watched boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if coalesce(p_video, '') !~ '^[A-Za-z0-9_-]{6,20}$' then
    raise exception 'Unknown video.';
  end if;
  if p_watched then
    insert into private.videos_watched (user_id, video_id) values (u, p_video) on conflict do nothing;
  else
    delete from private.videos_watched where user_id = u and video_id = p_video;
  end if;
  return public.cat_progress();
end $$;

-- ---------------------------------------------------------------- full mocks taken elsewhere

create or replace function public.cat_mocks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'takenOn', taken_on, 'source', source, 'paperId', paper_id, 'atSlotTime', at_slot_time,
    'varc', varc, 'dilr', dilr, 'qa', qa, 'total', varc + dilr + qa, 'analysis', analysis,
    'analysedAt', analysed_at)
    order by taken_on desc, id desc), '[]')
  from private.mocks where user_id = private.member()
$$;

-- Keep only the analysis fields the site uses, with sane values:
-- {attempted: {varc, dilr, qa}, wrong: {varc, dilr, qa}, causes: {c1..c7: marks lost},
--  note, skip: [3 lines], try: [3 lines], resolve: marks on the untimed redo, varcOrder: rc|va}
create or replace function private.clean_analysis(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  a jsonb := '{}';
  sec text;
begin
  if jsonb_typeof(p) <> 'object' then
    return a;
  end if;
  for sec in select unnest(array['attempted', 'wrong']) loop
    if jsonb_typeof(p -> sec) = 'object' then
      a := a || jsonb_build_object(sec, (
        select coalesce(jsonb_object_agg(k, least(greatest((p -> sec ->> k)::numeric::int, 0), 24)), '{}')
        from unnest(array['varc', 'dilr', 'qa']) k
        where jsonb_typeof(p -> sec -> k) = 'number'));
    end if;
  end loop;
  if jsonb_typeof(p -> 'causes') = 'object' then
    a := a || jsonb_build_object('causes', (
      select coalesce(jsonb_object_agg(k, least(greatest((p -> 'causes' ->> k)::numeric::int, 0), 204)), '{}')
      from unnest(array['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']) k
      where jsonb_typeof(p -> 'causes' -> k) = 'number'));
  end if;
  if jsonb_typeof(p -> 'note') = 'string' then
    a := a || jsonb_build_object('note', left(p ->> 'note', 500));
  end if;
  for sec in select unnest(array['skip', 'try']) loop
    if jsonb_typeof(p -> sec) = 'array' then
      a := a || jsonb_build_object(sec, (
        select coalesce(jsonb_agg(left(btrim(x), 120) order by i), '[]')
        from (select x, i from jsonb_array_elements_text(p -> sec) with ordinality e(x, i)
              where btrim(x) <> '' order by i limit 3) y));
    end if;
  end loop;
  if jsonb_typeof(p -> 'resolve') = 'number' then
    a := a || jsonb_build_object('resolve', least(greatest((p ->> 'resolve')::numeric::int, -68), 204));
  end if;
  if p ->> 'varcOrder' in ('rc', 'va') then
    a := a || jsonb_build_object('varcOrder', p ->> 'varcOrder');
  end if;
  return a;
end $$;

-- An analysis counts as saved once it names where the marks went.
create or replace function private.is_analysed(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce((select count(*) > 0 from jsonb_object_keys(coalesce(a -> 'causes', '{}'))), false)
    or jsonb_array_length(coalesce(a -> 'skip', '[]')) > 0
$$;

create or replace function public.cat_mock_add(p_taken_on date, p_source text, p_paper_id text, p_varc int, p_dilr int, p_qa int,
  p_at_slot_time boolean, p_analysis jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  src text := private.check_text(p_source, 60, 'The paper name');
  a jsonb := private.clean_analysis(p_analysis);
begin
  if p_taken_on is null or p_taken_on < date '2026-01-01' or p_taken_on > private.today() then
    raise exception 'Use the date you took the paper (not in the future).';
  end if;
  if p_varc not between -24 and 72 or p_dilr not between -22 and 66 or p_qa not between -22 and 66 then
    raise exception 'Those marks are outside what CAT allows. VARC runs from -24 to 72, DILR and QA from -22 to 66.';
  end if;
  if p_paper_id is not null and p_paper_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Unknown paper.';
  end if;
  insert into private.mocks (user_id, taken_on, source, paper_id, varc, dilr, qa, at_slot_time, analysis, analysed_at)
  values (u, p_taken_on, src, p_paper_id, p_varc, p_dilr, p_qa, coalesce(p_at_slot_time, false), a,
    case when private.is_analysed(a) then now() end);
  return public.cat_mocks();
end $$;

-- Save or replace the analysis of a mock you logged earlier.
create or replace function public.cat_mock_analysis(p_mock_id bigint, p_analysis jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  a jsonb := private.clean_analysis(p_analysis);
begin
  update private.mocks
  set analysis = a,
    analysed_at = case when private.is_analysed(a) then coalesce(analysed_at, now()) else null end
  where id = p_mock_id and user_id = u;
  if not found then
    raise exception 'No mock of yours with that number.';
  end if;
  return public.cat_mocks();
end $$;

-- Everyone's marks on one paper, for head-to-head comparison.
create or replace function public.cat_paper(p_paper_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(), 'takenOn', k.taken_on,
    'varc', k.varc, 'dilr', k.dilr, 'qa', k.qa, 'total', k.varc + k.dilr + k.qa)
    order by k.varc + k.dilr + k.qa desc), '[]')
  from (select distinct on (user_id) * from private.mocks where paper_id = p_paper_id order by user_id, taken_on, id) k
  join private.members m on m.user_id = k.user_id
$$;

create or replace function public.cat_mock_delete(p_mock_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  delete from private.mocks where id = p_mock_id and user_id = u;
  return public.cat_mocks();
end $$;

-- ---------------------------------------------------------------- leaderboards
--
-- Effort points, counted per day on Indian time:
--   focus             1 per 10 minutes on the study timer, up to 60 a day
--   study day         5 for any day with an hour or more of focus
--   promise kept      10 when you set a target of 2 hours or more and reach it
--   sleep             5 for logging 7 hours or more
--   tasks             3 per task ticked off, up to 5 tasks a day
--   site test         20 the first time you finish each test (10 for a Daily 5)
--   full mock         30 per mock logged, one a day, plus 10 if sat at your CAT slot time
--   video             5 per video marked watched, up to 6 a day
--   topic level       10 for reaching "solves basic", 15 more for "solves CAT level", up to 50 a day
--   approach posted   3 per explanation of 40 characters or more, up to 5 a day
--   helpful votes     2 per vote your approaches receive, up to 5 a day
--   review            2 per review question answered right, up to 5 a day
--   speed drill       2 per round finished, up to 5 rounds a day
--   mixed set         10 per mixed set or Sunday retest finished (in place of the 20 for a site test)
--   analysis          10 per full-mock analysis saved, up to 2 a day
--   review cleared    3 per review question cleared for good, up to 5 a day
--
-- p_range: 'week' (this week), 'last' (last week), 'all' (since 1 Nov), or a
-- date 'YYYY-MM-DD' for the week starting that Monday.

create or replace function public.cat_board(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  d1 date := private.today();
  d0 date;
begin
  if p_range = 'last' then
    d1 := private.week_start(private.today()) - 1;
    d0 := d1 - 6;
  elsif p_range = 'all' then
    d0 := date '2026-11-01';
  elsif p_range ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    d0 := private.week_start(p_range::date);
    d1 := least(d0 + 6, private.today());
  else
    d0 := private.week_start(d1);
  end if;
  return jsonb_build_object('range', coalesce(p_range, 'week'), 'from', d0, 'to', d1,
    'rows', private.board_rows(u, d0, d1));
end $$;

create or replace function private.board_rows(u uuid, d0 date, d1 date) returns jsonb
language sql stable security definer set search_path = '' as $$
  with m as (
    select user_id, name, slot, team from private.members
  ), dd as (
    select user_id, sum(least(focus_min / 10, 60)) fp, sum(focus_min) fm,
      count(*) filter (where focus_min >= 60) sd,
      count(*) filter (where target_min >= 120 and focus_min >= target_min) kept,
      count(*) filter (where sleep_min >= 420) slept
    from private.days where day between d0 and d1 group by user_id
  ), tk as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, day, count(*) n from private.tasks
      where done_at is not null and day between d0 and d1 group by 1, 2) x group by 1
  ), ts as (
    select user_id, sum(case when test_id like 'daily-%' or test_id like 'mix-%' or test_id like 'retest-%'
      then 10 else 20 end) p, count(*) n from (
      select user_id, test_id, min(private.ist_day(submitted_at)) fd from private.attempts group by 1, 2) x
    where fd between d0 and d1 group by 1
  ), an as (
    select user_id, sum(least(n, 2)) n from (
      select user_id, private.ist_day(analysed_at) dd, count(*) n from private.mocks
      where analysed_at is not null group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), cl as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, private.ist_day(cleared_at) dd, count(*) n from private.reviews
      where cleared_at is not null group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), mk as (
    select user_id, count(*) n, count(*) filter (where slot_time) slot_n from (
      select user_id, private.ist_day(created_at) dd, bool_or(at_slot_time) slot_time
      from private.mocks group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), vd as (
    select user_id, sum(least(n, 6)) n from (
      select user_id, private.ist_day(at) dd, count(*) n from private.videos_watched group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), tp as (
    select user_id, sum(least(p, 50)) p from (
      select user_id, private.ist_day(at) dd, sum(case when level = 1 then 10 else 15 end) p
      from private.topic_events group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), ps as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, private.ist_day(created_at) dd, count(*) n from private.posts
      where char_length(body) >= 40 group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), hv as (
    select user_id, sum(least(n, 5)) n from (
      select p.user_id, private.ist_day(v.at) dd, count(*) n
      from private.post_votes v join private.posts p on p.id = v.post_id group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), rv as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, private.ist_day(at) dd, count(*) n from private.review_log
      where result = 'correct' group by 1, 2) x
    where dd between d0 and d1 group by 1
  ), sp as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, day, sum(rounds) n from private.speed where day between d0 and d1 group by 1, 2) x
    group by 1
  ), r as (
    select m.user_id, m.name, m.slot, m.team,
      coalesce(dd.fm, 0) focus_min,
      coalesce(dd.sd, 0) study_days,
      coalesce(dd.kept, 0) kept,
      coalesce(dd.slept, 0) slept,
      coalesce(tk.n, 0) tasks,
      coalesce(ts.n, 0) tests,
      coalesce(mk.n, 0) mocks,
      coalesce(vd.n, 0) videos,
      coalesce(tp.p, 0) topic_points,
      coalesce(ps.n, 0) posts,
      coalesce(hv.n, 0) votes,
      coalesce(rv.n, 0) reviews,
      coalesce(sp.n, 0) drills,
      coalesce(an.n, 0) analyses,
      coalesce(cl.n, 0) cleared,
      coalesce(dd.fp, 0) + 5 * coalesce(dd.sd, 0) + 10 * coalesce(dd.kept, 0) + 5 * coalesce(dd.slept, 0)
        + 3 * coalesce(tk.n, 0) + coalesce(ts.p, 0)
        + 30 * coalesce(mk.n, 0) + 10 * coalesce(mk.slot_n, 0) + 5 * coalesce(vd.n, 0)
        + coalesce(tp.p, 0) + 3 * coalesce(ps.n, 0) + 2 * coalesce(hv.n, 0)
        + 2 * coalesce(rv.n, 0) + 2 * coalesce(sp.n, 0)
        + 10 * coalesce(an.n, 0) + 3 * coalesce(cl.n, 0) as points
    from m
    left join dd on dd.user_id = m.user_id
    left join tk on tk.user_id = m.user_id
    left join ts on ts.user_id = m.user_id
    left join mk on mk.user_id = m.user_id
    left join vd on vd.user_id = m.user_id
    left join tp on tp.user_id = m.user_id
    left join ps on ps.user_id = m.user_id
    left join hv on hv.user_id = m.user_id
    left join rv on rv.user_id = m.user_id
    left join sp on sp.user_id = m.user_id
    left join an on an.user_id = m.user_id
    left join cl on cl.user_id = m.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'slot', slot, 'team', team, 'me', user_id = u, 'points', points,
      'focusMin', focus_min, 'studyDays', study_days, 'kept', kept, 'slept', slept,
      'tasks', tasks, 'tests', tests, 'mocks', mocks, 'videos', videos, 'topicPoints', topic_points,
      'posts', posts, 'votes', votes, 'reviews', reviews, 'drills', drills,
      'analyses', analyses, 'cleared', cleared,
      'streak', private.streak(user_id))
    order by points desc, focus_min desc, lower(name)), '[]')
  from r
$$;

-- Scores board: best full mock, goals, then first-attempt marks on each site test.
create or replace function public.cat_scores() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  result jsonb;
begin
  select coalesce(jsonb_agg(row_json order by best_total desc nulls last, lower(name)), '[]') into result
  from (
    select m.name, (bm ->> 'total')::int best_total,
      jsonb_build_object(
        'name', m.name, 'slot', m.slot, 'team', m.team, 'me', m.user_id = u,
        'goalScore', m.goal_score, 'goalPct', m.goal_pct,
        'bestMock', bm,
        'mocks', (select count(*) from private.mocks k where k.user_id = m.user_id),
        'trend', coalesce((select jsonb_agg(jsonb_build_object('takenOn', taken_on, 'total', varc + dilr + qa,
            'varc', varc, 'dilr', dilr, 'qa', qa) order by taken_on, id)
          from private.mocks k where k.user_id = m.user_id), '[]'),
        'tests', coalesce((
          select jsonb_object_agg(test_id, (totals ->> 'marks')::int) from (
            select distinct on (test_id) test_id, totals from private.attempts a
            where a.user_id = m.user_id and a.test_id not like 'mix-%' and a.test_id not like 'retest-%'
            order by test_id, submitted_at, id) f), '{}')) row_json
    from private.members m
    left join lateral (
      select jsonb_build_object('total', varc + dilr + qa, 'varc', varc, 'dilr', dilr, 'qa', qa,
        'takenOn', taken_on, 'source', source) bm
      from private.mocks k where k.user_id = m.user_id
      order by varc + dilr + qa desc, taken_on desc limit 1) b on true
  ) s;
  return jsonb_build_object('rows', result);
end $$;

-- ---------------------------------------------------------------- group chat

create or replace function public.cat_chat(p_after bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'me', me, 'text', case when hidden then '' else body end, 'at', created_at,
    'likes', likes, 'liked', liked, 'paperId', paper_id, 'hidden', hidden) order by id), '[]')
  from (
    select c.id, m.name, c.user_id = private.member() me, c.body, c.created_at, c.paper_id,
      -- Spoiler guard: a message about a calendar paper stays hidden until you've logged that paper.
      c.paper_id is not null and c.user_id <> private.member()
        and not private.logged_paper(private.member(), c.paper_id) hidden,
      (select count(*) from private.chat_likes l where l.message_id = c.id) likes,
      exists (select 1 from private.chat_likes l where l.message_id = c.id and l.user_id = private.member()) liked
    from private.chat c join private.members m on m.user_id = c.user_id
    where c.id > coalesce(p_after, 0)
    order by c.id desc limit 150) x
$$;

drop function if exists public.cat_chat_send(text);
create or replace function public.cat_chat_send(p_text text, p_paper_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 1000, 'The message');
begin
  if (select count(*) from private.chat where user_id = u and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Slow down a little: 15 messages a minute at most.';
  end if;
  if p_paper_id is not null and p_paper_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Unknown paper.';
  end if;
  insert into private.chat (user_id, body, paper_id) values (u, t, nullif(p_paper_id, ''));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cat_chat_delete(p_message_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  delete from private.chat where id = p_message_id and user_id = u;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- approaches on test questions
-- A question's thread opens only for people who have submitted that test,
-- so nobody reads an approach before trying the question.

create or replace function private.require_done(u uuid, p_test text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.first_attempt(u, p_test) is null then
    raise exception 'Submit this test first. Its discussions open after that.';
  end if;
end $$;

create or replace function private.require_question(p_test text, p_question text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.tests t, jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'questions') q
    where t.test_id = p_test and q ->> 'id' = p_question) then
    raise exception 'That question is not in this test.';
  end if;
end $$;

-- For the results page: per question, how many in the group did the test,
-- how many got it right first time, and how many approaches are posted.
create or replace function public.cat_thread_summary(p_test_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  result jsonb;
begin
  if private.first_attempt(u, p_test_id) is null then
    return jsonb_build_object('open', false);
  end if;
  with firsts as (
    select distinct on (user_id) user_id, questions from private.attempts
    where test_id = p_test_id order by user_id, submitted_at, id
  ), qr as (
    select q ->> 'id' qid, count(*) done_n, count(*) filter (where q ->> 'result' = 'correct') right_n,
      -- median time of those who answered it
      percentile_cont(0.5) within group (order by (q ->> 'timeSpentSec')::numeric)
        filter (where q ->> 'result' <> 'skipped') med
    from firsts, jsonb_array_elements(firsts.questions) q group by 1
  ), pc as (
    select question_id qid, count(*) n from private.posts where test_id = p_test_id group by 1
  )
  select coalesce(jsonb_object_agg(qr.qid, jsonb_build_object(
    'done', qr.done_n, 'right', qr.right_n, 'posts', coalesce(pc.n, 0),
    'medianSec', round(qr.med::numeric))), '{}')
  into result
  from qr left join pc on pc.qid = qr.qid;
  return jsonb_build_object('open', true, 'questions', result);
end $$;

create or replace function public.cat_thread(p_test_id text, p_question_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  result jsonb;
begin
  perform private.require_done(u, p_test_id);
  perform private.require_question(p_test_id, p_question_id);
  select jsonb_build_object(
    'mine', private.first_result(u, p_test_id, p_question_id),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', m.name, 'me', p.user_id = u, 'text', p.body, 'at', p.created_at,
        'result', private.first_result(p.user_id, p_test_id, p_question_id),
        'votes', (select count(*) from private.post_votes v where v.post_id = p.id),
        'voted', exists (select 1 from private.post_votes v where v.post_id = p.id and v.user_id = u))
        order by (select count(*) from private.post_votes v where v.post_id = p.id) desc, p.id)
      from private.posts p join private.members m on m.user_id = p.user_id
      where p.test_id = p_test_id and p.question_id = p_question_id), '[]'),
    'bookmark', (select jsonb_build_object('note', note) from private.bookmarks b
      where b.user_id = u and b.test_id = p_test_id and b.question_id = p_question_id),
    'done', (select count(distinct user_id) from private.attempts where test_id = p_test_id),
    'right', (select count(*) from private.members m
      where private.first_result(m.user_id, p_test_id, p_question_id) = 'correct'))
  into result;
  return result;
end $$;

create or replace function public.cat_thread_post(p_test_id text, p_question_id text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 1500, 'The approach');
begin
  perform private.require_done(u, p_test_id);
  perform private.require_question(p_test_id, p_question_id);
  if (select count(*) from private.posts where user_id = u and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Slow down a little: 10 posts a minute at most.';
  end if;
  insert into private.posts (user_id, test_id, question_id, body) values (u, p_test_id, p_question_id, t);
  return public.cat_thread(p_test_id, p_question_id);
end $$;

create or replace function public.cat_post_delete(p_post_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  delete from private.posts where id = p_post_id and user_id = u;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- goals, settings, daily promise, sleep

drop function if exists public.cat_set_goal(int, numeric);
-- p_sec: sectional targets in marks, {varc, dilr, qa}.
create or replace function public.cat_set_goal(p_score int, p_pct numeric, p_sec jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  s jsonb := '{}';
begin
  if p_score is not null and p_score not between -68 and 204 then
    raise exception 'A CAT score runs from -68 to 204.';
  end if;
  if p_pct is not null and p_pct not between 0 and 100 then
    raise exception 'A percentile runs from 0 to 100.';
  end if;
  if jsonb_typeof(p_sec) = 'object' then
    select coalesce(jsonb_object_agg(k, least(greatest((p_sec ->> k)::numeric::int, -24), 72)), '{}') into s
    from unnest(array['varc', 'dilr', 'qa']) k where jsonb_typeof(p_sec -> k) = 'number';
  end if;
  update private.members set goal_score = p_score, goal_pct = round(p_pct, 1), goal_sec = s where user_id = u;
  return public.cat_me();
end $$;

-- Reminder settings follow you from device to device. Unknown keys are dropped.
create or replace function public.cat_settings_set(p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  s jsonb := '{}';
  lim record;
begin
  if jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Settings must be a list of values.';
  end if;
  for lim in select * from (values
    ('breakAfterMin', 20, 120), ('breakLengthMin', 3, 30),
    ('eyeEveryMin', 0, 60), ('textSize', 90, 130)) v(k, lo, hi)
  loop
    if jsonb_typeof(p_settings -> lim.k) = 'number' then
      s := s || jsonb_build_object(lim.k, least(greatest((p_settings ->> lim.k)::numeric::int, lim.lo), lim.hi));
    end if;
  end loop;
  if jsonb_typeof(p_settings -> 'sound') = 'boolean' then
    s := s || jsonb_build_object('sound', p_settings -> 'sound');
  end if;
  for lim in select * from (values ('windDown', 0, 0), ('autoBreak', 0, 0), ('walk', 0, 0), ('caffeine', 0, 0),
    ('lunch', 0, 0), ('examReminders', 0, 0), ('quiet', 0, 0)) v(k, lo, hi)
  loop
    if jsonb_typeof(p_settings -> lim.k) = 'boolean' then
      s := s || jsonb_build_object(lim.k, p_settings -> lim.k);
    end if;
  end loop;
  -- When you'll leave for the centre on 29 Nov, as HH:MM.
  if coalesce(p_settings ->> 'travelAt', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    s := s || jsonb_build_object('travelAt', p_settings ->> 'travelAt');
  end if;
  update private.members set settings = s where user_id = u;
  return public.cat_me();
end $$;

-- Today's promise: how many minutes you'll study. Shown to everyone.
create or replace function public.cat_set_target(p_minutes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_minutes is null or p_minutes not between 30 and 840 then
    raise exception 'Pick a target between 30 minutes and 14 hours.';
  end if;
  insert into private.days (user_id, day, target_min) values (u, private.today(), p_minutes)
  on conflict (user_id, day) do update set target_min = excluded.target_min;
  return public.cat_today();
end $$;

-- Last night's sleep, logged on today's row, with bed and wake times (HH:MM)
-- when given, for the regularity score.
drop function if exists public.cat_sleep(numeric);
create or replace function public.cat_sleep(p_hours numeric, p_bed text, p_wake text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  bed text := case when coalesce(p_bed, '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then p_bed end;
  wake text := case when coalesce(p_wake, '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then p_wake end;
begin
  if p_hours is null or p_hours not between 0 and 14 then
    raise exception 'Log between 0 and 14 hours.';
  end if;
  insert into private.days (user_id, day, sleep_min, bed_time, wake_time)
  values (u, private.today(), round(p_hours * 60)::int, bed, wake)
  on conflict (user_id, day) do update set sleep_min = excluded.sleep_min,
    bed_time = coalesce(excluded.bed_time, private.days.bed_time),
    wake_time = coalesce(excluded.wake_time, private.days.wake_time);
  return public.cat_today();
end $$;

-- The last 7 days of sleep, for the regularity score.
create or replace function public.cat_sleep_week() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'sleepMin', sleep_min, 'bed', bed_time, 'wake', wake_time)
    order by day), '[]')
  from private.days
  where user_id = private.member() and day > private.today() - 7 and sleep_min is not null
$$;

-- Everyone's promise and progress today, with their plan line and ticked blocks.
create or replace function public.cat_promises() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(),
    'targetMin', d.target_min, 'focusMin', coalesce(d.focus_min, 0), 'planText', d.plan_text,
    'ticks', (select count(*) from private.plan_ticks t where t.user_id = m.user_id and t.day = private.today()),
    'planTotal', d.plan_total)
    order by coalesce(d.focus_min, 0) desc, lower(m.name)), '[]')
  from private.members m
  left join private.days d on d.user_id = m.user_id and d.day = private.today()
$$;

-- ---------------------------------------------------------------- studying now, nudges

create or replace function public.cat_presence(p_mode text, p_minutes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_mode not in ('focus', 'break', 'idle') then
    raise exception 'Unknown mode.';
  end if;
  insert into private.presence (user_id, mode, since, until, updated_at)
  values (u, p_mode, now(), now() + make_interval(mins => least(greatest(coalesce(p_minutes, 0), 0), 240)), now())
  on conflict (user_id) do update set
    since = case when private.presence.mode = excluded.mode then private.presence.since else now() end,
    mode = excluded.mode, until = excluded.until, updated_at = now();
  return public.cat_now();
end $$;

-- People in a focus block or on a break, seen in the last 20 minutes.
create or replace function public.cat_now() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(), 'mode', p.mode, 'since', p.since)
    order by p.mode, p.since), '[]')
  from private.presence p join private.members m on m.user_id = p.user_id
  where p.mode in ('focus', 'break') and p.updated_at > now() - interval '20 minutes'
$$;

create or replace function public.cat_nudge(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  target uuid;
  studied int;
begin
  select user_id into target from private.members where lower(name) = lower(btrim(coalesce(p_name, '')));
  if target is null then
    raise exception 'Nobody in the group has that name.';
  end if;
  if target = u then
    raise exception 'You can''t nudge yourself. Start a focus block instead.';
  end if;
  -- Quiet hours protect the 23:00 lights-out.
  if ((now() at time zone 'UTC') + interval '5 hours 30 minutes')::time not between time '06:00' and time '22:30' then
    raise exception 'Quiet hours: no nudges between 22:30 and 06:00.';
  end if;
  if (select count(*) from private.nudges where from_user = u and day = private.today()) >= 3 then
    raise exception 'Three nudges a day is the limit. Save them for whoever needs one most.';
  end if;
  select focus_min into studied from private.days where user_id = target and day = private.today();
  if coalesce(studied, 0) >= 30 then
    raise exception '% has already studied today.', p_name;
  end if;
  insert into private.nudges (from_user, to_user, day) values (u, target, private.today()) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- One call for the header: unread chat, mentions, new approaches, and who's studying.
create or replace function public.cat_pulse(p_chat_after bigint, p_posts_after bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'chatLatest', (select coalesce(max(id), 0) from private.chat),
    'chatNew', (select count(*) from private.chat c
      where c.id > coalesce(p_chat_after, 0) and c.user_id <> private.member()),
    'mentions', (select count(*) from private.chat c
      where c.id > coalesce(p_chat_after, 0) and c.user_id <> private.member()
        and position(lower('@' || (select name from private.members where user_id = private.member())) in lower(c.body)) > 0),
    'postsLatest', (select coalesce(max(id), 0) from private.posts),
    'postsNew', (select count(*) from private.posts p
      where p.id > coalesce(p_posts_after, 0) and p.user_id <> private.member()
        and private.first_attempt(private.member(), p.test_id) is not null),
    'nudges', (select count(*) from private.nudges where to_user = private.member() and day = private.today()),
    'now', public.cat_now())
$$;

-- ---------------------------------------------------------------- review queue

create or replace function public.cat_reviews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'due', coalesce((select jsonb_agg(jsonb_build_object(
        'testId', r.test_id, 'testTitle', t.title, 'questionId', r.question_id,
        'stage', r.stage, 'dueOn', r.due_on) order by r.due_on, r.test_id, r.question_id)
      from private.reviews r join private.tests t on t.test_id = r.test_id
      where r.user_id = private.member() and r.cleared_at is null and r.due_on <= private.today()), '[]'),
    'upcoming', (select count(*) from private.reviews
      where user_id = private.member() and cleared_at is null and due_on > private.today()),
    'cleared', (select count(*) from private.reviews
      where user_id = private.member() and cleared_at is not null))
$$;

create or replace function public.cat_review_answer(p_test_id text, p_question_id text, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  r private.reviews%rowtype;
  k jsonb;
  qtype text;
  ans text := nullif(left(btrim(coalesce(p_answer, '')), 40), '');
  res text;
  revealed boolean;
  next_stage smallint;
  next_due date;
  cleared boolean := false;
begin
  select * into r from private.reviews
  where user_id = u and test_id = p_test_id and question_id = p_question_id for update;
  if not found or r.cleared_at is not null then
    raise exception 'That question is not in your review queue.';
  end if;
  if r.due_on > private.today() then
    raise exception 'Not due yet. It comes back on %.', to_char(r.due_on, 'DD Mon');
  end if;
  if ans is null then
    raise exception 'Type an answer first.';
  end if;
  select t.key -> p_question_id,
    (select q ->> 'type' from jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'questions') q
     where q ->> 'id' = p_question_id)
  into k, qtype
  from private.tests t where t.test_id = p_test_id;
  res := private.grade(qtype, k, ans);
  insert into private.review_log (user_id, test_id, question_id, answer, result) values (u, p_test_id, p_question_id, ans, res);
  if res = 'correct' then
    if r.stage >= 2 then
      cleared := true;
      next_stage := 3;
      next_due := r.due_on;
    else
      next_stage := r.stage + 1;
      next_due := private.today() + case when r.stage = 0 then 3 else 7 end;
    end if;
  else
    next_stage := 0;
    next_due := private.today() + 1;
  end if;
  update private.reviews
  set stage = next_stage, due_on = next_due, cleared_at = case when cleared then now() else null end
  where user_id = u and test_id = p_test_id and question_id = p_question_id;
  select revealed_at is not null into revealed from private.attempts where id = private.first_attempt(u, p_test_id);
  return jsonb_build_object('result', res, 'stage', next_stage, 'dueOn', next_due, 'cleared', cleared,
    'answer', case when coalesce(revealed, false) then coalesce(k -> 'display', k -> 'answer') end,
    'solution', case when coalesce(revealed, false) then k ->> 'solution' end);
end $$;

-- ---------------------------------------------------------------- Daily 5 ranking

create or replace function public.cat_daily(p_test_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(),
    'marks', (a.totals ->> 'marks')::int, 'correct', (a.totals ->> 'correct')::int,
    'wrong', (a.totals ->> 'wrong')::int,
    'timeSec', (select coalesce(sum((s ->> 'timeUsedSec')::int), 0) from jsonb_array_elements(a.sections) s))
    order by (a.totals ->> 'marks')::int desc,
      (select coalesce(sum((s ->> 'timeUsedSec')::int), 0) from jsonb_array_elements(a.sections) s)), '[]')
  from private.members m
  join private.attempts a on a.id = private.first_attempt(m.user_id, p_test_id)
  where p_test_id like 'daily-%' and private.member() is not null
$$;

-- ---------------------------------------------------------------- speed drills

create or replace function public.cat_speed_board(p_kind text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(),
    'today', (select best from private.speed s where s.user_id = m.user_id and s.kind = p_kind and s.day = private.today()),
    'best', (select max(best) from private.speed s where s.user_id = m.user_id and s.kind = p_kind))
    order by (select max(best) from private.speed s where s.user_id = m.user_id and s.kind = p_kind) desc nulls last,
      lower(m.name)), '[]')
  from private.members m
$$;

create or replace function public.cat_speed_save(p_kind text, p_score int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_kind not in ('fractions', 'squares', 'tables', 'percent', 'mixed', 'calculator') then
    raise exception 'Unknown drill.';
  end if;
  if p_score is null or p_score not between 0 and 120 then
    raise exception 'That score is out of range.';
  end if;
  insert into private.speed (user_id, kind, day, best) values (u, p_kind, private.today(), p_score)
  on conflict (user_id, kind, day) do update
    set best = greatest(private.speed.best, excluded.best), rounds = least(private.speed.rounds + 1, 50);
  return public.cat_speed_board(p_kind);
end $$;

-- ---------------------------------------------------------------- study rooms

create or replace function public.cat_rooms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'title', r.title, 'startsAt', r.starts_at, 'minutes', r.minutes,
    'host', h.name, 'mine', r.host = private.member(),
    'joined', exists (select 1 from private.room_members x where x.room_id = r.id and x.user_id = private.member()),
    'people', (select coalesce(jsonb_agg(m.name order by lower(m.name)), '[]')
      from private.room_members x join private.members m on m.user_id = x.user_id where x.room_id = r.id))
    order by r.starts_at), '[]')
  from private.rooms r join private.members h on h.user_id = r.host
  where r.starts_at + make_interval(mins => r.minutes) > now()
$$;

create or replace function public.cat_room_create(p_title text, p_starts_at timestamptz, p_minutes int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_title, 60, 'The room name');
  new_id bigint;
begin
  if p_starts_at is null or p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '2 days' then
    raise exception 'Pick a start time between now and two days ahead.';
  end if;
  if p_minutes is null or p_minutes not between 25 and 240 then
    raise exception 'A room runs for 25 minutes to 4 hours.';
  end if;
  if (select count(*) from private.rooms where host = u and starts_at + make_interval(mins => minutes) > now()) >= 3 then
    raise exception 'You already host three upcoming rooms.';
  end if;
  insert into private.rooms (host, title, starts_at, minutes) values (u, t, p_starts_at, p_minutes) returning id into new_id;
  insert into private.room_members (room_id, user_id) values (new_id, u);
  return public.cat_rooms();
end $$;

create or replace function public.cat_room_join(p_room_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if not exists (select 1 from private.rooms where id = p_room_id) then
    raise exception 'That room has closed.';
  end if;
  if p_on then
    insert into private.room_members (room_id, user_id) values (p_room_id, u) on conflict do nothing;
  else
    delete from private.room_members where room_id = p_room_id and user_id = u;
  end if;
  return public.cat_rooms();
end $$;

create or replace function public.cat_room_delete(p_room_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  delete from private.rooms where id = p_room_id and host = u;
  return public.cat_rooms();
end $$;

-- ---------------------------------------------------------------- votes, likes, bookmarks

create or replace function public.cat_post_vote(p_post_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  p private.posts%rowtype;
begin
  select * into p from private.posts where id = p_post_id;
  if not found then
    raise exception 'That approach was deleted.';
  end if;
  if p.user_id = u then
    raise exception 'You can''t vote for your own approach.';
  end if;
  perform private.require_done(u, p.test_id);
  if p_on then
    insert into private.post_votes (post_id, user_id) values (p_post_id, u) on conflict do nothing;
  else
    delete from private.post_votes where post_id = p_post_id and user_id = u;
  end if;
  return public.cat_thread(p.test_id, p.question_id);
end $$;

create or replace function public.cat_chat_like(p_message_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if not exists (select 1 from private.chat where id = p_message_id) then
    raise exception 'That message was deleted.';
  end if;
  if p_on then
    insert into private.chat_likes (message_id, user_id) values (p_message_id, u) on conflict do nothing;
  else
    delete from private.chat_likes where message_id = p_message_id and user_id = u;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cat_bookmarks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'testId', b.test_id, 'testTitle', t.title, 'questionId', b.question_id, 'note', b.note, 'at', b.created_at)
    order by b.created_at desc), '[]')
  from private.bookmarks b join private.tests t on t.test_id = b.test_id
  where b.user_id = private.member()
$$;

create or replace function public.cat_bookmark_set(p_test_id text, p_question_id text, p_on boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  perform private.require_done(u, p_test_id);
  perform private.require_question(p_test_id, p_question_id);
  if p_on then
    insert into private.bookmarks (user_id, test_id, question_id, note)
    values (u, p_test_id, p_question_id, left(btrim(coalesce(p_note, '')), 500))
    on conflict (user_id, test_id, question_id) do update set note = excluded.note;
  else
    delete from private.bookmarks where user_id = u and test_id = p_test_id and question_id = p_question_id;
  end if;
  return public.cat_bookmarks();
end $$;

-- ---------------------------------------------------------------- badges and heatmap

create or replace function private.longest_streak(u uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  d date := date '2026-11-01';
  n int := 0;
  best int := 0;
  s int;
begin
  while d <= private.today() loop
    s := private.streak_day(u, d);
    n := case when s < 0 then 0 else n + s end;
    best := greatest(best, n);
    d := d + 1;
  end loop;
  return best;
end $$;

create or replace function private.badges_of(u uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(code), '[]') from (
    select 'first-test' code where exists (select 1 from private.attempts where user_id = u)
    union all select 'first-mock' where exists (select 1 from private.mocks where user_id = u)
    union all select 'slot-mock' where exists (select 1 from private.mocks where user_id = u and at_slot_time)
    union all select 'promise-kept' where exists (select 1 from private.days
      where user_id = u and target_min >= 120 and focus_min >= target_min)
    union all select 'streak-3' where private.longest_streak(u) >= 3
    union all select 'streak-7' where private.longest_streak(u) >= 7
    union all select 'hours-10' where (select coalesce(sum(focus_min), 0) from private.days where user_id = u) >= 600
    union all select 'hours-50' where (select coalesce(sum(focus_min), 0) from private.days where user_id = u) >= 3000
    union all select 'helper' where (select count(*) from private.posts where user_id = u and char_length(body) >= 40) >= 5
    union all select 'helpful' where exists (select 1 from private.post_votes v join private.posts p on p.id = v.post_id where p.user_id = u)
    union all select 'topics-5' where (select count(*) from private.topic_events where user_id = u and level = 2) >= 5
    union all select 'reviewer' where (select count(*) from private.reviews where user_id = u and cleared_at is not null) >= 10
    union all select 'plan-day' where exists (select 1 from private.days d
      where d.user_id = u and d.plan_total > 0
        and (select count(*) from private.plan_ticks t where t.user_id = u and t.day = d.day) >= d.plan_total)
  ) b
$$;

create or replace function public.cat_badges() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(), 'badges', private.badges_of(m.user_id))
    order by lower(m.name)), '[]')
  from private.members m
$$;

create or replace function public.cat_heatmap() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(),
    'days', coalesce((select jsonb_object_agg(d.day, d.focus_min) from private.days d
      where d.user_id = m.user_id and d.day >= date '2026-11-01'), '{}'))
    order by lower(m.name)), '[]')
  from private.members m
$$;

-- ---------------------------------------------------------------- admin (whoever joined first)

create or replace function private.admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if not exists (select 1 from private.members where user_id = u and is_admin) then
    raise exception 'Only the group admin can do that.';
  end if;
  return u;
end $$;

create or replace function public.cat_admin_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.admin();
begin
  return jsonb_build_object(
    'code', (select value from private.config where key = 'join_code'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'slot', slot, 'team', team, 'isAdmin', is_admin, 'joinedAt', joined_at, 'me', user_id = u,
      'hasPin', pin_hash is not null)
      order by joined_at), '[]') from private.members));
end $$;

create or replace function public.cat_admin_set_code(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  if coalesce(p_code, '') !~ '^[A-Za-z0-9-]{4,30}$' then
    raise exception 'Use 4 to 30 letters, numbers or dashes.';
  end if;
  insert into private.config (key, value) values ('join_code', p_code)
  on conflict (key) do update set value = excluded.value;
  return public.cat_admin_members();
end $$;

create or replace function public.cat_admin_set_team(p_name text, p_team text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  if p_team is not null and p_team not in ('A', 'B') then
    raise exception 'Teams are A or B.';
  end if;
  update private.members set team = p_team where lower(name) = lower(btrim(coalesce(p_name, '')));
  if not found then
    raise exception 'Nobody in the group has that name.';
  end if;
  return public.cat_admin_members();
end $$;

create or replace function public.cat_admin_reset_pin(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  perform private.check_pin(p_pin);
  update private.members set pin_hash = private.hash_pin(user_id, p_pin)
  where lower(name) = lower(btrim(coalesce(p_name, '')));
  if not found then
    raise exception 'Nobody in the group has that name.';
  end if;
  return public.cat_admin_members();
end $$;

create or replace function public.cat_admin_remove(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.admin();
begin
  delete from private.members where lower(name) = lower(btrim(coalesce(p_name, ''))) and user_id <> u;
  if not found then
    raise exception 'Nobody else in the group has that name.';
  end if;
  return public.cat_admin_members();
end $$;

-- ---------------------------------------------------------------- Today's plan, check-in, breaks

-- Tick or untick a block of today's plan. p_total is how many blocks today's
-- plan has, for the full-plan-day badge.
create or replace function public.cat_plan_tick(p_block text, p_done boolean, p_total int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if coalesce(p_block, '') !~ '^[a-z0-9-]{1,30}$' then
    raise exception 'Unknown block.';
  end if;
  if p_done then
    insert into private.plan_ticks (user_id, day, block_id) values (u, private.today(), p_block) on conflict do nothing;
  else
    delete from private.plan_ticks where user_id = u and day = private.today() and block_id = p_block;
  end if;
  if p_total between 1 and 30 then
    insert into private.days (user_id, day, plan_total) values (u, private.today(), p_total)
    on conflict (user_id, day) do update set plan_total = excluded.plan_total;
  end if;
  return public.cat_today();
end $$;

-- One line on what you'll do today, shown to the group with your promise.
create or replace function public.cat_set_plan_text(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := nullif(left(btrim(coalesce(p_text, '')), 160), '');
begin
  insert into private.days (user_id, day, plan_text) values (u, private.today(), t)
  on conflict (user_id, day) do update set plan_text = excluded.plan_text;
  return public.cat_today();
end $$;

-- When each batch of focus minutes arrived today, for planned against actual.
create or replace function public.cat_focus_log() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', at, 'minutes', minutes) order by at), '[]')
  from private.focus_log
  where user_id = private.member() and private.ist_day(at) = private.today()
$$;

create or replace function public.cat_checkin(p_hours numeric, p_best text, p_worst text, p_fix text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_hours is not null and p_hours not between 0 and 16 then
    raise exception 'Hours run from 0 to 16.';
  end if;
  insert into private.checkins (user_id, day, hours, best, worst, fix)
  values (u, private.today(), round(p_hours, 1), left(btrim(coalesce(p_best, '')), 200),
    left(btrim(coalesce(p_worst, '')), 200), left(btrim(coalesce(p_fix, '')), 200))
  on conflict (user_id, day) do update set hours = excluded.hours, best = excluded.best,
    worst = excluded.worst, fix = excluded.fix, at = now();
  return public.cat_today();
end $$;

-- Every check-in you've written, newest first.
create or replace function public.cat_checkins() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'hours', hours, 'best', best, 'worst', worst, 'fix', fix)
    order by day desc), '[]')
  from private.checkins where user_id = private.member()
$$;

-- A fixed break taken or skipped.
create or replace function public.cat_break_log(p_skipped boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  insert into private.days (user_id, day, breaks_taken, breaks_skipped)
  values (u, private.today(), case when p_skipped then 0 else 1 end, case when p_skipped then 1 else 0 end)
  on conflict (user_id, day) do update set
    breaks_taken = least(private.days.breaks_taken + excluded.breaks_taken, 99),
    breaks_skipped = least(private.days.breaks_skipped + excluded.breaks_skipped, 99);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- profile extras

create or replace function public.cat_set_rules(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update private.members set rules = left(btrim(coalesce(p_text, '')), 1200) where user_id = private.member();
  return public.cat_me();
end $$;

create or replace function public.cat_set_iims(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update private.members set iims = left(btrim(coalesce(p_text, '')), 200) where user_id = private.member();
  return public.cat_me();
end $$;

-- Your accountability buddy: you see their plan ticks. p_name null clears it.
create or replace function public.cat_set_buddy(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  b uuid;
begin
  if nullif(btrim(coalesce(p_name, '')), '') is not null then
    select user_id into b from private.members where lower(name) = lower(btrim(p_name));
    if b is null then
      raise exception 'Nobody in the group has that name.';
    end if;
    if b = u then
      raise exception 'Pick someone else as your buddy.';
    end if;
  end if;
  update private.members set buddy = b where user_id = u;
  return public.cat_me();
end $$;

create or replace function public.cat_buddy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', b.name,
    'ticks', coalesce((select jsonb_agg(block_id) from private.plan_ticks t
      where t.user_id = b.user_id and t.day = private.today()), '[]'),
    'focusMin', coalesce((select focus_min from private.days d where d.user_id = b.user_id and d.day = private.today()), 0),
    'nudged', exists (select 1 from private.nudges n where n.from_user = me.user_id and n.to_user = b.user_id
      and n.day = private.today()))
  from private.members me join private.members b on b.user_id = me.buddy
  where me.user_id = private.member()
$$;

-- Everyone's target IIMs and section targets, for the group page.
create or replace function public.cat_profiles() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'me', user_id = private.member(), 'slot', slot,
    'iims', iims, 'goalScore', goal_score, 'goalPct', goal_pct, 'goalSec', goal_sec) order by lower(name)), '[]')
  from private.members
$$;

-- ---------------------------------------------------------------- notice and week goal (admin)

create or replace function public.cat_admin_notice(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  insert into private.config (key, value) values ('notice', left(btrim(coalesce(p_text, '')), 600))
  on conflict (key) do update set value = excluded.value;
  insert into private.config (key, value) values ('notice_at', now()::text)
  on conflict (key) do update set value = excluded.value;
  return public.cat_today();
end $$;

create or replace function public.cat_week_goal() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'goalHours', (select value::int from private.config where key = 'week_goal_hours'),
    'doneMin', (select coalesce(sum(focus_min), 0) from private.days
      where day between private.week_start(private.today()) and private.today()),
    'members', (select count(*) from private.members),
    'from', private.week_start(private.today()))
  where private.member() is not null
$$;

create or replace function public.cat_admin_week_goal(p_hours int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  if p_hours is null then
    delete from private.config where key = 'week_goal_hours';
  elsif p_hours not between 1 and 2000 then
    raise exception 'Pick between 1 and 2000 hours.';
  else
    insert into private.config (key, value) values ('week_goal_hours', p_hours::text)
    on conflict (key) do update set value = excluded.value;
  end if;
  return public.cat_week_goal();
end $$;

-- ---------------------------------------------------------------- mixed sets and Sunday retests
-- Each is a test made for one person, from questions already on the site.
-- Question ids are "<source test>~<question id>" so the page can show the
-- original text, and answers are copied from the source keys.

create or replace function private.composed_json(p_test text, u uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.test_id, 'title', t.title, 'kind', t.kind,
    'minutes', (t.sections -> 0 ->> 'minutes')::int,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q ->> 'id', 'type', q ->> 'type',
        'src', split_part(q ->> 'id', '~', 1), 'qid', split_part(q ->> 'id', '~', 2), 'topic', q ->> 'topic')
        order by i), '[]')
      from jsonb_array_elements(t.sections -> 0 -> 'questions') with ordinality e(q, i)),
    'attemptId', (select id from private.attempts a where a.test_id = t.test_id and a.user_id = u
      order by submitted_at limit 1))
  from private.tests t where t.test_id = p_test and t.owner = u
$$;

create or replace function public.cat_composed(p_test_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := private.composed_json(p_test_id, private.member());
begin
  if r is null then
    raise exception 'That set was not made for you.';
  end if;
  return r;
end $$;

-- p_kind 'mixed': up to 10 questions from the practice sets of topics you
-- started 3 to 5 days ago, ones you haven't got right first. 'retest' (Sundays):
-- up to 20 questions you got wrong or left blank this week. One of each a day.
create or replace function public.cat_compose(p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  tag text := left(replace(u::text, '-', ''), 8) || '-' || to_char(private.today(), 'YYYYMMDD');
  tid text;
  topics text[];
  qs jsonb;
  k jsonb;
  n int;
  title text;
begin
  if p_kind = 'mixed' then
    tid := 'mix-' || tag;
  elsif p_kind = 'retest' then
    tid := 'retest-' || tag;
  else
    raise exception 'Unknown kind of set.';
  end if;
  if exists (select 1 from private.tests where test_id = tid) then
    return private.composed_json(tid, u);
  end if;

  if p_kind = 'mixed' then
    select array_agg(topic_id) into topics from private.topic_starts
    where user_id = u and private.ist_day(at) between private.today() - 5 and private.today() - 3;
    if topics is null then
      select array_agg(topic_id) into topics from private.topic_starts
      where user_id = u and private.ist_day(at) <= private.today() - 3;
    end if;
    if topics is null then
      raise exception 'Mixed sets start 3 days after you first move a topic past Not started on the Topics page.';
    end if;
    with cand as (
      select qi.test_id, qi.qid, qi.topic, s.q
      from private.qinfo() qi
      join private.tests t on t.test_id = qi.test_id,
      lateral (select q from jsonb_array_elements(t.sections) sec, jsonb_array_elements(sec -> 'questions') q
               where q ->> 'id' = qi.qid limit 1) s
      where qi.kind = 'practice' and qi.owner is null and qi.topic = any(topics) and s.q ->> 'group' is null
    ), seen as (
      select a.test_id, q ->> 'id' qid, bool_or(q ->> 'result' = 'correct') ok
      from private.attempts a, jsonb_array_elements(a.questions) q where a.user_id = u group by 1, 2
    ), ranked as (
      select cand.*, row_number() over (partition by cand.topic order by coalesce(seen.ok, false), random()) rn
      from cand left join seen on seen.test_id = cand.test_id and seen.qid = cand.qid
    ), picked as (
      select * from ranked
      where rn <= greatest(2, ceil(10.0 / cardinality(topics)))
      order by random() limit 10
    )
    select jsonb_agg(jsonb_build_object('id', test_id || '~' || qid, 'type', q ->> 'type', 'topic', topic)),
      jsonb_object_agg(test_id || '~' || qid, (select key -> qid from private.tests x where x.test_id = picked.test_id))
    into qs, k from picked;
    title := 'Mixed set, ' || to_char(private.today(), 'Dy DD Mon');
  else
    if extract(isodow from private.today()) <> 7 then
      raise exception 'The retest opens on Sundays.';
    end if;
    with wrong as (
      -- first attempts this week at shared tests
      select a.test_id, q ->> 'id' qid, a.submitted_at
      from private.attempts a
      join private.tests t on t.test_id = a.test_id
      cross join lateral jsonb_array_elements(a.questions) q
      where a.user_id = u and t.owner is null
        and a.id = private.first_attempt(u, a.test_id)
        and private.ist_day(a.submitted_at) >= private.week_start(private.today())
        and q ->> 'result' <> 'correct'
      union
      -- and anything missed in this week's mixed sets
      select split_part(q ->> 'id', '~', 1), split_part(q ->> 'id', '~', 2), a.submitted_at
      from private.attempts a, jsonb_array_elements(a.questions) q
      where a.user_id = u and a.test_id like 'mix-%'
        and private.ist_day(a.submitted_at) >= private.week_start(private.today())
        and q ->> 'result' <> 'correct'
    ), picked as (
      select distinct on (w.test_id, w.qid) w.test_id, w.qid, qi.topic, qi.kind, w.submitted_at
      from wrong w join private.qinfo() qi on qi.test_id = w.test_id and qi.qid = w.qid
      order by w.test_id, w.qid
    ), lim as (
      select * from picked order by random() limit 20
    )
    select jsonb_agg(jsonb_build_object('id', lim.test_id || '~' || lim.qid,
        'type', (select q ->> 'type' from private.tests t, jsonb_array_elements(t.sections) s, jsonb_array_elements(s -> 'questions') q
                 where t.test_id = lim.test_id and q ->> 'id' = lim.qid limit 1),
        'topic', lim.topic)),
      jsonb_object_agg(lim.test_id || '~' || lim.qid, (select key -> lim.qid from private.tests x where x.test_id = lim.test_id))
    into qs, k from lim;
    title := 'Sunday retest, ' || to_char(private.today(), 'DD Mon');
  end if;
  n := coalesce(jsonb_array_length(qs), 0);
  if n = 0 then
    raise exception '%', case when p_kind = 'mixed'
      then 'No questions to mix yet. The practice sets for your started topics come first.'
      else 'Nothing to retest: you got every question right this week.' end;
  end if;
  insert into private.tests (test_id, title, sections, key, kind, topic, owner)
  values (tid, title, jsonb_build_array(jsonb_build_object('name', case when p_kind = 'mixed' then 'Mixed QA' else 'Retest' end,
    'minutes', n * 2, 'questions', qs)), k, 'mixed', null, u);
  return private.composed_json(tid, u);
end $$;

-- ---------------------------------------------------------------- readiness, error log, hints

create or replace function public.cat_readiness() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(topic, jsonb_build_object('solved', solved, 'total', total, 'sets', sets)), '{}')
  from private.topic_results(private.member())
$$;

-- Everyone's results on each topic, for the topic board and ask-the-best.
create or replace function public.cat_topic_board() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'me', m.user_id = private.member(),
    'topics', coalesce((select jsonb_object_agg(r.topic, jsonb_build_object('solved', r.solved, 'total', r.total))
      from private.topic_results(m.user_id) r), '{}')) order by lower(m.name)), '[]')
  from private.members m
  where private.member() is not null
$$;

-- How many times you've got each question type right, anywhere on the site.
create or replace function public.cat_qtype_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  with res as (
    select a.test_id, q ->> 'id' qid from private.attempts a, jsonb_array_elements(a.questions) q
    where a.user_id = private.member() and q ->> 'result' = 'correct'
    union all
    select test_id, question_id from private.review_log where user_id = private.member() and result = 'correct'
  )
  select coalesce(jsonb_object_agg(qtype, n), '{}') from (
    select qi.qtype, count(*) n from res join private.qinfo() qi on qi.test_id = res.test_id and qi.qid = res.qid
    where qi.qtype is not null group by 1) x
$$;

-- The method for a question, once you've submitted its test or it's in your review queue.
create or replace function public.cat_hint(p_test_id text, p_question_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if private.first_attempt(u, p_test_id) is null
    and not exists (select 1 from private.reviews where user_id = u and test_id = p_test_id and question_id = p_question_id) then
    raise exception 'Submit this test first. Hints open after that.';
  end if;
  return jsonb_build_object('hint', (select key -> p_question_id ->> 'hint' from private.tests where test_id = p_test_id));
end $$;

create or replace function public.cat_explain(p_test_id text, p_question_id text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 300, 'The explanation');
begin
  if private.first_attempt(u, p_test_id) is null
    and not exists (select 1 from private.reviews where user_id = u and test_id = p_test_id and question_id = p_question_id) then
    raise exception 'Submit this test first.';
  end if;
  insert into private.explanations (user_id, test_id, question_id, body) values (u, p_test_id, p_question_id, t)
  on conflict (user_id, test_id, question_id) do update set body = excluded.body, at = now();
  return public.cat_explanations(p_test_id);
end $$;

create or replace function public.cat_explanations(p_test_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(question_id, body), '{}') from private.explanations
  where user_id = private.member() and test_id = p_test_id
$$;

-- Tag a lost question with one of the seven causes. p_cause null removes the tag.
create or replace function public.cat_cause_set(p_test_id text, p_question_id text, p_cause text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  perform private.require_done(u, p_test_id);
  perform private.require_question(p_test_id, p_question_id);
  if p_cause is null or p_cause = '' then
    delete from private.question_causes where user_id = u and test_id = p_test_id and question_id = p_question_id;
  else
    if p_cause not in ('c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7') then
      raise exception 'Unknown cause.';
    end if;
    insert into private.question_causes (user_id, test_id, question_id, cause) values (u, p_test_id, p_question_id, p_cause)
    on conflict (user_id, test_id, question_id) do update set cause = excluded.cause, at = now();
  end if;
  return public.cat_causes(p_test_id);
end $$;

create or replace function public.cat_causes(p_test_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(question_id, cause), '{}') from private.question_causes
  where user_id = private.member() and test_id = p_test_id
$$;

-- Every question you got wrong or left blank: first attempts at shared tests and every mixed set.
create or replace function public.cat_errors() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'testId', a.test_id, 'testTitle', t.title, 'attemptId', a.id, 'questionId', q ->> 'id',
    'number', (q ->> 'number')::int, 'result', q ->> 'result', 'topic', coalesce(q ->> 'topic', t.topic),
    'cause', c.cause, 'at', a.submitted_at, 'conf', q ->> 'conf',
    'cleared', r.cleared_at is not null, 'inQueue', r.user_id is not null and r.cleared_at is null)
    order by a.submitted_at desc, (q ->> 'number')::int), '[]')
  from private.attempts a
  join private.tests t on t.test_id = a.test_id
  cross join lateral jsonb_array_elements(a.questions) q
  left join private.question_causes c on c.user_id = a.user_id and c.test_id = a.test_id and c.question_id = q ->> 'id'
  left join private.reviews r on r.user_id = a.user_id
    and r.test_id = case when t.owner is null then a.test_id else split_part(q ->> 'id', '~', 1) end
    and r.question_id = case when t.owner is null then q ->> 'id' else split_part(q ->> 'id', '~', 2) end
  where a.user_id = private.member() and q ->> 'result' <> 'correct'
    and (t.owner is not null or a.id = private.first_attempt(a.user_id, a.test_id))
$$;

-- How often each confidence tag was right, over all your attempts.
create or replace function public.cat_confidence() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(conf, jsonb_build_object('right', ok, 'answered', n)), '{}') from (
    select q ->> 'conf' conf, count(*) filter (where q ->> 'result' = 'correct') ok, count(*) n
    from private.attempts a, jsonb_array_elements(a.questions) q
    where a.user_id = private.member() and q ->> 'conf' is not null and q ->> 'result' <> 'skipped'
    group by 1) x
$$;

-- Questions you skipped that most of the group solved, with a median right-answer time under 2 minutes.
create or replace function public.cat_missed_easy() returns jsonb
language sql stable security definer set search_path = '' as $$
  with firsts as (
    select distinct on (user_id, test_id) id, user_id, test_id, questions from private.attempts
    where test_id not like 'mix-%' and test_id not like 'retest-%'
    order by user_id, test_id, submitted_at, id
  ), q as (
    select f.id aid, f.user_id, f.test_id, x ->> 'id' qid, (x ->> 'number')::int num, x ->> 'result' result,
      (x ->> 'timeSpentSec')::numeric sec
    from firsts f, jsonb_array_elements(f.questions) x
  ), grp as (
    select test_id, qid, count(*) n, count(*) filter (where result = 'correct') ok,
      percentile_cont(0.5) within group (order by sec) filter (where result = 'correct') med
    from q where user_id <> private.member() group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object('testId', q.test_id, 'testTitle', t.title, 'attemptId', q.aid,
    'questionId', q.qid, 'number', q.num, 'groupRight', grp.ok, 'groupDone', grp.n, 'medianSec', round(grp.med::numeric))
    order by q.test_id, q.num), '[]')
  from q join grp on grp.test_id = q.test_id and grp.qid = q.qid
  join private.tests t on t.test_id = q.test_id
  where q.user_id = private.member() and q.result = 'skipped'
    and grp.n >= 2 and grp.ok * 2 > grp.n and grp.med < 120
$$;

-- ---------------------------------------------------------------- formula cards from memory

create or replace function public.cat_recall() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(card_id, jsonb_build_object('stage', stage, 'dueOn', due_on,
    'hits', hits, 'misses', misses, 'cleared', cleared_at is not null)), '{}')
  from private.recall where user_id = private.member()
$$;

-- Mark a card after writing it from memory. A miss brings it back tomorrow;
-- a hit after 1, 3 and 7 days clears it.
create or replace function public.cat_recall_mark(p_card text, p_ok boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  r private.recall%rowtype;
begin
  if coalesce(p_card, '') !~ '^[a-z0-9-]{2,40}#[0-9]{1,2}$' then
    raise exception 'Unknown card.';
  end if;
  select * into r from private.recall where user_id = u and card_id = p_card;
  if not found then
    r.stage := 0;
    r.hits := 0;
    r.misses := 0;
  end if;
  if p_ok then
    insert into private.recall (user_id, card_id, stage, due_on, hits, misses, cleared_at)
    values (u, p_card, least(r.stage + 1, 3),
      private.today() + case r.stage when 0 then 1 when 1 then 3 else 7 end, r.hits + 1, r.misses,
      case when r.stage >= 2 then now() end)
    on conflict (user_id, card_id) do update set stage = excluded.stage, due_on = excluded.due_on,
      hits = excluded.hits, cleared_at = excluded.cleared_at;
  else
    insert into private.recall (user_id, card_id, stage, due_on, hits, misses)
    values (u, p_card, 0, private.today() + 1, r.hits, r.misses + 1)
    on conflict (user_id, card_id) do update set stage = 0, due_on = excluded.due_on,
      misses = excluded.misses, cleared_at = null;
  end if;
  return public.cat_recall();
end $$;

-- ---------------------------------------------------------------- calendar, paper room, debriefs

create or replace function public.cat_calendar() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'day', c.day, 'time', c.at_time, 'paper', c.paper_id,
    'title', c.title, 'kind', c.kind, 'link', c.link, 'owner', m.name, 'mine', c.owner = private.member())
    order by c.day, c.at_time, c.id), '[]')
  from private.calendar c left join private.members m on m.user_id = c.owner
  where private.member() is not null
$$;

-- p_group true: a group paper, admin only. Otherwise your own entry, such as a paid mock.
create or replace function public.cat_calendar_add(p_day date, p_time text, p_title text, p_paper_id text,
  p_kind text, p_link text, p_group boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_title, 80, 'The title');
begin
  if p_group then
    perform private.admin();
  end if;
  if p_day is null or p_day < date '2026-11-01' or p_day > date '2027-01-31' then
    raise exception 'Pick a day between November and January.';
  end if;
  if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Give the time as HH:MM.';
  end if;
  if p_paper_id is not null and p_paper_id !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Unknown paper.';
  end if;
  if coalesce(p_kind, '') not in ('free', 'paid', 'official', 'sectional') then
    raise exception 'Unknown kind of paper.';
  end if;
  if p_link is not null and (p_link !~ '^https://[^[:space:]<>"]+$' or length(p_link) > 300) then
    raise exception 'Links must start with https://.';
  end if;
  if not p_group and (select count(*) from private.calendar where owner = u) >= 20 then
    raise exception 'Twenty entries of your own is the limit.';
  end if;
  insert into private.calendar (day, at_time, paper_id, title, kind, link, owner)
  values (p_day, p_time, p_paper_id, t, p_kind, nullif(p_link, ''), case when p_group then null else u end);
  return public.cat_calendar();
end $$;

-- Move a paper: the admin for group papers, the owner for their own.
create or replace function public.cat_calendar_move(p_id bigint, p_day date, p_time text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  c private.calendar%rowtype;
begin
  select * into c from private.calendar where id = p_id;
  if not found then
    raise exception 'That entry is gone.';
  end if;
  if c.owner is null then perform private.admin(); elsif c.owner <> u then raise exception 'Only its owner can move it.'; end if;
  if p_day is null or p_day < date '2026-11-01' or p_day > date '2027-01-31' then
    raise exception 'Pick a day between November and January.';
  end if;
  if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Give the time as HH:MM.';
  end if;
  update private.calendar set day = p_day, at_time = p_time where id = p_id;
  return public.cat_calendar();
end $$;

create or replace function public.cat_calendar_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  c private.calendar%rowtype;
begin
  select * into c from private.calendar where id = p_id;
  if found then
    if c.owner is null then perform private.admin(); elsif c.owner <> u then raise exception 'Only its owner can delete it.'; end if;
    delete from private.calendar where id = p_id;
  end if;
  return public.cat_calendar();
end $$;

-- Fill the group calendar from the plan's list, once, so the admin can edit it.
create or replace function public.cat_admin_calendar_import(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
begin
  perform private.admin();
  if exists (select 1 from private.calendar where owner is null) then
    return public.cat_calendar();
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'Send the calendar as a list of up to 30 papers.';
  end if;
  for x in select value from jsonb_array_elements(p_items) loop
    perform public.cat_calendar_add((x ->> 'day')::date, x ->> 'time', x ->> 'title', x ->> 'paper',
      coalesce(x ->> 'kind', 'free'), x ->> 'link', true);
  end loop;
  return public.cat_calendar();
end $$;

-- Paper room: where each person is in today's sitting of a calendar paper.
create or replace function public.cat_paper_room(p_paper_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'me', m.user_id = private.member(),
    'state', s.state, 'at', s.updated_at) order by s.updated_at), '[]')
  from private.paper_status s join private.members m on m.user_id = s.user_id
  where s.paper_id = p_paper_id and s.day = private.today() and private.member() is not null
$$;

create or replace function public.cat_paper_progress(p_paper_id text, p_state text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if coalesce(p_paper_id, '') !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'Unknown paper.';
  end if;
  if p_state not in ('started', 'varc', 'dilr', 'qa', 'finished') then
    raise exception 'Unknown state.';
  end if;
  insert into private.paper_status (user_id, paper_id, day, state) values (u, p_paper_id, private.today(), p_state)
  on conflict (user_id, paper_id, day) do update set state = excluded.state, updated_at = now();
  return public.cat_paper_room(p_paper_id);
end $$;

-- A paper's debrief thread opens once you've logged that paper.
create or replace function public.cat_paper_posts(p_paper_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if not private.logged_paper(u, p_paper_id) then
    return jsonb_build_object('open', false,
      'count', (select count(*) from private.paper_posts where paper_id = p_paper_id));
  end if;
  return jsonb_build_object('open', true, 'posts', coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', m.name, 'me', p.user_id = u, 'text', p.body, 'at', p.created_at) order by p.id)
    from private.paper_posts p join private.members m on m.user_id = p.user_id
    where p.paper_id = p_paper_id), '[]'));
end $$;

create or replace function public.cat_paper_post(p_paper_id text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 1500, 'The post');
begin
  if not private.logged_paper(u, p_paper_id) then
    raise exception 'Log this paper on the Mocks page first.';
  end if;
  if (select count(*) from private.paper_posts where user_id = u and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Slow down a little: 10 posts a minute at most.';
  end if;
  insert into private.paper_posts (user_id, paper_id, body) values (u, p_paper_id, t);
  return public.cat_paper_posts(p_paper_id);
end $$;

-- ---------------------------------------------------------------- reports, RC log, budget, search

create or replace function public.cat_report(p_test_id text, p_question_id text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 600, 'The report');
begin
  perform private.require_question(p_test_id, p_question_id);
  if (select count(*) from private.reports where user_id = u and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Twenty reports a day is the limit.';
  end if;
  insert into private.reports (user_id, test_id, question_id, body) values (u, p_test_id, p_question_id, t);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cat_admin_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', m.name, 'testId', r.test_id,
    'questionId', r.question_id, 'text', r.body, 'at', r.created_at) order by r.id)
    from private.reports r join private.members m on m.user_id = r.user_id where r.resolved_at is null), '[]');
end $$;

create or replace function public.cat_admin_report_resolve(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin();
  update private.reports set resolved_at = now() where id = p_id;
  return public.cat_admin_reports();
end $$;

create or replace function public.cat_rc_log() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', at, 'words', words, 'seconds', seconds,
    'right', right_n, 'total', total_n, 'source', source) order by at desc), '[]')
  from private.rc_log where user_id = private.member()
$$;

create or replace function public.cat_rc_log_add(p_words int, p_seconds int, p_right int, p_total int, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_words not between 100 and 3000 or p_seconds not between 30 and 3600 then
    raise exception 'Give 100 to 3000 words and 30 seconds to an hour.';
  end if;
  if p_total not between 1 and 10 or p_right not between 0 and p_total then
    raise exception 'Right answers run from 0 to the number of questions (1 to 10).';
  end if;
  insert into private.rc_log (user_id, words, seconds, right_n, total_n, source)
  values (private.member(), p_words, p_seconds, p_right, p_total, left(btrim(coalesce(p_source, '')), 80));
  return public.cat_rc_log();
end $$;

create or replace function public.cat_rc_log_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.rc_log where id = p_id and user_id = private.member();
  return public.cat_rc_log();
end $$;

create or replace function public.cat_spend() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'item', item, 'amount', amount, 'day', on_day)
    order by on_day, id), '[]')
  from private.spend where user_id = private.member()
$$;

create or replace function public.cat_spend_add(p_item text, p_amount int, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t text := private.check_text(p_item, 80, 'The item');
begin
  if p_amount is null or p_amount not between 0 and 100000 then
    raise exception 'Give the amount in rupees, 0 to 100000.';
  end if;
  insert into private.spend (user_id, item, amount, on_day) values (private.member(), t, p_amount, coalesce(p_day, private.today()));
  return public.cat_spend();
end $$;

create or replace function public.cat_spend_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.spend where id = p_id and user_id = private.member();
  return public.cat_spend();
end $$;

-- Approaches (on tests you've submitted), your bookmark notes and explanations.
create or replace function public.cat_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  q text := btrim(coalesce(p_q, ''));
  pat text;
begin
  if char_length(q) < 2 then
    return '[]';
  end if;
  pat := '%' || replace(replace(replace(left(q, 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
    select jsonb_build_object('kind', 'approach', 'testId', p.test_id, 'testTitle', t.title, 'questionId', p.question_id,
      'name', m.name, 'text', p.body, 'at', p.created_at) x
    from private.posts p join private.members m on m.user_id = p.user_id join private.tests t on t.test_id = p.test_id
    where p.body ilike pat and private.first_attempt(u, p.test_id) is not null
    union all
    select jsonb_build_object('kind', 'bookmark', 'testId', b.test_id, 'testTitle', t.title, 'questionId', b.question_id,
      'text', b.note, 'at', b.created_at)
    from private.bookmarks b join private.tests t on t.test_id = b.test_id
    where b.user_id = u and b.note ilike pat
    union all
    select jsonb_build_object('kind', 'explanation', 'testId', e.test_id, 'testTitle', t.title, 'questionId', e.question_id,
      'text', e.body, 'at', e.at)
    from private.explanations e join private.tests t on t.test_id = e.test_id
    where e.user_id = u and e.body ilike pat
    limit 60) y), '[]');
end $$;

-- ---------------------------------------------------------------- voice approaches

create or replace function public.cat_voice_list(p_test_id text, p_question_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  perform private.require_done(u, p_test_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', m.name, 'me', v.user_id = u,
    'seconds', v.seconds, 'at', v.created_at) order by v.id)
    from private.voice_notes v join private.members m on m.user_id = v.user_id
    where v.test_id = p_test_id and v.question_id = p_question_id), '[]');
end $$;

create or replace function public.cat_voice_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.member();
  v private.voice_notes%rowtype;
begin
  select * into v from private.voice_notes where id = p_id;
  if not found then
    raise exception 'That recording was deleted.';
  end if;
  perform private.require_done(u, v.test_id);
  return jsonb_build_object('mime', v.mime, 'data', v.data);
end $$;

-- Up to 90 seconds of audio, about 700 KB as base64, 10 a day.
create or replace function public.cat_voice_post(p_test_id text, p_question_id text, p_mime text, p_data text, p_seconds int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  perform private.require_done(u, p_test_id);
  perform private.require_question(p_test_id, p_question_id);
  if coalesce(p_mime, '') !~ '^audio/[a-z0-9.+-]{2,30}(;[ a-z0-9=.,+-]{0,60})?$' then
    raise exception 'That recording format is not supported.';
  end if;
  if char_length(coalesce(p_data, '')) not between 100 and 700000 or p_data !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'Keep recordings under about 90 seconds.';
  end if;
  if (select count(*) from private.voice_notes where user_id = u and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Ten recordings a day is the limit.';
  end if;
  insert into private.voice_notes (user_id, test_id, question_id, mime, data, seconds)
  values (u, p_test_id, p_question_id, p_mime, p_data, least(greatest(coalesce(p_seconds, 0), 0), 120));
  return public.cat_voice_list(p_test_id, p_question_id);
end $$;

create or replace function public.cat_voice_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  q text;
begin
  delete from private.voice_notes where id = p_id and user_id = private.member() returning test_id, question_id into t, q;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- whiteboard and co-solve

-- Board names: "set-<test id>" for a DILR set, or "cs-<co-solve id>".
create or replace function public.cat_strokes(p_board text, p_after bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', m.name, 'data', s.data) order by s.id), '[]')
  from (select * from private.strokes where board = p_board and id > coalesce(p_after, 0) order by id limit 500) s
  join private.members m on m.user_id = s.user_id
  where private.member() is not null
$$;

-- data: {color, width, points: [[x, y], ...]} with x and y from 0 to 1, or {clear: true}.
create or replace function public.cat_stroke_add(p_board text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  new_id bigint;
begin
  if coalesce(p_board, '') !~ '^(set|cs)-[a-z0-9-]{1,60}$' then
    raise exception 'Unknown board.';
  end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 20000 then
    raise exception 'That stroke is too long.';
  end if;
  if (select count(*) from private.strokes where user_id = u and created_at > now() - interval '1 minute') >= 120 then
    raise exception 'Slow down a little.';
  end if;
  if p_data ? 'clear' then
    delete from private.strokes where board = p_board;
    insert into private.strokes (board, user_id, data) values (p_board, u, '{"clear": true}') returning id into new_id;
  else
    insert into private.strokes (board, user_id, data)
    values (p_board, u, jsonb_build_object('color', left(coalesce(p_data ->> 'color', 'ink'), 12),
      'width', least(greatest(coalesce(private.num(p_data -> 'width'), 2), 1), 12),
      'points', case when jsonb_typeof(p_data -> 'points') = 'array' then p_data -> 'points' else '[]' end))
    returning id into new_id;
  end if;
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.cat_cosolves() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'testId', c.test_id, 'startsAt', c.starts_at,
    'host', h.name, 'partner', p.name, 'mine', c.host = private.member()) order by c.starts_at), '[]')
  from private.cosolve c join private.members h on h.user_id = c.host join private.members p on p.user_id = c.partner
  where (c.host = private.member() or c.partner = private.member()) and c.starts_at > now() - interval '2 hours'
$$;

-- Invite one person to sit a DILR set with you. The shared clock starts in p_in_min minutes.
create or replace function public.cat_cosolve_create(p_test_id text, p_partner text, p_in_min int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  p uuid;
begin
  if not exists (select 1 from private.tests where test_id = p_test_id and owner is null) then
    raise exception 'That set is not on the site.';
  end if;
  select user_id into p from private.members where lower(name) = lower(btrim(coalesce(p_partner, '')));
  if p is null or p = u then
    raise exception 'Pick someone else in the group.';
  end if;
  if p_in_min is null or p_in_min not between 1 and 120 then
    raise exception 'Start it 1 to 120 minutes from now.';
  end if;
  if (select count(*) from private.cosolve where host = u and starts_at > now() - interval '2 hours') >= 5 then
    raise exception 'Five open invitations is the limit.';
  end if;
  insert into private.cosolve (host, partner, test_id, starts_at) values (u, p, p_test_id, now() + make_interval(mins => p_in_min));
  return public.cat_cosolves();
end $$;

create or replace function public.cat_cosolve(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'testId', c.test_id, 'startsAt', c.starts_at, 'now', now(),
    'host', h.name, 'partner', p.name)
  from private.cosolve c join private.members h on h.user_id = c.host join private.members p on p.user_id = c.partner
  where c.id = p_id and (c.host = private.member() or c.partner = private.member())
$$;

-- ---------------------------------------------------------------- points history, export

-- Your points day by day since 1 November, with where they came from.
create or replace function public.cat_points_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(r || jsonb_build_object('day', d) order by d desc), '[]')
  from generate_series(date '2026-11-01', private.today(), interval '1 day') g(d0),
  lateral (select g.d0::date d) dd(d),
  lateral (select x from jsonb_array_elements(private.board_rows(private.member(), dd.d, dd.d)) x
           where (x ->> 'me')::boolean) y(r)
  where (r ->> 'points')::int > 0
$$;

-- Everything the group has logged, as one file, for the admin to keep a copy.
-- Answer keys and the group code are left out.
create or replace function public.cat_admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin();
  return jsonb_build_object(
    'exportedAt', now(),
    'members', (select coalesce(jsonb_agg(to_jsonb(m) - 'user_id' - 'pin_hash' || jsonb_build_object('id', m.user_id)), '[]') from private.members m),
    'days', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.days x),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.tasks x),
    'attempts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.attempts x),
    'mocks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.mocks x),
    'topicStatus', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.topic_status x),
    'topicEvents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.topic_events x),
    'topicStarts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.topic_starts x),
    'videos', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.videos_watched x),
    'chat', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.chat x),
    'posts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.posts x),
    'postVotes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.post_votes x),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.reviews x),
    'reviewLog', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.review_log x),
    'speed', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.speed x),
    'bookmarks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.bookmarks x),
    'planTicks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.plan_ticks x),
    'focusLog', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.focus_log x),
    'recall', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.recall x),
    'explanations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.explanations x),
    'causes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.question_causes x),
    'checkins', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.checkins x),
    'paperPosts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.paper_posts x),
    'calendar', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.calendar x),
    'reports', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.reports x),
    'rcLog', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.rc_log x),
    'spend', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from private.spend x),
    'composedTests', (select coalesce(jsonb_agg(jsonb_build_object('testId', test_id, 'title', title, 'owner', owner,
      'sections', sections)), '[]') from private.tests where owner is not null));
end $$;

-- ---------------------------------------------------------------- access

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'cat\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
