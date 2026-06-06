# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Quick Start: Essential Commands

```bash
# Installation & setup
npm install
npm run setup:xhs              # Install Chromium for XHS browser automation

# Development
npm run dev:all               # Run frontend (5173) + backend (3001) concurrently
npm run dev                   # Frontend only (Vite)
npm run server                # Backend only (Express)

# Testing
npm run test:proxy            # Proxy security tests
npm run test:providers        # LLM provider config tests
npm run test:agent-loop       # Agent loop tests
npm run test:agent-llm        # LLM client protocol tests
npm run test:agent-timeout    # Agent timeout tests
npm run test:publish-goals    # Publishing goals tests

# Build & quality
npm run build                 # Vite production build
npm run lint                  # ESLint (fix: eslint . --fix)
npm run preview               # Preview production build
```

**Run a single test file:**
```bash
node test/agent/agent-loop.test.js
```

**Watch frontend changes:** Vite auto-reloads on file changes. Backend requires manual restart.

---

## Architecture Overview

### System Layers

**Frontend (React + Vite)**
- `src/main.jsx` — Entry point with React DOM root
- `src/App.jsx` — Main UI component
- `src/lib/generation.js` — Draft generation orchestration (calls backend LLM proxy)
- `src/lib/providers.js` — LLM provider definitions (OpenAI, Anthropic, Gemini, NVIDIA NIM, Ollama, custom)
- `src/lib/publishing.js` — Publishing flow (API & browser automation paths)
- `public/` — Static assets

**Backend (Express)**
- `server/index.js` — Main server, CORS, proxy endpoints
- `server/proxy-security.js` — Allowlist validation for LLM proxying
- `server/agent/` — ReAct agent loop for browser automation
  - `agent-loop.js` — Iterative agent (observe DOM → ask LLM → execute action → repeat)
  - `llm-client.js` — Protocol-aware LLM calls (OpenAI, Anthropic, Gemini, NVIDIA NIM, Ollama)
  - `agent-prompts.js` — System prompts for agent actions
  - `dom-snapshot.js` — DOM extraction and interactive element detection
  - `heal-engine.js` — Single-shot repair mode (backup to agent loop)
- `server/fb.js`, `server/ig.js`, `server/xhs.js` — Platform-specific automation endpoints

**Core Data Flow**
1. Frontend: User uploads image(s), enters context
2. Frontend calls `/api/llm/draft` (backend proxy to configured LLM)
3. Backend validates destination URL via allowlist, forwards to LLM
4. LLM returns 4-platform JSON drafts
5. Frontend displays drafts for user review, edit, copy, regenerate
6. Optional: User clicks Publish → browser automation or API flow

---

## LLM Provider System

**Key file:** `src/lib/providers.js`

The system supports multi-provider flexibility:
- **OpenAI-compatible** — OpenAI, NVIDIA NIM, Ollama, custom endpoints
- **Anthropic** — Anthropic Messages API
- **Gemini** — Google Gemini (native protocol)

