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
  user_id uuid primary key references auth.users (id) on delete cascade,
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
  water int not null default 0,
  target_min int,
  sleep_min int,
  primary key (user_id, day)
);

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

-- ---------------------------------------------------------------- helpers

-- Days run on Indian time, whatever the server's clock says.
create or replace function private.ist_day(ts timestamptz) returns date
language sql stable as $$
  select ((ts at time zone 'UTC') + interval '5 hours 30 minutes')::date
$$;

create or replace function private.today() returns date
language sql stable as $$
  select private.ist_day(now())
$$;

create or replace function private.week_start(d date) returns date
language sql immutable as $$
  select d - (extract(isodow from d)::int - 1)
$$;

create or replace function private.uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'Sign in first.';
  end if;
  return u;
end $$;

create or replace function private.member() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.uid();
begin
  if not exists (select 1 from private.members where user_id = u) then
    raise exception 'Join the group first.';
  end if;
  return u;
end $$;

create or replace function private.num(v jsonb) returns numeric
language sql immutable as $$
  select case jsonb_typeof(v) when 'number' then (v #>> '{}')::numeric else null end
$$;

-- A typed or chosen answer as text, or null when blank.
create or replace function private.clean_answer(v jsonb) returns text
language sql immutable as $$
  select nullif(left(btrim(case jsonb_typeof(v)
    when 'string' then v #>> '{}'
    when 'number' then v #>> '{}'
    else null end), 40), '')
$$;

-- A type-in answer as a number, or null if it isn't one. Commas, %, the rupee
-- sign and spaces are ignored, as on the real exam.
create or replace function private.norm_tita(t text) returns numeric
language plpgsql immutable as $$
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
language plpgsql immutable as $$
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
language sql immutable as $$
  select case
    when result = 'correct' then 3
    when result = 'wrong' and q_type = 'mcq' then -1
    else 0 end
$$;

create or replace function private.tally(m int, c int, w int, s int) returns jsonb
language sql immutable as $$
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

create or replace function private.streak(u uuid) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  d date := private.today();
  n int := 0;
begin
  -- Today still counts as unbroken until it's over.
  if not exists (select 1 from private.days where user_id = u and day = d and focus_min >= 60) then
    d := d - 1;
  end if;
  while exists (select 1 from private.days where user_id = u and day = d and focus_min >= 60) loop
    n := n + 1;
    d := d - 1;
  end loop;
  return n;
end $$;

create or replace function private.check_text(body text, max_len int, what text) returns text
language plpgsql immutable as $$
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

-- ---------------------------------------------------------------- profile

create or replace function public.cat_me() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  u uuid := private.uid();
begin
  return jsonb_build_object('member', (
    select jsonb_build_object('name', name, 'slot', slot, 'joinedAt', joined_at, 'isAdmin', is_admin,
      'team', team, 'goalScore', goal_score, 'goalPct', goal_pct, 'settings', settings)
    from private.members where user_id = u));
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

create or replace function public.cat_join(p_code text, p_name text, p_slot int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.uid();
  n text := btrim(coalesce(p_name, ''));
  code text;
begin
  select value into code from private.config where key = 'join_code';
  if code is null or upper(btrim(coalesce(p_code, ''))) <> upper(btrim(code)) then
    raise exception 'That group code is wrong. Ask whoever runs the group for it.';
  end if;
  if exists (select 1 from private.members where user_id = u) then
    return public.cat_me();
  end if;
  if n !~ '^[[:alnum:] ._-]{2,20}$' then
    raise exception 'Pick a name of 2 to 20 letters or numbers.';
  end if;
  if p_slot is null or p_slot not between 1 and 3 then
    raise exception 'Pick slot 1, 2 or 3.';
  end if;
  if exists (select 1 from private.members where lower(name) = lower(n)) then
    raise exception 'Someone in the group already uses that name.';
  end if;
  -- The first person to join runs the group.
  insert into private.members (user_id, name, slot, is_admin)
  values (u, n, p_slot, not exists (select 1 from private.members));
  return public.cat_me();
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
        'result', res);
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
  if private.first_attempt(u, t.test_id) = new_id then
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
    'attemptId', a.id, 'testId', a.test_id, 'testTitle', t.title,
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

-- ---------------------------------------------------------------- today: focus, water, tasks

create or replace function public.cat_today() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'day', private.today(),
    'focusMin', coalesce((select focus_min from private.days where user_id = private.member() and day = private.today()), 0),
    'water', coalesce((select water from private.days where user_id = private.member() and day = private.today()), 0),
    'targetMin', (select target_min from private.days where user_id = private.member() and day = private.today()),
    'sleepMin', (select sleep_min from private.days where user_id = private.member() and day = private.today()),
    'streak', private.streak(private.member()),
    'reviewsDue', (select count(*) from private.reviews
      where user_id = private.member() and cleared_at is null and due_on <= private.today()),
    'nudges', coalesce((select jsonb_agg(jsonb_build_object('from', m.name, 'at', n.at) order by n.at)
      from private.nudges n join private.members m on m.user_id = n.from_user
      where n.to_user = private.member() and n.day = private.today()), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', body, 'done', done_at is not null) order by id)
      from private.tasks where user_id = private.member() and day = private.today()), '[]'))
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
  return public.cat_today();
