import * as vscode from "vscode";
import * as path from "path";
import { LogStore } from "./logStore";
import { LogEntry } from "./types";

type ViewFilter = "all" | "debug" | "warning" | "error";

interface PanelMessage {
  type: "setFilter" | "setSearch" | "setSource" | "setTimeRange" | "setRegex" | "ready" | "clear" | "startCapture" | "stopCapture" | "openLink";
  value?: ViewFilter;
  query?: string;
  source?: string;
  timeRange?: string;
  enabled?: boolean;
  filePath?: string;
  line?: number;
  column?: number;
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
  private sourceFilter = "all";
  private timeRange = "all";
  private regexSearch = false;
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
          case "setSource":
            this.sourceFilter = (message.source ?? "all").trim() || "all";
            this.postLogs(this.logStore.getAll());
            return;
          case "setTimeRange":
            this.timeRange = (message.timeRange ?? "all").trim() || "all";
            this.postLogs(this.logStore.getAll());
            return;
          case "setRegex":
            this.regexSearch = Boolean(message.enabled);
            this.postLogs(this.logStore.getAll());
            return;
          case "setSearch":
            this.searchQuery = (message.query ?? "").trim();
            this.postLogs(this.logStore.getAll());
            return;
          case "clear":
            this.logStore.clear();
            return;
          case "openLink":
            if (typeof message.filePath === "string" && message.filePath.trim().length > 0) {
              void this.openFileLocation(message.filePath, message.line, message.column);
            }
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

    const threshold = this.getTimeThreshold(this.timeRange);
    const regex = this.tryBuildSearchRegex();

    const filtered = entries.filter((entry) => {
      const levelMatches = this.currentFilter === "all" || entry.level === this.currentFilter;
      if (!levelMatches) {
        return false;
      }

      if (this.sourceFilter !== "all" && entry.source !== this.sourceFilter) {
        return false;
      }

      if (typeof threshold === "number") {
        const timestamp = Date.parse(entry.timestamp);
        if (!Number.isFinite(timestamp) || timestamp < threshold) {
          return false;
        }
      }

      if (this.searchQuery.length === 0) {
        return true;
      }

      const haystack = `${entry.timestamp} ${entry.level} ${entry.source} ${entry.message}`;
      if (regex) {
        return regex.test(haystack);
      }

      return haystack.toLowerCase().includes(this.searchQuery.toLowerCase());
    });

    const sources = Array.from(new Set(entries.map((entry) => entry.source))).sort((left, right) => left.localeCompare(right));
    const collapsed = collapseConsecutiveDuplicates(filtered);

