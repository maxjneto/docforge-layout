import type { TokenGroup, Tokens } from "../schema/tokens";

export type TokenProblem = "unknown-token" | "wrong-group" | "raw-value";

export interface TokenLookup<T> {
  value: T | undefined;
  problem?: TokenProblem;
  ref?: string;
}

/**
 * Resolve a written value against the tokens. `$group.key` must point into `group`;
 * anything else is a raw value (allowed, but reported so agents prefer tokens).
 */
export function lookupToken(written: unknown, group: TokenGroup, tokens: Tokens): TokenLookup<string | number> {
  if (typeof written === "string" && written.startsWith("$")) {
    const ref = written.slice(1);
    const dot = ref.indexOf(".");
    const refGroup = dot === -1 ? ref : ref.slice(0, dot);
    const key = dot === -1 ? "" : ref.slice(dot + 1);
    if (refGroup !== group) return { value: undefined, problem: "wrong-group", ref: written };
    const table = tokens[group] as Record<string, string | number>;
    const value = table[key];
    if (value === undefined) return { value: undefined, problem: "unknown-token", ref: written };
    return { value, ref: written };
  }
  if (typeof written === "number" || typeof written === "string") return { value: written, problem: "raw-value" };
  return { value: undefined, problem: "unknown-token" };
}

/** Resolve a color written as `$color.key` or a raw CSS color, without reporting. */
export function colorValue(written: string | undefined, tokens: Tokens, fallback: string): string {
  if (!written) return fallback;
  if (written.startsWith("$")) {
    const result = lookupToken(written, "color", tokens);
    return typeof result.value === "string" ? result.value : fallback;
  }
  return written;
}

export function sizeValue(key: string | undefined, tokens: Tokens): number | undefined {
  if (!key) return undefined;
  const stripped = key.startsWith("$size.") ? key.slice(6) : key;
  return tokens.size[stripped];
}
