# SelectX - Instant Define & Translate (Chrome Extension)

A lightweight, modern, glassmorphic Manifest V3 Chrome Extension. Select any text on any webpage to instantly view dictionary definitions, pronunciation audio, and translations in a sleek floating popup.

---

## 🚀 Features

- **Intuitive Selection Detection**: Select text on any web page to see a floating trigger icon positioned directly near your selection.
- **Continuous Reading Mode**: While the card is already visible, selecting any other text immediately updates and searches without needing to click the trigger bubble again.
- **Auto Mode Switching**:
  - **Word Mode (1–2 words)**: Word definition, phonetics, audio pronunciation, part of speech, synonyms, example usage, and immediate translation into your preferred language.
  - **Sentence Mode (3+ words)**: Auto source language detection, large bold translation, text-to-speech for both languages, and natural scroll-reveal for original text.
  - **Tab Switcher**: Toggle seamlessly between *Define* and *Translate* anytime.
- **Dynamic Smart Canvas**: Auto-expands bidirectionally (width & height) to fit content smoothly up to optimal viewport bounds.
- **Option C Word-Level Streaming**: Natural typography cascade that preserves Hindi and Devanagari ligatures without breaking.
- **Liquid Glass UI & Shadow DOM**: Built with encapsulated Shadow DOM to guarantee zero style conflicts with host websites. Supports native Dark and Light modes.
- **Rich Interaction**:
  - One-click copy with animated feedback.
  - Text-to-speech via Web Speech API and native dictionary audio.
  - Graceful fallback: when dictionary definitions aren't available, automatically falls back to translation.
- **Context Menu & Shortcut**:
  - Right-click any selection -> **Translate with SelectX**.
  - Keyboard shortcut: **`Alt + Shift + T`** to trigger on selected text.
- **Settings & Preferences**:
  - Customize preferred translation language (Hindi, English, Spanish, French, German, Japanese, Bengali, Marathi).
  - Text Size Scale slider (80% - 140%).
  - Smart auto-expand toggle.
  - Toggle between automatic text selection trigger vs. context menu only.
  - Search history of the last 20 lookups stored locally in `chrome.storage.local`.

---

## 📁 Directory Structure

```
SelectX/
├── manifest.json         # Manifest V3 configuration
├── background.js         # Service worker handling API requests, CORS, context menus, shortcuts
├── content.js            # Injected script managing Shadow DOM, positioning, and selection listeners
├── content.css           # Styling for floating button and card
├── popup.html            # Extension settings popup
├── popup.js              # Settings logic and history viewer
├── popup.css             # Settings popup styling
├── icons/                # Extension icons (16px, 48px, 128px)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # Documentation and installation guide
```

---

## 🛠️ How to Install in Google Chrome

1. **Open Chrome Extensions**:
   - In Google Chrome, navigate to `chrome://extensions` in the address bar.
2. **Enable Developer Mode**:
   - Turn on the **Developer mode** toggle switch in the top-right corner.
3. **Load Unpacked**:
   - Click the **"Load unpacked"** button in the top-left corner.
   - Select the folder containing `manifest.json`.
4. **Test the Extension**:
   - Open any web page (e.g., Wikipedia, a news site, or a blog). Refresh the page if it was already open.
   - Highlight any single word or sentence with your mouse.
   - Click the floating translation button that appears near your selection!
   - Or press **Alt + Shift + T** / right click and select **"Translate with SelectX"**.

---

## ⚙️ Configuration & Options

Click the SelectX extension icon in the Chrome toolbar to:
- Select your **Preferred Translation Language** (default: Hindi).
- Adjust **Text Size Scale** (80% to 140%).
- Toggle **Smart Auto-Expand**.
- Choose **Trigger Mode** (show floating button on selection or context menu only).
- Switch **Theme** (System auto, Light, or Dark).
- View or clear your recent lookup history.

---

> This project was vibe coded, but built on my direction.
