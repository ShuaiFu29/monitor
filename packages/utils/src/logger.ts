/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const PREFIX = '[Monitor]';

/**
 * SDK 内部日志器
 * 可通过 setLevel 控制输出级别，生产环境建议设为 'error' 或 'silent'
 */
export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'warn') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const consoleFn =
      level === 'debug'
        ? console.debug // eslint-disable-line no-console
        : level === 'info'
          ? console.info // eslint-disable-line no-console
          : level === 'warn'
            ? console.warn
            : console.error;

    consoleFn(`${PREFIX} ${message}`, ...args);
  }
}

/**
 * 全局默认日志器实例
 */
export const logger = new Logger();
