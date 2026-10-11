import { createEngine } from "@docforge/layout";
import { useEffect, useRef, useState } from "react";
import onePager from "../examples/one-pager.json";
import proposta from "../examples/proposta.json";
import relatorio from "../examples/relatorio.json";
import { runConformance } from "./conformance";
import { fontsReady, loadRegistry } from "./fonts";
import { checkLines, summarize } from "./measure";

const EXAMPLES: Record<string, unknown> = { relatorio, "one-pager": onePager, proposta };

/**
 * Unattended checks for scripts and CI: `?auto=conformance&count=300` or `?auto=examples`.
 * The result is written as JSON into #result once done.
 */
export function Auto({ mode, count }: { mode: string; count: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [result, setResult] = useState<string>("running");

  useEffect(() => {
    (async () => {
      const registry = await loadRegistry();
      const engine = createEngine({ registry });
      const iframe = frame.current as HTMLIFrameElement;
      if (mode === "conformance") {
        const report = await runConformance(registry, iframe, { count, tolerance: 1 });
        setResult(JSON.stringify({ ...report, failures: report.failures.slice(0, 20) }));
        return;
      }
      const out: Record<string, unknown> = {};
      for (const [name, doc] of Object.entries(EXAMPLES)) {
        for (const surface of (doc as { surfaces: { id: string }[] }).surfaces) {
          const { page, rendered } = engine.render(doc, { surfaceId: surface.id });
          await new Promise<void>((resolve) => {
            iframe.onload = () => resolve();
            iframe.srcdoc = page;
          });
          const inner = iframe.contentDocument as Document;
          await fontsReady(inner);
          out[`${name}/${surface.id}`] = { pages: rendered.pages, ...summarize(checkLines(inner), 1) };
        }
      }
      setResult(JSON.stringify(out));
    })().catch((e: unknown) => setResult(JSON.stringify({ error: String(e) })));
  }, [mode, count]);

  return (
    <div>
      <pre id="result">{result}</pre>
      <iframe ref={frame} title="auto" style={{ width: 1200, height: 800 }} />
    </div>
  );
}
