import { createEngine } from "@docforge/layout";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import onePager from "../examples/one-pager.json";
import proposta from "../examples/proposta.json";
import relatorio from "../examples/relatorio.json";
import { App } from "./App";
import { Auto } from "./auto";
import { loadRegistry } from "./fonts";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const auto = params.get("auto");
const print = params.get("print");
const EXAMPLES: Record<string, unknown> = { relatorio, "one-pager": onePager, proposta };

if (print) {
  // `?print=<example>&surface=<id>`: the bare document, as the print dialog (or --print-to-pdf) sees it.
  const registry = await loadRegistry();
  // `&grid=1` adds the grid overlay (screen only); `&screen=1` keeps the on-screen page spacing.
  const { page } = createEngine({ registry }).render(EXAMPLES[print], {
    surfaceId: params.get("surface") ?? undefined,
    screen: params.get("screen") === "1",
    grid: params.get("grid") === "1",
  });
  document.open();
  document.write(page);
  document.close();
} else {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>{auto ? <Auto mode={auto} count={Number(params.get("count") ?? 300)} /> : <App />}</StrictMode>,
  );
}
