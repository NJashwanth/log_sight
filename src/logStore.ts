import * as vscode from "vscode";
import { LogEntry, LogLevel } from "./types";

export class LogStore {
  private static readonly MAX_ENTRIES = 5000;
  private readonly entries: LogEntry[] = [];
  private nextId = 1;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<readonly LogEntry[]>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public add(level: LogLevel, message: string, source = "extension"): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level,
      message,
      source
    };

    this.entries.push(entry);
    if (this.entries.length > LogStore.MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - LogStore.MAX_ENTRIES);
    }

    this.onDidChangeEmitter.fire(this.getAll());
    return entry;
  }

  public clear(): void {
    this.entries.length = 0;
    this.onDidChangeEmitter.fire(this.getAll());
  }

  public getAll(): readonly LogEntry[] {
    return this.entries;
  }

  public dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
