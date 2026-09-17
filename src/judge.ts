/**
 * Ask Jev narrow questions about the code behind a control. One request per
 * control carries every question, so they run in parallel. Answers are cached
 * by a hash of the code slice, so unchanged code is never re-judged.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";
import type { CodeSlice } from "./link.ts";
import type { ControlInfo } from "./trace.ts";

export type Judgment = {
  // Crash-type failures
  throwsOrRejects: number;
  logsConsoleError: number;
  // Consistency-type failures (what UI invariants catch)
  handlerBoundToControl: number;
  updatesCorrectElements: number;
  updatesAllDependentViews: number;
  keepsRouteInSync: number;
  unguardedState: number;
  needsRepetition: number;
  severity: number;
  severityConfidence: number;
  model: string;
  inputTokens: number;
};

const SEVERITY = [
  "Interacting with the control cannot go wrong; the handler is trivial or absent",
  "Something cosmetic or recoverable could go wrong, such as a wrong count or stale text",
  "Visible state could end up contradicting the model, or an uncaught error could occur",
] as const;

export function questionsFor() {
  const inspect = ["`control`", "`scripts`"];
  return {
    throws_or_rejects: noul(
      {
        question:
          "Can interacting with `control`, once or repeatedly, cause code in `scripts` to throw an uncaught exception or reject a promise that nothing handles?",
        inspect,
        focus: "Trace the event handler attached to the control. Count a rejection as unhandled if no .catch or try/await handles it.",
      },
      {
        true: "Some sequence of interactions reaches a throw or an unhandled reject",
        false: "No interaction sequence reaches a throw or an unhandled reject",
      },
    ),
    logs_console_error: noul(
      {
        question: "Can interacting with `control`, once or repeatedly, cause code in `scripts` to call console.error?",
        inspect,
      },
      {
        true: "Some sequence of interactions reaches a console.error call",
        false: "No console.error call is reachable from this control",
      },
    ),
    handler_bound_to_control: noul(
      {
        question:
          "When the user interacts with `control` directly (a click or key press on this exact element), does code in `scripts` run in response?",
        inspect,
        focus:
          "A handler bound only to a related element, such as a label, wrapper, or sibling, does not count. Event delegation from an ancestor that matches this element does count.",
      },
      {
        true: "A handler runs for direct interaction with this element",
        false: "Only a related element has a handler, or the element has none",
      },
    ),
    updates_correct_elements: noul(
      {
        question:
          "After `control` is used, does every DOM update that the code performs write to the element it is meant to change?",
        inspect,
        focus:
          "Check each assignment to a DOM property such as checked, value, textContent, className, or style against the element it is applied to.",
      },
      {
        true: "Each update targets the element that should change",
        false: "Some update writes to a different element than the one it should change, or to a property that has no effect there",
      },
    ),
    updates_all_dependent_views: noul(
      {
        question:
          "After `control` changes the model, does the code refresh every part of the view that depends on that change?",
        inspect,
        focus:
          "Dependent parts include counters, buttons whose visibility depends on the data, an all-selected control, filtered lists, and empty-state sections.",
      },
      {
        true: "All dependent parts are refreshed",
        false: "At least one dependent part is left stale",
      },
    ),
    keeps_route_in_sync: noul(
      {
        question:
          "If the handler for `control` changes which view, filter, page, or subset of data is displayed, does it also update the URL, hash, or router state to match?",
        inspect,
        focus:
          "State that lives both in memory and in the URL must change together. A handler that changes neither counts as in sync.",
      },
      {
        true: "The displayed view and the route change together, or the handler changes neither",
        false: "The handler changes the displayed view or filter but leaves the URL or router state as it was, or the other way round",
      },
    ),
    unguarded_state: noul(
      {
        question:
          "Does the handler for `control` in `scripts` change application state without checking bounds, nullness, or input validity?",
        inspect,
        focus: "Only the state the handler itself mutates.",
      },
      {
        true: "State changes with no guard at all",
        false: "State changes are guarded, or the handler changes no state",
      },
    ),
    needs_repetition: noul(
      {
        question: "If the handler for `control` in `scripts` can fail, does the failure require interacting with the control more than once?",
        inspect,
      },
      {
        true: "A counter or threshold must be reached first",
        false: "The first interaction can already fail, or nothing can fail",
      },
    ),
    failure_severity: score(
      {
        question: "How severe is the worst outcome that interacting with `control` can produce, given `scripts`?",
        inspect,
      },
      SEVERITY,
    ),
  };
}

type Cache = Record<string, Judgment>;

export class Judge {
  private cache: Cache = {};
  private client: TypeSafeClient;
  private cachePath: string;

  constructor(cachePath: string, model?: string) {
    this.cachePath = cachePath;
    this.client = new TypeSafeClient(model ? { defaultModel: model } : {});
  }

  async load(): Promise<void> {
    try {
      this.cache = JSON.parse(await readFile(this.cachePath, "utf8")) as Cache;
    } catch {
      this.cache = {};
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(this.cache, null, 2) + "\n");
  }

  static cacheKey(f: ControlInfo, slice: CodeSlice): string {
    return createHash("sha256")
      .update(JSON.stringify([f, slice.element, slice.code]))
      .digest("hex")
      .slice(0, 24);
  }

  async judge(f: ControlInfo, slice: CodeSlice): Promise<{ judgment: Judgment; cached: boolean }> {
    const key = Judge.cacheKey(f, slice);
    const hit = this.cache[key];
    if (hit) return { judgment: hit, cached: true };

    const state = {
      page: slice.page,
      control: {
        tag: f.tag,
        id: f.id,
        classes: f.classes,
        href: f.href,
        text: f.text,
        placeholder: f.placeholder ?? null,
        html: slice.element,
      },
      scripts: slice.code,
      note: "A browser app. `scripts` holds the page's script sources in load order; an entry may be an excerpt around lines that mention the control.",
    };
    const { answers, model, usage } = await this.client.systemOne({
      state,
      questions: questionsFor(),
    });
    const judgment: Judgment = {
      throwsOrRejects: answers.throws_or_rejects.noul,
      logsConsoleError: answers.logs_console_error.noul,
      handlerBoundToControl: answers.handler_bound_to_control.noul,
      updatesCorrectElements: answers.updates_correct_elements.noul,
      updatesAllDependentViews: answers.updates_all_dependent_views.noul,
      keepsRouteInSync: answers.keeps_route_in_sync.noul,
      unguardedState: answers.unguarded_state.noul,
      needsRepetition: answers.needs_repetition.noul,
      severity: answers.failure_severity.score,
      severityConfidence: answers.failure_severity.confidence,
      model,
      inputTokens: usage.input_tokens,
    };
    this.cache[key] = judgment;
    return { judgment, cached: false };
  }
}
