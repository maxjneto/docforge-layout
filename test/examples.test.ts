import { describe, expect, it } from "vitest";
import { engine, example } from "./helpers";

describe("examples", () => {
  for (const name of ["relatorio", "one-pager", "proposta"]) {
    it(`${name} has no errors or warnings on any surface`, () => {
      const d = example(name) as { surfaces: { id: string }[] };
      for (const s of d.surfaces) {
        const r = engine.layout(d, s.id);
        const problems = r.diagnostics.filter((x) => x.severity !== "info");
        expect(problems, `${name}/${s.id}: ${problems.map((e) => e.message).join(" | ")}`).toEqual([]);
      }
    });
  }
});