end $$;

create or replace function public.cat_water(p_delta int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  d int := least(greatest(coalesce(p_delta, 0), -5), 5);
  n int;
begin
  insert into private.days (user_id, day, water) values (u, private.today(), greatest(d, 0))
  on conflict (user_id, day) do update set water = least(greatest(private.days.water + d, 0), 20)
  returning water into n;
  return jsonb_build_object('day', private.today(), 'count', n);
end $$;

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
    'varc', varc, 'dilr', dilr, 'qa', qa, 'total', varc + dilr + qa, 'analysis', analysis)
    order by taken_on desc, id desc), '[]')
  from private.mocks where user_id = private.member()
$$;

-- p_analysis: {attempted: {varc, dilr, qa}, wrong: {varc, dilr, qa}, causes: {code: marks lost}, note}
create or replace function public.cat_mock_add(p_taken_on date, p_source text, p_paper_id text, p_varc int, p_dilr int, p_qa int,
  p_at_slot_time boolean, p_analysis jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  src text := private.check_text(p_source, 60, 'The paper name');
  a jsonb := '{}';
  sec text;
  v int;
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
  -- Keep only the analysis fields the site uses, with sane numbers.
  if jsonb_typeof(p_analysis) = 'object' then
    for sec in select unnest(array['attempted', 'wrong']) loop
      if jsonb_typeof(p_analysis -> sec) = 'object' then
        a := a || jsonb_build_object(sec, (
          select coalesce(jsonb_object_agg(k, least(greatest((p_analysis -> sec ->> k)::int, 0), 24)), '{}')
          from unnest(array['varc', 'dilr', 'qa']) k
          where jsonb_typeof(p_analysis -> sec -> k) = 'number'));
      end if;
    end loop;
    if jsonb_typeof(p_analysis -> 'causes') = 'object' then
      a := a || jsonb_build_object('causes', (
        select coalesce(jsonb_object_agg(k, least(greatest((p_analysis -> 'causes' ->> k)::int, 0), 204)), '{}')
        from unnest(array['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']) k
        where jsonb_typeof(p_analysis -> 'causes' -> k) = 'number'));
    end if;
    if jsonb_typeof(p_analysis -> 'note') = 'string' then
      a := a || jsonb_build_object('note', left(p_analysis ->> 'note', 500));
    end if;
  end if;
  insert into private.mocks (user_id, taken_on, source, paper_id, varc, dilr, qa, at_slot_time, analysis)
  values (u, p_taken_on, src, p_paper_id, p_varc, p_dilr, p_qa, coalesce(p_at_slot_time, false), a);
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
--   water             1 per glass, up to 10 a day
--   tasks             3 per task ticked off, up to 5 tasks a day
--   site test         20 the first time you finish each test (10 for a Daily 5)
--   full mock         30 per mock logged, one a day, plus 10 if sat at your CAT slot time
--   video             5 per video marked watched, up to 6 a day
--   topic level       10 for reaching "solves basic", 15 more for "solves CAT level", up to 50 a day
--   approach posted   3 per explanation of 40 characters or more, up to 5 a day
--   helpful votes     2 per vote your approaches receive, up to 5 a day
--   review            2 per review question answered right, up to 5 a day
--   speed drill       2 per round finished, up to 5 rounds a day
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
      count(*) filter (where sleep_min >= 420) slept,
      sum(least(water, 10)) wp
    from private.days where day between d0 and d1 group by user_id
  ), tk as (
    select user_id, sum(least(n, 5)) n from (
      select user_id, day, count(*) n from private.tasks
      where done_at is not null and day between d0 and d1 group by 1, 2) x group by 1
  ), ts as (
    select user_id, sum(case when test_id like 'daily-%' then 10 else 20 end) p, count(*) n from (
      select user_id, test_id, min(private.ist_day(submitted_at)) fd from private.attempts group by 1, 2) x
    where fd between d0 and d1 group by 1
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
      coalesce(dd.wp, 0) water,
      coalesce(tk.n, 0) tasks,
      coalesce(ts.n, 0) tests,
      coalesce(mk.n, 0) mocks,
      coalesce(vd.n, 0) videos,
      coalesce(tp.p, 0) topic_points,
      coalesce(ps.n, 0) posts,
      coalesce(hv.n, 0) votes,
      coalesce(rv.n, 0) reviews,
      coalesce(sp.n, 0) drills,
      coalesce(dd.fp, 0) + 5 * coalesce(dd.sd, 0) + 10 * coalesce(dd.kept, 0) + 5 * coalesce(dd.slept, 0)
        + coalesce(dd.wp, 0) + 3 * coalesce(tk.n, 0) + coalesce(ts.p, 0)
        + 30 * coalesce(mk.n, 0) + 10 * coalesce(mk.slot_n, 0) + 5 * coalesce(vd.n, 0)
        + coalesce(tp.p, 0) + 3 * coalesce(ps.n, 0) + 2 * coalesce(hv.n, 0)
        + 2 * coalesce(rv.n, 0) + 2 * coalesce(sp.n, 0) as points
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'slot', slot, 'team', team, 'me', user_id = u, 'points', points,
      'focusMin', focus_min, 'studyDays', study_days, 'kept', kept, 'slept', slept, 'water', water,
      'tasks', tasks, 'tests', tests, 'mocks', mocks, 'videos', videos, 'topicPoints', topic_points,
      'posts', posts, 'votes', votes, 'reviews', reviews, 'drills', drills,
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
            where a.user_id = m.user_id order by test_id, submitted_at, id) f), '{}')) row_json
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
    'id', id, 'name', name, 'me', me, 'text', body, 'at', created_at,
    'likes', likes, 'liked', liked) order by id), '[]')
  from (
    select c.id, m.name, c.user_id = private.member() me, c.body, c.created_at,
      (select count(*) from private.chat_likes l where l.message_id = c.id) likes,
      exists (select 1 from private.chat_likes l where l.message_id = c.id and l.user_id = private.member()) liked
    from private.chat c join private.members m on m.user_id = c.user_id
    where c.id > coalesce(p_after, 0)
    order by c.id desc limit 150) x
