-- Comment hardening (security review of 054):
-- - one notification per commenter per post, refreshed instead of piling up (so comments can't push posts out of the feed);
-- - the notification goes when its comment is deleted;
-- - the daily cap takes a lock so parallel calls can't slip past it;
-- - a thread returns at most its newest 200 comments;
-- - sets never sell Siam Si-only items.

create or replace function public.comment(p_activity bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.activity; v_body text := btrim(coalesce(p_body, '')); v_id bigint; v_note jsonb;
begin
  select * into v_row from public.activity where id = p_activity;
  if not found or v_row.kind in ('nudge', 'comment') or not public.can_see_activity(v_row) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if char_length(v_body) not between 1 and 280 then raise exception 'bad_comment' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = auth.uid() for update;   -- one comment at a time per person, so the cap holds
  if (select count(*) from public.comments where user_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'comment_limit' using errcode = 'P0001';
  end if;
  insert into public.comments (activity_id, user_id, body) values (p_activity, auth.uid(), v_body) returning id into v_id;
  if v_row.user_id <> auth.uid() then   -- tell the poster: one notice per commenter per post, showing the latest comment
    v_note := jsonb_build_object('to', v_row.user_id, 'on', p_activity, 'what', v_row.kind, 'body', left(v_body, 80), 'comment', v_id);
    update public.activity set data = v_note, created_at = now()
     where kind = 'comment' and user_id = auth.uid() and data->>'on' = p_activity::text;
    if not found then insert into public.activity (user_id, kind, data) values (auth.uid(), 'comment', v_note); end if;
  end if;
  return jsonb_build_object('id', v_id, 'body', v_body, 'at', now(), 'mine', true, 'who', public.who_of(auth.uid()));
end;
$$;

create or replace function public.comments_of(p_activity bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.activity;
begin
  select * into v_row from public.activity where id = p_activity;
  if not found or not public.can_see_activity(v_row) then raise exception 'not_found' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(c order by c->>'at'), '[]') from (
            select jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at, 'mine', c.user_id = auth.uid(), 'who', public.who_of(c.user_id)) c
              from public.comments c where c.activity_id = p_activity order by c.created_at desc limit 200) x);
end;
$$;

-- the comment's author or the post's owner can delete it; its notice goes too
create or replace function public.delete_comment(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments c using public.activity a
   where c.id = p_id and a.id = c.activity_id and auth.uid() in (c.user_id, a.user_id);
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from public.activity where kind = 'comment' and data->>'comment' = p_id::text;
end;
$$;

create or replace function public.set_missing(p_user uuid, p_set text)
returns table (kind text, item_id text, coins int) language sql stable security definer set search_path = '' as $$
  select i.kind, i.id, (i.price * 3 / 4)::int
    from public.shop_sets s, unnest(s.items) x, public.shop_items i
   where s.id = p_set and i.kind = split_part(x, ':', 1) and i.id = substr(x, length(split_part(x, ':', 1)) + 2)
     and not i.gacha_only and not public.can_wear(p_user, i.kind, i.id)
$$;
revoke all on function public.set_missing(uuid, text) from public, anon, authenticated;
