// SelectX - Content Script (Concept UI Match + Translation on Top + Option C Streaming + 500 Word Limit)
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__SELECTX_INJECTED__) return;
  window.__SELECTX_INJECTED__ = true;

  // Language mapping
  const LANG_NAMES = {
    'hi': 'Hindi',
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'ja': 'Japanese',
    'bn': 'Bengali',
    'mr': 'Marathi'
  };

  const LANG_SPEECH_MAP = {
    'hi': 'hi-IN',
    'en': 'en-US',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'de': 'de-DE',
    'ja': 'ja-JP',
    'bn': 'bn-IN',
    'mr': 'mr-IN'
  };

  // Fast In-Memory Script Cache (<10ms instant response)
  const localDefCache = new Map();
  const localTransCache = new Map();

  // State
  let hostElement = null;
  let shadowRoot = null;
  let floatingBtn = null;
  let cardElement = null;
  let currentSelectionText = '';
  let currentWordCount = 0;
  let activeTab = 'define'; // 'define' | 'translate'
  let cachedDefinitionData = null;
  let cachedTranslationData = null;
  let selectionDebounceTimer = null;
  let lastSelectionCoords = { x: 0, y: 0, rect: null, scrollY: 0 };
  let currentAudio = null;
  let isDraggingCard = false;

  // Settings
  let preferredLang = 'hi';
  let showMode = 'both';
  let theme = 'light';
  let autoExpand = true;
  let fontScale = 100;

  function loadSettings() {
    chrome.storage.sync.get(['preferredLang', 'showMode', 'theme', 'autoExpand', 'fontScale'], (res) => {
      if (res.preferredLang) preferredLang = res.preferredLang;
      if (res.showMode) showMode = res.showMode;
      if (res.theme) theme = res.theme;
      if (typeof res.autoExpand !== 'undefined') autoExpand = !!res.autoExpand;
      if (res.fontScale) fontScale = res.fontScale;
      applyTheme();
      applyFontScale();
    });
  }

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.preferredLang) preferredLang = changes.preferredLang.newValue;
      if (changes.showMode) showMode = changes.showMode.newValue;
      if (typeof changes.autoExpand !== 'undefined') autoExpand = !!changes.autoExpand.newValue;
      if (changes.fontScale) {
        fontScale = changes.fontScale.newValue;
        applyFontScale();
      }
      if (changes.theme) {
        theme = changes.theme.newValue;
        applyTheme();
      }
    }
  });

  function applyFontScale() {
    if (cardElement) {
      cardElement.style.setProperty('--sx-font-scale', (fontScale / 100).toString());
    }
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (theme === 'system') applyTheme();
  });

  loadSettings();

  // Initialize Host & Shadow DOM
  function ensureShadowDOM() {
    if (!hostElement) {
      hostElement = document.createElement('div');
      hostElement.id = 'selectx-root-container';
      hostElement.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
      document.documentElement.appendChild(hostElement);
      shadowRoot = hostElement.attachShadow({ mode: 'open' });

      const styleEl = document.createElement('style');
      styleEl.textContent = getEmbeddedStyles();
      shadowRoot.appendChild(styleEl);
    }
  }

  function getEffectiveTheme() {
    if (theme === 'dark') return 'theme-dark';
    if (theme === 'light') return 'theme-light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'theme-dark' : 'theme-light';
  }

  function applyTheme() {
    const eff = getEffectiveTheme();
    if (shadowRoot && cardElement) {
      cardElement.className = `sx-card ${eff}`;
    }
    if (shadowRoot && floatingBtn) {
      floatingBtn.className = `sx-floating-btn ${eff}`;
    }
  }

  // Global Keydown (Escape, Arrow Nudge & Arrow Resize)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideFloatingBtn();
      hideCard();
      return;
    }

    if (cardElement && cardElement.style.display !== 'none') {
      const rect = cardElement.getBoundingClientRect();
      let handled = false;

      // Resizing via Shift+Arrow or Ctrl+Arrow
      if (e.shiftKey || e.ctrlKey || e.altKey) {
        const resizeStep = 24;
        const minW = 280, maxW = Math.min(800, window.innerWidth - 32);
        const minH = 200, maxH = Math.min(700, window.innerHeight - 32);

        if (e.key === 'ArrowRight') {
          const newW = Math.min(maxW, Math.max(minW, rect.width + resizeStep));
          cardElement.style.width = `${newW}px`;
          handled = true;
        } else if (e.key === 'ArrowLeft') {
          const newW = Math.max(minW, rect.width - resizeStep);
          cardElement.style.width = `${newW}px`;
          handled = true;
        } else if (e.key === 'ArrowDown') {
          const newH = Math.min(maxH, Math.max(minH, rect.height + resizeStep));
          cardElement.style.height = `${newH}px`;
          handled = true;
        } else if (e.key === 'ArrowUp') {
          const newH = Math.max(minH, rect.height - resizeStep);
          cardElement.style.height = `${newH}px`;
          handled = true;
        }
      } else {
        // Moving / Nudging card with Arrow keys
        const moveStep = 15;
        if (e.key === 'ArrowLeft') {
          const newLeft = Math.max(16, rect.left - moveStep);
          cardElement.style.left = `${newLeft}px`;
          handled = true;
        } else if (e.key === 'ArrowRight') {
          const newLeft = Math.min(window.innerWidth - rect.width - 16, rect.left + moveStep);
          cardElement.style.left = `${newLeft}px`;
          handled = true;
        } else if (e.key === 'ArrowUp') {
          const newTop = Math.max(16, rect.top - moveStep);
          cardElement.style.top = `${newTop}px`;
          handled = true;
        } else if (e.key === 'ArrowDown') {
          const newTop = Math.min(window.innerHeight - 40, rect.top + moveStep);
          cardElement.style.top = `${newTop}px`;
          handled = true;
        }
      }

      if (handled && !isInputOrEditable(e.target)) {
        e.preventDefault();
      }
    }
  }, true);

  // Outside click to dismiss (only if not starting a new text selection)
  let mouseDownPos = { x: 0, y: 0 };
  let cardVisibleOnMouseDown = false;

  document.addEventListener('mousedown', (e) => {
    if (isDraggingCard) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (hostElement && path.includes(hostElement)) {
      return;
    }
    mouseDownPos = { x: e.clientX, y: e.clientY };
    cardVisibleOnMouseDown = (cardElement && cardElement.style.display !== 'none');
    hideFloatingBtn();
  });

  // On scroll: Auto dismiss if original selection scrolls > 200px away
  window.addEventListener('scroll', () => {
    if (cardElement && cardElement.style.display !== 'none' && lastSelectionCoords.scrollY) {
      const deltaScroll = Math.abs(window.scrollY - lastSelectionCoords.scrollY);
      if (deltaScroll > 200) {
        hideCard();
      }
    }
  }, { passive: true });

  // Fast 60ms debounced selection listener
  document.addEventListener('mouseup', (e) => {
    if (isDraggingCard) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (hostElement && path.includes(hostElement)) {
      return;
    }
    if (selectionDebounceTimer) clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      handleSelection(e);
    }, 60);
  });

  function isInputOrEditable(element) {
    if (!element) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || element.isContentEditable;
  }

  function handleSelection(e) {
    if (hostElement && e && e.composedPath().includes(hostElement)) return;
    if (e && isInputOrEditable(e.target)) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideFloatingBtn();
      // If user simply clicked outside without selecting text, dismiss the card
      const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
      if (dist < 6 && cardVisibleOnMouseDown) {
        hideCard();
      }
      return;
    }

    const text = selection.toString().trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 1) {
      hideFloatingBtn();
      return;
    }
    if (words.length > 500) {
      hideFloatingBtn();
      showToast("Selection exceeds 500-word limit (" + words.length + " words)");
      return;
    }

    if (showMode === 'contextOnly') return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    currentSelectionText = text;
    currentWordCount = words.length;

    // Check if card was already visible when user started this selection
    const isCardAlreadyOpen = cardVisibleOnMouseDown || (cardElement && cardElement.style.display !== 'none');

    if (isCardAlreadyOpen) {
      // User requested: Card is already appearing, instantly update card with the new word without pressing floating button
      lastSelectionCoords = { x: rect.left, y: rect.bottom, rect: rect, scrollY: window.scrollY };
      triggerCardDisplay(text);
    } else {
      showFloatingButton(rect);
    }
  }

  // Floating Button creation & positioning
  function showFloatingButton(rect) {
    ensureShadowDOM();
    hideCard();

    if (!floatingBtn) {
      floatingBtn = document.createElement('div');
      floatingBtn.className = `sx-floating-btn ${getEffectiveTheme()}`;
      floatingBtn.title = 'SelectX: Translate / Define';
      floatingBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="sx-sf-icon">
          <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
        </svg>
      `;
      const handleTrigger = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        floatingBtn.classList.add('is-pressed');
        setTimeout(() => {
          if (floatingBtn) floatingBtn.classList.remove('is-pressed');
          triggerCardDisplay();
        }, 60);
      };
      floatingBtn.addEventListener('click', handleTrigger);
      shadowRoot.appendChild(floatingBtn);
    }

    const btnSize = 36;
    const padding = 8;
    let top = rect.top - btnSize - padding;
    let left = rect.left + (rect.width / 2) - (btnSize / 2);

    if (top < 16) {
      top = rect.bottom + padding;
    }

    if (left < 16) left = 16;
    if (left + btnSize > window.innerWidth - 16) {
      left = window.innerWidth - btnSize - 16;
    }

    lastSelectionCoords = { x: left, y: top, rect: rect, scrollY: window.scrollY };

    floatingBtn.style.top = `${top}px`;
    floatingBtn.style.left = `${left}px`;
    floatingBtn.style.display = 'flex';
  }

  function hideFloatingBtn() {
    if (floatingBtn) {
      floatingBtn.style.display = 'none';
    }
  }

  function hideCard() {
    if (activeStreamTimer) {
      clearInterval(activeStreamTimer);
      activeStreamTimer = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (cardElement && cardElement.style.display !== 'none') {
      cardElement.classList.add('is-dismissing');
      setTimeout(() => {
        if (cardElement) {
          cardElement.style.display = 'none';
          cardElement.classList.remove('is-dismissing');
        }
      }, 180);
    }
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }

  // Toast notification for user feedback (e.g. 500 word limit)
  let activeToast = null;
  function showToast(message) {
    ensureShadowDOM();
    if (activeToast) activeToast.remove();
    const toast = document.createElement('div');
    toast.className = `sx-toast ${getEffectiveTheme()}`;
    toast.textContent = message;
    shadowRoot.appendChild(toast);
    activeToast = toast;
    setTimeout(() => {
      if (toast) {
        toast.classList.add('is-dismissing');
        setTimeout(() => toast.remove(), 250);
      }
    }, 2800);
  }

  // Trigger Card display
  function triggerCardDisplay(customText) {
    if (activeStreamTimer) {
      clearInterval(activeStreamTimer);
      activeStreamTimer = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (customText) {
      currentSelectionText = customText.trim();
      currentWordCount = currentSelectionText.split(/\s+/).filter(Boolean).length;
    }
    if (!currentSelectionText) return;

    hideFloatingBtn();
    ensureShadowDOM();

    activeTab = currentWordCount <= 2 ? 'define' : 'translate';
    cachedDefinitionData = null;
    cachedTranslationData = null;

    renderCardSkeleton();
    positionCard();
    fetchCardData();
  }

  // Position Card with dynamic viewport awareness & bidirectional expansion
  function positionCard() {
    if (!cardElement) return;

    // Calculate smart width based on selection length:
    // Short word (explain): ~320px
    // Paragraph (You hear a calm voice...): ~440px - 480px
    let cardWidth = 330;
    if (currentWordCount <= 2) {
      cardWidth = 320;
    } else if (currentWordCount <= 8) {
      cardWidth = 360;
    } else if (currentWordCount <= 25) {
      cardWidth = 420;
    } else {
      cardWidth = 470;
    }

    const padding = 10;
    const marginEdge = 18;

    // Set dynamic max-height based on available viewport
    const maxAvailableH = Math.max(260, window.innerHeight - 36);
    cardElement.style.maxHeight = `${maxAvailableH}px`;

    // Reset inline width/height on fresh open so it auto-fits unless user drags resize
    if (!cardElement.classList.contains('has-custom-size')) {
      cardElement.style.width = `${cardWidth}px`;
      cardElement.style.height = 'auto';
    } else {
      cardWidth = cardElement.offsetWidth || cardWidth;
    }

    let targetX = lastSelectionCoords.x;
    let targetY = lastSelectionCoords.y;

    if (lastSelectionCoords.rect) {
      const r = lastSelectionCoords.rect;

      // Horizontal alignment: Center relative to selection if selection is narrower than card
      if (r.width < cardWidth) {
        targetX = r.left + (r.width / 2) - (cardWidth / 2);
      } else {
        targetX = r.left;
      }

      // Vertical positioning: Check if selection is in lower half of the screen
      const isLowerHalf = r.bottom > (window.innerHeight * 0.52);

      if (isLowerHalf) {
        // Place above the selected text so it expands upward safely
        const estH = cardElement.offsetHeight || (currentWordCount > 8 ? 360 : 220);
        targetY = Math.max(marginEdge, r.top - estH - padding);
      } else {
        // Place below the selected text
        targetY = r.bottom + padding;
      }
    }

    // Viewport horizontal edge boundaries
    if (targetX + cardWidth > window.innerWidth - marginEdge) {
      targetX = window.innerWidth - cardWidth - marginEdge;
    }
    if (targetX < marginEdge) {
      targetX = marginEdge;
    }

    cardElement.style.left = `${Math.round(targetX)}px`;
    cardElement.style.top = `${Math.round(targetY)}px`;
    cardElement.style.display = 'flex';

    // Verify and clamp position after content renders
    requestAnimationFrame(() => {
      clampCardToViewport();
    });
  }

  // Ensures 100% of the card is visible on screen, never cut off by taskbar or header
  function clampCardToViewport() {
    if (!cardElement || cardElement.style.display === 'none') return;
    const rect = cardElement.getBoundingClientRect();
    const marginEdge = 16;
    let newTop = rect.top;

    // If bottom edge falls off screen (e.g. into taskbar)
    if (rect.bottom > window.innerHeight - marginEdge) {
      newTop = Math.max(marginEdge, window.innerHeight - rect.height - marginEdge);
      cardElement.style.top = `${Math.round(newTop)}px`;
    }

    // If top edge is pushed off screen
    if (newTop < marginEdge) {
      cardElement.style.top = `${marginEdge}px`;
    }
  }

  // Build card structure
  function renderCardSkeleton() {
    if (!cardElement) {
      cardElement = document.createElement('div');
      shadowRoot.appendChild(cardElement);
    }

    const themeClass = getEffectiveTheme();
    cardElement.className = `sx-card ${themeClass}`;
    applyFontScale();

    cardElement.innerHTML = `
      <div class="sx-header" title="Drag to move">
        <div class="sx-tabs">
          <button class="sx-tab-btn ${activeTab === 'define' ? 'active' : ''}" data-tab="define">Define</button>
          <button class="sx-tab-btn ${activeTab === 'translate' ? 'active' : ''}" data-tab="translate">Translate</button>
        </div>
      </div>

      <div class="sx-body">
        <div class="sx-skeleton sx-skel-title"></div>
        <div class="sx-skeleton sx-skel-line"></div>
        <div class="sx-skeleton sx-skel-short"></div>
      </div>

      <div class="sx-footer">
        <button class="sx-btn sx-footer-copy-btn">
          <svg viewBox="0 0 24 24" class="sx-btn-icon">
            <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <span>Copy</span>
        </button>
      </div>

      <!-- Interactive Resize Handles -->
      <div class="sx-resize-handle sx-resize-r" title="Drag to resize width"></div>
      <div class="sx-resize-handle sx-resize-b" title="Drag to resize height"></div>
      <div class="sx-resize-handle sx-resize-br" title="Drag to resize">
        <svg viewBox="0 0 6 6" class="sx-resize-grip">
          <line x1="5" y1="1" x2="1" y2="5" stroke="currentColor" stroke-width="1.2"/>
          <line x1="5" y1="3.5" x2="3.5" y2="5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </div>
    `;

    // Prevent clicks inside card from bubbling to document
    ['mousedown', 'mouseup', 'click'].forEach(evt => {
      cardElement.addEventListener(evt, (e) => {
        e.stopPropagation();
      });
    });

    setupDraggableCard();
    setupResizableCard();

    // Tab buttons event listeners
    cardElement.querySelectorAll('.sx-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tab = btn.getAttribute('data-tab');
        if (tab && tab !== activeTab) {
          if (activeStreamTimer) {
            clearInterval(activeStreamTimer);
            activeStreamTimer = null;
          }
          if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          activeTab = tab;
          updateTabButtons();
          renderActiveView();
        }
      });
    });

    // Footer actions
    const footerCopyBtn = cardElement.querySelector('.sx-footer-copy-btn');
    footerCopyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      let textToCopy = '';

      if (activeTab === 'translate') {
        const streamSlot = cardElement.querySelector('.sx-trans-stream-slot');
        if (cachedTranslationData?.translatedText) {
          textToCopy = cachedTranslationData.translatedText;
        } else if (streamSlot && streamSlot.textContent.trim()) {
          textToCopy = streamSlot.textContent.trim();
        } else {
          textToCopy = currentSelectionText;
        }
      } else {
        // Define view
        const headline = cardElement.querySelector('.sx-original-headline')?.textContent.trim() || cachedDefinitionData?.word || currentSelectionText;
        const transText = cardElement.querySelector('.sx-translation-text')?.textContent.trim() || cachedDefinitionData?.translation || '';
        const defText = cardElement.querySelector('.sx-definition-preview')?.textContent.trim() || cachedDefinitionData?.meanings?.[0]?.definitions?.[0]?.definition || '';
        
        if (transText && transText !== '...') {
          textToCopy = `${headline} - ${transText}${defText ? ' (' + defText + ')' : ''}`;
        } else if (defText) {
          textToCopy = `${headline}: ${defText}`;
        } else {
          textToCopy = headline;
        }
      }

      copyToClipboard(textToCopy, footerCopyBtn);
    });
  }

  function updateTabButtons() {
    if (!cardElement) return;
    cardElement.querySelectorAll('.sx-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === activeTab);
    });
  }

  // Interactive Mouse Resize Handler for sides & corner
  function setupResizableCard() {
    if (!cardElement) return;
    const handles = cardElement.querySelectorAll('.sx-resize-handle');

    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDraggingCard = true;

        const isRight = handle.classList.contains('sx-resize-r') || handle.classList.contains('sx-resize-br');
        const isBottom = handle.classList.contains('sx-resize-b') || handle.classList.contains('sx-resize-br');

        const startX = e.clientX;
        const startY = e.clientY;
        const startRect = cardElement.getBoundingClientRect();

        cardElement.classList.add('is-resizing');

        const onResizeMove = (ev) => {
          if (ev.buttons === 0) {
            onResizeUp();
            return;
          }
          if (isRight) {
            const deltaX = ev.clientX - startX;
            const newW = Math.max(280, Math.min(window.innerWidth - startRect.left - 16, startRect.width + deltaX));
            cardElement.style.width = `${newW}px`;
            cardElement.classList.add('has-custom-size');
          }
          if (isBottom) {
            const deltaY = ev.clientY - startY;
            const newH = Math.max(160, Math.min(window.innerHeight - startRect.top - 16, startRect.height + deltaY));
            cardElement.style.height = `${newH}px`;
            cardElement.classList.add('has-custom-size');
          }
        };

        const onResizeUp = () => {
          cardElement.classList.remove('is-resizing');
          window.removeEventListener('mousemove', onResizeMove);
          window.removeEventListener('mouseup', onResizeUp);
          document.removeEventListener('mousemove', onResizeMove);
          document.removeEventListener('mouseup', onResizeUp);
          setTimeout(() => {
            isDraggingCard = false;
          }, 100);
        };

        window.addEventListener('mousemove', onResizeMove);
        window.addEventListener('mouseup', onResizeUp);
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeUp);
      });
    });
  }

  // macOS Window Dragging Behavior
  function setupDraggableCard() {
    if (!cardElement) return;
    const header = cardElement.querySelector('.sx-header');
    if (!header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let moveHandler = null;
    let upHandler = null;

    const onMouseDown = (e) => {
      if (e.target.closest('.sx-tab-btn') || e.target.closest('.sx-btn') || e.target.closest('a')) return;
      isDragging = true;
      isDraggingCard = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = cardElement.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      cardElement.classList.add('is-dragging');

      moveHandler = (ev) => {
        if (!isDragging) return;
        if (ev.buttons === 0) {
          upHandler();
          return;
        }
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let nl = initialLeft + dx;
        let nt = initialTop + dy;

        const cr = cardElement.getBoundingClientRect();
        const maxLeft = window.innerWidth - cr.width - 16;
        const maxTop = window.innerHeight - 40;

        nl = Math.max(16, Math.min(nl, maxLeft));
        nt = Math.max(16, Math.min(nt, maxTop));

        cardElement.style.left = `${nl}px`;
        cardElement.style.top = `${nt}px`;
        cardElement.style.right = 'auto';
        cardElement.style.bottom = 'auto';
      };

      upHandler = () => {
        if (!isDragging) return;
        isDragging = false;
        cardElement.classList.remove('is-dragging');
        if (moveHandler) {
          window.removeEventListener('mousemove', moveHandler);
          document.removeEventListener('mousemove', moveHandler);
        }
        window.removeEventListener('mouseup', upHandler);
        document.removeEventListener('mouseup', upHandler);
        setTimeout(() => {
          isDraggingCard = false;
        }, 100);
      };

      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', upHandler);
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      e.preventDefault();
      e.stopPropagation();
    };

    if (header._selectxMouseDown) {
      header.removeEventListener('mousedown', header._selectxMouseDown);
    }
    header._selectxMouseDown = onMouseDown;
    header.addEventListener('mousedown', onMouseDown);
  }

  function fetchCardData() {
    const t = currentSelectionText;
    if (activeTab === 'define') {
      fetchDefinition(t);
    } else {
      fetchTranslation(t);
    }
  }

  function renderLoadingView() {
    if (!cardElement) return;
    const body = cardElement.querySelector('.sx-body');
    if (body) {
      body.innerHTML = `
        <div class="sx-skeleton sx-skel-title"></div>
        <div class="sx-skeleton sx-skel-line"></div>
        <div class="sx-skeleton sx-skel-short"></div>
      `;
    }
  }

  function renderActiveView() {
    if (!cardElement) return;
    if (activeTab === 'define') {
      if (cachedDefinitionData) {
        renderDefinitionView(cachedDefinitionData);
      } else {
        renderLoadingView();
        fetchDefinition(currentSelectionText);
      }
    } else {
      if (cachedTranslationData) {
        renderTranslationView(cachedTranslationData);
      } else {
        renderLoadingView();
        fetchTranslation(currentSelectionText);
      }
    }
  }

  // Fast Definition Fetch
  function fetchDefinition(word) {
    const rawFirstWord = word.split(/\s+/)[0].trim();
    const cleanWord = rawFirstWord.replace(/[^a-zA-Z\u0900-\u097F-]/g, '').toLowerCase();

    if (!cleanWord) {
      activeTab = 'translate';
      updateTabButtons();
      fetchTranslation(word);
      return;
    }

    const selectionAtStart = currentSelectionText;

    if (localDefCache.has(cleanWord)) {
      cachedDefinitionData = localDefCache.get(cleanWord);
      if (activeTab === 'define') renderDefinitionView(cachedDefinitionData);
      return;
    }

    renderLoadingView();

    chrome.runtime.sendMessage({ type: 'DEFINE', word: cleanWord }, (response) => {
      if (!cardElement || !shadowRoot || !shadowRoot.contains(cardElement)) return;
      if (chrome.runtime.lastError || currentSelectionText !== selectionAtStart) return;

      if (response?.success && response.data?.length > 0) {
        cachedDefinitionData = response.data[0];
        localDefCache.set(cleanWord, cachedDefinitionData);

        if (activeTab === 'define') {
          renderDefinitionView(cachedDefinitionData);
        }

        // Parallel translation
        chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          text: rawFirstWord,
          targetLang: preferredLang || 'hi'
        }, (transRes) => {
          if (chrome.runtime.lastError || currentSelectionText !== selectionAtStart) return;
          if (transRes?.success) {
            cachedDefinitionData.translation = transRes.translatedText;
            if (activeTab === 'define' && shadowRoot.contains(cardElement)) {
              renderDefinitionView(cachedDefinitionData);
            }
          }
        });
      } else {
        handleFallbackTranslation(word, "No dictionary definition found. Showing translation:");
      }
    });
  }

  function handleFallbackTranslation(text, notice) {
    const selectionAtStart = currentSelectionText;
    chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      text: text,
      targetLang: preferredLang || 'hi'
    }, (transRes) => {
      if (!cardElement || !shadowRoot || !shadowRoot.contains(cardElement)) return;
      if (currentSelectionText !== selectionAtStart) return;
      if (chrome.runtime.lastError) {
        renderErrorView("Failed to fetch translation.");
        return;
      }

      activeTab = 'translate';
      updateTabButtons();
      cachedTranslationData = transRes?.success ? transRes : null;
      renderTranslationView(cachedTranslationData, notice);
    });
  }

  function fetchTranslation(text) {
    if (!text) return;
    const selectionAtStart = currentSelectionText;
    const cacheKey = `${text}:${preferredLang}`;

    if (localTransCache.has(cacheKey)) {
      cachedTranslationData = localTransCache.get(cacheKey);
      if (activeTab === 'translate') renderTranslationView(cachedTranslationData);
      return;
    }

    renderLoadingView();

    chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      text: text,
      targetLang: preferredLang || 'hi',
      sourceLang: 'auto'
    }, (res) => {
      if (!cardElement || !shadowRoot || !shadowRoot.contains(cardElement)) return;
      if (currentSelectionText !== selectionAtStart) return;

      if (chrome.runtime.lastError) {
        if (activeTab === 'translate') renderErrorView(chrome.runtime.lastError.message);
        return;
      }

      if (res?.success) {
        cachedTranslationData = res;
        localTransCache.set(cacheKey, res);
        if (activeTab === 'translate') renderTranslationView(res);
      } else {
        if (activeTab === 'translate') renderErrorView(res?.error || "Translation failed. Check network or API limit.");
      }
    });
  }

  // Render Definition View
  function renderDefinitionView(data) {
    if (!cardElement) return;
    const body = cardElement.querySelector('.sx-body');
    if (!body) return;

    const word = data.word || currentSelectionText;
    let audioUrl = data.phonetics?.find(p => p.audio)?.audio || '';
    if (audioUrl.startsWith('http://')) audioUrl = audioUrl.replace('http://', 'https://');

    const firstMeaning = data.meanings?.[0];
    const pos = firstMeaning?.partOfSpeech || 'general';
    const defs = (firstMeaning?.definitions || []).slice(0, 2);
    const langName = LANG_NAMES[preferredLang] || preferredLang.toUpperCase();

    body.innerHTML = `
      <div class="sx-section-block">
        <div class="sx-section-header">
          <span class="sx-section-label">ORIGINAL</span>
          <div class="sx-speaker-wrap">
            ${audioUrl ? `
              <button class="sx-speaker-icon-btn sx-play-audio-btn" title="Pronounce">
                <svg viewBox="0 0 24 24" class="sx-speaker-svg">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </button>
            ` : `
              <button class="sx-speaker-icon-btn sx-speak-btn" title="Speak">
                <svg viewBox="0 0 24 24" class="sx-speaker-svg">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
              </button>
            `}
          </div>
        </div>
        <div class="sx-original-headline">${escapeHtml(word)}</div>
      </div>

      <div class="sx-hairline-sep"></div>

      <div class="sx-section-block">
        <div class="sx-section-header">
          <span class="sx-section-label sx-blue-label">${escapeHtml(langName.toUpperCase())} TRANSLATION</span>
        </div>
        <div class="sx-translation-text">${escapeHtml(data.translation || '...')}</div>
      </div>

      ${defs.length > 0 ? `
        <div class="sx-meaning-drawer">
          <span class="sx-pos-tag">${escapeHtml(pos)}</span>
          <p class="sx-definition-preview">${escapeHtml(defs[0].definition)}</p>
        </div>
      ` : ''}
    `;

    if (audioUrl) {
      body.querySelector('.sx-play-audio-btn')?.addEventListener('click', (ev) => {
        animateAudioWave(ev.currentTarget);
        playAudio(audioUrl);
      });
    } else {
      body.querySelector('.sx-speak-btn')?.addEventListener('click', (ev) => {
        animateAudioWave(ev.currentTarget);
        speakText(word, 'en-US');
      });
    }

    requestAnimationFrame(() => {
      clampCardToViewport();
    });
  }

  // Progressive word-by-word streaming that naturally grows the card height as words appear
  let activeStreamTimer = null;

  function streamTextIntoElement(containerEl, text) {
    if (activeStreamTimer) {
      clearInterval(activeStreamTimer);
      activeStreamTimer = null;
    }

    containerEl.innerHTML = '';
    const words = text.split(/\s+/).filter(Boolean);

    // Single words / short phrases (<= 4 words): instant smooth reveal
    if (words.length <= 4) {
      containerEl.innerHTML = `<span class="sx-stream-instant">${escapeHtml(text)}</span>`;
      requestAnimationFrame(() => clampCardToViewport());
      return;
    }

    // Progressively inject words in rapid sequence so card height physically expands as text fills in
    let wordIndex = 0;
    const intervalMs = 28; // ~35 words per second

    activeStreamTimer = setInterval(() => {
      if (wordIndex >= words.length) {
        clearInterval(activeStreamTimer);
        activeStreamTimer = null;
        clampCardToViewport();
        return;
      }

      const w = words[wordIndex];
      const span = document.createElement('span');
      span.className = 'sx-stream-word sx-word-revealed';
      span.textContent = w;
      containerEl.appendChild(span);

      if (wordIndex < words.length - 1) {
        containerEl.appendChild(document.createTextNode(' '));
      }

      wordIndex++;

      // Every 3 words, gently check viewport clamp so card never overflows screen
      if (wordIndex % 4 === 0) {
        clampCardToViewport();
      }
    }, intervalMs);
  }

  // Render Translation View: TRANSLATION ON TOP, ORIGINAL BELOW
  function renderTranslationView(res, fallbackNotice = "", customLangName = null) {
    const body = cardElement.querySelector('.sx-body');
    if (!body) return;

    const original = currentSelectionText;
    const translated = res?.translatedText || "Translation unavailable";
    const targetLangName = customLangName || LANG_NAMES[preferredLang] || preferredLang.toUpperCase();

    body.innerHTML = `
      ${fallbackNotice ? `<div class="sx-fallback-msg">${escapeHtml(fallbackNotice)}</div>` : ''}
      
      <!-- 1. TRANSLATION (PRIMARY FOCUS - CLEAN & PROMINENT) -->
      <div class="sx-section-block sx-trans-primary-block">
        <div class="sx-section-header">
          <span class="sx-section-label sx-blue-label">${escapeHtml(targetLangName.toUpperCase())} TRANSLATION</span>
          <button class="sx-speaker-icon-btn sx-listen-trans-btn" title="Listen translation">
            <svg viewBox="0 0 24 24" class="sx-speaker-svg">
              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="sx-translation-text sx-trans-stream-slot"></div>
      </div>

      <!-- 2. ORIGINAL BELOW (OPTION A: REVEALED NATURALLY ON SCROLL DOWN) -->
      <div class="sx-hairline-sep sx-scroll-sep"></div>

      <div class="sx-section-block sx-original-scroll-block">
        <div class="sx-section-header">
          <span class="sx-section-label sx-subdued-label">ORIGINAL</span>
          <button class="sx-speaker-icon-btn sx-listen-orig-btn" title="Listen original">
            <svg viewBox="0 0 24 24" class="sx-speaker-svg">
              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="sx-original-subdued-text">${escapeHtml(original)}</div>
      </div>
    `;

    // Stream translation into top slot
    const streamSlot = body.querySelector('.sx-trans-stream-slot');
    if (streamSlot) {
      streamTextIntoElement(streamSlot, translated);
    }

    // Audio handlers
    body.querySelector('.sx-listen-orig-btn')?.addEventListener('click', (ev) => {
      animateAudioWave(ev.currentTarget);
      speakText(original, 'en-US');
    });

    // Ensure entire card is clamped within visible viewport
    requestAnimationFrame(() => {
      clampCardToViewport();
    });

    body.querySelector('.sx-listen-trans-btn')?.addEventListener('click', (ev) => {
      animateAudioWave(ev.currentTarget);
      const speechLang = LANG_SPEECH_MAP[preferredLang] || preferredLang;
      speakText(translated, speechLang);
    });
  }

  function animateAudioWave(btn) {
    if (!btn) return;
    btn.classList.add('is-playing');
    setTimeout(() => {
      btn.classList.remove('is-playing');
    }, 1200);
  }

  function playAudio(url) {
    try {
      if (currentAudio) currentAudio.pause();
      currentAudio = new Audio(url);
      currentAudio.play().catch(() => {});
    } catch (e) {}
  }

  function renderErrorView(msg) {
    const body = cardElement.querySelector('.sx-body');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center; padding: 28px 12px;">
        <p style="font-weight: 600; color: #ff3b30; margin-bottom: 6px;">Unable to Load</p>
        <p style="font-size: 12px; color: #666666; margin-bottom: 14px;">${escapeHtml(msg)}</p>
        <button class="sx-btn sx-retry-btn" style="margin: 0 auto;">Try Again</button>
      </div>
    `;
    body.querySelector('.sx-retry-btn')?.addEventListener('click', fetchCardData);
  }

  function speakText(text, lang = 'en-US') {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;

      // Select matching voice or base language fallback
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      if (voices.length > 0) {
        const langBase = lang.split('-')[0].toLowerCase();
        const bestVoice = voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
                          voices.find(v => v.lang.toLowerCase().startsWith(langBase));
        if (bestVoice) {
          utterance.voice = bestVoice;
          utterance.lang = bestVoice.lang;
        } else {
          utterance.lang = lang;
        }
      } else {
        utterance.lang = lang;
      }

      window.speechSynthesis.speak(utterance);
    }
  }

  // Apple-style Copy Feedback with Bulletproof Clipboard Handling
  function copyToClipboard(text, btnElement) {
    if (!text) return;

    const done = () => {
      if (!btnElement) return;
      btnElement.classList.add('is-copied');
      const span = btnElement.querySelector('span');
      const orig = span ? span.textContent : 'Copy';
      if (span) span.textContent = 'Copied!';

      setTimeout(() => {
        btnElement.classList.remove('is-copied');
        if (span) span.textContent = orig;
      }, 1500);
    };

    // Primary: Modern Async Clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text)
        .then(done)
        .catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }

    // Fallback: document.execCommand with robust textarea focus
    function fallbackCopy(t, cb) {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '2em';
        ta.style.height = '2em';
        ta.style.padding = '0';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.boxShadow = 'none';
        ta.style.background = 'transparent';
        ta.style.opacity = '0';
        ta.style.zIndex = '-9999';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const success = document.execCommand('copy');
        document.body.removeChild(ta);
        if (success) {
          cb();
        }
      } catch (err) {
        console.warn('SelectX: Copy failed', err);
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Background message listener
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TRIGGER_CARD" && msg.selectedText) {
      const selection = window.getSelection();
      let coords = { x: window.innerWidth / 2 - 180, y: window.innerHeight / 3, scrollY: window.scrollY };
      if (selection && selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        if (rect && rect.width > 0) {
          coords = { x: rect.left, y: rect.bottom, rect: rect, scrollY: window.scrollY };
        }
      }
      lastSelectionCoords = coords;
      triggerCardDisplay(msg.selectedText);
    }

    if (msg.type === "KEYBOARD_TRIGGER") {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        const text = selection.toString().trim();
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        lastSelectionCoords = { x: rect.left, y: rect.bottom, rect: rect, scrollY: window.scrollY };
        triggerCardDisplay(text);
      }
    }
  });

  // Liquid Glass Stylesheet
  function getEmbeddedStyles() {
    return `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #000000;
        box-sizing: border-box;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: inherit;
        -webkit-font-smoothing: antialiased;
      }

      /* Liquid Glass Main Window Card with Dynamic Expanding Animation */
      .sx-card {
        position: fixed;
        min-width: 310px;
        max-width: 470px;
        width: auto;
        min-height: 140px;
        max-height: 450px;
        height: auto;
        background: rgba(246, 247, 249, 0.88);
        backdrop-filter: blur(40px) saturate(190%) contrast(1.05);
        -webkit-backdrop-filter: blur(40px) saturate(190%);
        border: 1px solid rgba(255, 255, 255, 0.9);
        border-radius: 24px;
        box-shadow: 
          0 24px 60px rgba(0, 0, 0, 0.14),
          0 2px 8px rgba(0, 0, 0, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 1);
        display: flex;
        flex-direction: column;
        z-index: 2147483647;
        overflow: hidden;
        color: #000000 !important;
        transform-origin: top left;
        animation: sx-card-expand-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, height 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .sx-card.theme-dark {
        background: rgba(36, 36, 40, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #ffffff !important;
        box-shadow: 0 28px 70px rgba(0, 0, 0, 0.6);
      }

      /* Spring expanding bloom animation (originating from selection) */
      @keyframes sx-card-expand-in {
        0% {
          opacity: 0;
          transform: scale(0.68) translateY(-10px);
          filter: blur(12px);
        }
        70% {
          opacity: 0.98;
          transform: scale(1.02) translateY(1px);
          filter: blur(0px);
        }
        100% {
          opacity: 1;
          transform: scale(1) translateY(0);
          filter: blur(0px);
        }
      }

      .sx-card.is-dismissing {
        opacity: 0;
        transform: scale(0.85) translateY(-6px);
        filter: blur(6px);
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), filter 0.2s ease;
      }

      .sx-card.is-dragging {
        user-select: none;
        cursor: grabbing !important;
        transform: scale(1.02);
        opacity: 0.98;
        box-shadow: 0 32px 80px rgba(0, 0, 0, 0.25);
      }

      .sx-card.is-resizing {
        user-select: none;
        transition: none !important;
      }

      /* Floating Button - Circular Frosted Bubble with Clear Minimal Outshade */
      .sx-floating-btn {
        position: fixed;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(30px) saturate(190%);
        -webkit-backdrop-filter: blur(30px) saturate(190%);
        color: #000000;
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 
          0 4px 12px rgba(0, 0, 0, 0.12),
          0 10px 28px rgba(0, 0, 0, 0.1),
          0 1px 3px rgba(0, 0, 0, 0.08),
          inset 0 1px 1px rgba(255, 255, 255, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2147483647;
        user-select: none;
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
        animation: sx-spring-btn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .sx-floating-btn.theme-dark {
        background: rgba(44, 44, 50, 0.94);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: 
          0 4px 14px rgba(0, 0, 0, 0.4),
          0 12px 30px rgba(0, 0, 0, 0.35),
          0 0 0 1px rgba(255, 255, 255, 0.1);
      }
      .sx-floating-btn:hover {
        transform: scale(1.09);
        box-shadow: 
          0 6px 18px rgba(0, 0, 0, 0.16),
          0 14px 34px rgba(0, 0, 0, 0.12),
          inset 0 1px 1px rgba(255, 255, 255, 1);
      }
      .sx-floating-btn.theme-dark:hover {
        box-shadow: 
          0 8px 22px rgba(0, 0, 0, 0.55),
          0 16px 38px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(255, 255, 255, 0.18);
      }
      .sx-floating-btn.is-pressed {
        transform: scale(0.92);
      }
      .sx-sf-icon {
        width: 17px;
        height: 17px;
        display: block;
      }

      @keyframes sx-spring-btn {
        from {
          opacity: 0;
          transform: scale(0.7) translateY(4px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      /* Header with Pill Segmented Switcher */
      .sx-header {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px 18px 8px 18px;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
      }
      .sx-tabs {
        display: flex;
        width: 100%;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 16px;
        padding: 3px;
        gap: 4px;
      }
      .sx-card.theme-dark .sx-tabs {
        background: rgba(255, 255, 255, 0.08);
      }
      .sx-tab-btn {
        flex: 1;
        padding: 7px 0;
        text-align: center;
        border-radius: 13px;
        border: none;
        background: transparent;
        font-size: 14px;
        font-weight: 500;
        color: #555555;
        cursor: pointer;
        transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      .sx-card.theme-dark .sx-tab-btn {
        color: #aaaaaa;
      }
      .sx-tab-btn:hover {
        color: #000000;
      }
      .sx-card.theme-dark .sx-tab-btn:hover {
        color: #ffffff;
      }
      .sx-tab-btn.active {
        background: #007AFF !important;
        color: #ffffff !important;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0, 122, 255, 0.38);
      }

      /* Body */
      .sx-body {
        padding: 14px 22px 14px 22px;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .sx-body::-webkit-scrollbar { width: 4px; }
      .sx-body::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.12);
        border-radius: 4px;
      }

      /* Sections & Separator */
      .sx-section-block {
        padding: 4px 0;
      }
      .sx-hairline-sep {
        height: 1px;
        background: rgba(0, 0, 0, 0.07);
        margin: 14px 0;
      }
      .sx-card.theme-dark .sx-hairline-sep {
        background: rgba(255, 255, 255, 0.1);
      }
      .sx-scroll-sep {
        margin: 18px 0 14px 0;
        opacity: 0.75;
      }
      .sx-original-scroll-block {
        padding-top: 2px;
        padding-bottom: 8px;
      }
      .sx-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .sx-section-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: #000000;
      }
      .sx-card.theme-dark .sx-section-label {
        color: #ffffff;
      }
      .sx-blue-label {
        color: #007AFF !important;
        font-weight: 700;
      }
      .sx-subdued-label {
        color: #777777 !important;
      }
      .sx-card.theme-dark .sx-subdued-label {
        color: #999999 !important;
      }

      /* Primary Bold Translation Typography (Top) */
      .sx-translation-text {
        font-size: calc(26px * var(--sx-font-scale, 1));
        font-weight: 700;
        color: #000000 !important;
        line-height: 1.5;
        padding-bottom: 2px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Devanagari", "Mukta", sans-serif;
        word-break: normal;
        overflow-wrap: break-word;
        white-space: normal;
      }
      .sx-card.theme-dark .sx-translation-text {
        color: #ffffff !important;
      }

      /* Original Text Typography (Subdued & Smaller Below) */
      .sx-original-subdued-text {
        font-size: calc(15px * var(--sx-font-scale, 1));
        font-weight: 500;
        color: #444444 !important;
        line-height: 1.45;
        word-break: normal;
        overflow-wrap: break-word;
      }
      .sx-card.theme-dark .sx-original-subdued-text {
        color: #cccccc !important;
      }

      /* Original Headline for Definition view */
      .sx-original-headline {
        font-size: calc(26px * var(--sx-font-scale, 1));
        font-weight: 700;
        color: #000000 !important;
        line-height: 1.25;
        letter-spacing: -0.4px;
        word-break: break-word;
      }
      .sx-card.theme-dark .sx-original-headline {
        color: #ffffff !important;
      }

      .sx-definition-preview {
        font-size: calc(13.5px * var(--sx-font-scale, 1));
        line-height: 1.45;
        color: #444444;
      }

      /* Streaming Animation Styles */
      .sx-stream-instant {
        animation: sx-fade-in 0.18s ease-out forwards;
      }
      .sx-stream-word {
        display: inline;
        opacity: 0;
        animation: sx-stream-in 0.16s ease-out forwards;
      }
      .sx-stream-word.sx-word-revealed {
        opacity: 1;
      }
      @keyframes sx-stream-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes sx-fade-in {
        from { opacity: 0; transform: scale(0.98); }
        to { opacity: 1; transform: scale(1); }
      }

      /* Speaker Icon */
      .sx-speaker-icon-btn {
        background: transparent;
        border: none;
        width: 24px;
        height: 24px;
        color: #000000;
        opacity: 0.75;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .sx-card.theme-dark .sx-speaker-icon-btn {
        color: #ffffff;
      }
      .sx-speaker-icon-btn:hover {
        opacity: 1;
        transform: scale(1.1);
      }
      .sx-speaker-icon-btn.is-playing {
        color: #007AFF !important;
        animation: sx-pulse 0.6s infinite alternate ease-in-out;
      }
      @keyframes sx-pulse {
        from { transform: scale(1); }
        to { transform: scale(1.15); }
      }
      .sx-speaker-svg {
        width: 18px;
        height: 18px;
      }

      /* Meaning Drawer in Definition Mode */
      .sx-meaning-drawer {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px dashed rgba(0, 0, 0, 0.09);
      }
      .sx-card.theme-dark .sx-meaning-drawer {
        border-top: 1px dashed rgba(255, 255, 255, 0.12);
      }
      .sx-pos-tag {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        color: #007AFF;
        margin-bottom: 4px;
      }
      .sx-definition-preview {
        font-size: 13px;
        line-height: 1.45;
        color: #444444;
      }
      .sx-card.theme-dark .sx-definition-preview {
        color: #cccccc;
      }

      /* Pill Footer Actions */
      .sx-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 22px 18px 22px;
        flex-shrink: 0;
        margin-top: auto;
      }
      .sx-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 16px;
        border-radius: 12px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        background: rgba(255, 255, 255, 0.85);
        color: #000000 !important;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 
          0 2px 5px rgba(0, 0, 0, 0.08),
          0 1px 2px rgba(0, 0, 0, 0.04);
      }
      .sx-card.theme-dark .sx-btn {
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #ffffff !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }
      .sx-btn:hover {
        background: rgba(255, 255, 255, 0.98);
        transform: translateY(-1px);
        box-shadow: 
          0 4px 12px rgba(0, 0, 0, 0.12),
          0 2px 4px rgba(0, 0, 0, 0.06);
      }
      .sx-card.theme-dark .sx-btn:hover {
        background: rgba(255, 255, 255, 0.22);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
      }
      .sx-btn.is-copied {
        background: #34c759 !important;
        color: #ffffff !important;
        border-color: #34c759 !important;
      }
      .sx-btn-icon {
        width: 14px;
        height: 14px;
        display: inline-block;
      }

      /* Resize handles */
      .sx-resize-handle {
        position: absolute;
        z-index: 10;
      }
      .sx-resize-r {
        top: 0;
        right: 0;
        width: 8px;
        height: 100%;
        cursor: ew-resize;
      }
      .sx-resize-b {
        bottom: 0;
        left: 0;
        height: 8px;
        width: 100%;
        cursor: ns-resize;
      }
      .sx-resize-br {
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
        display: flex;
        align-items: flex-end;
        justify-content: flex-end;
        padding: 4px;
        color: #888888;
        opacity: 0.5;
      }
      .sx-resize-grip {
        width: 8px;
        height: 8px;
        display: block;
      }

      /* Skeleton */
      .sx-skeleton {
        animation: sx-shimmer 1.5s infinite;
        background: linear-gradient(90deg, rgba(0, 0, 0, 0.05) 25%, rgba(0, 0, 0, 0.09) 50%, rgba(0, 0, 0, 0.05) 75%);
        background-size: 200% 100%;
        border-radius: 8px;
      }
      .sx-card.theme-dark .sx-skeleton {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 25%, rgba(255, 255, 255, 0.12) 50%, rgba(255, 255, 255, 0.06) 75%);
        background-size: 200% 100%;
      }
      .sx-skel-title { height: 26px; width: 60%; margin-bottom: 14px; }
      .sx-skel-line { height: 14px; width: 90%; margin-bottom: 10px; }
      .sx-skel-short { height: 14px; width: 65%; margin-bottom: 14px; }
      @keyframes sx-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .sx-fallback-msg {
        padding: 8px 12px;
        margin-bottom: 10px;
        border-radius: 8px;
        background: rgba(255, 149, 0, 0.12);
        color: #ff9500;
        font-size: 12px;
      }
      .sx-retry-btn {
        margin-top: 10px;
      }

      /* Liquid Glass Toast */
      .sx-toast {
        position: fixed;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 18px;
        border-radius: 20px;
        background: rgba(30, 30, 34, 0.92);
        color: #ffffff;
        font-size: 12.5px;
        font-weight: 500;
        backdrop-filter: blur(25px);
        -webkit-backdrop-filter: blur(25px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.15);
        z-index: 2147483647;
        pointer-events: none;
        animation: sx-toast-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .sx-toast.theme-light {
        background: rgba(246, 247, 250, 0.94);
        color: #000000;
        border: 1px solid rgba(0, 0, 0, 0.08);
      }
      .sx-toast.is-dismissing {
        opacity: 0;
        transform: translate(-50%, 6px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      @keyframes sx-toast-in {
        from { opacity: 0; transform: translate(-50%, 10px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
  }
})();
