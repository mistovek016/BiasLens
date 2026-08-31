// content.js - BiasLens Content Script & Embedded Shadow DOM Overlay

(() => {
  // Prevent duplicate initialization
  if (window.__biasLensInitialized) return;
  window.__biasLensInitialized = true;

  console.log('[BiasLens] Content script initialized on', window.location.href);

  let shadowHost = null;
  let shadowRoot = null;
  let currentSelectionData = null;
  let cachedSelectionData = null;
  let isProcessing = false;

  /**
   * In-Memory Global Page Metadata Cache
   * Pre-caches document.title and primary/secondary headings for instant lookup
   */
  const pageMetadataCache = {
    title: '',
    primaryHeading: '',
    secondaryHeadings: [],
    lastUpdated: 0
  };

  /**
   * Refreshes the in-memory page metadata cache
   */
  function updatePageMetadataCache() {
    try {
      pageMetadataCache.title = (document.title || 'Untitled Page').trim();

      // Find primary heading (h1 or web component title)
      const h1El = document.querySelector('shreddit-title, [slot="title"], h1');
      pageMetadataCache.primaryHeading = (h1El?.innerText || h1El?.textContent || '').trim() || 'General Section';

      // Cache up to 3 secondary headings (h2)
      const h2Els = Array.from(document.querySelectorAll('h2')).slice(0, 3);
      pageMetadataCache.secondaryHeadings = h2Els
        .map(el => (el.innerText || el.textContent || '').trim())
        .filter(Boolean);

      pageMetadataCache.lastUpdated = Date.now();
    } catch (err) {
      console.warn('[BiasLens] updatePageMetadataCache error:', err);
    }
  }

  // Initial cache population
  updatePageMetadataCache();

  // Listen for SPA navigation and DOM changes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updatePageMetadataCache, { once: true });
  }
  window.addEventListener('popstate', updatePageMetadataCache, { passive: true });
  window.addEventListener('hashchange', updatePageMetadataCache, { passive: true });

  // Lightweight observer for SPA dynamic title / heading updates
  try {
    let debounceTimer = null;
    const titleObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePageMetadataCache, 300);
    });

    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });
    }
  } catch {
    // ignore
  }

  /**
   * Embedded CSS Stylesheet Constant
   * Injected synchronously into Shadow Root to completely eliminate CSP network blocks on Reddit/SPAs
   */
  const OVERLAY_STYLES = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #f8fafc;
      z-index: 2147483647 !important;
      position: fixed !important;
      top: 0;
      left: 0;
      pointer-events: none;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .biaslens-trigger-btn {
      pointer-events: auto;
      position: fixed !important;
      z-index: 2147483647 !important;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: linear-gradient(135deg, #1e1b4b, #312e81);
      color: #f8fafc;
      border: 1px solid #6366f1;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 12px rgba(99, 102, 241, 0.35);
      transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease, background 0.15s ease;
      user-select: none;
      animation: biaslens-pop-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
      will-change: transform, opacity;
    }

    .biaslens-trigger-btn:hover {
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 18px rgba(99, 102, 241, 0.55);
      background: linear-gradient(135deg, #312e81, #4338ca);
    }

    .biaslens-trigger-btn:active {
      transform: scale(0.96);
    }

    .biaslens-trigger-icon {
      width: 14px;
      height: 14px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    /* Tooltip Container Card with Viewport Protection */
    .biaslens-tooltip {
      pointer-events: auto;
      position: fixed !important;
      z-index: 2147483647 !important;
      width: 360px;
      min-width: 340px;
      max-width: 440px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: #0f172a;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(99, 102, 241, 0.35);
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7), 0 0 24px rgba(99, 102, 241, 0.2);
      color: #f8fafc;
      overflow: hidden;
      animation: biaslens-pop-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: text;
      overscroll-behavior: contain;
      will-change: transform, opacity;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .biaslens-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(30, 41, 59, 0.65);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      user-select: none;
      cursor: grab;
      touch-action: none;
      flex-shrink: 0;
    }

    .biaslens-header:active {
      cursor: grabbing;
    }

    .biaslens-brand {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .biaslens-header-logo {
      width: 16px;
      height: 16px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    .biaslens-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.2px;
      color: #f8fafc;
    }

    .biaslens-mode-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(99, 102, 241, 0.2);
      color: #c7d2fe;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }

    .biaslens-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .biaslens-icon-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s, transform 0.1s;
    }

    .biaslens-icon-btn:hover {
      color: #f8fafc;
      background: rgba(255, 255, 255, 0.12);
    }

    .biaslens-icon-btn:active {
      transform: scale(0.92);
    }

    .biaslens-icon-btn svg {
      width: 14px;
      height: 14px;
    }

    .biaslens-loading-body {
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      text-align: center;
      flex: 1 1 auto;
    }

    .biaslens-spinner {
      width: 30px;
      height: 30px;
      border: 3px solid rgba(99, 102, 241, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: biaslens-spin 0.75s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    }

    .biaslens-loading-text {
      font-size: 12px;
      color: #94a3b8;
    }

    .biaslens-loading-pulse {
      font-weight: 600;
      color: #c7d2fe;
      animation: biaslens-pulse 1.4s ease-in-out infinite;
    }

    .biaslens-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1 1 auto;
      max-height: 480px;
      overflow-y: auto;
      overscroll-behavior: contain;
      animation: biaslens-fade-in 0.25s ease-out;
    }

    .biaslens-body::-webkit-scrollbar {
      width: 5px;
    }
    .biaslens-body::-webkit-scrollbar-track {
      background: transparent;
    }
    .biaslens-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
    }

    .biaslens-scores-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      flex-shrink: 0;
    }

    .biaslens-score-card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 9px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.3s ease, box-shadow 0.3s ease;
    }

    .biaslens-score-card.tier-low {
      border-color: rgba(16, 185, 129, 0.35);
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(30, 41, 59, 0.7) 100%);
    }

    .biaslens-score-card.tier-med {
      border-color: rgba(245, 158, 11, 0.35);
      background: linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, rgba(30, 41, 59, 0.7) 100%);
    }

    .biaslens-score-card.tier-high {
      border-color: rgba(239, 68, 68, 0.35);
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, rgba(30, 41, 59, 0.7) 100%);
    }

    .biaslens-score-label {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .biaslens-tier-text {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 1px 5px;
      border-radius: 3px;
    }

    .biaslens-score-val-wrap {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }

    .biaslens-score-num {
      font-size: 24px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.5px;
    }

    .biaslens-score-max {
      font-size: 11px;
      color: #64748b;
    }

    .biaslens-progress-track {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 2px;
    }

    .biaslens-progress-bar {
      height: 100%;
      width: 0%;
      border-radius: 4px;
      transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .score-low { color: #34d399; }
    .score-low-bg {
      background: linear-gradient(90deg, #059669, #10b981);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
    }
    .biaslens-tier-text.score-low {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .score-med { color: #fbbf24; }
    .score-med-bg {
      background: linear-gradient(90deg, #d97706, #f59e0b);
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
    }
    .biaslens-tier-text.score-med {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .score-high { color: #f87171; }
    .score-high-bg {
      background: linear-gradient(90deg, #dc2626, #ef4444);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
    }
    .biaslens-tier-text.score-high {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .biaslens-violation-card {
      background: rgba(30, 41, 59, 0.55);
      border-left: 3px solid #6366f1;
      padding: 8px 12px;
      border-radius: 4px 8px 8px 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
    }

    .biaslens-violation-label {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
    }

    .biaslens-violation-tag {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
      background: rgba(99, 102, 241, 0.2);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.4);
      white-space: nowrap;
    }

    .biaslens-violation-tag.violation-none {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.35);
    }

    .biaslens-violation-tag.violation-flagged {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.35);
    }

    .biaslens-explanation {
      font-size: 12.5px;
      line-height: 1.5;
      color: #e2e8f0;
      background: rgba(15, 23, 42, 0.65);
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
    }

    .biaslens-flagged-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .biaslens-section-title {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .biaslens-phrases-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .biaslens-phrase-chip {
      font-size: 11px;
      background: rgba(239, 68, 68, 0.14);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 3px 8px;
      border-radius: 4px;
      cursor: default;
      transition: background 0.15s, border-color 0.15s;
    }

    .biaslens-phrase-chip:hover {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.45);
    }

    /* Context Accordion & Scrollable Metadata Drawer */
    .biaslens-context-details {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      overflow: hidden;
      font-size: 11px;
      flex-shrink: 0; /* Prevents flexbox compression */
    }

    .biaslens-context-summary {
      padding: 7px 10px;
      cursor: pointer;
      color: #94a3b8;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      list-style: none;
      user-select: none;
      transition: color 0.15s ease, background 0.15s ease;
    }

    .biaslens-context-summary:hover {
      color: #e2e8f0;
      background: rgba(255, 255, 255, 0.04);
    }

    .biaslens-context-summary::-webkit-details-marker {
      display: none;
    }

    /* Strict Max-Height, Padding, and Scoped Scrollbar for Metadata Drawer */
    .biaslens-context-body {
      padding: 8px 10px 16px 10px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      flex-direction: column;
      gap: 8px;
      color: #cbd5e1;
      max-height: 140px !important;
      overflow-y: auto !important;
      overscroll-behavior: contain;
      box-sizing: border-box !important;
    }

    .biaslens-context-body::-webkit-scrollbar {
      width: 4px;
    }
    .biaslens-context-body::-webkit-scrollbar-track {
      background: rgba(15, 23, 42, 0.4);
      border-radius: 4px;
    }
    .biaslens-context-body::-webkit-scrollbar-thumb {
      background: rgba(99, 102, 241, 0.4);
      border-radius: 4px;
    }
    .biaslens-context-body::-webkit-scrollbar-thumb:hover {
      background: rgba(99, 102, 241, 0.7);
    }

    .biaslens-context-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .biaslens-context-key {
      font-size: 10px;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .biaslens-context-val {
      font-size: 11px;
      color: #94a3b8;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .biaslens-error-box {
      padding: 14px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .biaslens-error-title {
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    @keyframes biaslens-pop-in {
      0% {
        opacity: 0;
        transform: scale(0.93) translateY(8px);
      }
      100% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    @keyframes biaslens-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes biaslens-spin {
      to { transform: rotate(360deg); }
    }

    @keyframes biaslens-pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
  `;

  /**
   * Checks if extension context is valid and active
   */
  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  /**
   * Safe storage getter with fallback
   */
  async function getStoredSettings(keys, fallback = {}) {
    if (!isExtensionContextValid()) return fallback;
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return fallback;
    }
  }

  /**
   * Safe message dispatcher with extension context invalidation guard
   */
  async function sendRuntimeMessage(message) {
    if (!isExtensionContextValid()) {
      throw new Error('BiasLens was recently updated or reloaded. Please refresh this webpage (Cmd+Shift+R or Ctrl+Shift+R) to reconnect.');
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (
        !isExtensionContextValid() ||
        err?.message?.includes('Extension context invalidated') ||
        err?.message?.includes('message port closed') ||
        err?.message?.includes('Receiving end does not exist')
      ) {
        throw new Error('BiasLens was recently updated or reloaded. Please refresh this webpage (Cmd+Shift+R or Ctrl+Shift+R) to reconnect.');
      }
      throw err;
    }
  }

  /**
   * Initialize Shadow Root Container with embedded CSS template literal
   */
  function ensureShadowRoot() {
    try {
      if (!shadowHost) {
        shadowHost = document.createElement('biaslens-root');
        shadowHost.style.cssText = 'all: initial; position: fixed !important; z-index: 2147483647 !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; pointer-events: none !important;';

        shadowRoot = shadowHost.attachShadow({ mode: 'open' });

        const styleEl = document.createElement('style');
        styleEl.textContent = OVERLAY_STYLES;
        shadowRoot.appendChild(styleEl);

        const targetHost = document.documentElement || document.body || document;
        targetHost.appendChild(shadowHost);
        console.log('[BiasLens] Attached <biaslens-root> Shadow DOM to document.documentElement');
      } else if (!shadowHost.isConnected) {
        const targetHost = document.documentElement || document.body || document;
        targetHost.appendChild(shadowHost);
      }
    } catch (rootErr) {
      console.warn('[BiasLens] Error in ensureShadowRoot:', rootErr);
    }
    return shadowRoot;
  }

  /**
   * Helper to remove all UI overlays
   */
  function removeOverlays() {
    try {
      if (shadowRoot) {
        const existingTrigger = shadowRoot.querySelector('.biaslens-trigger-btn');
        if (existingTrigger) existingTrigger.remove();

        const existingTooltip = shadowRoot.querySelector('.biaslens-tooltip');
        if (existingTooltip) existingTooltip.remove();
      }
    } catch {
      // ignore
    }
  }

  /**
   * Attaches wheel, scroll, and touchmove listeners to isolate scrolling within tooltip
   */
  function isolateScrollEvents(element) {
    if (!element) return;

    const stopScrollBubbling = (e) => {
      try {
        e.stopPropagation();

        const scrollable = e.target.closest
          ? e.target.closest('.biaslens-body, .biaslens-context-body, .biaslens-tooltip')
          : null;

        if (scrollable && e.type === 'wheel') {
          const { scrollTop, scrollHeight, clientHeight } = scrollable;
          const isScrollable = scrollHeight > clientHeight;
          if (isScrollable) {
            const delta = e.deltaY;
            const atTop = delta < 0 && scrollTop <= 0;
            const atBottom = delta > 0 && scrollTop + clientHeight >= scrollHeight - 1;
            if (atTop || atBottom) {
              e.preventDefault();
            }
          }
        }
      } catch {
        // ignore
      }
    };

    element.addEventListener('wheel', stopScrollBubbling, { passive: false });
    element.addEventListener('touchmove', stopScrollBubbling, { passive: true });
    element.addEventListener('scroll', stopScrollBubbling, { passive: true });
  }

  /**
   * Real-time selection change tracker
   */
  document.addEventListener('selectionchange', () => {
    try {
      const raw = getDeepActiveSelection();
      if (raw && raw.text && raw.text.length > 5) {
        cachedSelectionData = {
          ...raw,
          timestamp: Date.now()
        };
      }
    } catch {
      // ignore
    }
  });

  /**
   * Deep active selection retriever across standard and Shadow DOMs
   */
  function getDeepActiveSelection() {
    try {
      let active = document.activeElement;
      while (active && active.shadowRoot) {
        if (active === shadowHost) return null;
        const sRoot = active.shadowRoot;
        if (typeof sRoot.getSelection === 'function') {
          const sel = sRoot.getSelection();
          if (sel) {
            const str = sel.toString().trim();
            if (str.length > 5) {
              const range = (sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
              const rect = calculateSelectionRect(range, active, active);
              return {
                text: str,
                range,
                rect,
                containerEl: range?.commonAncestorContainer || active,
                targetRoot: sRoot
              };
            }
          }
        }
        active = sRoot.activeElement;
      }

      const standardSel = (window.getSelection && window.getSelection()) || (document.getSelection && document.getSelection());
      if (standardSel) {
        const str = standardSel.toString().trim();
        if (str.length > 5 && standardSel.rangeCount > 0) {
          let range = null;
          try {
            range = standardSel.getRangeAt(0);
          } catch {
            range = null;
          }

          let container = range ? range.commonAncestorContainer : null;
          if (container && container.nodeType === Node.TEXT_NODE) {
            container = container.parentElement;
          }
          if (container && (container.closest?.('biaslens-root') || (shadowHost && shadowHost.contains(container)))) {
            return null;
          }
          const rect = calculateSelectionRect(range, container, null);
          return {
            text: str,
            range,
            rect,
            containerEl: container || document.body,
            targetRoot: document
          };
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Extracts selection on mouseup / keyup with composedPath fallback
   */
  function getAggressiveSelection(event) {
    try {
      if (cachedSelectionData && (Date.now() - cachedSelectionData.timestamp) < 1500) {
        return cachedSelectionData;
      }

      if (event && typeof event.composedPath === 'function') {
        const path = event.composedPath();
        for (const element of path) {
          if (!element) continue;

          if (element instanceof ShadowRoot && typeof element.getSelection === 'function') {
            if (element === shadowRoot) return null;
            const sel = element.getSelection();
            if (sel) {
              const str = sel.toString().trim();
              if (str.length > 5) {
                const range = (sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
                const rect = calculateSelectionRect(range, element.host || element, path[0]);
                return {
                  text: str,
                  range,
                  rect,
                  containerEl: range?.commonAncestorContainer || element.host || path[0],
                  targetRoot: element
                };
              }
            }
          }

          if (element.shadowRoot && typeof element.shadowRoot.getSelection === 'function') {
            if (element.shadowRoot === shadowRoot) return null;
            const sel = element.shadowRoot.getSelection();
            if (sel) {
              const str = sel.toString().trim();
              if (str.length > 5) {
                const range = (sel.rangeCount > 0) ? sel.getRangeAt(0) : null;
                const rect = calculateSelectionRect(range, element, path[0]);
                return {
                  text: str,
                  range,
                  rect,
                  containerEl: range?.commonAncestorContainer || element,
                  targetRoot: element.shadowRoot
                };
              }
            }
          }
        }
      }

      return getDeepActiveSelection();
    } catch {
      return null;
    }
  }

  /**
   * Helper to safely calculate bounding client rect with shadow DOM & mouse fallback
   */
  function calculateSelectionRect(range, primaryElement, fallbackElement) {
    let rect = null;

    if (range) {
      try {
        const rRect = range.getBoundingClientRect();
        if (rRect && (rRect.width > 0 || rRect.height > 0)) {
          rect = rRect;
        } else {
          const clientRects = range.getClientRects ? range.getClientRects() : [];
          if (clientRects.length > 0 && (clientRects[0].width > 0 || clientRects[0].height > 0)) {
            rect = clientRects[0];
          }
        }
      } catch {
        rect = null;
      }
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      try {
        if (primaryElement && typeof primaryElement.getBoundingClientRect === 'function') {
          const pRect = primaryElement.getBoundingClientRect();
          if (pRect && (pRect.width > 0 || pRect.height > 0)) rect = pRect;
        }
      } catch {
        // ignore
      }
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      try {
        if (fallbackElement && typeof fallbackElement.getBoundingClientRect === 'function') {
          const fRect = fallbackElement.getBoundingClientRect();
          if (fRect && (fRect.width > 0 || fRect.height > 0)) rect = fRect;
        }
      } catch {
        // ignore
      }
    }

    return rect;
  }

  /**
   * Targeted sibling extraction without full DOM tree traversal:
   * Extracts text of the closest block-level parent, plus up to 2 preceding siblings and 1 succeeding sibling.
   * Caps the combined context string to 1,200 characters.
   */
  function extractTargetedSiblingContext(blockEl, fallbackText) {
    if (!blockEl) return fallbackText;

    const parts = [];

    try {
      // 1. Up to 2 preceding siblings
      const prevElements = [];
      let prev = blockEl.previousElementSibling;
      let count = 0;
      while (prev && count < 2) {
        const text = (prev.innerText || prev.textContent || '').trim();
        if (text.length > 0) {
          prevElements.unshift(text);
          count++;
        }
        prev = prev.previousElementSibling;
      }
      if (prevElements.length > 0) {
        parts.push(...prevElements);
      }

      // 2. Current block container text
      const currentText = (blockEl.innerText || blockEl.textContent || fallbackText).trim();
      if (currentText) {
        parts.push(currentText);
      }

      // 3. 1 succeeding sibling element
      let next = blockEl.nextElementSibling;
      if (next) {
        const nextText = (next.innerText || next.textContent || '').trim();
        if (nextText.length > 0) {
          parts.push(nextText);
        }
      }
    } catch (traverseErr) {
      console.warn('[BiasLens] Sibling extraction error:', traverseErr);
      return (blockEl.innerText || blockEl.textContent || fallbackText || '').trim().slice(0, 1200);
    }

    let combined = parts.join('\n\n').trim();
    if (!combined) combined = fallbackText;
    if (combined.length > 1200) {
      combined = combined.slice(0, 1200) + '...';
    }
    return combined;
  }

  /**
   * Context metadata extractor using memory cache & local sibling traversal
   */
  function extractSelectionContext(event) {
    try {
      const rawSel = getAggressiveSelection(event);
      if (!rawSel) return null;

      const { text: selectedText, rect: rawRect, containerEl: initialContainer, targetRoot } = rawSel;

      let containerEl = initialContainer;
      if (containerEl && containerEl.nodeType === Node.TEXT_NODE) {
        containerEl = containerEl.parentElement;
      }

      let rect = rawRect;
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        if (event && (typeof event.clientX === 'number' && typeof event.clientY === 'number') && (event.clientX > 0 || event.clientY > 0)) {
          rect = {
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
            width: 0,
            height: 0
          };
        } else {
          const path = event && typeof event.composedPath === 'function' ? event.composedPath() : [];
          const directTarget = path[0] || event?.target || containerEl;
          if (directTarget && typeof directTarget.getBoundingClientRect === 'function') {
            rect = directTarget.getBoundingClientRect();
          }
        }
      }

      if (!rect) return null;

      // Refresh cache if stale (>5s) or unpopulated
      if (!pageMetadataCache.title || (Date.now() - pageMetadataCache.lastUpdated > 5000)) {
        updatePageMetadataCache();
      }

      // 1. Identify nearest block-level container
      const blockContainer = containerEl && containerEl.closest
        ? (containerEl.closest('p, article, shreddit-comment, shreddit-post, li, blockquote, section, td, div') || containerEl)
        : containerEl;

      // 2. Extract targeted sibling context (capped at 1,200 characters)
      const surroundingContext = extractTargetedSiblingContext(blockContainer, selectedText);

      // 3. Determine section heading with pageMetadataCache fallback
      const sectionHeading = findLocalHeading(containerEl, targetRoot) || pageMetadataCache.primaryHeading || 'General Section';

      return {
        selectedText,
        surroundingContext,
        pageTitle: pageMetadataCache.title || document.title || 'Untitled Page',
        sectionHeading,
        rect
      };
    } catch (err) {
      console.warn('[BiasLens] extractSelectionContext failed silently:', err);
      return null;
    }
  }

  /**
   * Traverses immediate parent chain for local heading, falling back quickly to cached heading
   */
  function findLocalHeading(startElement, targetRoot) {
    try {
      if (!startElement) return pageMetadataCache.primaryHeading || 'General Section';

      let ancestor = startElement.closest
        ? startElement.closest('shreddit-post, article, section, main, aside, [role="region"], [role="article"]')
        : null;

      if (ancestor) {
        const redditTitle = ancestor.querySelector
          ? ancestor.querySelector('shreddit-title, [slot="title"], h1[slot="title"], a[slot="full-post-link"], .post-title, h1, h2')
          : null;
        if (redditTitle && (redditTitle.innerText || redditTitle.textContent)) {
          return (redditTitle.innerText || redditTitle.textContent).trim();
        }
      }

      let curr = startElement;
      let depth = 0;
      while (curr && curr !== document.body && depth < 5) {
        let sibling = curr.previousElementSibling;
        while (sibling) {
          if (/^H[1-2]$/i.test(sibling.tagName) && (sibling.innerText || sibling.textContent)) {
            return (sibling.innerText || sibling.textContent).trim();
          }
          sibling = sibling.previousElementSibling;
        }
        curr = curr.parentElement;
        depth++;
      }
    } catch {
      // ignore
    }

    return pageMetadataCache.primaryHeading || 'General Section';
  }

  /**
   * Viewport boundary detection and position calculator for position: fixed elements
   */
  function calculateElementPosition(rect, elementWidth = 360, elementHeight = 320) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;

    const EDGE_MARGIN = 16;
    const GAP = 8;

    let left = rect.left || EDGE_MARGIN;
    const maxLeft = viewportWidth - elementWidth - EDGE_MARGIN;
    if (left > maxLeft) {
      left = Math.max(EDGE_MARGIN, maxLeft);
    }
    if (left < EDGE_MARGIN) {
      left = EDGE_MARGIN;
    }

    const targetBottom = typeof rect.bottom === 'number' ? rect.bottom : (rect.top || EDGE_MARGIN);
    const targetTop = typeof rect.top === 'number' ? rect.top : targetBottom;

    const spaceBelow = viewportHeight - targetBottom;
    const spaceAbove = targetTop;

    let top;
    if (spaceBelow >= elementHeight + GAP + EDGE_MARGIN) {
      top = targetBottom + GAP;
    } else if (spaceAbove >= elementHeight + GAP + EDGE_MARGIN) {
      top = targetTop - elementHeight - GAP;
    } else if (spaceAbove > spaceBelow) {
      top = Math.max(EDGE_MARGIN, targetTop - elementHeight - GAP);
    } else {
      top = Math.min(viewportHeight - elementHeight - EDGE_MARGIN, targetBottom + GAP);
    }

    top = Math.max(EDGE_MARGIN, Math.min(viewportHeight - elementHeight - EDGE_MARGIN, top));

    return { top, left };
  }

  /**
   * Dynamically readjusts element position after DOM render if dimensions changed
   */
  function readjustElementBounds(element, rect, isCenteredFallback = false) {
    if (isCenteredFallback) return;

    requestAnimationFrame(() => {
      try {
        if (!element || !element.isConnected || !rect) return;
        const actualWidth = element.offsetWidth || 360;
        const actualHeight = element.offsetHeight || 320;

        const { top, left } = calculateElementPosition(rect, actualWidth, actualHeight);
        element.style.top = `${top}px`;
        element.style.left = `${left}px`;
      } catch {
        // ignore
      }
    });
  }

  /**
   * Renders the floating trigger pill near selection
   */
  function showTriggerBadge(contextData) {
    try {
      const root = ensureShadowRoot();
      removeOverlays();

      console.log('[BiasLens] Mounting UI overlay (floating trigger badge)...');

      const btn = document.createElement('button');
      btn.className = 'biaslens-trigger-btn';
      btn.type = 'button';
      btn.style.cssText = 'pointer-events: auto; position: fixed !important; z-index: 2147483647 !important;';
      btn.innerHTML = `
        <svg class="biaslens-trigger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="7" stroke="#38bdf8"/>
          <path d="M21 21l-4.35-4.35" stroke="#38bdf8" stroke-linecap="round"/>
          <path d="M8 11a3 3 0 0 1 3-3" stroke="#a5f3fc" stroke-linecap="round"/>
        </svg>
        <span>BiasLens</span>
      `;

      const { top, left } = calculateElementPosition(contextData.rect, 105, 34);
      btn.style.top = `${top}px`;
      btn.style.left = `${left}px`;

      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        btn.remove();
        startAnalysisFlow(contextData);
      });

      root.appendChild(btn);
    } catch (err) {
      console.warn('[BiasLens] Failed to show trigger badge:', err);
    }
  }

  /**
   * Starts the analysis request and displays loading/result tooltip
   */
  async function startAnalysisFlow(contextData) {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const root = ensureShadowRoot();
      removeOverlays();

      console.log('[BiasLens] Mounting UI overlay (analysis tooltip card)...');

      const tooltip = document.createElement('div');
      tooltip.className = 'biaslens-tooltip';

      const isCentered = Boolean(contextData.isCenteredFallback);

      tooltip.style.cssText = `
        pointer-events: auto;
        position: fixed !important;
        min-width: 340px;
        max-width: 440px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
        background: #0f172a;
        color: #f8fafc;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0,0,0,0.7);
        font-family: system-ui, -apple-system, sans-serif;
        z-index: 2147483647 !important;
      `;

      if (isCentered) {
        tooltip.style.top = '25%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translateX(-50%)';
      } else {
        const { top, left } = calculateElementPosition(contextData.rect, 360, 220);
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
      }

      tooltip.innerHTML = `
        <div class="biaslens-header">
          <div class="biaslens-brand">
            <svg class="biaslens-header-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7" stroke="#38bdf8"/>
              <path d="M21 21l-4.35-4.35" stroke="#38bdf8" stroke-linecap="round"/>
            </svg>
            <span class="biaslens-title">BiasLens</span>
            <span class="biaslens-mode-badge" id="categoryBadge">Auto-Detecting...</span>
          </div>
          <div class="biaslens-actions">
            <button class="biaslens-icon-btn biaslens-close-btn" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="biaslens-loading-body">
          <div class="biaslens-spinner"></div>
          <div class="biaslens-loading-text">
            Auto-detecting context &amp; <span class="biaslens-loading-pulse">analysing rhetoric</span>...
          </div>
        </div>
      `;

      setupDraggable(tooltip);
      isolateScrollEvents(tooltip);

      tooltip.querySelector('.biaslens-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.remove();
        isProcessing = false;
      });

      root.appendChild(tooltip);
      if (!isCentered && contextData.rect) {
        readjustElementBounds(tooltip, contextData.rect);
      }

      console.log('[BiasLens] Dispatching structured payload to background worker...', {
        selectedText: contextData.selectedText.slice(0, 60) + '...',
        surroundingContextLength: contextData.surroundingContext?.length,
        pageTitle: contextData.pageTitle,
        sectionHeading: contextData.sectionHeading
      });

      const response = await sendRuntimeMessage({
        action: 'ANALYZE_BIAS',
        payload: {
          selectedText: contextData.selectedText,
          surroundingContext: contextData.surroundingContext || contextData.selectedText,
          pageTitle: contextData.pageTitle || 'Untitled Page',
          sectionHeading: contextData.sectionHeading || 'General Section'
        }
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to receive analysis response.');
      }

      console.log('[BiasLens] Received LLM response:', response.data);
      renderAnalysisResult(tooltip, response.data, contextData, isCentered);
    } catch (err) {
      console.error('[BiasLens] Analysis flow encountered error:', err);
      if (shadowRoot) {
        const tooltip = shadowRoot.querySelector('.biaslens-tooltip');
        if (tooltip) {
          renderErrorState(tooltip, err.message, contextData, Boolean(contextData.isCenteredFallback));
        }
      }
    } finally {
      isProcessing = false;
    }
  }

  /**
   * Renders the completed analysis card with auto-detected category and dual animated meters
   */
  function renderAnalysisResult(tooltip, data, contextData, isCentered = false) {
    try {
      const {
        detected_category = 'General',
        bias_score = 0,
        hallucination_risk = 0,
        primary_violation = 'None',
        explanation = '',
        flagged_phrases = []
      } = data;

      const biasTier = getScoreTier(bias_score);
      const riskTier = getScoreTier(hallucination_risk);

      const isNoneViolation = primary_violation === 'None';
      const violationClass = isNoneViolation ? 'violation-none' : 'violation-flagged';

      const flaggedHtml = flagged_phrases && flagged_phrases.length > 0
        ? `
          <div class="biaslens-flagged-section">
            <span class="biaslens-section-title">Flagged Phrases</span>
            <div class="biaslens-phrases-wrap">
              ${flagged_phrases.map(p => `<span class="biaslens-phrase-chip" title="Flagged excerpt">“${escapeHtml(p)}”</span>`).join('')}
            </div>
          </div>
        `
        : '';

      const contextPreview = (contextData.surroundingContext || contextData.selectedText || '').trim();

      tooltip.innerHTML = `
        <div class="biaslens-header">
          <div class="biaslens-brand">
            <svg class="biaslens-header-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7" stroke="#38bdf8"/>
              <path d="M21 21l-4.35-4.35" stroke="#38bdf8" stroke-linecap="round"/>
            </svg>
            <span class="biaslens-title">BiasLens</span>
            <span class="biaslens-mode-badge" title="Auto-Detected Category">${escapeHtml(detected_category)}</span>
          </div>
          <div class="biaslens-actions">
            <button class="biaslens-icon-btn biaslens-copy-btn" title="Copy Analysis">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="biaslens-icon-btn biaslens-close-btn" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div class="biaslens-body">
          <!-- Dual Animated Score Grid -->
          <div class="biaslens-scores-grid">
            <!-- Bias Score Meter -->
            <div class="biaslens-score-card tier-${biasTier.tier}">
              <div class="biaslens-score-label">
                <span>Bias Severity</span>
                <span class="biaslens-tier-text score-${biasTier.color}">${biasTier.label}</span>
              </div>
              <div class="biaslens-score-val-wrap">
                <span class="biaslens-score-num score-${biasTier.color}">${bias_score}</span>
                <span class="biaslens-score-max">/100</span>
              </div>
              <div class="biaslens-progress-track">
                <div class="biaslens-progress-bar score-${biasTier.color}-bg" id="biasProgressBar"></div>
              </div>
            </div>

            <!-- Hallucination Risk Meter -->
            <div class="biaslens-score-card tier-${riskTier.tier}">
              <div class="biaslens-score-label">
                <span>Hallucination Risk</span>
                <span class="biaslens-tier-text score-${riskTier.color}">${riskTier.label}</span>
              </div>
              <div class="biaslens-score-val-wrap">
                <span class="biaslens-score-num score-${riskTier.color}">${hallucination_risk}</span>
                <span class="biaslens-score-max">/100</span>
              </div>
              <div class="biaslens-progress-track">
                <div class="biaslens-progress-bar score-${riskTier.color}-bg" id="riskProgressBar"></div>
              </div>
            </div>
          </div>

          <!-- Primary Violation Banner -->
          <div class="biaslens-violation-card">
            <span class="biaslens-violation-label">Primary Pattern:</span>
            <span class="biaslens-violation-tag ${violationClass}">${escapeHtml(primary_violation)}</span>
          </div>

          <!-- Strict 2-sentence rationale -->
          <div class="biaslens-explanation">
            ${escapeHtml(explanation)}
          </div>

          <!-- Flagged Phrases -->
          ${flaggedHtml}

          <!-- Context Accordion & Scrollable Metadata Drawer -->
          <details class="biaslens-context-details">
            <summary class="biaslens-context-summary">
              <span>Deep Surrounding Context</span>
              <span style="font-size: 10px;">▼</span>
            </summary>
            <div class="biaslens-context-body">
              <div class="biaslens-context-row">
                <span class="biaslens-context-key">Detected Category</span>
                <span class="biaslens-context-val" style="color: #a5b4fc; font-weight: 600;">${escapeHtml(detected_category)}</span>
              </div>
              <div class="biaslens-context-row">
                <span class="biaslens-context-key">Page Title</span>
                <span class="biaslens-context-val">${escapeHtml(contextData.pageTitle || 'Untitled Page')}</span>
              </div>
              <div class="biaslens-context-row">
                <span class="biaslens-context-key">Section Header</span>
                <span class="biaslens-context-val">${escapeHtml(contextData.sectionHeading || 'General Section')}</span>
              </div>
              <div class="biaslens-context-row">
                <span class="biaslens-context-key">Surrounding Context Excerpt</span>
                <span class="biaslens-context-val">"${escapeHtml(contextPreview.slice(0, 350))}${contextPreview.length > 350 ? '...' : ''}"</span>
              </div>
            </div>
          </details>
        </div>
      `;

      setupDraggable(tooltip);
      isolateScrollEvents(tooltip);
      if (!isCentered && contextData.rect) {
        readjustElementBounds(tooltip, contextData.rect);
      }

      requestAnimationFrame(() => {
        try {
          const biasBar = tooltip.querySelector('#biasProgressBar');
          const riskBar = tooltip.querySelector('#riskProgressBar');
          if (biasBar) biasBar.style.width = `${bias_score}%`;
          if (riskBar) riskBar.style.width = `${hallucination_risk}%`;
        } catch {
          // ignore
        }
      });

      tooltip.querySelector('.biaslens-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.remove();
      });

      const copyBtn = tooltip.querySelector('.biaslens-copy-btn');
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const copyText = `BiasLens Analysis [${detected_category}]:
• Bias Score: ${bias_score}/100 (${biasTier.label})
• Hallucination Risk: ${hallucination_risk}/100 (${riskTier.label})
• Primary Violation: ${primary_violation}
• Explanation: ${explanation}
• Highlighted Excerpt: "${contextData.selectedText}"`;

        try {
          await navigator.clipboard.writeText(copyText);
          copyBtn.style.color = '#34d399';
          setTimeout(() => { copyBtn.style.color = ''; }, 1800);
        } catch (clipErr) {
          console.error('[BiasLens] Failed to copy analysis:', clipErr);
        }
      });
    } catch (renderErr) {
      console.error('[BiasLens] Failed to render analysis result:', renderErr);
    }
  }

  /**
   * Renders error state with retry option
   */
  function renderErrorState(tooltip, errorMessage, contextData, isCentered = false) {
    try {
      tooltip.innerHTML = `
        <div class="biaslens-header">
          <div class="biaslens-brand">
            <svg class="biaslens-header-logo" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span class="biaslens-title">Analysis Failed</span>
          </div>
          <div class="biaslens-actions">
            <button class="biaslens-icon-btn biaslens-close-btn" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="biaslens-body">
          <div class="biaslens-error-box">
            <div class="biaslens-error-title">Error Details</div>
            <div>${escapeHtml(errorMessage)}</div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
              Tip: Refresh the webpage or try again in a few moments.
            </div>
          </div>
        </div>
      `;

      setupDraggable(tooltip);
      isolateScrollEvents(tooltip);
      if (!isCentered && contextData.rect) {
        readjustElementBounds(tooltip, contextData.rect);
      }

      tooltip.querySelector('.biaslens-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        tooltip.remove();
      });
    } catch {
      // ignore
    }
  }

  /**
   * Helper to return tier color and label based on numeric score
   */
  function getScoreTier(score) {
    if (score <= 30) {
      return { label: 'Low', color: 'low', tier: 'low' };
    } else if (score <= 70) {
      return { label: 'Moderate', color: 'med', tier: 'med' };
    } else {
      return { label: 'Severe', color: 'high', tier: 'high' };
    }
  }

  /**
   * Robust Drag-and-Drop using Pointer Events API with Pointer Capture
   */
  function setupDraggable(tooltipEl) {
    const header = tooltipEl.querySelector('.biaslens-header');
    if (!header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
      try {
        if (e.target.closest('.biaslens-icon-btn')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const bRect = tooltipEl.getBoundingClientRect();
        tooltipEl.style.transform = 'none';
        tooltipEl.style.left = `${bRect.left}px`;
        tooltipEl.style.top = `${bRect.top}px`;

        initialLeft = bRect.left;
        initialTop = bRect.top;

        header.setPointerCapture(e.pointerId);
      } catch {
        // fallback
      }
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      try {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const viewportWidth = window.innerWidth || 800;
        const viewportHeight = window.innerHeight || 600;
        const cardWidth = tooltipEl.offsetWidth || 360;
        const cardHeight = tooltipEl.offsetHeight || 300;

        const newLeft = Math.max(10, Math.min(viewportWidth - cardWidth - 10, initialLeft + dx));
        const newTop = Math.max(10, Math.min(viewportHeight - cardHeight - 10, initialTop + dy));

        tooltipEl.style.left = `${newLeft}px`;
        tooltipEl.style.top = `${newTop}px`;
      } catch {
        // ignore
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        header.releasePointerCapture(e.pointerId);
      } catch {
        // fallback
      }
    };

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }

  /**
   * Helper to escape HTML characters
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Debounced Selection Change Handler on user gestures
   */
  let selectionTimeout = null;
  async function handleSelectionEvent(event) {
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(async () => {
      try {
        const selectedStr = (
          window.getSelection?.()?.toString() ||
          document.getSelection?.()?.toString() ||
          document.activeElement?.shadowRoot?.getSelection?.()?.toString() ||
          ''
        ).trim();

        if (selectedStr.length <= 5) {
          if (shadowRoot) {
            const trigger = shadowRoot.querySelector('.biaslens-trigger-btn');
            if (trigger) trigger.remove();
          }
          return;
        }

        console.log('[BiasLens] Text selected:', selectedStr.slice(0, 50) + (selectedStr.length > 50 ? '...' : ''));

        const context = extractSelectionContext(event);
        if (!context) return;

        currentSelectionData = context;
        showTriggerBadge(context);
      } catch (selErr) {
        console.warn('[BiasLens] Selection event processing failed:', selErr);
      }
    }, 150);
  }

  // Event Listeners with Capture Phase
  document.addEventListener('mouseup', (e) => {
    try {
      if (shadowHost && e.composedPath && e.composedPath().includes(shadowHost)) {
        e.stopPropagation();
        return;
      }
      handleSelectionEvent(e);
    } catch {
      // ignore
    }
  }, { capture: true });

  document.addEventListener('keyup', (e) => {
    try {
      if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        handleSelectionEvent(e);
      }
    } catch {
      // ignore
    }
  }, { capture: true });

  // Global Click-Outside Dismissal
  document.addEventListener('mousedown', (e) => {
    try {
      if (!shadowHost) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (!path.includes(shadowHost)) {
        removeOverlays();
        cachedSelectionData = null;
        currentSelectionData = null;
      }
    } catch {
      // ignore
    }
  }, { capture: true });

  // Escape key closes overlay
  document.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Escape') {
        removeOverlays();
        cachedSelectionData = null;
        currentSelectionData = null;
      }
    } catch {
      // ignore
    }
  });

  /**
   * Universal Context Menu Message Listener from background.js
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.action === 'TRIGGER_CONTEXT_ANALYSIS') {
        console.log('[BiasLens] Received TRIGGER_CONTEXT_ANALYSIS message with text length:', request.selectedText?.length);

        let text = (request.selectedText || '').trim();
        if (!text) {
          try {
            text = (
              window.getSelection?.()?.toString() ||
              document.getSelection?.()?.toString() ||
              document.activeElement?.shadowRoot?.getSelection?.()?.toString() ||
              ''
            ).trim();
          } catch {
            text = '';
          }
        }

        if (text && text.length > 5) {
          // Pre-cached page metadata lookup
          if (!pageMetadataCache.title || (Date.now() - pageMetadataCache.lastUpdated > 5000)) {
            updatePageMetadataCache();
          }

          const contextData = {
            selectedText: text,
            surroundingContext: cachedSelectionData?.surroundingContext || text,
            rect: null,
            isCenteredFallback: true,
            pageTitle: pageMetadataCache.title || document.title || 'Untitled Page',
            sectionHeading: pageMetadataCache.primaryHeading || 'General Section',
            pageUrl: window.location.href || ''
          };

          startAnalysisFlow(contextData);
          sendResponse({ success: true });
          return true;
        } else {
          sendResponse({ success: false, reason: 'Selection text too short.' });
          return true;
        }
      }
    } catch (msgErr) {
      console.warn('[BiasLens] Error handling context menu message:', msgErr);
      sendResponse({ success: false, error: msgErr.message });
      return true;
    }
  });
})();
