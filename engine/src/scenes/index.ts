import type { ComponentType } from "react";
import { Title } from "./title";
import { Chapter } from "./chapter";
import { Screen } from "./screen";
import { Bullets } from "./bullets";
import { Statement } from "./statement";
import { Compare } from "./compare";
import { Steps } from "./steps";
import { Outro } from "./outro";
import { SCENES as PROJECT_SCENES } from "@project/scenes";
export { Placeholder } from "./placeholder";

/** Built-in scenes (key = `component` field of the scenario), overridden by the project's own. */
export const SCENES: Record<string, ComponentType<any>> = {
  Title,
  Chapter,
  Screen,
  Bullets,
  Statement,
  Compare,
  Steps,
  Outro,
  ...PROJECT_SCENES,
};
