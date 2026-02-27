import { execSync } from "child_process";
import * as readline from "readline";
import OpenAI from "openai";
import chalk from "chalk";
import {
  createRandomMonkey,
  runBatch,
  type RandomMonkeyState,
} from "./random-monkey.js";
import {
  createLLMMonkey,
  runLLMAttempt,
  TARGET,
  type LLMMonkeyState,
} from "./llm-monkey.js";

// ─── Config ─────────────────────────────────────────────────
const RACE_TIMEOUT_SEC = 120;
const RANDOM_BATCH_SIZE = 200_000;
const UI_REFRESH_MS = 150;
const MODELS = [
  { id: "gpt-4o-mini", name: "GPT-4o Mini", note: "fast & cheap" },
  { id: "gpt-4o", name: "GPT-4o", note: "smarter, slower" },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", note: "fastest" },
  { id: "o4-mini", name: "o4-mini", note: "reasoning model" },
  { id: "Phi-4", name: "Phi-4", note: "Microsoft, small" },
  { id: "Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", note: "Meta, large" },
  { id: "Mistral-Large-2411", name: "Mistral Large", note: "Mistral AI" },
  { id: "DeepSeek-R1", name: "DeepSeek R1", note: "reasoning model" },
];

// ─── Token ──────────────────────────────────────────────────
function getToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync("gh auth token 2>/dev/null", { encoding: "utf-8" }).trim();
  } catch {
    console.error(
      chalk.red("\n  ✖ Could not find a GitHub token.\n") +
        chalk.gray(
          "  Set GITHUB_TOKEN or install the gh CLI and run: gh auth login\n",
        ),
    );
    process.exit(1);
  }
}

// ─── Formatting helpers ─────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function bar(pct: number, w = 20): string {
  const filled = Math.round(pct * w);
  return (
    chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(w - filled))
  );
}

function colorize(attempt: string, target: string): string {
  let out = "";
  const len = Math.min(attempt.length, target.length);
  for (let i = 0; i < len; i++) {
    out +=
      attempt[i] === target[i]
        ? chalk.green.bold(attempt[i])
        : chalk.red(attempt[i]);
  }
  // extra chars beyond target length
  for (let i = len; i < attempt.length; i++) {
    out += chalk.gray(attempt[i]);
  }
  return out;
}

