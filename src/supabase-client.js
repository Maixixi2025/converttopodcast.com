// converttopodcast.com — Supabase client + auth helper
// Publishable/anon key is safe in browser; service key lives only in CF Pages secrets.
//
// Window globals (set by index.html before this script loads):
//   window.SUPABASE_URL          — https://nsdhcmjztwxoywkzmdgh.supabase.co
//   window.SUPABASE_ANON_KEY     — sb_publishable_...
//
// Public API:
//   window.CTP.supabase.createClient()   → supabase-js client
//   window.CTP.auth.signInWithEmail(email)
//   window.CTP.auth.signInWithGoogle()
//   window.CTP.auth.signOut()
//   window.CTP.auth.onAuthChange(cb)
//   window.CTP.auth.getSession()        → { user, accessToken, plan, creditsRemaining }
//   window.CTP.auth.refreshCredits()    → re-fetch credits row from Supabase

(function () {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.warn('[supabase] credentials missing — auth/credits disabled');
    return;
  }

  // Load supabase-js from CDN (only once)
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) {
        return resolve(window.supabase);
      }
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.async = true;
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('Failed to load supabase-js'));
      document.head.appendChild(s);
    });
  }

  let _client = null;
  let _ready = null;

  async function client() {
    if (_client) return _client;
    if (!_ready) {
      _ready = loadSupabase().then(() => {
        _client = window.supabase.createClient(
          window.SUPABASE_URL,
          window.SUPABASE_ANON_KEY,
          { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
        );
        return _client;
      });
    }
    return _ready;
  }

  // ---- Auth helpers ----

  async function signInWithEmail(email) {
    const c = await client();
    // Magic link — no password needed
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    return { ok: true, message: 'Check your email for the login link.' };
  }

  async function signInWithGoogle() {
    const c = await client();
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  async function signOut() {
    const c = await client();
    const { error } = await c.auth.signOut();
    if (error) throw error;
  }

  function onAuthChange(cb) {
    // Defer until client is ready
    client().then((c) => {
      c.auth.onAuthStateChange((_event, session) => cb(session));
    });
  }

  async function getSession() {
    const c = await client();
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    return data.session; // null if not signed in
  }

  async function refreshCredits() {
    const c = await client();
    const { data: { user } } = await c.auth.getUser();
    if (!user) return null;
    const { data, error } = await c
      .from('user_credits')
      .select('plan, credits, credits_used, period_start')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.warn('[supabase] refreshCredits error', error);
      return null;
    }
    if (!data) return { plan: 'free', credits: 30, credits_used: 0, remaining: 30 };
    // Monthly reset on read
    const period = new Date(data.period_start);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    let remaining = (data.credits || 30) - (data.credits_used || 0);
    if (period < monthStart) remaining = data.credits || 30;
    return { plan: data.plan, remaining };
  }

  async function getFullSession() {
    const session = await getSession();
    if (!session) return null;
    const credits = await refreshCredits();
    return {
      user: session.user,
      accessToken: session.access_token,
      ...credits,
    };
  }

  // ---- Public namespace ----
  window.CTP = window.CTP || {};
  window.CTP.supabase = { createClient: client };
  window.CTP.auth = {
    signInWithEmail,
    signInWithGoogle,
    signOut,
    onAuthChange,
    getSession,
    refreshCredits,
    getFullSession,
  };

  // Signal when supabase-js has loaded
  client().then(() => window.dispatchEvent(new Event('ctp-auth-ready')));
})();
