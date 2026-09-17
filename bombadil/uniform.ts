/**
 * Baseline specification: identical to specification.ts but every click
 * target gets the same weight. Used by `npm run auto:compare`.
 */
import { weighted } from "@antithesishq/bombadil/browser";
import {
  inputs,
  navigation,
  scroll,
  waitOnce,
} from "@antithesishq/bombadil/browser/defaults/actions";
import { weightedClicks, type WeightTable } from "./policy.ts";
import table from "./uniform.json" with { type: "json" };

export {
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
  noConsoleErrors,
} from "@antithesishq/bombadil/browser/defaults/properties";

export const defaultActions = weighted([
  [100, weightedClicks(table as WeightTable)],
  [100, inputs],
  [50, scroll],
  [10, navigation],
  [1, waitOnce],
]);
