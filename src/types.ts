export type LogLevel = "debug" | "warning" | "error";

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  source: string;
}