    this.panel.webview.postMessage({
      type: "update",
      payload: {
        logs: collapsed,
        sources,
        regexError: this.regexSearch && this.searchQuery.length > 0 && !regex
      }
    });
  }

  private getTimeThreshold(timeRange: string): number | undefined {
    const now = Date.now();

    if (timeRange === "5m") {
      return now - 5 * 60 * 1000;
    }

    if (timeRange === "15m") {
      return now - 15 * 60 * 1000;
    }

    if (timeRange === "1h") {
      return now - 60 * 60 * 1000;
    }

    if (timeRange === "24h") {
      return now - 24 * 60 * 60 * 1000;
    }

    return undefined;
  }

  private tryBuildSearchRegex(): RegExp | undefined {
    if (!this.regexSearch || this.searchQuery.length === 0) {
      return undefined;
    }

    try {
      return new RegExp(this.searchQuery, "i");
    } catch {
      return undefined;
    }
  }

  private async openFileLocation(rawPath: string, line?: number, column?: number): Promise<void> {
    const trimmed = rawPath.trim();
    const candidates: vscode.Uri[] = [];

    if (trimmed.startsWith("file://")) {
      candidates.push(vscode.Uri.parse(trimmed));
    } else if (path.isAbsolute(trimmed)) {
      candidates.push(vscode.Uri.file(trimmed));
    } else {
      const folders = vscode.workspace.workspaceFolders ?? [];
      for (const folder of folders) {
        candidates.push(vscode.Uri.file(path.resolve(folder.uri.fsPath, trimmed)));
      }
    }

    for (const candidate of candidates) {
      try {
        await vscode.workspace.fs.stat(candidate);
        const document = await vscode.workspace.openTextDocument(candidate);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const targetLine = Math.max(0, (line ?? 1) - 1);
        const targetColumn = Math.max(0, (column ?? 1) - 1);
        const position = new vscode.Position(targetLine, targetColumn);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      } catch {
        // Try the next candidate.
      }
    }

    void vscode.window.showWarningMessage(`Log Sight could not find file: ${trimmed}`);
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
      --chip-active: #0f4f78;
      --group: #89b7da;
      --link: #7bc5ff;
      --danger: #ff8b8b;
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
      flex-wrap: wrap;
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
      border-color: #7bc5ff;
      background: var(--chip-active);
      box-shadow: 0 0 0 1px #7bc5ff inset;
    }

    .spacer {
      flex: 1;
    }

    .select,
    .search,
    .preset-input {
      border-radius: 6px;
      border: 1px solid #8aa2b8;
      background: rgba(4, 15, 25, 0.5);
      color: var(--text);
      padding: 6px 10px;
      font-family: inherit;
      font-size: 12px;
      min-height: 30px;
    }

    .select {
      min-width: 110px;
    }

    .search {
      width: 240px;
      max-width: 40vw;
    }

    .search::placeholder {
      color: #8ba4ba;
    }

    .checkbox {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #b7cbdd;
      user-select: none;
    }

    .checkbox input {
      margin: 0;
    }

    .presets {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      flex-wrap: wrap;
    }

    .preset-input {
      width: 140px;
    }

    .preset-select {
      min-width: 140px;
      max-width: 190px;
    }

    .toolbar-btn {
      border-radius: 6px;
      border: 1px solid #8aa2b8;
      background: rgba(16, 44, 66, 0.45);
      color: var(--text);
      padding: 6px 10px;
      cursor: pointer;
      min-height: 30px;
      font-family: inherit;
      font-size: 12px;
    }

    .toolbar-btn.danger {
      border-color: var(--danger);
      color: var(--danger);
      background: rgba(88, 22, 22, 0.28);
    }

    .toolbar-btn.small {
      padding: 4px 8px;
      min-height: 24px;
      font-size: 11px;
    }

    .regex-error {
      color: var(--danger);
      font-size: 12px;
      width: 100%;
      display: none;
    }

    .regex-error.show {
      display: block;
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
      grid-template-columns: 180px 80px 1fr auto;
      gap: 12px;
      padding: 8px;
      border-bottom: 1px dashed var(--line);
      align-items: start;
      font-size: 12px;
      animation: fade-in 150ms ease-out;
    }

    .group {
      padding: 8px;
      margin-top: 8px;
      border: 1px solid rgba(122, 170, 201, 0.35);
      border-radius: 8px;
      background: rgba(20, 46, 67, 0.35);
    }

    .group-title {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--group);
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px dashed rgba(122, 170, 201, 0.35);
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

    .msg .file-link {
      color: var(--link);
      text-decoration: underline;
      cursor: pointer;
    }

    .msg .dup {
      color: #9cc6e2;
      margin-left: 6px;
      border: 1px solid rgba(156, 198, 226, 0.45);
      border-radius: 999px;
      padding: 0 6px;
      font-size: 11px;
      white-space: nowrap;
    }

    .actions {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }

    .expand-toggle {
      margin-left: 8px;
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
    <select id="source-filter" class="select" aria-label="Source filter">
      <option value="all">All Sources</option>
    </select>
    <select id="time-range" class="select" aria-label="Time range">
      <option value="all">All Time</option>
      <option value="5m">Last 5m</option>
      <option value="15m">Last 15m</option>
      <option value="1h">Last 1h</option>
      <option value="24h">Last 24h</option>
    </select>
    <label class="checkbox"><input id="regex-toggle" type="checkbox">Regex</label>
    <label class="checkbox"><input id="group-toggle" type="checkbox">Group by source</label>
    <div class="spacer"></div>
    <input id="search" class="search" type="text" placeholder="Search logs..." aria-label="Search logs">
    <div class="presets">
      <input id="preset-name" class="preset-input" type="text" placeholder="Preset name" aria-label="Preset name">
      <button id="save-preset" class="toolbar-btn small" type="button">Save</button>
      <select id="preset-select" class="select preset-select" aria-label="Preset list"></select>
      <button id="load-preset" class="toolbar-btn small" type="button">Load</button>
      <button id="delete-preset" class="toolbar-btn small danger" type="button">Delete</button>
    </div>
    <div class="status" id="capture-status">Capture: <strong>Running</strong></div>
    <button class="toggle stop" id="capture-toggle" data-state="running">Stop</button>
    <button class="toolbar-btn" id="clear">Clear</button>
    <div id="regex-error" class="regex-error">Invalid regex pattern.</div>
  </div>

  <div id="logs"></div>
  <button id="jump-latest" class="jump-latest" type="button">Latest</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const logContainer = document.getElementById("logs");
    const chips = Array.from(document.querySelectorAll(".chip"));
    const searchInput = document.getElementById("search");
    const sourceFilter = document.getElementById("source-filter");
    const timeRange = document.getElementById("time-range");
    const regexToggle = document.getElementById("regex-toggle");
    const groupToggle = document.getElementById("group-toggle");
    const presetNameInput = document.getElementById("preset-name");
    const presetSelect = document.getElementById("preset-select");
    const savePresetButton = document.getElementById("save-preset");
    const loadPresetButton = document.getElementById("load-preset");
    const deletePresetButton = document.getElementById("delete-preset");
    const captureStatus = document.getElementById("capture-status");
    const captureToggle = document.getElementById("capture-toggle");
    const jumpLatest = document.getElementById("jump-latest");
    const regexError = document.getElementById("regex-error");

    let userScrolledUp = false;
    let latestLogs = [];
    let groupBySource = false;
    const expandedRows = new Set();
    const state = vscode.getState() || { presets: [] };
    if (!Array.isArray(state.presets)) {
      state.presets = [];
    }

    function setFilter(value) {
      chips.forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === value);
      });
      vscode.postMessage({ type: "setFilter", value });
    }

    function currentFilterValue() {
      const active = chips.find((chip) => chip.classList.contains("active"));
      return active ? active.dataset.filter : "all";
    }

    function saveState() {
      vscode.setState(state);
    }

    function updatePresetSelect() {
      const previous = presetSelect.value;
      const options = ['<option value="">Presets</option>'];
      state.presets
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach((preset) => {
          options.push('<option value="' + escapeAttr(preset.name) + '">' + escapeHtml(preset.name) + '</option>');
        });
      presetSelect.innerHTML = options.join("");
      if (state.presets.some((preset) => preset.name === previous)) {
        presetSelect.value = previous;
      }
    }

    function readCurrentPreset() {
      return {
        name: presetNameInput.value.trim(),
        filter: currentFilterValue(),
        source: sourceFilter.value,
        timeRange: timeRange.value,
        regexEnabled: regexToggle.checked,
        groupBySource: groupToggle.checked,
        search: searchInput.value
      };
    }

    function applyPreset(preset) {
      setFilter(preset.filter || "all");
      sourceFilter.value = preset.source || "all";
      timeRange.value = preset.timeRange || "all";
      regexToggle.checked = Boolean(preset.regexEnabled);
      groupToggle.checked = Boolean(preset.groupBySource);
      searchInput.value = preset.search || "";

      groupBySource = groupToggle.checked;

      vscode.postMessage({ type: "setSource", source: sourceFilter.value });
      vscode.postMessage({ type: "setTimeRange", timeRange: timeRange.value });
      vscode.postMessage({ type: "setRegex", enabled: regexToggle.checked });
      vscode.postMessage({ type: "setSearch", query: searchInput.value });

      renderLogs(latestLogs);
    }

    function savePreset() {
      const preset = readCurrentPreset();
      if (!preset.name) {
        return;
      }

      state.presets = state.presets.filter((entry) => entry.name !== preset.name);
      state.presets.push(preset);
      saveState();
      updatePresetSelect();
      presetSelect.value = preset.name;
    }

    function loadPreset() {
      const selected = presetSelect.value;
      if (!selected) {
        return;
      }

      const preset = state.presets.find((entry) => entry.name === selected);
      if (!preset) {
        return;
      }

      presetNameInput.value = preset.name;
      applyPreset(preset);
    }

    function deletePreset() {
      const selected = presetSelect.value;
      if (!selected) {
        return;
      }

      state.presets = state.presets.filter((preset) => preset.name !== selected);
      saveState();
      updatePresetSelect();
    }

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        setFilter(chip.dataset.filter);
      });
    });

    searchInput.addEventListener("input", () => {
      vscode.postMessage({ type: "setSearch", query: searchInput.value });
    });

    sourceFilter.addEventListener("change", () => {
      vscode.postMessage({ type: "setSource", source: sourceFilter.value });
    });

    timeRange.addEventListener("change", () => {
      vscode.postMessage({ type: "setTimeRange", timeRange: timeRange.value });
    });

    regexToggle.addEventListener("change", () => {
      vscode.postMessage({ type: "setRegex", enabled: regexToggle.checked });
    });

    groupToggle.addEventListener("change", () => {
      groupBySource = groupToggle.checked;
      renderLogs(latestLogs);
    });

    savePresetButton.addEventListener("click", savePreset);
    loadPresetButton.addEventListener("click", loadPreset);
    deletePresetButton.addEventListener("click", deletePreset);

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

    logContainer.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.classList.contains("expand-toggle")) {
        const id = Number(target.dataset.id);
        if (expandedRows.has(id)) {
          expandedRows.delete(id);
        } else {
          expandedRows.add(id);
        }
        renderLogs(latestLogs);
        return;
      }

      if (target.classList.contains("copy-row")) {
        const id = Number(target.dataset.id);
        const row = latestLogs.find((entry) => entry.id === id);
        if (row) {
          copyText('[' + row.timestamp + '] [' + row.level + '] [' + row.source + '] ' + row.message);
        }
        return;
      }

      if (target.classList.contains("copy-stack")) {
        const id = Number(target.dataset.id);
        const row = latestLogs.find((entry) => entry.id === id);
        if (row) {
          copyText(row.message);
        }
        return;
      }

      if (target.classList.contains("file-link")) {
        event.preventDefault();
        const line = Number(target.dataset.line || "1");
        const column = Number(target.dataset.column || "1");
        const filePath = target.dataset.path || "";
        if (filePath) {
          vscode.postMessage({ type: "openLink", filePath, line, column });
        }
      }
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

      const payload = message.payload || {};
      const logs = Array.isArray(payload.logs) ? payload.logs : [];
      const sources = Array.isArray(payload.sources) ? payload.sources : [];

      syncSourceOptions(sources);
      regexError.classList.toggle("show", Boolean(payload.regexError));

      latestLogs = logs;
      renderLogs(logs);
    });

    function syncSourceOptions(sources) {
      const current = sourceFilter.value || "all";
      const options = ['<option value="all">All Sources</option>'];
      sources.forEach((source) => {
        options.push('<option value="' + escapeAttr(source) + '">' + escapeHtml(source) + '</option>');
      });
      sourceFilter.innerHTML = options.join("");
      sourceFilter.value = sources.includes(current) || current === "all" ? current : "all";
    }

    function renderLogs(logs) {
      if (!Array.isArray(logs) || logs.length === 0) {
        logContainer.innerHTML = '<div class="empty">No logs yet.</div>';
        return;
      }

      if (groupBySource) {
        const groups = new Map();
        logs.forEach((log) => {
          const key = String(log.source);
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key).push(log);
        });

        const sections = [];
        groups.forEach((items, source) => {
          sections.push('<section class="group">'
            + '<div class="group-title">' + escapeHtml(source) + '</div>'
            + items.map((log) => renderRow(log)).join("")
            + '</section>');
        });
        logContainer.innerHTML = sections.join("");
      } else {
        logContainer.innerHTML = logs.map((log) => renderRow(log)).join("");
      }

      if (!userScrolledUp) {
        scrollToLatest();
      }

      updateJumpLatestVisibility();
    }

    function renderRow(log) {
      const ts = escapeHtml(new Date(log.timestamp).toLocaleString());
      const level = escapeHtml(log.level);
      const source = escapeHtml(log.source);
      const message = String(log.message || "");
      const lines = message.split(/\r?\n/);
      const isExpanded = expandedRows.has(log.id);
      const shouldCollapse = lines.length > 1;
      const visibleText = shouldCollapse && !isExpanded ? lines[0] : message;
      const linked = linkifyText(visibleText);
      const duplicate = Number(log.duplicateCount || 1);

      const duplicateBadge = duplicate > 1 ? '<span class="dup">x' + duplicate + '</span>' : '';
      const expandButton = shouldCollapse
        ? '<button class="toolbar-btn small expand-toggle" data-id="' + log.id + '">' + (isExpanded ? 'Collapse' : 'Expand') + '</button>'
        : '';
      const copyStackButton = shouldCollapse
        ? '<button class="toolbar-btn small copy-stack" data-id="' + log.id + '">Copy Stack</button>'
        : '';

      return '<div class="row">'
        + '<div class="ts">' + ts + '</div>'
        + '<div class="level ' + level + '">' + level + '</div>'
        + '<div class="msg">[' + source + '] ' + linked + duplicateBadge + expandButton + '</div>'
        + '<div class="actions">'
        + '<button class="toolbar-btn small copy-row" data-id="' + log.id + '">Copy</button>'
        + copyStackButton
        + '</div>'
        + '</div>';
    }

    function linkifyText(text) {
      const pattern = /((?:[A-Za-z]:\\\\|\/|\.\.\/|\.\/)[^:\n]+?\.[A-Za-z0-9_\-]+):(\d+)(?::(\d+))?/g;
      let result = "";
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const start = match.index;
        const end = pattern.lastIndex;
        const rawPath = match[1];
        const line = match[2] || "1";
        const column = match[3] || "1";

        result += escapeHtml(text.slice(lastIndex, start));
        result += '<a href="#" class="file-link" data-path="' + escapeAttr(rawPath) + '" data-line="' + escapeAttr(line) + '" data-column="' + escapeAttr(column) + '">' + escapeHtml(match[0]) + '</a>';
        lastIndex = end;
      }

      result += escapeHtml(text.slice(lastIndex));
      return result.replace(/\n/g, "<br>");
    }

    function copyText(value) {
      const text = String(value);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          fallbackCopyText(text);
        });
        return;
      }
      fallbackCopyText(text);
    }

    function fallbackCopyText(text) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }

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

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    updatePresetSelect();

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}

function collapseConsecutiveDuplicates(entries: readonly LogEntry[]): Array<LogEntry & { duplicateCount: number }> {
  const collapsed: Array<LogEntry & { duplicateCount: number }> = [];

  for (const entry of entries) {
    const previous = collapsed.at(-1);
    if (previous && previous.level === entry.level && previous.source === entry.source && previous.message === entry.message) {
      previous.duplicateCount += 1;
      previous.timestamp = entry.timestamp;
      continue;
    }

    collapsed.push({
      ...entry,
      duplicateCount: 1
    });
  }

  return collapsed;
}

function getNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let i = 0; i < 32; i += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }

  return value;
}
