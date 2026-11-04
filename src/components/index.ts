import type { ComponentType } from "../schema/components";
import { calloutComponent } from "./callout";
import { cardComponent } from "./card";
import { chartComponent } from "./chart";
import { codeComponent } from "./code";
import { coverComponent } from "./cover";
import { dividerComponent } from "./divider";
import { flowComponent } from "./flow";
import { imageComponent } from "./image";
import { kpiComponent } from "./kpi";
import { listComponent } from "./list";
import { progressComponent } from "./progress";
import { stepsComponent } from "./steps";
import { tableComponent } from "./table";
import { tagsComponent } from "./tags";
import { textComponent } from "./text";
import { timelineComponent } from "./timeline";
import { tocComponent } from "./toc";
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
  callout: calloutComponent,
  tags: tagsComponent,
  progress: progressComponent,
  cover: coverComponent,
  toc: tocComponent,
  flow: flowComponent,
};

export function defOf(type: ComponentType): ComponentDef {
  return componentDefs[type] as unknown as ComponentDef;
}

export type { ComponentDef, Chunk, Laid, ComponentContext, Late, Mark, OutlineEntry, SemanticOptions } from "./types";