$$;

create or replace function public.cat_chat_send(p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
  t text := private.check_text(p_text, 1000, 'The message');
begin
  if (select count(*) from private.chat where user_id = u and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'Slow down a little: 15 messages a minute at most.';
  end if;
  insert into private.chat (user_id, body) values (u, t);
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
    select q ->> 'id' qid, count(*) done_n, count(*) filter (where q ->> 'result' = 'correct') right_n
    from firsts, jsonb_array_elements(firsts.questions) q group by 1
  ), pc as (
    select question_id qid, count(*) n from private.posts where test_id = p_test_id group by 1
  )
  select coalesce(jsonb_object_agg(qr.qid, jsonb_build_object(
    'done', qr.done_n, 'right', qr.right_n, 'posts', coalesce(pc.n, 0))), '{}')
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

create or replace function public.cat_set_goal(p_score int, p_pct numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_score is not null and p_score not between -68 and 204 then
    raise exception 'A CAT score runs from -68 to 204.';
  end if;
  if p_pct is not null and p_pct not between 0 and 100 then
    raise exception 'A percentile runs from 0 to 100.';
  end if;
  update private.members set goal_score = p_score, goal_pct = round(p_pct, 1) where user_id = u;
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
    ('waterEveryMin', 10, 120), ('breakAfterMin', 20, 120), ('breakLengthMin', 3, 30),
    ('goalGlasses', 4, 16), ('eyeEveryMin', 0, 60), ('textSize', 90, 130)) v(k, lo, hi)
  loop
    if jsonb_typeof(p_settings -> lim.k) = 'number' then
      s := s || jsonb_build_object(lim.k, least(greatest((p_settings ->> lim.k)::numeric::int, lim.lo), lim.hi));
    end if;
  end loop;
  if jsonb_typeof(p_settings -> 'sound') = 'boolean' then
    s := s || jsonb_build_object('sound', p_settings -> 'sound');
  end if;
  if jsonb_typeof(p_settings -> 'windDown') = 'boolean' then
    s := s || jsonb_build_object('windDown', p_settings -> 'windDown');
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

-- Last night's sleep, logged on today's row.
create or replace function public.cat_sleep(p_hours numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.member();
begin
  if p_hours is null or p_hours not between 0 and 14 then
    raise exception 'Log between 0 and 14 hours.';
  end if;
  insert into private.days (user_id, day, sleep_min) values (u, private.today(), round(p_hours * 60)::int)
  on conflict (user_id, day) do update set sleep_min = excluded.sleep_min;
  return public.cat_today();
end $$;

-- Everyone's promise and progress today.
create or replace function public.cat_promises() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', m.name, 'me', m.user_id = private.member(),
    'targetMin', d.target_min, 'focusMin', coalesce(d.focus_min, 0))
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
language sql stable security definer set search_path = '' as $$
  select coalesce(max(n), 0)::int from (
    select count(*) n from (
      select day - (row_number() over (order by day))::int grp
      from private.days where user_id = u and focus_min >= 60) x
    group by grp) y
$$;

create or replace function private.badges_of(u uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(code), '[]') from (
    select 'first-test' code where exists (select 1 from private.attempts where user_id = u)
    union all select 'first-mock' where exists (select 1 from private.mocks where user_id = u)
    union all select 'slot-mock' where exists (select 1 from private.mocks where user_id = u and at_slot_time)
    union all select 'promise-kept' where exists (select 1 from private.days
      where user_id = u and target_min >= 120 and focus_min >= target_min)
    union all select 'water-day' where exists (select 1 from private.days where user_id = u and water >= 10)
    union all select 'streak-3' where private.longest_streak(u) >= 3
    union all select 'streak-7' where private.longest_streak(u) >= 7
    union all select 'hours-10' where (select coalesce(sum(focus_min), 0) from private.days where user_id = u) >= 600
    union all select 'hours-50' where (select coalesce(sum(focus_min), 0) from private.days where user_id = u) >= 3000
    union all select 'helper' where (select count(*) from private.posts where user_id = u and char_length(body) >= 40) >= 5
    union all select 'helpful' where exists (select 1 from private.post_votes v join private.posts p on p.id = v.post_id where p.user_id = u)
    union all select 'topics-5' where (select count(*) from private.topic_events where user_id = u and level = 2) >= 5
    union all select 'reviewer' where (select count(*) from private.reviews where user_id = u and cleared_at is not null) >= 10
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
      'name', name, 'slot', slot, 'team', team, 'isAdmin', is_admin, 'joinedAt', joined_at, 'me', user_id = u)
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
