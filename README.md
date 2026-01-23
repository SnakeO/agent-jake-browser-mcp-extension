# Agent Jake Browser MCP Extension

[![Version](https://img.shields.io/badge/version-2.2.3-blue.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/chrome-extension-yellow.svg)](https://developer.chrome.com/docs/extensions/)

A Chrome extension that enables AI agents to automate browser interactions through the Model Context Protocol (MCP) and Laravel Reverb WebSocket.

## Overview

This extension bridges AI agents with browser automation, supporting two connection modes:

- **Local Mode**: Direct WebSocket connection to [agent-jake-browser-mcp-server](https://github.com/SnakeO/agent-jake-browser-mcp-server) for AI agents like Claude
- **Remote Mode**: WebSocket connection to Laravel backend via Reverb for server-coordinated automation

Together, these provide a complete browser automation solution enabling AI agents to navigate websites, click elements, fill forms, take screenshots, and more.

## Architecture

```
┌─────────────────┐     stdio      ┌─────────────────┐   WebSocket    ┌──────────────────┐
│   AI Agent      │◄──────────────►│   MCP Server    │◄──────────────►│ Chrome Extension │
│ (Claude, etc.)  │   JSON-RPC     │  (Node.js)      │   port 8765    │  (This project)  │
└─────────────────┘                └─────────────────┘                └────────┬─────────┘
                                                                               │
                  ┌─────────────────┐   Reverb WS    ┌──────────────────────────┤
                  │  Laravel Server │◄──────────────►│                          │
                  │ (agent-jake-app)│   port 8085    │                          │
                  └─────────────────┘                │   Chrome Debugger API    │
                                                     ▼                          │
                                            ┌──────────────────┐               │
                                            │   Browser Tab    │◄──────────────┘
                                            │  (Any website)   │
                                            └──────────────────┘
```

## Features

- **23 Browser Automation Tools** - Navigate, click, type, hover, drag, screenshot, and more
- **ARIA Accessibility Tree** - Structured page snapshots for AI understanding
- **Vue 3 Popup UI** - Modern, responsive extension interface with dark theme
- **Dual Connection Model** - Local MCP server + Remote Laravel Reverb WebSocket
- **Authentication** - Secure login with Laravel Sanctum token-based auth
- **Activity Logging** - Full audit trail of all actions with filtering
- **Session Management** - Auto-restore sessions, heartbeat keep-alive, graceful offline handling
- **Tab Management** - Connect, switch, and manage browser tabs
- **Console Log Access** - Read browser console messages
- **Visual Debugging** - Highlight elements for debugging

## Installation

### Load as Unpacked Extension

1. Clone this repository:
   ```bash
   git clone https://github.com/SnakeO/agent-jake-browser-mcp-extension.git
   cd agent-jake-browser-mcp-extension
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Open Chrome and go to `chrome://extensions/`

4. Enable "Developer mode" (toggle in top right)

5. Click "Load unpacked" and select the `dist/` folder

6. The extension icon should appear in your toolbar

## Usage

1. **Login** - Click the extension icon and enter your credentials to authenticate with the Laravel backend

2. **Connect to Server** - The extension automatically connects to Reverb WebSocket on successful login

3. **Select a Tab** - Choose a browser tab to automate from the popup

4. **Monitor Status** - The popup shows connection state and activity log

### Connection Indicators

| Indicator | Meaning |
|-----------|---------|
| SERVER: ONLINE (cyan) | Connected to Reverb WebSocket |
| SERVER: SYNC (yellow) | Connecting to server |
| SERVER: RETRY (yellow) | Reconnecting after disconnect |
| SERVER: ERROR (red) | Connection failed |
| SERVER: OFFLINE (gray) | Not connected |
| TAB: [title] (green) | Tab connected and ready |
| TAB: Pick a tab (gray) | No tab selected |

## Development

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck

# Run E2E tests with Playwright
npm test

# Run unit tests with Vitest
npm run test:unit

# Watch unit tests
npm run test:unit:watch
```

## Project Structure

```
src/
├── background/              # Service worker (Manifest V3)
│   ├── index.ts             # Entry point, message routing
│   ├── ws-client.ts         # Local MCP WebSocket client
│   ├── reverb-client.ts     # Laravel Reverb WebSocket client
│   ├── auth-service.ts      # Authentication & session management
│   ├── api-client.ts        # HTTP API client
│   ├── tab-manager.ts       # Chrome Debugger API integration
│   ├── tool-handlers.ts     # Tool implementations
│   ├── activity-log.ts      # Action logging to Chrome storage
│   ├── connection-state.ts  # Connection state with backoff
│   └── tools/               # Tool schemas & utilities
├── popup/                   # Vue 3 popup UI
│   ├── App.vue              # Root component
│   ├── main.ts              # Vue app initialization
│   ├── components/          # UI components
│   │   ├── AuthForm.vue     # Login form
│   │   ├── UserCard.vue     # User profile display
│   │   ├── ConnectionStatus.vue  # Connection indicators
│   │   ├── TabSelector.vue  # Tab selection
│   │   ├── ActivityLog.vue  # Recent activity
│   │   └── ActivityModal.vue # Activity details modal
│   ├── stores/              # Pinia state management
│   │   ├── auth.ts          # Authentication state
│   │   ├── status.ts        # Connection & tab state
│   │   └── activity.ts      # Activity log state
│   ├── composables/         # Vue composables
│   ├── constants/           # UI constants
│   └── styles/              # CSS variables & base styles
├── content/                 # Content script (injected into pages)
│   ├── index.ts             # Entry point
│   ├── aria-tree.ts         # ARIA accessibility tree builder
│   ├── selector.ts          # Element reference system
│   └── aria/                # ARIA role mappings
├── types/                   # Shared TypeScript types
├── constants/               # Configuration constants
└── utils/                   # Utilities
```

## Tech Stack

- **TypeScript** - Type-safe development
- **Vue 3** - Popup UI framework with Composition API
- **Pinia** - Vue state management
- **Vite + CRXJS** - Fast Chrome extension builds
- **Laravel Echo + Pusher** - Reverb WebSocket client
- **Zod** - Runtime schema validation
- **Vitest** - Unit testing
- **Playwright** - E2E testing
- **Chrome Debugger API** - Browser automation via CDP

## Configuration

Key configuration values in `src/types/config.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `WS_PORT` | 8765 | Local MCP server WebSocket port |
| `REVERB_PORT` | 8085 | Laravel Reverb WebSocket port |
| `REVERB_HOST` | localhost | Reverb server host |
| `API_URL` | http://localhost:8000 | Laravel backend URL |
| `RECONNECT_INTERVAL_MS` | 5000 | WebSocket reconnect interval |
| `DOM_STABILITY_MS` | 1000 | Wait time after DOM actions |

## Available Tools

The extension exposes 23 browser automation tools:

| Tool | Description |
|------|-------------|
| `navigate` | Navigate to a URL |
| `click` | Click an element |
| `type` | Type text into an element |
| `hover` | Hover over an element |
| `drag` | Drag and drop elements |
| `scroll` | Scroll the page |
| `screenshot` | Capture screenshot |
| `snapshot` | Get ARIA accessibility tree |
| `evaluate` | Execute JavaScript |
| `select` | Select dropdown option |
| `wait` | Wait for element/condition |
| `highlight` | Highlight element visually |
| ... | And more |

## Related Projects

- [agent-jake-browser-mcp-server](https://github.com/SnakeO/agent-jake-browser-mcp-server) - Node.js MCP server that exposes browser tools to AI agents
- [ai-email-sorter-app](https://github.com/SnakeO/ai-email-sorter-app) - Laravel backend with Reverb WebSocket support

## License

MIT - See [LICENSE](LICENSE)
