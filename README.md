# Agent Jake Browser MCP Extension

A Chrome extension that enables AI agents to automate browser interactions through the Model Context Protocol (MCP).

## Overview

This extension works as a companion to [agent-jake-browser-mcp-server](https://github.com/SnakeO/agent-jake-browser-mcp-server). Together, they provide a complete browser automation solution for AI agents like Claude, enabling them to navigate websites, click elements, fill forms, take screenshots, and more.

## Architecture

```
┌─────────────────┐     stdio      ┌─────────────────┐   WebSocket    ┌──────────────────┐
│   AI Agent      │◄──────────────►│   MCP Server    │◄──────────────►│ Chrome Extension │
│ (Claude, etc.)  │   JSON-RPC     │  (Node.js)      │   port 8765    │  (This project)  │
└─────────────────┘                └─────────────────┘                └────────┬─────────┘
                                                                               │
                                                                               │ Chrome
                                                                               │ Debugger
                                                                               │ API
                                                                               ▼
                                                                      ┌──────────────────┐
                                                                      │   Browser Tab    │
                                                                      │  (Any website)   │
                                                                      └──────────────────┘
```

## Features

- **23 Browser Automation Tools** - Navigate, click, type, screenshot, and more
- **ARIA Accessibility Tree** - Get structured page snapshots for AI understanding
- **Tab Management** - Open, switch, and close browser tabs
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

1. **Start the MCP Server** - Make sure [agent-jake-browser-mcp-server](https://github.com/SnakeO/agent-jake-browser-mcp-server) is running

2. **Connect a Tab** - Click the extension icon and select a tab to automate

3. **Use with AI** - The AI agent can now control the connected tab

### Popup UI

- **Green dot** - Connected to MCP server and ready
- **Yellow dot** - Tab connected, waiting for server
- **Gray dot** - No tab connected

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
```

## Project Structure

```
src/
├── background/          # Service worker
│   ├── index.ts         # Entry point
│   ├── ws-client.ts     # WebSocket client
│   ├── tab-manager.ts   # Tab connection management
│   └── tool-handlers/   # Tool implementations
├── popup/               # Extension popup UI
│   ├── index.html
│   ├── popup.ts
│   └── popup.css
├── types/               # Shared TypeScript types
└── utils/               # Utility functions
```

## Tech Stack

- TypeScript
- Vite + CRXJS (Chrome Extension build)
- Chrome Extension Manifest V3
- Chrome Debugger API (CDP)
- WebSocket for server communication

## Related

- [agent-jake-browser-mcp-server](https://github.com/SnakeO/agent-jake-browser-mcp-server) - MCP server that exposes browser tools to AI agents

## License

MIT - See [LICENSE](LICENSE)
