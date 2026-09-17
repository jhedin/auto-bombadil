/** Jev-weighted TodoMVC specification. Weights come from ./todomvc-weights.json. */
import { weighted } from "@antithesishq/bombadil/browser";
import { navigation, scroll, waitOnce } from "@antithesishq/bombadil/browser/defaults/actions";
import { fastInputs } from "./todomvc-actions.ts";
import { weightedClicks, type WeightTable } from "./policy.ts";
import table from "./todomvc-weights.json" with { type: "json" };

export * from "@antithesishq/bombadil/browser/defaults/properties";
export * from "./todomvc-props.ts";

export const defaultActions = weighted([
  [100, weightedClicks(table as WeightTable)],
  [100, fastInputs],
  [20, scroll],
  [5, navigation],
  [1, waitOnce],
]);
