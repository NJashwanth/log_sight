import * as vscode from "vscode";
import { LogStore } from "./logStore";
import { LogEntry } from "./types";

type ViewFilter = "all" | "debug" | "warning" | "error";

interface PanelMessage {
  type: "setFilter" | "setSearch" | "ready" | "clear" | "startCapture" | "stopCapture";
  value?: ViewFilter;
  query?: string;
}

interface CaptureControls {
  isCapturing: () => boolean;
  onStartCapture: () => void;
  onStopCapture: () => void;
}

export class LogPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentFilter: ViewFilter = "all";
  private searchQuery = "";
  private isCapturing = true;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly logStore: LogStore,
    private readonly captureControls: CaptureControls
  ) {
    this.isCapturing = this.captureControls.isCapturing();

    this.disposables.push(
      this.logStore.onDidChange((entries) => {
        this.postLogs(entries);
      })
    );
  }

  public show(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "logSightConsole",
        "Log Sight Console",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: []
        }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, null, this.disposables);

      this.panel.webview.onDidReceiveMessage((message: PanelMessage) => {
        switch (message.type) {
          case "setFilter":
            this.currentFilter = message.value ?? "all";
            this.postLogs(this.logStore.getAll());
            return;
          case "setSearch":
            this.searchQuery = (message.query ?? "").trim().toLowerCase();
            this.postLogs(this.logStore.getAll());
            return;
          case "clear":
            this.logStore.clear();
            return;
          case "startCapture":
            this.captureControls.onStartCapture();
            return;
          case "stopCapture":
            this.captureControls.onStopCapture();
            return;
          case "ready":
            this.postLogs(this.logStore.getAll());
            this.postCaptureState();
            return;
          default:
            return;
        }
      }, null, this.disposables);

      this.panel.webview.html = this.getHtml(this.panel.webview);
    }

    this.panel.reveal(vscode.ViewColumn.Beside, true);
    this.postLogs(this.logStore.getAll());
    this.postCaptureState();
  }

  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
    this.panel?.dispose();
  }

  public setCaptureState(isCapturing: boolean): void {
    this.isCapturing = isCapturing;
    this.postCaptureState();
  }

  private postLogs(entries: readonly LogEntry[]): void {
    if (!this.panel) {
      return;
    }

    const filtered = entries.filter((entry) => {
      const levelMatches = this.currentFilter === "all" || entry.level === this.currentFilter;
      if (!levelMatches) {
        return false;
      }

      if (this.searchQuery.length === 0) {
        return true;
      }

      const haystack = `${entry.timestamp} ${entry.level} ${entry.source} ${entry.message}`.toLowerCase();
      return haystack.includes(this.searchQuery);
    });

    this.panel.webview.postMessage({
      type: "update",
      payload: filtered
    });
  }

  private postCaptureState(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.postMessage({
      type: "captureState",
      payload: {
        isCapturing: this.isCapturing
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Log Sight Console</title>
  <style>
    :root {
      --bg: #0d1b2a;
      --bg-soft: #12263a;
      --text: #d5e5f5;
      --debug: #4db6ac;
      --warning: #ffcc66;
      --error: #ff6b6b;
      --line: #23435f;
      --chip: #19344d;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Iosevka", "IBM Plex Mono", Consolas, monospace;
      color: var(--text);
      background: radial-gradient(circle at top right, #1b3350, var(--bg));
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg-soft) 85%, black);
      position: sticky;
      top: 0;
    }

    .chip {
      border: 1px solid var(--line);
      color: var(--text);
      background: var(--chip);
      border-radius: 999px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .chip.active {
      border-color: #7fb3d9;
      box-shadow: 0 0 0 1px #7fb3d9 inset;
    }

    .spacer {
      flex: 1;
    }

    .search {
      width: 240px;
      max-width: 40vw;
      border-radius: 6px;
      border: 1px solid #8aa2b8;
      background: rgba(4, 15, 25, 0.5);
      color: var(--text);
      padding: 6px 10px;
      font-family: inherit;
      font-size: 12px;
    }

    .search::placeholder {
      color: #8ba4ba;
    }

    .clear {
      border-radius: 6px;
      border: 1px solid #8aa2b8;
      background: transparent;
      color: var(--text);
      padding: 6px 10px;
      cursor: pointer;
    }

    .toggle {
      border-radius: 6px;
      border: 1px solid #8aa2b8;
      background: transparent;
      color: var(--text);
      padding: 6px 10px;
      cursor: pointer;
    }

    .toggle.stop {
      border-color: #ffcc66;
      color: #ffcc66;
    }

    .toggle.start {
      border-color: #4db6ac;
      color: #4db6ac;
    }

    .status {
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #9bb6cc;
    }

    .status strong {
      color: var(--text);
    }

    #logs {
      padding: 8px 12px 24px;
      overflow: auto;
      flex: 1;
    }

    .jump-latest {
      position: fixed;
      right: 16px;
      bottom: 16px;
      border-radius: 999px;
      border: 1px solid #4db6ac;
      background: rgba(9, 36, 54, 0.9);
      color: #4db6ac;
      padding: 8px 12px;
      font-size: 12px;
      cursor: pointer;
      display: none;
    }

    .jump-latest.show {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .row {
      display: grid;
      grid-template-columns: 190px 70px 1fr;
      gap: 12px;
      padding: 8px;
      border-bottom: 1px dashed var(--line);
      align-items: start;
      font-size: 12px;
      animation: fade-in 150ms ease-out;
    }

    .ts {
      opacity: 0.9;
    }

    .level {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .level.debug {
      color: var(--debug);
    }

    .level.error {
      color: var(--error);
    }

    .level.warning {
      color: var(--warning);
    }

    .msg {
      white-space: pre-wrap;
      line-height: 1.35;
      word-break: break-word;
    }

    .empty {
      padding: 16px;
      opacity: 0.7;
    }

    @keyframes fade-in {
      from { opacity: 0; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="chip active" data-filter="all">All</button>
    <button class="chip" data-filter="debug">Debug</button>
    <button class="chip" data-filter="warning">Warning</button>
    <button class="chip" data-filter="error">Error</button>
    <div class="spacer"></div>
    <input id="search" class="search" type="text" placeholder="Search logs..." aria-label="Search logs">
    <div class="status" id="capture-status">Capture: <strong>Running</strong></div>
    <button class="toggle stop" id="capture-toggle" data-state="running">Stop</button>
    <button class="clear" id="clear">Clear</button>
  </div>

  <div id="logs"></div>
  <button id="jump-latest" class="jump-latest" type="button">Latest</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const logContainer = document.getElementById("logs");
    const chips = Array.from(document.querySelectorAll(".chip"));
    const searchInput = document.getElementById("search");
    const captureStatus = document.getElementById("capture-status");
    const captureToggle = document.getElementById("capture-toggle");
    const jumpLatest = document.getElementById("jump-latest");

    let userScrolledUp = false;

    function setFilter(value) {
      chips.forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === value);
      });
      vscode.postMessage({ type: "setFilter", value });
    }

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        setFilter(chip.dataset.filter);
      });
    });

    searchInput.addEventListener("input", () => {
      vscode.postMessage({ type: "setSearch", query: searchInput.value });
    });

    document.getElementById("clear").addEventListener("click", () => {
      vscode.postMessage({ type: "clear" });
    });

    captureToggle.addEventListener("click", () => {
      const shouldStart = captureToggle.dataset.state === "stopped";
      vscode.postMessage({ type: shouldStart ? "startCapture" : "stopCapture" });
    });

    jumpLatest.addEventListener("click", () => {
      scrollToLatest();
    });

    logContainer.addEventListener("scroll", () => {
      updateJumpLatestVisibility();
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "captureState") {
        setCaptureState(Boolean(message.payload && message.payload.isCapturing));
        return;
      }

      if (message.type !== "update") {
        return;
      }

      const logs = message.payload;
      if (!Array.isArray(logs) || logs.length === 0) {
        logContainer.innerHTML = '<div class="empty">No logs yet.</div>';
        return;
      }

      logContainer.innerHTML = logs.map((log) => {
        const ts = escapeHtml(new Date(log.timestamp).toLocaleString());
        const level = escapeHtml(log.level);
        const source = escapeHtml(log.source);
        const text = escapeHtml(log.message);

        return '<div class="row">'
          + '<div class="ts">' + ts + '</div>'
          + '<div class="level ' + level + '">' + level + '</div>'
          + '<div class="msg">[' + source + '] ' + text + '</div>'
          + '</div>';
      }).join("");

      updateJumpLatestVisibility();
    });

    function updateJumpLatestVisibility() {
      const distanceToBottom = logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight;
      userScrolledUp = distanceToBottom > 8;
      jumpLatest.classList.toggle("show", userScrolledUp);
    }

    function scrollToLatest() {
      logContainer.scrollTop = logContainer.scrollHeight;
      updateJumpLatestVisibility();
    }

    function setCaptureState(isCapturing) {
      captureStatus.innerHTML = 'Capture: <strong>' + (isCapturing ? 'Running' : 'Stopped') + '</strong>';
      captureToggle.dataset.state = isCapturing ? 'running' : 'stopped';
      captureToggle.textContent = isCapturing ? 'Stop' : 'Start';
      captureToggle.classList.toggle('stop', isCapturing);
      captureToggle.classList.toggle('start', !isCapturing);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let i = 0; i < 32; i += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return value;
}
