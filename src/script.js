// converttopodcast.com — Frontend Script
// Includes: tab/upload/generate UX + Supabase auth + credits display

document.addEventListener('DOMContentLoaded', () => {
  // ---- Elements ----
  const tabs = document.querySelectorAll('.tab');
  const panels = {
    url: document.getElementById('panel-url'),
    text: document.getElementById('panel-text'),
    pdf: document.getElementById('panel-pdf'),
  };
  const urlInput = document.getElementById('url-input');
  const textInput = document.getElementById('text-input');
  const pdfInput = document.getElementById('pdf-input');
  const uploadZone = document.getElementById('upload-zone');
  const fileInfo = document.getElementById('file-info');
  const fileName = document.getElementById('file-name');
  const clearFile = document.getElementById('clear-file');
  const clearUrl = document.getElementById('clear-url');
  const styleSelect = document.getElementById('style-select');
  const langSelect = document.getElementById('lang-select');
  const lengthSelect = document.getElementById('length-select');
  const generateBtn = document.getElementById('generate-btn');
  const btnText = generateBtn.querySelector('.btn-text');
  const btnLoading = generateBtn.querySelector('.btn-loading');
  const resultSection = document.getElementById('result-section');
  const errorSection = document.getElementById('error-section');
  const errorText = document.getElementById('error-text');
  const audioPlayer = document.getElementById('audio-player');
  const downloadBtn = document.getElementById('download-btn');
  const shareBtn = document.getElementById('share-btn');
  const regenerateBtn = document.getElementById('regenerate-btn');
  const resultInfo = document.getElementById('result-info');
  const creditCount = document.getElementById('credit-count');
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');

  // Auth nav elements
  const navSignin = document.getElementById('nav-signin');
  const navAccount = document.getElementById('nav-account');
  const navAccountEmail = document.getElementById('nav-account-email');
  const navAccountMenu = document.getElementById('nav-account-menu');
  const navSignout = document.getElementById('nav-signout');
  const navUpgrade = document.getElementById('nav-upgrade');
  const navCreditPill = document.getElementById('nav-credit-pill');
  const navCreditNum = document.getElementById('nav-credit-num');

  // Auth modal elements
  const authModal = document.getElementById('auth-modal');
  const authModalClose = document.getElementById('auth-modal-close');
  const oauthGoogle = document.getElementById('oauth-google');
  const emailForm = document.getElementById('email-form');
  const authEmail = document.getElementById('auth-email');
  const emailFormHint = document.getElementById('email-form-hint');

  let selectedFile = null;
  let currentTab = 'url';
  let currentSession = null; // { user, accessToken, plan, remaining } | null
  let lastResultData = null; // Latest generation result for share/copy

  // ---- Hamburger Menu ----
  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

  // ---- Tab Switching ----
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      Object.values(panels).forEach(p => p.classList.remove('active'));
      currentTab = tab.dataset.tab;
      panels[currentTab].classList.add('active');
    });
  });

  // ---- URL Input ----
  urlInput.addEventListener('input', () => {
    clearUrl.style.display = urlInput.value ? 'block' : 'none';
  });
  clearUrl.addEventListener('click', () => {
    urlInput.value = '';
    clearUrl.style.display = 'none';
  });

  // ---- PDF Upload ----
  uploadZone.addEventListener('click', () => pdfInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragover', () => uploadZone.classList.add('dragover'));
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handlePdfFile(e.dataTransfer.files[0]);
  });
  pdfInput.addEventListener('change', () => {
    if (pdfInput.files.length) handlePdfFile(pdfInput.files[0]);
  });

  function handlePdfFile(file) {
    if (file.size > 10 * 1024 * 1024) {
      showError('File too large. Max 10MB.');
      return;
    }
    selectedFile = file;
    fileName.textContent = `📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    fileInfo.style.display = 'flex';
    uploadZone.style.display = 'none';
  }

  clearFile.addEventListener('click', () => {
    selectedFile = null;
    pdfInput.value = '';
    fileInfo.style.display = 'none';
    uploadZone.style.display = 'block';
  });

  // ---- Generate Podcast ----
  generateBtn.addEventListener('click', generatePodcast);

  async function generatePodcast() {
    // Auth gate — anonymous usage disabled (2026-06-17).
    // If not signed in, open the auth modal and abort.
    if (!currentSession?.accessToken) {
      openAuthModal();
      showError('Please sign in to generate podcasts. It only takes a second.');
      return;
    }

    // Validate input
    let content;
    if (currentTab === 'url') {
      const url = urlInput.value.trim();
      if (!url || !isValidUrl(url)) {
        showError('Please enter a valid URL.');
        return;
      }
      content = { type: 'url', value: url };
    } else if (currentTab === 'text') {
      const text = textInput.value.trim();
      if (text.length < 50) {
        showError('Please enter at least 50 characters of text.');
        return;
      }
      content = { type: 'text', value: text };
    } else if (currentTab === 'pdf') {
      if (!selectedFile) {
        showError('Please select a PDF file.');
        return;
      }
      content = { type: 'pdf', value: selectedFile };
    } else {
      showError('Please select an input method.');
      return;
    }

    setLoading(true);
    hideError();
    resultSection.style.display = 'none';

    try {
      let response;

      // Build headers — always attach Bearer token if signed in
      const headers = currentSession?.accessToken
        ? { 'Authorization': `Bearer ${currentSession.accessToken}` }
        : {};

      if (content.type === 'pdf') {
        const formData = new FormData();
        formData.append('file', content.value);
        formData.append('style', styleSelect.value);
        formData.append('language', langSelect.value);
        formData.append('length', lengthSelect.value);
        response = await fetch('/api/generate', {
          method: 'POST',
          headers,  // FormData sets Content-Type itself
          body: formData,
        });
      } else {
        response = await fetch('/api/generate', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: content.type,
            content: content.value,
            style: styleSelect.value,
            language: langSelect.value,
            length: lengthSelect.value,
          }),
        });
      }

      const data = await response.json();

      if (response.status === 401 && (data.code === 'auth_required' || data.code === 'auth_invalid')) {
        // Session missing/expired — kick user back to auth modal
        showError(data.message || 'Please sign in to continue.');
        openAuthModal();
        return;
      }

      if (response.status === 402) {
        // Insufficient credits — show CTA to upgrade
        showError(
          (data.error || 'Insufficient credits.') +
          ' Upgrade your plan for more credits.'
        );
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Generation failed. Please try again.');
      }

      showResult(data);
      // Refresh credit display after a successful generation
      await refreshAndRenderCredits();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function showResult(data) {
    resultSection.style.display = 'block';
    errorSection.style.display = 'none';
    lastResultData = data;

    const audioSrc = data.audio_url || data.url;
    audioPlayer.src = audioSrc;
    audioPlayer.load();

    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = audioSrc;
      a.download = data.title ? `${data.title}.mp3` : 'podcast.mp3';
      a.click();
    };

    resultInfo.textContent = `${data.title || 'Podcast'} · ${data.duration || ''} · ${data.credits_used || '-'} credits`;

    if (data.credits_remaining !== undefined) {
      creditCount.innerHTML = `Your plan: <strong>${data.credits_remaining} credits remaining this month</strong>`;
    }
    // Show storage error if any
    if (data.upload_error) {
      console.warn('Storage upload error:', data.upload_error);
    }
  }

  // ---- Share / Regenerate ----
  shareBtn.addEventListener('click', async () => {
    const result = lastResultData;
    try {
      const url = result?.share_url || result?.audio_url || '';
      if (!url || url.startsWith('data:')) {
        const err = result?.upload_error;
        if (err) {
          shareBtn.textContent = '⚠️ ' + err.slice(0, 40);
        } else {
          shareBtn.textContent = '⚠️ No share link';
        }
        setTimeout(() => { shareBtn.textContent = '📋 Copy Link'; }, 4000);
        return;
      }
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = '✅ Copied!';
      setTimeout(() => { shareBtn.textContent = '📋 Copy Link'; }, 2000);
    } catch {
      shareBtn.textContent = '⚠️ Copy failed';
      setTimeout(() => { shareBtn.textContent = '📋 Copy Link'; }, 2000);
    }
  });

  regenerateBtn.addEventListener('click', () => {
    resultSection.style.display = 'none';
    window.scrollTo({ top: document.querySelector('.tool-card').offsetTop - 80, behavior: 'smooth' });
  });

  // ---- Helpers ----
  function setLoading(loading) {
    generateBtn.disabled = loading;
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoading.style.display = loading ? 'inline-flex' : 'none';
  }

  function showError(msg) {
    errorSection.style.display = 'block';
    errorText.textContent = msg;
    resultSection.style.display = 'none';
  }

  function hideError() {
    errorSection.style.display = 'none';
  }

  function isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // ---- Auth UI ----
  function openAuthModal() {
    authModal.style.display = 'flex';
    emailFormHint.textContent = '';
    authEmail.value = '';
  }
  function closeAuthModal() {
    authModal.style.display = 'none';
  }

  navSignin.addEventListener('click', openAuthModal);
  authModalClose.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });

  oauthGoogle.addEventListener('click', async () => {
    try {
      await window.CTP.auth.signInWithGoogle();
    } catch (e) {
      emailFormHint.textContent = 'Google sign-in failed: ' + e.message;
    }
  });

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    if (!email) return;
    emailFormHint.textContent = 'Sending magic link…';
    try {
      const r = await window.CTP.auth.signInWithEmail(email);
      emailFormHint.textContent = r.message;
      emailFormHint.style.color = '#10b981';
    } catch (e) {
      emailFormHint.textContent = 'Error: ' + e.message;
      emailFormHint.style.color = '#ef4444';
    }
  });

  navAccount.addEventListener('click', (e) => {
    e.stopPropagation();
    navAccountMenu.style.display =
      navAccountMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => {
    navAccountMenu.style.display = 'none';
  });

  navSignout.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await window.CTP.auth.signOut();
    } catch (err) {
      console.error(err);
    }
  });

  navUpgrade.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/pricing/'; // create this page later
  });

  // ---- Session / credits rendering ----
  function renderAuthState() {
    if (currentSession && currentSession.user) {
      const email = currentSession.user.email || 'Account';
      navSignin.style.display = 'none';
      navAccount.style.display = 'inline-flex';
      navAccountEmail.textContent = email.split('@')[0];
      navCreditPill.style.display = 'inline-flex';
      const remaining = currentSession.remaining ?? 30;
      navCreditNum.textContent = remaining;
      creditCount.innerHTML = `Your plan: <strong>${remaining} credits remaining this month</strong>`;
    } else {
      navSignin.style.display = 'inline-flex';
      navAccount.style.display = 'none';
      navCreditPill.style.display = 'none';
      // Anonymous state — invite to sign up so they can start using the tool
      creditCount.innerHTML = `<a href="#" id="credit-cta-inline">Sign up free</a> to get <strong>30 credits/month</strong>. 1 credit = 1 minute of audio.`;
      // Wire the inline CTA to open the auth modal
      const cta = document.getElementById('credit-cta-inline');
      if (cta) cta.addEventListener('click', (e) => { e.preventDefault(); openAuthModal(); });
    }
  }

  async function refreshAndRenderCredits() {
    if (!window.CTP) return;
    try {
      currentSession = await window.CTP.auth.getFullSession();
    } catch (e) {
      console.warn('getFullSession failed', e);
    }
    renderAuthState();
  }

  // ---- Init: wait for supabase-js, then wire up auth listener ----
  if (window.CTP && window.CTP.auth) {
    // Wait for supabase-js to finish loading (CDN script), THEN pull session
    // and register the auth-change listener. detectSessionInUrl needs the
    // client fully constructed to parse #access_token from the OAuth callback.
    window.CTP.supabase.createClient().then(() => {
      refreshAndRenderCredits();
      window.CTP.auth.onAuthChange((session) => {
        refreshAndRenderCredits();
        if (session) closeAuthModal();
      });
    });

    // Wire the static "Sign up free" CTA in the tool card (only present when
    // server-rendered HTML showed the anonymous state, before renderAuthState runs)
    const cta = document.getElementById('credit-cta');
    if (cta) cta.addEventListener('click', (e) => { e.preventDefault(); openAuthModal(); });
  } else {
    // Supabase env not configured — show anonymous state
    renderAuthState();
  }
});
