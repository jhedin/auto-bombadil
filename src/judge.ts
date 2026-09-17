/**
 * Ask Jev narrow questions about the code behind a control. One request per
 * control carries every question, so they run in parallel. Answers are cached
 * by a hash of the code slice, so unchanged code is never re-judged.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TypeSafeClient, noul, score } from "@typesafe-ai/sdk";
import type { ControlFields } from "../bombadil/key.ts";
import type { CodeSlice } from "./link.ts";

export type Judgment = {
  throwsOrRejects: number;
  logsConsoleError: number;
  unguardedState: number;
  needsRepetition: number;
  severity: number;
  severityConfidence: number;
  model: string;
  inputTokens: number;
};

const SEVERITY = [
  "Interacting with the control cannot fail; the handler is trivial or absent",
  "A failure would be cosmetic or recoverable, such as a wrong count or stale text",
  "A failure would be an uncaught exception, an unhandled promise rejection, or a console error",
] as const;

export function questionsFor() {
  return {
    throws_or_rejects: noul(
      {
        question:
          "Can interacting with `control`, once or repeatedly, cause code in `scripts` to throw an uncaught exception or reject a promise that nothing handles?",
        inspect: ["`control.html`", "`scripts`"],
        focus:
          "Trace the event handler attached to the control. Count a rejection as unhandled if no .catch or try/await handles it.",
      },
      {
        true: "Some sequence of interactions reaches a throw or an unhandled reject",
        false: "No interaction sequence reaches a throw or an unhandled reject",
      },
    ),
    logs_console_error: noul(
      {
        question:
          "Can interacting with `control`, once or repeatedly, cause code in `scripts` to call console.error?",
        inspect: ["`control.html`", "`scripts`"],
      },
      {
        true: "Some sequence of interactions reaches a console.error call",
        false: "No console.error call is reachable from this control",
      },
    ),
    unguarded_state: noul(
      {
        question:
          "Does the handler for `control` in `scripts` change application state without checking bounds, nullness, or input validity?",
        inspect: ["`control.html`", "`scripts`"],
        focus: "Only the state the handler itself mutates.",
      },
      {
        true: "State changes with no guard at all",
        false: "State changes are guarded, or the handler changes no state",
      },
    ),
    needs_repetition: noul(
      {
        question:
          "If the handler for `control` in `scripts` can fail, does the failure require interacting with the control more than once?",
        inspect: ["`control.html`", "`scripts`"],
      },
      {
        true: "A counter or threshold must be reached first",
        false: "The first interaction can already fail, or nothing can fail",
      },
    ),
    failure_severity: score(
      {
        question:
          "How severe is the worst failure that interacting with `control` can cause, given `scripts`?",
        inspect: ["`control.html`", "`scripts`"],
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

  static cacheKey(f: ControlFields, slice: CodeSlice): string {
    return createHash("sha256")
      .update(JSON.stringify([f, slice.element, slice.scripts]))
      .digest("hex")
      .slice(0, 24);
  }

  async judge(f: ControlFields, slice: CodeSlice): Promise<{ judgment: Judgment; cached: boolean }> {
    const key = Judge.cacheKey(f, slice);
    const hit = this.cache[key];
    if (hit) return { judgment: hit, cached: true };

    const state = {
      page: slice.page,
      control: {
        tag: f.tag,
        id: f.id,
        href: f.href,
        text: f.text,
        html: slice.element,
      },
      scripts: slice.scripts,
      note: "The page is a small static HTML app. `scripts` holds every inline script on the page, in order.",
    };
    const { answers, model, usage } = await this.client.systemOne({
      state,
      questions: questionsFor(),
    });
    const judgment: Judgment = {
      throwsOrRejects: answers.throws_or_rejects.noul,
      logsConsoleError: answers.logs_console_error.noul,
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