**Configuration in UI:**
1. Settings (⚙️) → Choose provider
2. Enter API key if required (some local providers don't need keys)
3. Vision-capable models only (e.g., gpt-4o, claude-3-5-sonnet, gemini-2-flash)

**Backend proxy (`server/proxy-security.js`):**
- Validates destination URL against allowlist
- Rejects private networks (`localhost`, `127.0.0.1`, `192.168.*`, etc.)
- Redacts API keys from error messages
- Limits to POST method only

**Local Ollama example:**
- Base URL: `http://localhost:11434/v1`
- Model: `llama2-vision` or similar
- No API key required

---

## Agent Loop (ReAct for Browser Automation)

**Used for:** XHS, Facebook personal, Instagram personal (experimental V2.5 feature)

**Entry point:** `server/agent/agent-loop.js`

**How it works:**
1. Takes initial goal (e.g., "完成小紅書發文流程")
2. Loop iteration:
   - `extractInteractiveElements()` — Parse DOM, screenshot
   - `buildAgentStepPrompt()` — Build step-specific prompt
   - `callAgentLLM()` — Ask model for single action
   - Execute action (click, type, scroll)
   - Wait 2s for page to settle
3. Repeat until:
   - LLM reports "done"
   - Max steps (default 15) reached
   - Error occurs

**Configuration:**
```javascript
const maxSteps = 15;      // iterations per round
const maxRounds = 1;      // number of retries
const stepTimeout = 15000; // 15s per action
```

**Logging:** Uses ANSI colors for readability in terminal.

---

## Draft Generation Output Schema

**Current format:** Single `content` string per platform (for backward compatibility)

**Target format (P1):** Structured schema
```json
{
  "title": "Opening line or platform title",
  "body": "Main copy",
  "hashtags": ["#tag1", "#tag2"],
  "imageAlt": "Image description",
  "notes": "Generation rationale"
}
```

**Platform specs (from `src/lib/generation.js`):**
| Platform | Tone | Structure | Hashtags |
|---|---|---|---|
| Instagram | Visual, poetic, 2-4 sentences | Story-like | 8+ |
| XHS (小紅書) | Conversational, emotional, 3-5 sentences + bullets | Girlfriend vibe | 6-10 + emoji |
| Facebook | Narrative, friendly, 3-6 sentences | Complete story arc | 3-5 |
| Threads | Ultra-short, 1-2 sentences | Microcopy / hot take | 2-3 |

---

## Publishing Paths

**V1 (Drafting only):** No publishing yet.

**V1.5 (Publishing Assist):**
- User confirms draft
- Publish dialog shows platform, account type, image count, final copy
- Paths: API (Facebook, Instagram, Threads) or Browser (XHS, personal accounts)

**V2.5 (Experimental Browser Automation):**
- XHS creator portal
- Facebook personal
- Instagram personal
- Risks: May violate TOS, may break if UI changes

---

## Testing Strategy

**Test files:** `test/` directory mirrors server structure.

| Test | Purpose | Run |
|---|---|---|
| `proxy-security.test.js` | Allowlist validation | `npm run test:proxy` |
| `providers.test.js` | LLM provider config validation | `npm run test:providers` |
| `agent/agent-loop.test.js` | Agent iteration logic | `npm run test:agent-loop` |
| `agent/llm-client.test.js` | Multi-protocol LLM calls | `npm run test:agent-llm` |
| `agent/agent-timeout.test.js` | Timeout handling | `npm run test:agent-timeout` |
| `agent/publish-goals.test.js` | Publishing goal parsing | `npm run test:publish-goals` |

**Writing new tests:** Use Node's built-in `assert` module (already in use).

---

## Development Workflow & Principles

This project follows **Karpathy Guidelines** for AI-assisted coding (see Section 2 of the global CLAUDE.md):

1. **Think Before Coding** — Clarify assumptions; no hidden confusion
2. **Simplicity First** — Minimal code, no speculative features
3. **Surgical Changes** — Only edit what's necessary; clean up only your own mess
4. **Goal-Driven Execution** — Define success criteria; verify iteratively

**RTK (Token Killer):** If installed, use `rtk git`, `rtk grep`, `rtk cat` for 80% token savings.

---

## Common Development Tasks

### Add a new LLM provider
1. Add provider definition to `providers.js` (name, baseUrl template, models)
2. Implement protocol handler in `server/agent/llm-client.js` (if new protocol)
3. Test with `npm run test:providers`

### Fix agent loop reliability
1. Check `dom-snapshot.js` for selector accuracy
2. Adjust `SETTLE_DELAY` or `stepTimeout` in `agent-loop.js`
3. Review agent system prompt in `agent-prompts.js`
4. Test with `npm run test:agent-loop`

### Update platform-specific copy rules
1. Edit `src/lib/generation.js` SYSTEM_PROMPT (lines 3–47)
2. Update specs in `ARCH.md` or `PROMPTS.md` for reference
3. Verify with manual testing in UI (upload image, check draft tone)

### Debug LLM response format
1. Check `extractJsonBlock()` in `generation.js` (handles JSON parsing)
2. Ensure all 4 platforms are populated in response
3. Look for common issues: extra newlines, code fences, markdown wrapping

---

## File Structure Reference

```
MySocialMediaAgent/
├── server/
│   ├── index.js                    # Express server
│   ├── proxy-security.js           # URL allowlist validation
│   ├── fb.js, ig.js, xhs.js        # Platform automation
│   └── agent/
│       ├── agent-loop.js           # ReAct agent loop
│       ├── agent-prompts.js        # Agent system prompts
│       ├── llm-client.js           # Multi-protocol LLM client
│       ├── dom-snapshot.js         # DOM parsing
│       ├── heal-engine.js          # Single-shot repair
│       └── publish-goals.js        # Goal parsing
├── src/
│   ├── main.jsx                    # React entry
│   ├── App.jsx                     # Main UI
│   └── lib/
│       ├── generation.js           # Draft generation
│       ├── providers.js            # LLM provider config
│       └── publishing.js           # Publishing flow
├── test/                           # Test files (mirror server structure)
├── package.json                    # NPM scripts
├── ARCH.md                         # Detailed architecture & roadmap
├── PRD.md                          # Product requirements & scope
├── PROMPTS.md                      # Platform prompt examples
└── README.md                       # User-facing setup guide
```

---

## Debugging Tips

**Frontend (Vite):**
- Open browser console (`F12`) for React errors
- Check `http://localhost:5173` (frontend)
- Network tab shows `/api/llm/draft` requests

**Backend (Node):**
- Logs print to terminal where `npm run server` runs
- Check proxy allowlist: `server/proxy-security.js` line ~20
- Agent loop logs use ANSI colors (see `agent-loop.js` line 22–29)

**LLM calls:**
- Verify provider config in UI (Settings → Provider name, API key)
- Check backend logs for API errors (URL, auth, response format)
- Try simpler query first (text-only) before vision

**Browser automation:**
- Agent loop timeout: 15s per step (can adjust in `agent-loop.js` line 18)
- DOM selectors: Update in `dom-snapshot.js` if platform UI changes
- Take screenshots for debugging: agent logs include them (with redaction)

---

## Related Documentation

- **ARCH.md** — Detailed architecture, roadmap (P0/P1/P2)
- **PRD.md** — Product scope, version stages (V1–V2.5)
- **PROMPTS.md** — Platform-specific copy guidelines
- **README.md** — User setup & feature overview

---

## Global Coding Guidelines

This project also adheres to global guidelines in the linked CLAUDE.md files (via symlinks in `.clinerules`, `.windsurfrules`, etc.):

- **Section 2:** Karpathy Guidelines (think first, simplicity, surgical changes, goal-driven)
- **Section 3:** RTK rules (token optimization)
- **Section 7:** Developer communication protocol (terse, direct, no filler)

These are **meta-guidelines for how to write code and collaborate**, not project-specific rules.
