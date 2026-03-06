# Log Sight

Log Sight is a VS Code extension that behaves like a lightweight debug console:
- Captures and displays timestamped logs.
- Differentiates `debug`, `warning`, and `error` log levels.
- Provides a dedicated console-style UI with filtering.

## Features

- `Log Sight: Show Console`
  - Opens a console-like webview panel with `All`, `Debug`, `Warning`, and `Error` filters.
- `Log Sight: Add Debug Log`
  - Prompts for a debug message and logs it with a timestamp.
- `Log Sight: Add Warning Log`
  - Prompts for a warning message and logs it with a timestamp.
- `Log Sight: Add Error Log`
  - Prompts for an error message and logs it with a timestamp.
- `Log Sight: Clear Logs`
  - Clears both in-memory logs and the output channel.

The extension also mirrors `console.debug(...)`, `console.warn(...)`, and `console.error(...)` calls from the extension host into Log Sight automatically.

## Programmatic API

Other extension commands or automations can append logs with:

```ts
await vscode.commands.executeCommand("logsight.appendLog", {
  level: "debug", // or "warning" or "error"
  message: "Build started",
  source: "build-pipeline"
});
```

## Build

```bash
npm install
npm run compile
```

## Run

1. Open this project in VS Code.
2. Press `F5` to start the Extension Development Host.
3. Use the Command Palette and run `Log Sight: Show Console`.
