import { createEngine, type Diagnostic, type Engine, type MapLevel } from "@docforge-lib/layout";
import { useEffect, useMemo, useRef, useState } from "react";
import onePager from "../examples/one-pager.json";
import proposta from "../examples/proposta.json";
import relatorio from "../examples/relatorio.json";
import { runConformance, type ConformanceReport } from "./conformance";
import { fontsReady, loadRegistry } from "./fonts";
import { checkLines, summarize, type LineSummary } from "./measure";

const EXAMPLES: Record<string, unknown> = { relatorio, "one-pager": onePager, proposta };
const TOLERANCE = 1;

type Tab = "document" | "conformance";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRegistry()
      .then((registry) => setEngine(createEngine({ registry })))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="boot">Falha ao carregar as fontes: {error}</div>;
  if (!engine) return <div className="boot">Carregando fontes…</div>;
  return <Playground engine={engine} />;
}

function Playground({ engine }: { engine: Engine }) {
  const [tab, setTab] = useState<Tab>("document");
  const [example, setExample] = useState("relatorio");
  const [source, setSource] = useState(() => JSON.stringify(EXAMPLES.relatorio, null, 2));
  const [parsed, setParsed] = useState<unknown>(EXAMPLES.relatorio);
  const [parseError, setParseError] = useState<string | null>(null);
  const [surfaceId, setSurfaceId] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<MapLevel>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [lineSummary, setLineSummary] = useState<LineSummary | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // Debounced parse of the JSON editor.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setParsed(JSON.parse(source));
        setParseError(null);
      } catch (e) {
        setParseError((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [source]);

  const surfaces = useMemo(() => {
    const list = (parsed as { surfaces?: { id: string; kind: string }[] })?.surfaces;
    return Array.isArray(list) ? list : [];
  }, [parsed]);
  const activeSurface = surfaceId && surfaces.some((s) => s.id === surfaceId) ? surfaceId : surfaces[0]?.id;

  const output = useMemo(() => {
    const started = performance.now();
    const result = engine.render(parsed, { surfaceId: activeSurface, grid: showGrid });
    return { ...result, ms: performance.now() - started };
  }, [engine, parsed, activeSurface, showGrid]);

  const mapText = useMemo(() => {
    const opts = level === 2 && selected ? { level, components: [selected] } : { level };
    return engine.map(parsed, { ...opts, surfaceId: activeSurface }).text;
  }, [engine, parsed, level, selected, activeSurface]);

  // After the iframe renders: measure every line against the library, and wire clicks to the map.
  const onFrameLoad = async () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    await fontsReady(doc);
    setLineSummary(summarize(checkLines(doc), TOLERANCE));
    doc.addEventListener("click", (event) => {
      const box = (event.target as HTMLElement).closest<HTMLElement>(".dfl-box");
      if (box?.dataset.component) {
        setSelected(box.dataset.component);
        setLevel(2);
      }
    });
    if (selected) highlight(doc, selected);
  };

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc) highlight(doc, selected);
  }, [selected]);

  const loadExample = (name: string) => {
    setExample(name);
    setSource(JSON.stringify(EXAMPLES[name], null, 2));
    setSelected(null);
    setSurfaceId(undefined);
  };

  const componentIds = output.layout.doc?.components.map((c) => c.id) ?? [];
  const errors = output.layout.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = output.layout.diagnostics.filter((d) => d.severity === "warning").length;

  return (
    <div className="app">
      <header className="bar">
        <strong className="brand">DocForge Layout</strong>
        <nav className="tabs">
          <button className={tab === "document" ? "on" : ""} onClick={() => setTab("document")}>Documento</button>
          <button className={tab === "conformance" ? "on" : ""} onClick={() => setTab("conformance")}>Conformidade</button>
        </nav>
        {tab === "document" && (
          <div className="controls">
            <label>
              Exemplo
              <select value={example} onChange={(e) => loadExample(e.target.value)}>
                {Object.keys(EXAMPLES).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Superfície
              <select value={activeSurface ?? ""} onChange={(e) => setSurfaceId(e.target.value)}>
                {surfaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} ({s.kind === "page" ? "paginado" : "contínua"})
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              Grade
            </label>
            <button className="primary" onClick={() => frame.current?.contentWindow?.print()}>
              Imprimir / PDF
            </button>
          </div>
        )}
      </header>

      {tab === "document" ? (
        <main className="grid">
          <section className="editor">
            <div className="panel-title">
              JSON do documento {parseError && <span className="bad">· JSON inválido</span>}
            </div>
            <textarea spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
            {parseError && <div className="parse-error">{parseError}</div>}
          </section>

          <section className="preview">
            <div className="panel-title">
              {output.rendered.pages} página(s) · {output.ms.toFixed(0)} ms ·{" "}
              <span className={errors ? "bad" : "good"}>{errors} erro(s)</span> · {warnings} aviso(s)
              {lineSummary && (
                <>
                  {" "}· linhas {lineSummary.within}/{lineSummary.lines} dentro de {TOLERANCE}px
                  {lineSummary.maxDiff > TOLERANCE && <span className="bad"> (máx {lineSummary.maxDiff.toFixed(2)}px)</span>}
                </>
              )}
            </div>
            <iframe ref={frame} title="render" srcDoc={output.page} onLoad={onFrameLoad} />
          </section>

          <section className="side">
            <div className="panel-title">Diagnósticos</div>
            <Diagnostics list={output.layout.diagnostics} onPick={(id) => { setSelected(id); setLevel(2); }} />
            <div className="panel-title map-head">
              Mapa
              <span className="levels">
                {([0, 1, 2] as MapLevel[]).map((l) => (
                  <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>
                    {l}
                  </button>
                ))}
              </span>
              {level === 2 && (
                <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)}>
                  <option value="">todos</option>
                  {componentIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              )}
              <CopyButton text={() => forAgent(mapText, output.layout.diagnostics)} />
            </div>
            <pre className="map">{mapText}</pre>
          </section>
        </main>
      ) : (
        <Conformance engine={engine} />
      )}
    </div>
  );
}

