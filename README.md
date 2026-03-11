# Log Sight

Log Sight is a VS Code extension that provides a debug-console-style log viewer with timestamps and level-aware filtering.

## Why Log Sight

- View logs in a single focused panel.
- Separate `debug`, `warning`, and `error` signals quickly.
- Capture debug adapter output across different languages and debug sessions, then inspect it with filters.

## Features

- Timestamped log entries for every message.
- Log levels: `debug`, `warning`, `error`.
- Console-style panel with filters: `All`, `Debug`, `Warning`, `Error`.
- Start and stop capture controls in the panel and Command Palette.
- Manual log commands from Command Palette.
- Programmatic append API for integration with commands and automation.
- Mirrors extension-host `console.debug`, `console.warn`, and `console.error`.

## Commands

- `Log Sight: Show Console`
- `Log Sight: Start Log Capture`
- `Log Sight: Stop Log Capture`
- `Log Sight: Add Debug Log`
- `Log Sight: Add Warning Log`
- `Log Sight: Add Error Log`
- `Log Sight: Clear Logs`

## Usage

1. Open Command Palette.
2. Run `Log Sight: Show Console`.
3. Start your app/debug session.
4. Use the `Start` and `Stop` controls to pause or resume capture.
5. Use level chips to filter logs.

## Programmatic API

Use command `logsight.appendLog` to append logs from your own extension workflow:

```ts
await vscode.commands.executeCommand("logsight.appendLog", {
  level: "warning", // "debug" | "warning" | "error"
  message: "Disk usage is above threshold",
  source: "build-pipeline"
});
```

Payload shape:

- `level` (optional): `debug`, `warning`, `warn`, or `error`.
- `message` (optional): log text.
- `source` (optional): short source label shown in the UI.

## Development

```bash
npm install
npm run compile
```

Run locally:

1. Open this project in VS Code.
2. Press `F5` to launch Extension Development Host.
3. In the new window, run `Log Sight: Show Console`.

## Security Notes

- Webview runs with a restrictive Content Security Policy.
- Log content is escaped before rendering in the webview.
- In-memory log store is bounded to prevent unbounded growth.

## Current Limitations

- VS Code does not expose a universal API to capture every log from every extension/process globally.
- To capture logs from another VS Code window/process, Log Sight must also be running in that window.
