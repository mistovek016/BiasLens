// background.js - BiasLens Manifest V3 Service Worker (Cloudflare Worker Proxy)

const PROXY_URL = "https://biaslens-proxy.aryaman-aisola.workers.dev";

/**
 * Register Context Menu on installation
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'biaslens-analyze-selection',
    title: 'Analyse with BiasLens',
    contexts: ['selection']
  });
});

/**
 * Handle Context Menu Clicks & Route Data to Active Tab with SPA Re-injection Fallback
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'biaslens-analyze-selection' && tab?.id) {
    const payload = {
      action: 'TRIGGER_CONTEXT_ANALYSIS',
      selectedText: info.selectionText || ''
    };

    chrome.tabs.sendMessage(tab.id, payload, (response) => {
      if (chrome.runtime.lastError || !response) {
        console.warn('[BiasLens] Content script unreachable, injecting dynamically...', chrome.runtime.lastError?.message);

        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            files: ['content.js']
          },
          () => {
            if (chrome.runtime.lastError) {
              console.error('[BiasLens] Failed to inject content script:', chrome.runtime.lastError.message);
              return;
            }

            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, payload, (retryRes) => {
                if (chrome.runtime.lastError) {
                  console.error('[BiasLens] Retry message also failed:', chrome.runtime.lastError.message);
                }
              });
            }, 100);
          }
        );
      }
    });
  }
});

/**
 * Asynchronous Message Listener with synchronous return true
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ANALYZE_BIAS') {
    handleBiasAnalysis(request.payload)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message || 'Unknown error occurred' }));
    return true; // Synchronously keep port open for asynchronous sendResponse
  }
});

/**
 * Main analysis handler routing to PROXY_URL with security handshake and status code handling
 * @param {Object} payload Context extracted from webpage
 */
async function handleBiasAnalysis(payload) {
  const { selectedText, surroundingContext, pageTitle } = payload;

  if (!selectedText || !selectedText.trim()) {
    throw new Error('No text was selected for analysis.');
  }

  console.log('[BiasLens Background] Sending payload to proxy at:', new Date().toISOString());
  const startTime = performance.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25-second client timeout

  let response;
  try {
    response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-BiasLens-Source': 'biaslens-v1'
      },
      body: JSON.stringify({
        selectedText: selectedText.trim(),
        surroundingContext: surroundingContext || selectedText.trim(),
        pageTitle: pageTitle || 'Untitled Page'
      }),
      signal: controller.signal
    });
  } catch (netErr) {
    if (netErr.name === 'AbortError') {
      throw new Error('Analysis request timed out after 25 seconds. Upstream LLM took too long to respond.');
    }
    throw new Error(`Network connection failure: ${netErr.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Math.round(performance.now() - startTime);
  console.log('[BiasLens Background] Received response in:', durationMs, 'ms');

  const modelUsed = response.headers.get('X-Model-Used');
  if (modelUsed) {
    console.log('[BiasLens Background] Model used by proxy:', modelUsed);
  }

  // Handle HTTP status codes according to API contract
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Proxy authentication failed: invalid client handshake.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit reached (20 requests/min). Please wait a minute before analysing more text.');
    }
    if (response.status === 502 || response.status === 503) {
      throw new Error('Upstream analysis service temporarily busy. Please try again in a few seconds.');
    }

    const errorBody = await response.text();
    let parsedMsg = errorBody;
    try {
      const errObj = JSON.parse(errorBody);
      parsedMsg = errObj.error?.message || errObj.error || errorBody;
    } catch {
      // retain raw text
    }

    if (response.status === 400) {
      throw new Error(parsedMsg || 'Bad request sent to analysis proxy.');
    }

    throw new Error(`Proxy Error (${response.status}): ${parsedMsg}`);
  }

  const data = await response.json();
  return sanitizeAnalysisResponse(data);
}

/**
 * Validates and sanitizes analysis payload returned from the proxy
 */
function sanitizeAnalysisResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response format received from proxy.');
  }

  return {
    detected_category: String(data.detected_category || 'General').trim(),
    bias_score: Math.min(100, Math.max(0, Math.round(Number(data.bias_score) || 0))),
    hallucination_risk: Math.min(100, Math.max(0, Math.round(Number(data.hallucination_risk) || 0))),
    primary_violation: String(data.primary_violation || 'None'),
    explanation: String(data.explanation || 'No explanation provided.').trim(),
    flagged_phrases: Array.isArray(data.flagged_phrases)
      ? data.flagged_phrases.filter(p => typeof p === 'string' && p.trim().length > 0)
      : []
  };
}
