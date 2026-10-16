/**
 * Warnings the library gives when it loads a document for you: a format it had to
 * convert, a revision you did not pin, a copy served from the cache because the
 * server failed. Each has a stable `code`, so a system can count or alert on them.
 *
 * The default writes to `console.warn`. Pass your own `logger` to route them into
 * your logs, or `silentLogger` to drop them.
 */

export type LogCode =
  /** The document was in an older format and was converted up. */
  | "format_upgraded"
  /** The server converted the document down to the format this library reads; `data.notes` says what was lost. */
  | "format_downgraded"
  /** The document is in a newer format than this library reads. */
  | "format_unsupported"
  /** A document fetched by id without a revision: you got whatever is current. */
  | "revision_unpinned"
  /** The server failed and the last good copy from the cache was used. */
  | "served_from_cache";

export interface LogEntry {
  code: LogCode;
  message: string;
  data?: Record<string, unknown>;
}

export type Logger = (entry: LogEntry) => void;

export const consoleLogger: Logger = (entry) => {
  console.warn(`[@docforge-lib/layout] ${entry.code}: ${entry.message}`);
};

export const silentLogger: Logger = () => {};
