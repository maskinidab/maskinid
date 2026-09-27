-- (runs last)
-- Demo timeline (SPEC §17: "händelselogg med 400+ events och 30 dagars ankare"). The seed runs in seconds, so every
-- event would carry the same timestamp. Here – and only in the seed – events are spread over the last 30 days in
-- their original order, the hash chain is recomputed, and one anchor per day is computed and marked published.
-- Production never does this: the append-only triggers are disabled only inside this seed transaction.
do $$
declare e public.events; prev text; total bigint; first_seq bigint; d date;
begin
  select count(*), min(seq) into total, first_seq from public.events;
  if total = 0 then return; end if;
  alter table public.events disable trigger events_no_update;
  -- Order preserved: event n of N lands at 30 days ago + n/N of the span, plus a few minutes of spread.
  for e in select * from public.events order by seq loop
    e.created_at := date_trunc('minute', now() - interval '30 days')
      + ((e.seq - first_seq)::numeric / total) * (interval '30 days' - interval '1 hour')
      + make_interval(secs => (e.seq % 50) * 3);
    e.prev_hash := prev;
    e.hash := app.event_hash(e);
    update public.events set created_at = e.created_at, prev_hash = e.prev_hash, hash = e.hash where seq = e.seq;
    prev := e.hash;
  end loop;
  alter table public.events enable trigger events_no_update;
  for d in select generate_series(current_date - 30, current_date - 1, interval '1 day')::date loop
    perform app.compute_anchor(d);
  end loop;
  update public.event_anchors set published_at = (day + 1)::timestamp at time zone 'Europe/Stockholm' + interval '5 minutes'
  where published_at is null and day < current_date;
end $$;

-- Sanity: the recomputed chain verifies.
do $$
begin
  if not (app.verify_chain() ->> 'ok')::boolean then raise exception 'seed: event chain does not verify'; end if;
end $$;
