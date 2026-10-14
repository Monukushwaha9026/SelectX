// SelectX - Liquid Glass Settings & Preferences

document.addEventListener('DOMContentLoaded', () => {
  const preferredLangSelect = document.getElementById('preferredLang');
  const triggerModeControl = document.getElementById('triggerModeControl');
  const themeSelect = document.getElementById('themeSelect');
  const textSizeSlider = document.getElementById('textSizeSlider');
  const scaleValueLabel = document.getElementById('scaleValueLabel');
  const autoExpandToggle = document.getElementById('autoExpandToggle');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');
  const saveStatus = document.getElementById('saveStatus');

  let currentShowMode = 'both';

  function showStatusSaved(msg = "Settings saved!") {
    saveStatus.textContent = msg;
    saveStatus.style.color = "#007AFF";
    setTimeout(() => {
      saveStatus.textContent = "Settings saved automatically";
      saveStatus.style.color = "";
    }, 1600);
  }

  function applyThemeClass(theme) {
    document.body.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else if (theme === 'dark') {
      document.body.classList.add('theme-dark');
    }
  }

  function updateTriggerSegments(value) {
    currentShowMode = value;
    triggerModeControl.querySelectorAll('.segment-btn').forEach(btn => {
      if (btn.getAttribute('data-value') === value) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Load saved settings
  chrome.storage.sync.get(['preferredLang', 'showMode', 'theme', 'autoExpand', 'fontScale'], (res) => {
    if (res.preferredLang) {
      preferredLangSelect.value = res.preferredLang;
    }
    if (res.showMode) {
      updateTriggerSegments(res.showMode);
    }
    if (res.theme) {
      themeSelect.value = res.theme;
      applyThemeClass(res.theme);
    }
    if (typeof res.autoExpand !== 'undefined') {
      autoExpandToggle.checked = !!res.autoExpand;
    }
    if (res.fontScale) {
      textSizeSlider.value = res.fontScale;
      scaleValueLabel.textContent = `${res.fontScale}%`;
    }
  });

  // Load history from chrome.storage.local
  function loadHistory() {
    chrome.storage.local.get(['history'], (res) => {
      const history = res.history || [];
      if (history.length === 0) {
        historyList.innerHTML = `<div class="history-empty">No recent lookups yet</div>`;
        return;
      }

      historyList.innerHTML = history.map(item => `
        <div class="history-item">
          <div class="history-item-top">
            <span class="history-query" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</span>
            <span class="history-tag">${escapeHtml(item.mode || 'lookup')}</span>
          </div>
          <div class="history-summary">${escapeHtml(item.summary || '')}</div>
        </div>
      `).join('');
    });
  }

  loadHistory();

  // Save changes - Preferred Language
  preferredLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ preferredLang: preferredLangSelect.value }, () => {
      showStatusSaved();
    });
  });

  // Save changes - Segmented Trigger Mode
  triggerModeControl.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-value');
      if (val) {
        updateTriggerSegments(val);
        chrome.storage.sync.set({ showMode: val }, () => {
          showStatusSaved();
        });
      }
    });
  });

  // Save changes - Theme
  themeSelect.addEventListener('change', () => {
    const theme = themeSelect.value;
    applyThemeClass(theme);
    chrome.storage.sync.set({ theme }, () => {
      showStatusSaved();
    });
  });

  // Save changes - Text Size Slider
  textSizeSlider.addEventListener('input', () => {
    const scale = parseInt(textSizeSlider.value, 10) || 100;
    scaleValueLabel.textContent = `${scale}%`;
  });

  textSizeSlider.addEventListener('change', () => {
    const scale = parseInt(textSizeSlider.value, 10) || 100;
    chrome.storage.sync.set({ fontScale: scale }, () => {
      showStatusSaved(`Text size set to ${scale}%`);
    });
  });

  // Save changes - Auto-Expand Toggle
  autoExpandToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ autoExpand: autoExpandToggle.checked }, () => {
      showStatusSaved();
    });
  });

  // Clear history
  clearHistoryBtn.addEventListener('click', () => {
    chrome.storage.local.set({ history: [] }, () => {
      loadHistory();
      showStatusSaved("History cleared");
    });
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