/** The map as shown, plus every error and warning with its suggestions — ready to paste to an agent. */
function forAgent(map: string, diagnostics: Diagnostic[]): string {
  const problems = diagnostics.filter((d) => d.severity !== "info");
  if (!problems.length) return map;
  const lines = problems.flatMap((d) => [
    `- [${d.severity} ${d.code}] ${d.message}`,
    ...(d.suggestions ?? []).map((s) => `    → ${s}`),
  ]);
  return [map, "", "diagnostics:", ...lines].join("\n");
}

function CopyButton({ text }: { text: () => string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const value = text();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (non-secure context): fall back to a selected textarea.
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="copy" onClick={copy} title="Copia o mapa mostrado e os erros/avisos com sugestões">
      {copied ? "Copiado ✓" : "Copiar para o agente"}
    </button>
  );
}

function highlight(doc: Document, id: string | null) {
  doc.querySelectorAll<HTMLElement>(".dfl-box").forEach((el) => {
    el.style.outline = el.dataset.component === id ? "2px solid #1f4fd8" : "";
    el.style.outlineOffset = "2px";
  });
}

function Diagnostics({ list, onPick }: { list: Diagnostic[]; onPick: (id: string) => void }) {
  if (!list.length) return <div className="empty">Nenhum problema.</div>;
  return (
    <ul className="diags">
      {list.map((d, i) => (
        <li key={i} className={d.severity}>
          <span className="code">{d.code}</span>
          {d.component && (
            <button className="link" onClick={() => onPick(d.component as string)}>
              {d.component}
            </button>
          )}
          <div>{d.message}</div>
          {d.suggestions?.map((s, j) => (
            <div key={j} className="suggestion">
              → {s}
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

function Conformance({ engine }: { engine: Engine }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [count, setCount] = useState(300);
  const [report, setReport] = useState<ConformanceReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!frame.current) return;
    setRunning(true);
    try {
      setReport(await runConformance(engine.registry, frame.current, { count, tolerance: TOLERANCE }));
    } finally {
      setRunning(false);
    }
  };

  const rate = report ? (report.passed / report.cases) * 100 : 0;
  return (
    <main className="conformance">
      <div className="conf-controls">
        <label>
          Casos
          <input type="number" min={10} max={2000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <button className="primary" onClick={run} disabled={running}>
          {running ? "Rodando…" : "Rodar conformidade"}
        </button>
        <span className="hint">
          Gera textos com pesos, itálico, código, tamanhos e larguras variados; desenha as linhas que a lib calculou e compara a
          largura de cada uma com a que o navegador desenha (tolerância {TOLERANCE}px).
        </span>
      </div>
      {report && (
        <div className="report">
          <div className={`score ${rate >= 99 ? "good" : "bad"}`}>{rate.toFixed(2)}%</div>
          <div>
            {report.passed}/{report.cases} casos sem nenhuma linha fora da tolerância · {report.linesWithin}/{report.lines} linhas ·
            desvio máximo {report.maxDiff.toFixed(3)}px · {report.ms.toFixed(0)} ms
          </div>
          <div className="target">Critério do spike: ≥ 99% dos casos.</div>
          {report.failures.length > 0 && (
            <ul className="failures">
              {report.failures.slice(0, 50).map((f) => (
                <li key={f.index}>
                  #{f.index} · desvio {f.maxDiff.toFixed(2)}px · {f.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <iframe ref={frame} title="conformance" className="conf-frame" />
    </main>
  );
}
