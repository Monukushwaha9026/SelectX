// SelectX - Background Service Worker (High-Speed Edge Dictionary & Translation Engine)

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['preferredLang', 'showMode', 'theme'], (res) => {
    const updates = {};
    if (!res.preferredLang) updates.preferredLang = 'hi';
    if (!res.showMode) updates.showMode = 'both';
    if (!res.theme) updates.theme = 'system';
    if (Object.keys(updates).length > 0) chrome.storage.sync.set(updates);
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "selectx-translate",
      title: "Translate with SelectX",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "selectx-translate" && info.selectionText && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_CARD", selectedText: info.selectionText }).catch(()=>{});
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "trigger_selectx") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: "KEYBOARD_TRIGGER" }).catch(()=>{});
    });
  }
});

const cache = new Map();
const MAX_CACHE = 250;

function saveToHistory(item) {
  chrome.storage.local.get(['history'], (res) => {
    let history = res.history || [];
    history = history.filter(h => h.text.toLowerCase() !== item.text.toLowerCase());
    history.unshift({ text: item.text, mode: item.mode, summary: (item.summary||"").slice(0,80), timestamp: Date.now() });
    chrome.storage.local.set({ history: history.slice(0,25) });
  });
}

// Clean and stem/lemmatize word variations for higher hit-rate
function getWordVariants(word) {
  const list = [word];
  if (word.endsWith('ies') && word.length > 4) list.push(word.slice(0, -3) + 'y');
  if (word.endsWith('ing') && word.length > 5) {
    list.push(word.slice(0, -3));
    list.push(word.slice(0, -3) + 'e');
  }
  if (word.endsWith('ed') && word.length > 4) {
    list.push(word.slice(0, -2));
    list.push(word.slice(0, -1));
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) list.push(word.slice(0, -1));
  return [...new Set(list)];
}

// Ultra-fast dictionary fetch with strict 1200ms timeout
async function fetchDictionaryWithTimeout(word) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200);

  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(res.status === 404 ? "Not found" : `HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Fallback: Extract dictionary definition directly from Google Edge CDN (<100ms)
async function fetchGoogleDictionaryFallback(word) {
  const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=en&dt=md&dt=bd&q=${encodeURIComponent(word)}`;
  const res = await fetch(googleUrl);
  if (!res.ok) throw new Error("Google fallback failed");
  const data = await res.json();

  const meanings = [];
  // Parse definitions from Google's dt=md array (index 12)
  if (Array.isArray(data[12])) {
    data[12].forEach(block => {
      const partOfSpeech = block[0] || 'general';
      const definitions = [];
      if (Array.isArray(block[1])) {
        block[1].forEach(defItem => {
          if (defItem[0]) {
            definitions.push({
              definition: defItem[0],
              example: defItem[2] || ''
            });
          }
        });
      }
      if (definitions.length > 0) {
        meanings.push({ partOfSpeech, definitions });
      }
    });
  }

  // Parse dictionary entry from Google's dt=bd array (index 1)
  if (meanings.length === 0 && Array.isArray(data[1])) {
    data[1].forEach(block => {
      const partOfSpeech = block[0] || 'general';
      const terms = Array.isArray(block[1]) ? block[1].join(', ') : '';
      if (terms) {
        meanings.push({
          partOfSpeech,
          definitions: [{ definition: terms }]
        });
      }
    });
  }

  if (meanings.length > 0) {
    return [{
      word,
      phonetic: '',
      phonetics: [],
      meanings
    }];
  }

  throw new Error("No definition found in Google fallback");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DEFINE") {
    const rawWord = message.word?.trim().toLowerCase();
    if (!rawWord) { sendResponse({ success: false, error: "Empty" }); return true; }

    const cacheKey = `def:${rawWord}`;
    if (cache.has(cacheKey)) { sendResponse(cache.get(cacheKey)); return true; }

    const variants = getWordVariants(rawWord);

    (async () => {
      // 1. Try dictionaryapi.dev with variants and 1.2s timeout
      for (const variant of variants) {
        try {
          const data = await fetchDictionaryWithTimeout(variant);
          if (Array.isArray(data) && data.length > 0) {
            const result = { success: true, data };
            if (cache.size > MAX_CACHE) cache.clear();
            cache.set(cacheKey, result);
            sendResponse(result);
            saveToHistory({ text: rawWord, mode: 'definition', summary: data[0]?.meanings?.[0]?.definitions?.[0]?.definition || "Defined" });
            return;
          }
        } catch (_) {}
      }

      // 2. Fast fallback to Google Edge dictionary
      try {
        const googleData = await fetchGoogleDictionaryFallback(rawWord);
        const result = { success: true, data: googleData };
        if (cache.size > MAX_CACHE) cache.clear();
        cache.set(cacheKey, result);
        sendResponse(result);
        saveToHistory({ text: rawWord, mode: 'definition', summary: googleData[0]?.meanings?.[0]?.definitions?.[0]?.definition || "Defined" });
        return;
      } catch (gErr) {
        sendResponse({ success: false, error: "No definition found" });
      }
    })();

    return true;
  }

  if (message.type === "TRANSLATE") {
    const text = message.text?.trim();
    if (!text) { sendResponse({ success: false, error: "Empty" }); return true; }
    const targetLang = (message.targetLang || 'hi').toLowerCase();
    const sourceLang = message.sourceLang || 'auto';
    const cacheKey = `trans:${text}:${sourceLang}:${targetLang}`;
    if (cache.has(cacheKey)) { sendResponse(cache.get(cacheKey)); return true; }

    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;

    fetch(googleUrl)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => {
        let translatedText = '';
        if (Array.isArray(data) && Array.isArray(data[0])) translatedText = data[0].map(s => s[0] || '').join('');
        if (!translatedText) throw new Error("No translation");
        const result = { success: true, translatedText, detectedSource: data[2] || sourceLang, service: 'google' };
        if (cache.size > MAX_CACHE) cache.clear();
        cache.set(cacheKey, result);
        sendResponse(result);
        saveToHistory({ text, mode: 'translation', summary: translatedText });
      })
      .catch(err => {
        const shortTarget = targetLang.split('-')[0];
        const shortSource = sourceLang === 'auto' ? 'en' : sourceLang.split('-')[0];
        const langpair = `${shortSource}|${shortTarget}`;
        const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(langpair)}`;
        fetch(myMemoryUrl)
          .then(r => { if (!r.ok) throw new Error(`MM ${r.status}`); return r.json(); })
          .then(mmData => {
            if (mmData.responseData?.translatedText) {
              const result = { success: true, translatedText: mmData.responseData.translatedText, detectedSource: shortSource, service: 'mymemory' };
              cache.set(cacheKey, result);
              sendResponse(result);
              saveToHistory({ text, mode: 'translation', summary: result.translatedText });
            } else throw new Error(mmData.responseDetails || "Failed");
          })
          .catch(mmErr => sendResponse({ success: false, error: mmErr.message || err.message }));
      });
    return true;
  }
});
