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

const SITE = "examples/site";
const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}/`;
const CACHE = ".auto-bombadil/judgments.json";
const WEIGHTS = "bombadil/weights.json";

function extraArgs(): string[] {
  return (process.env["BOMBADIL_EXTRA_ARGS"] ?? "").split(/\s+/).filter(Boolean);
}

type RunResult = { spec: string; seconds: number; exit: number; violations: string[] };

async function runBombadil(spec: string, outputPath: string, timeLimit: string): Promise<RunResult> {
  await mkdir(outputPath, { recursive: true });
  const args = [
    "bombadil", "browser", "test", "--headless", "--exit-on-violation",
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
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "serve": {
      await serve(SITE, PORT);
      console.log(`serving ${SITE} at ${ORIGIN}`);
      await new Promise(() => {});
      return;
    }
    case "graph": {
      const trace = rest[0] ?? ".auto-bombadil/smoke/trace.jsonl";
      console.log(summarize(buildGraph(await readTrace(trace))));
      return;
    }
    case "weights": {
      const trace = rest[0] ?? ".auto-bombadil/smoke/trace.jsonl";
      const graph = buildGraph(await readTrace(trace));
      const judge = new Judge(CACHE, process.env["TYPESAFE_MODEL"]);
      await judge.load();
      const table = await computeWeights(graph, SITE, judge, console.log);
      await judge.save();
      await writeWeights(WEIGHTS, table);
      const rows = Object.values(table.weights).sort((a, b) => b.weight - a.weight);
      for (const r of rows) {
        console.log(`${String(r.weight).padStart(5)}  ${r.page.padEnd(42)} ${r.control.padEnd(34)} ${r.reasons.join("; ")}`);
      }
      console.log(`wrote ${WEIGHTS} (${rows.length} controls)`);
      return;
    }
    case "compare": {
      const { values } = parseArgs({ args: rest, options: { runs: { type: "string", default: "5" }, time: { type: "string", default: "60s" } } });
      const runs = Number(values.runs);
      const close = await serve(SITE, PORT).catch(() => null);
      const results: RunResult[] = [];
      for (let i = 0; i < runs; i++) {
        for (const spec of ["uniform", "specification"]) {
          const r = await runBombadil(spec, `.auto-bombadil/runs/${spec}-${i}`, values.time!);
          results.push(r);
          console.log(`${spec.padEnd(14)} run ${i}: ${r.seconds.toFixed(1)}s exit=${r.exit} ${r.violations.join(",") || "no violation"}`);
        }
      }
      close?.();
      for (const spec of ["uniform", "specification"]) {
        const rs = results.filter((r) => r.spec === spec);
        const found = rs.filter((r) => r.exit === 2);
        const mean = found.reduce((a, r) => a + r.seconds, 0) / Math.max(1, found.length);
        const sorted = found.map((r) => r.seconds).sort((a, b) => a - b);
        const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
        console.log(`${spec.padEnd(14)} found violation in ${found.length}/${rs.length} runs; time to first violation mean ${mean.toFixed(1)}s median ${median.toFixed(1)}s`);
      }
      return;
    }
    default:
      console.error("usage: node src/cli.ts <serve|graph|weights|compare> [args]");
      process.exit(1);
  }
}

await main();
