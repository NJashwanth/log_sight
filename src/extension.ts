import * as vscode from "vscode";
import { LogPanel } from "./logPanel";
import { LogStore } from "./logStore";
import { LogLevel } from "./types";

interface AppendLogPayload {
  level?: string;
  message?: string;
  source?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  const logStore = new LogStore();
  let isCapturing = true;
  let appendLog: (level: LogLevel, message: string, source?: string, force?: boolean) => void;

  const panel = new LogPanel(context.extensionUri, logStore, {
    isCapturing: () => isCapturing,
    onStartCapture: () => {
      startCapture();
    },
    onStopCapture: () => {
      stopCapture();
    }
  });
  const output = vscode.window.createOutputChannel("Log Sight", { log: true });

  context.subscriptions.push(logStore, panel, output);

  appendLog = (level: LogLevel, message: string, source = "extension", force = false): void => {
    if (!isCapturing && !force) {
      return;
    }

    const trimmed = message.trim();
    const normalized = trimmed.length > 0 ? trimmed : "(empty message)";
    const entry = logStore.add(level, normalized, source);

    const line = `[${entry.source}] ${entry.message}`;
    if (entry.level === "error") {
      output.error(line);
      return;
    }

    if (entry.level === "warning") {
      output.warn(line);
      return;
    }

    output.debug(line);
  };

  const startCapture = (): void => {
    if (isCapturing) {
      return;
    }

    isCapturing = true;
    panel.setCaptureState(true);
    appendLog("debug", "Log capture resumed.", "lifecycle", true);
  };

  const stopCapture = (): void => {
    if (!isCapturing) {
      return;
    }

    appendLog("warning", "Log capture paused.", "lifecycle", true);
    isCapturing = false;
    panel.setCaptureState(false);
  };

  const originalConsoleDebug = console.debug.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const originalConsoleError = console.error.bind(console);

  // Mirror extension-host console debug/error calls into Log Sight automatically.
  console.debug = (...args: unknown[]) => {
    appendLog("debug", args.map(stringifyPart).join(" "), "console.debug");
    originalConsoleDebug(...args);
  };

  console.error = (...args: unknown[]) => {
    appendLog("error", args.map(stringifyPart).join(" "), "console.error");
    originalConsoleError(...args);
  };

  console.warn = (...args: unknown[]) => {
    appendLog("warning", args.map(stringifyPart).join(" "), "console.warn");
    originalConsoleWarn(...args);
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      console.debug = originalConsoleDebug;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
    })
  );

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory("*", {
      createDebugAdapterTracker(session) {
        appendLog("debug", `Debug session started: ${session.name} (${session.type})`, "debug-session");

        return {
          onDidSendMessage: (message: unknown) => {
            const outputEvent = parseOutputEvent(message);
            if (!outputEvent) {
              return;
            }

            const chunks = outputEvent.text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0);

            for (const line of chunks) {
              const level = mapDebugCategoryToLevel(outputEvent.category);
              appendLog(level, line, `debug:${session.type}`);
            }
          },
          onError: (error: Error) => {
            appendLog("error", error.message, `debug:${session.type}`);
          },
          onExit: (code: number | undefined, signal: string | undefined) => {
            const codeText = typeof code === "number" ? String(code) : "n/a";
            const signalText = signal ?? "n/a";
            appendLog("debug", `Debug session exited. code=${codeText} signal=${signalText}`, "debug-session");
          }
        };
      }
    }),
    vscode.commands.registerCommand("logsight.showConsole", () => {
      panel.show();
      output.show(true);
    }),
    vscode.commands.registerCommand("logsight.startCapture", () => {
      if (isCapturing) {
        vscode.window.showInformationMessage("Log Sight capture is already running.");
        return;
      }

      startCapture();
      panel.show();
    }),
    vscode.commands.registerCommand("logsight.stopCapture", () => {
      if (!isCapturing) {
        vscode.window.showInformationMessage("Log Sight capture is already stopped.");
        return;
      }

      stopCapture();
      panel.show();
    }),
    vscode.commands.registerCommand("logsight.logDebug", async () => {
      const message = await vscode.window.showInputBox({
        title: "Log Sight Debug Message",
        placeHolder: "Enter debug log message"
      });

      if (typeof message !== "string") {
        return;
      }

      appendLog("debug", message, "manual");
      panel.show();
    }),
    vscode.commands.registerCommand("logsight.logWarning", async () => {
      const message = await vscode.window.showInputBox({
        title: "Log Sight Warning Message",
        placeHolder: "Enter warning log message"
      });

      if (typeof message !== "string") {
        return;
      }

      appendLog("warning", message, "manual");
      panel.show();
    }),
    vscode.commands.registerCommand("logsight.logError", async () => {
      const message = await vscode.window.showInputBox({
        title: "Log Sight Error Message",
        placeHolder: "Enter error log message"
      });

      if (typeof message !== "string") {
        return;
      }

      appendLog("error", message, "manual");
      panel.show();
    }),
    vscode.commands.registerCommand("logsight.clearLogs", () => {
      logStore.clear();
      output.clear();
    }),
    vscode.commands.registerCommand("logsight.appendLog", (payload: AppendLogPayload) => {
      const level = normalizeLevel(payload.level);
      const message = typeof payload.message === "string" ? payload.message : "";
      const source = typeof payload.source === "string" && payload.source.trim().length > 0
        ? payload.source
        : "api";

      appendLog(level, message, source);
      panel.show();
    })
  );

  appendLog("debug", "Log Sight activated.", "lifecycle");
  panel.setCaptureState(true);
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}

function parseOutputEvent(message: unknown): { text: string; category: string } | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const candidate = message as {
    type?: string;
    event?: string;
    body?: { output?: unknown; category?: unknown };
  };

  if (candidate.type !== "event" || candidate.event !== "output") {
    return undefined;
  }

  const text = typeof candidate.body?.output === "string" ? candidate.body.output : "";
  if (text.trim().length === 0) {
    return undefined;
  }

  const category = typeof candidate.body?.category === "string" ? candidate.body.category : "console";
  return { text, category };
}

function mapDebugCategoryToLevel(category: string): LogLevel {
  if (category === "important") {
    return "warning";
  }

  return category === "stderr" ? "error" : "debug";
}

function normalizeLevel(level?: string): LogLevel {
  const normalized = String(level).toLowerCase();
  if (normalized === "error") {
    return "error";
  }

  if (normalized === "warning" || normalized === "warn") {
    return "warning";
  }

  return "debug";
}

function stringifyPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
