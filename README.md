# BiasLens 🛡️

BiasLens is a high-performance, privacy-first Chrome extension that acts as a real-time linguistic and rhetorical forensic tool. By leveraging Gemini flash models through a secure Cloudflare Worker proxy, BiasLens analyses highlighted web text to detect emotional manipulation, cognitive bias, and unsupported AI hallucinations instantly.

## Architecture & System Design

BiasLens utilizes a modern Manifest V3 extension architecture paired with a serverless edge backend:

* **Client Extension (`content.js`, `background.js`):** Intercepts user text selections, harvests local DOM context (surrounding paragraphs and page headers), and communicates securely via an asynchronous message bridge.
* **Edge Proxy (`Cloudflare Worker`):** Acts as a secure reverse proxy holding the secret API key in encrypted environment variables. It enforces automated multi-model failover and strict CORS policies.
* **Inference Engine (`Google Gemini API`):** Employs strict JSON schema generation (`responseSchema`) to guarantee parseable, structured analytical output with zero retry overhead.

## Technologies Used

* **Frontend:** Vanilla JavaScript (ES6+), CSS3, Chrome Extensions API (Manifest V3)
* **Backend / Edge:** Cloudflare Workers (JavaScript/V8 runtime)
* **AI / ML:** Google Gemini 3.x Flash models via Google AI Studio

## Features & Advantages

* **Context-Aware Analysis:** Evaluates text within its actual discussion thread rather than in isolation.
* **Decoupled Scoring Metrics:** Separates rhetorical bias (emotional spin) from hallucination risk (empirical verifiability) using a quantised scoring matrix.
* **Zero User Configuration:** Users install the extension and immediately analyse text without dealing with API keys or complex setup.
* **Privacy-First:** No browsing data, personal identifiers, or text selections are logged, stored, or sold.

## Installation & Local Setup

1. Clone the repository:
   ```bash
   git clone [https://github.com/mistovek016/BiasLens.git](https://github.com/mistovek016/BiasLens.git)
