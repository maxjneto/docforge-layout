export interface LineCheck {
  expected: number;
  actual: number;
  diff: number;
  container: number;
}

/**
 * Compare every rendered line's measured width (`data-w`, from the library) with the
 * width the browser actually draws. The spans are inline, so their rects add up to
 * exactly what the browser laid out.
 */
export function checkLines(root: ParentNode): LineCheck[] {
  const lines = root.querySelectorAll<HTMLElement>(".dfl-line");
  const checks: LineCheck[] = [];
  lines.forEach((line) => {
    const expected = Number(line.dataset.w ?? "0");
    let actual = 0;
    line.querySelectorAll(":scope > span").forEach((span) => {
      actual += span.getBoundingClientRect().width;
    });
    checks.push({ expected, actual, diff: actual - expected, container: line.getBoundingClientRect().width });
  });
  return checks;
}

export interface LineSummary {
  lines: number;
  within: number;
  maxDiff: number;
  overflowing: number;
}

export function summarize(checks: LineCheck[], tolerance: number): LineSummary {
  return {
    lines: checks.length,
    within: checks.filter((c) => Math.abs(c.diff) <= tolerance).length,
    maxDiff: checks.reduce((m, c) => Math.max(m, Math.abs(c.diff)), 0),
    overflowing: checks.filter((c) => c.actual > c.container + tolerance).length,
  };
}
