#!/usr/bin/env node
/**
 * auto-bombadil: steer Bombadil with Jev.
 *
 *   node src/cli.ts serve                 serve examples/site on :8765
 *   node src/cli.ts graph <trace.jsonl>   print the state graph of a run
 *   node src/cli.ts weights <trace.jsonl> judge controls, write bombadil/weights.json
 *   node src/cli.ts compare               N runs uniform vs weighted, report time to first violation
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Judge } from "./judge.ts";
import { serve } from "./serve.ts";
import { buildGraph, readTrace, summarize } from "./trace.ts";
import { computeWeights, writeWeights } from "./weights.ts";

const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}/`;
const CACHE = ".auto-bombadil/judgments.json";

type App = { root: string; weights: string; spec: string; uniform: string; trace: string };
const APPS: Record<string, App> = {
  example: {
    root: "examples/site",
    weights: "bombadil/weights.json",
    spec: "specification",
    uniform: "uniform",
    trace: ".auto-bombadil/example/uniform-0/trace.jsonl",
  },
  todomvc: {
    root: "examples/todomvc",
    weights: "bombadil/todomvc-weights.json",
    spec: "todomvc",
    uniform: "todomvc-uniform",
    trace: ".auto-bombadil/todomvc/uniform-0/trace.jsonl",
  },
  "todomvc-jquery": {
    root: "examples/todomvc-jquery",
    weights: "bombadil/todomvc-jquery-weights.json",
    spec: "todomvc-jquery",
    uniform: "todomvc-jquery-uniform",
    trace: ".auto-bombadil/todomvc-jquery/uniform-0/trace.jsonl",
  },
};

function appFrom(args: string[]): { app: App; name: string; rest: string[] } {
  const i = args.indexOf("--app");
  const name = i >= 0 ? (args[i + 1] ?? "example") : "example";
  const app = APPS[name];
  if (!app) throw new Error(`unknown app ${name}; expected one of ${Object.keys(APPS).join(", ")}`);
  const rest = i >= 0 ? [...args.slice(0, i), ...args.slice(i + 2)] : args;
  return { app, name, rest };
}

function extraArgs(): string[] {
  return (process.env["BOMBADIL_EXTRA_ARGS"] ?? "").split(/\s+/).filter(Boolean);
}

type RunResult = { spec: string; seconds: number; exit: number; violations: string[] };

async function runBombadil(spec: string, outputPath: string, timeLimit: string, exitOnViolation: boolean): Promise<RunResult> {
  await mkdir(outputPath, { recursive: true });
  const args = [
    "bombadil", "browser", "test", "--headless",
    ...(exitOnViolation ? ["--exit-on-violation"] : []),
    `--time-limit=${timeLimit}`, `--output-path=${outputPath}`, "--output-path-overwrite",
    ...extraArgs(), ORIGIN, `bombadil/${spec}.ts`,
  ];
  const started = Date.now();
  const exit = await new Promise<number>((resolve) => {
    const child = spawn("npx", args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const seconds = (Date.now() - started) / 1000;
  const entries = await readTrace(`${outputPath}/trace.jsonl`).catch(() => []);
  const violations = [...new Set(entries.flatMap((e) => (e.violations ?? []).map((v) => v.name ?? "?")))];
  return { spec, seconds, exit, violations };
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  const { app, name, rest } = appFrom(argv);
  switch (command) {
    case "serve": {
      await serve(app.root, PORT);
      console.log(`serving ${app.root} at ${ORIGIN}`);
      await new Promise(() => {});
      return;
    }
    case "run": {
      // One exploratory run with the given spec (default: uniform), to seed a trace.
      const { values } = parseArgs({ args: rest, options: { spec: { type: "string" }, time: { type: "string", default: "30s" }, out: { type: "string" } } });
      const spec = values.spec ?? app.uniform;
      const out = values.out ?? `.auto-bombadil/${name}/${spec === app.uniform ? "uniform" : "weighted"}-0`;
      const close = await serve(app.root, PORT).catch(() => null);
      const r = await runBombadil(spec, out, values.time!, false);
      close?.();
      console.log(`${spec}: ${r.seconds.toFixed(1)}s exit=${r.exit} violations: ${r.violations.join(", ") || "none"}; trace at ${out}/trace.jsonl`);
      if (r.exit === 2) {
        console.log(`replay this failure without exploring: npx bombadil browser test --headless ${extraArgs().join(" ")} --reproduce ${out} ${ORIGIN} bombadil/${spec}.ts`);
      }
      return;
    }
    case "graph": {
      const trace = rest[0] ?? app.trace;
      console.log(summarize(buildGraph(await readTrace(trace))));
      return;
    }
    case "weights": {
      const trace = rest[0] ?? app.trace;
      const entries = await readTrace(trace);
      console.log(entries.length ? `trace: ${trace} (${entries.length} states)` : `no trace at ${trace}; discovering controls from ${app.root} only`);
      const graph = buildGraph(entries);
      const judge = new Judge(CACHE, process.env["TYPESAFE_MODEL"]);
      await judge.load();
      const table = await computeWeights(graph, app.root, judge, console.log);
      await judge.save();
      await writeWeights(app.weights, table);
      const rows = Object.values(table.weights).sort((a, b) => b.weight - a.weight);
      for (const r of rows) {
        console.log(`${String(r.weight).padStart(5)}  ${r.page.padEnd(30)} ${r.control.padEnd(40)} ${r.reasons.join("; ")}`);
      }
      console.log(`wrote ${app.weights} (${rows.length} controls)`);
      return;
    }
    case "compare": {
      const { values } = parseArgs({ args: rest, options: { runs: { type: "string", default: "5" }, time: { type: "string", default: "60s" } } });
      const runs = Number(values.runs);
      const close = await serve(app.root, PORT).catch(() => null);
      const results: RunResult[] = [];
      const specs = [app.uniform, app.spec];
      for (let i = 0; i < runs; i++) {
        for (const spec of specs) {
          const r = await runBombadil(spec, `.auto-bombadil/${name}/compare-${spec}-${i}`, values.time!, true);
          results.push(r);
          console.log(`${spec.padEnd(16)} run ${i}: ${r.seconds.toFixed(1)}s exit=${r.exit} ${r.violations.join(",") || "no violation"}`);
        }
      }
      close?.();
      for (const spec of specs) {
        const rs = results.filter((r) => r.spec === spec);
        const found = rs.filter((r) => r.exit === 2);
        const mean = found.reduce((a, r) => a + r.seconds, 0) / Math.max(1, found.length);
        const sorted = found.map((r) => r.seconds).sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
        console.log(`${spec.padEnd(16)} found violation in ${found.length}/${rs.length} runs; time to first violation mean ${mean.toFixed(1)}s median ${median.toFixed(1)}s`);
      }
      return;
    }
    default:
      console.error("usage: node src/cli.ts <serve|run|graph|weights|compare> [--app example|todomvc|todomvc-jquery] [args]");
      process.exit(1);
  }
}

await main();
