import type { ComponentType } from "../schema/components";
import { cardComponent } from "./card";
import { chartComponent } from "./chart";
import { codeComponent } from "./code";
import { dividerComponent } from "./divider";
import { imageComponent } from "./image";
import { kpiComponent } from "./kpi";
import { listComponent } from "./list";
import { stepsComponent } from "./steps";
import { tableComponent } from "./table";
import { textComponent } from "./text";
import { timelineComponent } from "./timeline";
import type { ComponentDef } from "./types";

export const componentDefs: { [T in ComponentType]: ComponentDef<T> } = {
  text: textComponent,
  list: listComponent,
  table: tableComponent,
  code: codeComponent,
  steps: stepsComponent,
  timeline: timelineComponent,
  kpi: kpiComponent,
  card: cardComponent,
  chart: chartComponent,
  image: imageComponent,
  divider: dividerComponent,
};

export function defOf(type: ComponentType): ComponentDef {
  return componentDefs[type] as unknown as ComponentDef;
}

export type { ComponentDef, Chunk, Laid, ComponentContext } from "./types";
