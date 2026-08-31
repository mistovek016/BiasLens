# BiasLens

BiasLens is a Chrome extension that analyses highlighted web text to detect emotional manipulation, cognitive bias, and AI hallucinations. It runs on Gemini Flash models routed through a Cloudflare Worker proxy.

## Architecture

Built with a Manifest V3 extension and a serverless edge backend:

* **Client (`content.js`, `background.js`):** Grabs the user's text selection and local DOM context (surrounding paragraphs and headers), then passes it to the backend.
* **Edge Proxy (Cloudflare Worker):** Acts as a reverse proxy to hide the API key. Enforces CORS policies and handles model failover.
* **Inference (Gemini API):** Uses strict JSON schema generation (`responseSchema`) to guarantee structured, parseable output without retry overhead.

## Tech Stack

* **Frontend:** Vanilla JS, CSS, Chrome Extensions API (Manifest V3)
* **Backend:** Cloudflare Workers
* **AI:** Gemini Flash models

## Features

* **Context-Aware:** Evaluates text using the surrounding page context rather than in isolation.
* **Decoupled Scoring:** Separates rhetorical bias from hallucination risk using a quantised scoring matrix.
* **Plug-and-Play:** Works immediately on install. Users don't need to configure their own API keys.
* **Private:** Text selections and browsing data are not logged or stored.

## Local Setup

1. Clone the repository:
   ```bash
   git clone [https://github.com/mistovek016/BiasLens.git](https://github.com/mistovek016/BiasLens.git)
