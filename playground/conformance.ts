import {
  defaultTokens,
  layoutText,
  renderTextBlock,
  styleRuns,
  type FontRegistry,
  type Run,
  type TextBlock,
} from "@docforge-lib/layout";
import { fontsReady } from "./fonts";
import { checkLines } from "./measure";

const WORDS = (
  "a receita cresceu sobre trimestre anterior puxada por contratos anuais na região Sudeste setembro foi o melhor mês " +
  "do ano com três renovações antecipadas margem caiu ponto percentual reajuste de infraestrutura agosto ainda não " +
  "repassado aos planos Business ação coração índice período métrica análise conclusão próximo passo equipe produto " +
  "the quick brown fox jumps over lazy dog layout engine measures every line before drawing it " +
  "R$ 4,2M 31,4% 1.284 +12% −1,2 p.p. (T3) 2026-10-11 e-mail https://doc-forge.dev/a/b?c=1 «citação» “aspas” — – … ; : ! ? " +
  "WWW mmm iii fi fl ffi Ø æ ß Ç ñ õ ü ÿ"
).split(" ");

const SIZES = [11, 13, 15, 18, 22, 28];

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ConformanceCase {
  index: number;
  width: number;
  size: number;
  family: string;
  block: TextBlock;
  text: string;
}

export interface CaseResult {
  index: number;
  lines: number;
  maxDiff: number;
  pass: boolean;
  description: string;
}

export interface ConformanceReport {
  cases: number;
  passed: number;
  lines: number;
  linesWithin: number;
  maxDiff: number;
  failures: CaseResult[];
  ms: number;
  /** Load status of every font face in the scratch frame. */
  fonts: string[];
}

export function generateCases(registry: FontRegistry, count: number, seed = 42): ConformanceCase[] {
  const random = rng(seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)] as T;
  const cases: ConformanceCase[] = [];
  for (let index = 0; index < count; index++) {
    const mono = random() < 0.2;
    const family = mono ? "JetBrains Mono" : "Inter";
    const size = pick(SIZES);
    const width = Math.round(60 + random() * 640);
    const words = 4 + Math.floor(random() * 60);
    const runs: Run[] = [];
    for (let w = 0; w < words; w++) {
      const word = pick(WORDS);
      const roll = random();
      const run: Run = { text: (w === 0 ? "" : " ") + word };
      if (roll < 0.1) run.bold = true;
      else if (roll < 0.18) run.italic = true;
      else if (roll < 0.22) run.code = true;
      else if (roll < 0.25) run.size = pick(["s", "l", "xl"]);
      else if (roll < 0.27) run.text += "\n";
      runs.push(run);
    }
    const base = { family, weight: pick([400, 500, 600, 700]), italic: random() < 0.1, size, color: "#1a1c1e", lineHeight: pick([1.2, 1.5]) };
    const styled = styleRuns(runs, base, { tokens: defaultTokens, monoFamily: "JetBrains Mono", linkColor: "#1f4fd8" });
    const block = layoutText(styled, { maxWidth: width, lineHeight: base.lineHeight, base, registry });
    cases.push({ index, width, size, family, block, text: runs.map((r) => r.text).join("") });
  }
  return cases;
}

/** Render every case in a scratch iframe and compare measured vs drawn line widths. */
export async function runConformance(
  registry: FontRegistry,
  frame: HTMLIFrameElement,
  options: { count: number; tolerance: number },
): Promise<ConformanceReport> {
  const started = performance.now();
  const cases = generateCases(registry, options.count);
  const body = cases
    .map((c) => {
      const html = renderTextBlock(c.block, { x: 0, y: 0, width: c.width, align: "left" });
      return `<div class="case" data-case="${c.index}" style="position:relative;width:${c.width}px;height:${Math.ceil(c.block.height)}px;margin:0 0 12px">${html}</div>`;
    })
    .join("");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${registry.fontFaceCss()}body{margin:16px;font-kerning:normal;font-variant-ligatures:normal;text-rendering:optimizeLegibility}</style></head><body>${body}</body></html>`;

  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = doc;
  });
  const inner = frame.contentDocument as Document;
  await fontsReady(inner);

  const failures: CaseResult[] = [];
  let lines = 0;
  let linesWithin = 0;
  let maxDiff = 0;
  let passed = 0;
  inner.querySelectorAll<HTMLElement>(".case").forEach((el) => {
    const c = cases[Number(el.dataset.case)] as ConformanceCase;
    const checks = checkLines(el);
    const worst = checks.reduce((m, x) => Math.max(m, Math.abs(x.diff)), 0);
    const within = checks.filter((x) => Math.abs(x.diff) <= options.tolerance).length;
    lines += checks.length;
    linesWithin += within;
    maxDiff = Math.max(maxDiff, worst);
    const pass = within === checks.length;
    if (pass) passed += 1;
    else {
      failures.push({
        index: c.index,
        lines: checks.length,
        maxDiff: worst,
        pass,
        description: `${c.family} ${c.size}px · ${c.width}px · "${c.text.slice(0, 60).replace(/\n/g, "⏎")}…"`,
      });
    }
  });
  const fonts = [...inner.fonts].map((f) => `${f.family} ${f.weight} ${f.style}: ${f.status}`);
  return { cases: cases.length, passed, lines, linesWithin, maxDiff, failures, ms: performance.now() - started, fonts };
}
