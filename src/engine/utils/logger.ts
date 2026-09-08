type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Read at call time, not import time: a CLI entry point that sets LOG_LEVEL
// after its imports have evaluated would otherwise never silence these lines,
// and stdout is the CLI's result channel.
function currentLevel(): LogLevel {
  const l = process.env.LOG_LEVEL as LogLevel | undefined;
  return l && l in LOG_LEVELS ? l : "info";
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel()];
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  return JSON.stringify({ timestamp, level, message, ...(data !== undefined ? { data } : {}) });
}

export const logger = {
  debug(message: string, data?: unknown) {
    if (shouldLog("debug")) console.debug(formatMessage("debug", message, data));
  },
  info(message: string, data?: unknown) {
    if (shouldLog("info")) console.log(formatMessage("info", message, data));
  },
  warn(message: string, data?: unknown) {
    if (shouldLog("warn")) console.warn(formatMessage("warn", message, data));
  },
  error(message: string, data?: unknown) {
    if (shouldLog("error")) console.error(formatMessage("error", message, data));
  },
};