// ─── Live race display ──────────────────────────────────────
function render(
  r: RandomMonkeyState,
  l: LLMMonkeyState,
  elapsed: number,
): string {
  const rPct = r.bestScore / TARGET.length;
  const lPct = l.bestScore / TARGET.length;
  const sec = Math.max(0.1, elapsed / 1000);

  const lines = [
    "",
    chalk.bold.yellow("  🐒 INFINITE MONKEYS vs LLMs — SHAKESPEARE RACE 🤖"),
    chalk.gray("  " + "━".repeat(52)),
    `  Target: ${chalk.white.bold(`"${TARGET}"`)}          ${chalk.gray(`⏱  ${clock(elapsed)}`)}`,
    "",
    // ── Random monkey ──
    chalk.red.bold("  🐒 RANDOM MONKEY"),
    `     Attempts:  ${chalk.white(fmt(r.attempts))}  ${chalk.gray("(" + fmt(Math.round(r.attempts / sec)) + "/sec)")}`,
    `     Best:      ${chalk.white(r.bestScore + "/" + TARGET.length + " chars")}  ${chalk.gray("(" + (rPct * 100).toFixed(1) + "%)")}`,
    `     Best try:  "${r.bestAttempt ? colorize(r.bestAttempt, TARGET) : chalk.gray("...")}"`,
    `     Progress:  [${bar(rPct)}] ${(rPct * 100).toFixed(1)}%`,
    "",
    // ── LLM monkey ──
    chalk.blue.bold("  🤖 LLM MONKEY") +
      chalk.cyan(`  ⟨${l.evolutionEmoji} ${l.evolutionName}⟩`),
    `     Attempts:  ${chalk.white(String(l.attempts))}  ${chalk.gray("(" + fmt(l.tokensUsed) + " tokens)")}`,
    `     Best:      ${chalk.white(l.bestScore + "/" + TARGET.length + " chars")}  ${chalk.gray("(" + (lPct * 100).toFixed(1) + "%)")}` +
      (l.finished ? chalk.green.bold("  ✓ MATCH!") : ""),
    `     Best try:  "${l.bestAttempt ? colorize(l.bestAttempt, TARGET) : chalk.gray("...")}"`,
    `     Progress:  [${bar(lPct)}] ${(lPct * 100).toFixed(1)}%`,
    "",
  ];

  // Fun math extrapolation
  if (r.attempts > 1000) {
    const rate = r.attempts / sec;
    const totalPossible = Math.pow(54, TARGET.length);
    const years = totalPossible / rate / 3.154e7;
    const exp = Math.log10(years);
    lines.push(
      chalk.gray(
        `  📊 Random monkey needs ~10^${exp.toFixed(0)} years at current speed`,
      ),
    );
    lines.push(
      chalk.gray("     The universe is only ~1.4 × 10^10 years old"),
    );
    lines.push("");
  }

  // Recent LLM attempts
  if (l.history.length > 0) {
    lines.push(chalk.gray("  🧬 LLM evolution:"));
    const recent = l.history.slice(-5);
    for (const h of recent) {
      const pct = (h.score * 100).toFixed(0) + "%";
      const c =
        h.score >= 1.0
          ? chalk.green.bold
          : h.score >= 0.4
            ? chalk.yellow
            : chalk.red;
      const check = h.score >= 1.0 ? chalk.green(" ✓") : "";
      lines.push(
        `     ${h.emoji} ${h.level.padEnd(22)} ${chalk.gray('"')}${h.attempt}${chalk.gray('"')}  ${c(pct)}${check}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Final statistics ───────────────────────────────────────
function renderFinal(
  r: RandomMonkeyState,
  l: LLMMonkeyState,
  elapsed: number,
): string {
  const sec = Math.max(0.1, elapsed / 1000);
  const rate = r.attempts / sec;
  const totalPossible = Math.pow(54, TARGET.length);
  const years = totalPossible / rate / 3.154e7;
  const exp = Math.log10(years);

  const winner = l.finished
    ? "LLM MONKEY"
    : r.finished
      ? "RANDOM MONKEY (?!)"
      : "NOBODY (timed out)";

  const lines = [
    "",
    chalk.bold.green(`  🎉 RACE COMPLETE — ${winner} WINS! 🎉`),
    chalk.gray("  " + "━".repeat(52)),
    "",
    chalk.bold("  📊 Final Statistics"),
    "",
    chalk.red.bold("  🐒 Random Monkey"),
    `     Total attempts:   ${fmt(r.attempts)}`,
    `     Characters typed: ${fmt(r.charsGenerated)}`,
    `     Best match:       ${((r.bestScore / TARGET.length) * 100).toFixed(1)}% (${r.bestScore}/${TARGET.length} chars)`,
    `     Best attempt:     "${r.bestAttempt}"`,
    `     Est. time needed: ${chalk.red("~10^" + exp.toFixed(0) + " years")}`,
    "",
    chalk.blue.bold("  🤖 LLM Monkey"),
    `     Total attempts:   ${l.attempts}`,
    `     Tokens used:      ${fmt(l.tokensUsed)}`,
    `     Match found in:   ${chalk.green(clock(Date.now() - l.startTime))}`,
    "",
    chalk.bold("  🧬 Full Evolution Journey:"),
  ];

  for (const h of l.history) {
    const pct = (h.score * 100).toFixed(0) + "%";
    const c =
      h.score >= 1.0
        ? chalk.green.bold
        : h.score >= 0.5
          ? chalk.yellow
          : chalk.red;
    const check = h.score >= 1.0 ? chalk.green(" ✓") : "";
    lines.push(
      `     ${h.emoji} ${h.level.padEnd(22)} "${h.attempt}"  ${c(pct)}${check}`,
    );
  }

  lines.push("");
  const speedRatio = (years * 3.154e7) / Math.max(1, sec);
  const sExp = Math.log10(speedRatio);
  lines.push(
    chalk.bold.yellow(
      `  ⚡ The LLM was ~10^${sExp.toFixed(0)}x faster than random chance!`,
    ),
  );
  lines.push("");

  return lines.join("\n");
}

// ─── Countdown ──────────────────────────────────────────────
async function countdown(): Promise<void> {
  for (const frame of ["3", "2", "1", "🏁 GO!"]) {
    process.stdout.write(`\x1b[2J\x1b[H\n  ${chalk.bold.yellow(frame)}\n`);
    await new Promise((r) => setTimeout(r, frame === "🏁 GO!" ? 500 : 700));
  }
}

// ─── Model selection ────────────────────────────────────────
async function selectModel(): Promise<string> {
  console.log("");
  console.log(chalk.bold.yellow("  🐒 INFINITE MONKEYS vs LLMs — SHAKESPEARE RACE 🤖"));
  console.log(chalk.gray("  " + "━".repeat(52)));
  console.log("");
  console.log(chalk.bold("  Select a model for the LLM monkey:"));
  console.log("");
  for (let i = 0; i < MODELS.length; i++) {
    const m = MODELS[i];
    const num = chalk.white.bold(`  ${String(i + 1).padStart(2)}.`);
    const name = chalk.cyan(m.name.padEnd(22));
    const note = chalk.gray(`(${m.note})`);
    console.log(`${num} ${name} ${note}`);
  }
  console.log("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.white("  Choice [1]: "), (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= MODELS.length) {
    console.log(chalk.yellow("  Invalid choice, using GPT-4o Mini."));
    return MODELS[0].id;
  }

  console.log(chalk.green(`  ✓ Using ${MODELS[idx].name}`));
  return MODELS[idx].id;
}

// ─── Main ───────────────────────────────────────────────────
async function main(): Promise<void> {
  const token = getToken();
  const client = new OpenAI({
    baseURL: "https://models.inference.ai.azure.com",
    apiKey: token,
  });

  const model = await selectModel();
  await countdown();

  process.stdout.write("\x1b[?25l"); // hide cursor
  const cleanup = () => process.stdout.write("\x1b[?25h\n");
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  let randomState = createRandomMonkey();
  let llmState = createLLMMonkey();
  const startTime = Date.now();
  let raceOver = false;

  // LLM monkey — makes API calls
  const llmLoop = async () => {
    while (!raceOver) {
      llmState = await runLLMAttempt(llmState, client, model);
      if (llmState.finished) raceOver = true;
    }
  };

  // Random monkey — hot loop with yields
  const randomLoop = async () => {
    while (!raceOver) {
      randomState = runBatch(randomState, RANDOM_BATCH_SIZE);
      if (randomState.finished) raceOver = true;
      await new Promise((r) => setImmediate(r));
    }
  };

  // UI refresh loop
  const uiLoop = async () => {
    while (!raceOver) {
      const elapsed = Date.now() - startTime;
      process.stdout.write(`\x1b[2J\x1b[H${render(randomState, llmState, elapsed)}`);

      if (elapsed > RACE_TIMEOUT_SEC * 1000) {
        raceOver = true;
        break;
      }
      await new Promise((r) => setTimeout(r, UI_REFRESH_MS));
    }
  };

  // 🏁 Start the race
  await Promise.all([llmLoop(), randomLoop(), uiLoop()]);

  // Show final results
  const elapsed = Date.now() - startTime;
  process.stdout.write(`\x1b[2J\x1b[H${render(randomState, llmState, elapsed)}`);
  process.stdout.write(renderFinal(randomState, llmState, elapsed));
  process.stdout.write("\x1b[?25h"); // show cursor
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h");
  console.error(chalk.red(`\n  Error: ${err.message}\n`));
  process.exit(1);
});
