// ConvertToPodcast - Frontend Script

document.addEventListener('DOMContentLoaded', () => {
  // Elements
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

  let selectedFile = null;
  let currentTab = 'url';

  // Hamburger Menu
  hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));

  // Tab Switching
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

  // URL Input: show/hide clear button
  urlInput.addEventListener('input', () => {
    clearUrl.style.display = urlInput.value ? 'block' : 'none';
  });
  clearUrl.addEventListener('click', () => {
    urlInput.value = '';
    clearUrl.style.display = 'none';
  });

  // PDF Upload
  uploadZone.addEventListener('click', () => pdfInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
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

  // Generate Podcast
  generateBtn.addEventListener('click', generatePodcast);

  async function generatePodcast() {
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

    // Show loading
    setLoading(true);
    hideError();
    resultSection.style.display = 'none';

    try {
      let response;

      if (content.type === 'pdf') {
        const formData = new FormData();
        formData.append('file', content.value);
        formData.append('style', styleSelect.value);
        formData.append('language', langSelect.value);
        formData.append('length', lengthSelect.value);

        response = await fetch('/api/generate', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

      if (!response.ok) {
        throw new Error(data.error || 'Generation failed. Please try again.');
      }

      showResult(data);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function showResult(data) {
    resultSection.style.display = 'block';
    errorSection.style.display = 'none';

    // Update audio source
    const audioSrc = data.audio_url || data.url;
    audioPlayer.src = audioSrc;
    audioPlayer.load();

    // Update download link
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = audioSrc;
      a.download = data.title ? `${data.title}.mp3` : 'podcast.mp3';
      a.click();
    };

    // Update info
    resultInfo.textContent = `${data.title || 'Podcast'} · ${data.duration || ''} · ${data.credits_used || '-'} credits`;

    // Update credit count
    if (data.credits_remaining !== undefined) {
      creditCount.innerHTML = `Free plan: <strong>${data.credits_remaining} credits remaining this month</strong>`;
    }
  }

  // Share URL
  shareBtn.addEventListener('click', async () => {
    const url = audioPlayer.src;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = '✅ Copied!';
      setTimeout(() => { shareBtn.textContent = '🔗 Copy Link'; }, 2000);
    } catch {
      prompt('Copy this link:', url);
    }
  });

  // Regenerate
  regenerateBtn.addEventListener('click', () => {
    resultSection.style.display = 'none';
    window.scrollTo({ top: document.querySelector('.tool-card').offsetTop - 80, behavior: 'smooth' });
  });

  // Helpers
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
});
