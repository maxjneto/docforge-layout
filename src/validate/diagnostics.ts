export type Severity = "error" | "warning" | "info";

export type DiagnosticCode =
  | "schema"
  | "duplicate-id"
  | "unplaced-component"
  | "unknown-surface"
  | "unknown-page"
  | "out-of-page"
  | "too-tall"
  | "page-limit"
  | "unknown-token"
  | "wrong-token-group"
  | "raw-value"
  | "invalid-style-value"
  | "style-conflict"
  | "unknown-font"
  | "missing-glyphs"
  | "word-broken"
  | "code-line-wrapped"
  | "kpi-shrunk"
  | "kpi-value-too-wide"
  | "chart-too-small"
  | "chart-labels-overlap"
  | "chart-series-length"
  | "table-row-length"
  | "unknown-size"
  | "invalid-op"
  | "fit-result"
  | "fit-failed"
  | "text-replaced"
  | "move-result"
  | "unknown-link-target"
  | "unsafe-link";

/** Codes that make a document unusable: a write that leads to one of these is refused. */
export const BLOCKING_CODES: ReadonlySet<DiagnosticCode> = new Set(["schema", "duplicate-id", "invalid-op"]);

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  component?: string;
  /** 1-based page, for problems tied to a page rather than a component. */
  page?: number;
  data?: Record<string, unknown>;
  suggestions?: string[];
}

export function diag(
  severity: Severity,
  code: DiagnosticCode,
  message: string,
  extra: Omit<Diagnostic, "severity" | "code" | "message"> = {},
): Diagnostic {
  return { severity, code, message, ...extra };
}

/** Drop exact duplicates (same code, target and message). */
export function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = `${d.code}|${d.component ?? ""}|${d.page ?? ""}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
export function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
