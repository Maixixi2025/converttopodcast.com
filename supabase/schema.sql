-- converttopodcast.com - Supabase schema with RLS
-- Run this in: https://supabase.com/dashboard/project/nsdhcmjztwxoywkzmdgh/sql

-- ============================================================
-- 1. user_credits table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan         text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','basic','pro')),
  credits      integer NOT NULL DEFAULT 30,
  credits_used integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_credits_user_idx ON public.user_credits (user_id);

-- ============================================================
-- 2. usage_log table (optional, for tracking generations)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usage_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source      text NOT NULL,
  style       text,
  language    text,
  length      text,
  duration    integer,
  credits     integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_log_user_idx ON public.usage_log (user_id, created_at DESC);

-- ============================================================
-- 3. RLS — enable on both tables
-- ============================================================
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_log   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Policies
-- ============================================================
-- user_credits: users can only read their own row
CREATE POLICY "users read own credits"
  ON public.user_credits
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- user_credits: only the service_role (server-side worker) writes
-- No INSERT/UPDATE/DELETE policy for anon/authenticated — backend uses service key

-- usage_log: users can read their own history
CREATE POLICY "users read own usage"
  ON public.usage_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. Auto-create credits row on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_credits (user_id, plan, credits, credits_used, period_start)
  VALUES (NEW.id, 'free', 30, 0, date_trunc('month', now()))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 6. Atomic credit consume RPC (called from CF Pages Function)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_credit(
  p_user_id   uuid,
  p_credits   integer,
  p_source    text,
  p_style     text,
  p_language  text,
  p_length    text,
  p_duration  integer
)
RETURNS TABLE(ok boolean, remaining integer, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits      integer;
  v_credits_used integer;
  v_period_start timestamptz;
  v_remaining    integer;
BEGIN
  SELECT credits, credits_used, period_start
    INTO v_credits, v_credits_used, v_period_start
    FROM public.user_credits
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 'No credits row';
    RETURN;
  END IF;

  -- Monthly reset for free plan
  IF v_period_start < date_trunc('month', now()) THEN
    v_credits := 30;
    v_credits_used := 0;
    v_period_start := date_trunc('month', now());
  END IF;

  v_remaining := v_credits - v_credits_used;

  IF v_remaining < p_credits THEN
    RETURN QUERY SELECT false, v_remaining, 'Insufficient credits';
    RETURN;
  END IF;

  UPDATE public.user_credits
     SET credits_used = credits_used + p_credits,
         updated_at   = now()
   WHERE user_id = p_user_id;

  INSERT INTO public.usage_log (user_id, source, style, language, length, duration, credits)
  VALUES (p_user_id, p_source, p_style, p_language, p_length, p_duration, p_credits);

  v_remaining := v_remaining - p_credits;
  RETURN QUERY SELECT true, v_remaining, 'OK';
END;
$$;

-- Grant execute to service_role only (CF function uses service key)
-- service_role bypasses RLS by default, so the above is just for safety
REVOKE ALL ON FUNCTION public.consume_credit(uuid, integer, text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_credit(uuid, integer, text, text, text, text, integer) TO service_role;
