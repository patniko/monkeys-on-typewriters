import * as readline from "readline";
import { CopilotClient } from "@github/copilot-sdk";
import chalk from "chalk";
import {
  createRandomMonkey,
  runBatch,
  type RandomMonkeyState,
} from "./random-monkey.js";
import {
  createLLMMonkey,
  runLLMAttempt,
  buildEvolution,
  type LLMMonkeyState,
  type DifficultyHints,
} from "./llm-monkey.js";

// ─── Config ─────────────────────────────────────────────────

const RANDOM_BATCH_SIZE = 200_000;
const UI_REFRESH_MS = 150;

interface Difficulty {
  name: string;
  emoji: string;
  target: string;
  description: string;
  hints: DifficultyHints;
}

const DIFFICULTIES: Difficulty[] = [
  {
    name: "Easy",
    emoji: "🟢",
    target: "To be, or not to be",
    description: "Hamlet — the most famous line in theater",
    hints: {
      classicsPrompt:
        "Type a famous short quote from a play written before 1700. Output ONLY the exact quote, nothing else, no quotation marks.",
      finalPrompt:
        "What is the single most famous short quote from English-language theater? Output ONLY the quote itself, no author, no quotation marks, no commentary.",
      perfectionPrompt:
        "What is the single most famous short quote from English-language theater? Be precise with punctuation and commas. Output ONLY the exact quote, no author, no quotation marks, no commentary.",
    },
  },
  {
    name: "Medium",
    emoji: "🟡",
    target: "All the world's a stage",
    description: "As You Like It — well-known but not the obvious #1",
    hints: {
      classicsPrompt:
        "Type a famous short quote from old English plays that uses a metaphor about life. Output ONLY the exact quote, nothing else, no quotation marks.",
      finalPrompt:
        "There is a famous line from an old play that compares all of human life to a theatrical performance. What is the short opening line? Output ONLY the quote, no attribution, no quotation marks.",
      perfectionPrompt:
        "There is a famous line from an old play that compares all of human life to a theatrical performance. What is the exact opening clause? Be precise with punctuation and apostrophes. Output ONLY the quote, no attribution, no quotation marks.",
    },
  },
  {
    name: "Hard",
    emoji: "🔴",
    target: "Brevity is the soul of wit",
    description: "Hamlet — recognizable but not top-of-mind",
    hints: {
      classicsPrompt:
        "Type a famous short quote about wisdom or cleverness from a play written before 1700. Output ONLY the exact quote, nothing else, no quotation marks.",
      finalPrompt:
        "There is a famous quote from an old English play about the value of being concise and keeping things short when you speak. What is it? Output ONLY the exact quote, no author, no quotation marks.",
      perfectionPrompt:
        "There is a famous quote from an old English play about the value of being concise and keeping things short when you speak. What is the exact quote? Output ONLY the quote, no author, no quotation marks, no period at the end.",
    },
  },
];

// ─── Readline helper ────────────────────────────────────────
function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
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
  target: string,
  diffName: string,
): string {
  const tLen = target.length;
  const rPct = r.bestScore / tLen;
  const lPct = l.bestScore / tLen;
  const sec = Math.max(0.1, elapsed / 1000);

  const lines = [
    "",
    chalk.bold.yellow("  🐒 INFINITE MONKEYS vs LLMs — SHAKESPEARE RACE 🤖"),
    chalk.gray("  " + "━".repeat(52)),
    `  Target: ${chalk.white.bold(`"${target}"`)}`,
    `  ${chalk.gray(`Difficulty: ${diffName}`)}          ${chalk.gray(`⏱  ${clock(elapsed)}`)}`,
    "",
    // ── Random monkey ──
    chalk.red.bold("  🐒 RANDOM MONKEY"),
    `     Attempts:  ${chalk.white(fmt(r.attempts))}  ${chalk.gray("(" + fmt(Math.round(r.attempts / sec)) + "/sec)")}`,
    `     Best:      ${chalk.white(r.bestScore + "/" + tLen + " chars")}  ${chalk.gray("(" + (rPct * 100).toFixed(1) + "%)")}`,
    `     Best try:  "${r.bestAttempt ? colorize(r.bestAttempt, target) : chalk.gray("...")}"`,
    `     Progress:  [${bar(rPct)}] ${(rPct * 100).toFixed(1)}%`,
    "",
    // ── LLM monkey ──
    chalk.blue.bold("  🤖 LLM MONKEY") +
      chalk.cyan(`  ⟨${l.evolutionEmoji} ${l.evolutionName}⟩`),
    `     Attempts:  ${chalk.white(String(l.attempts))}`,
    `     Best:      ${chalk.white(l.bestScore + "/" + tLen + " chars")}  ${chalk.gray("(" + (lPct * 100).toFixed(1) + "%)")}` +
      (l.finished ? chalk.green.bold("  ✓ MATCH!") : ""),
    `     Best try:  "${l.bestAttempt ? colorize(l.bestAttempt, target) : chalk.gray("...")}"`,
    `     Progress:  [${bar(lPct)}] ${(lPct * 100).toFixed(1)}%`,
    "",
  ];

  // Fun math extrapolation
  if (r.attempts > 1000) {
    const rate = r.attempts / sec;
    const totalPossible = Math.pow(r.charsetSize, tLen);
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
  target: string,
): string {
  const tLen = target.length;
  const sec = Math.max(0.1, elapsed / 1000);
  const rate = r.attempts / sec;
  const totalPossible = Math.pow(r.charsetSize, tLen);
  const years = totalPossible / rate / 3.154e7;
  const exp = Math.log10(years);

  const winner = l.finished
    ? "LLM MONKEY"
    : r.finished
      ? "RANDOM MONKEY (?!)"
      : "NOBODY";

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
    `     Best match:       ${((r.bestScore / tLen) * 100).toFixed(1)}% (${r.bestScore}/${tLen} chars)`,
    `     Best attempt:     "${r.bestAttempt}"`,
    `     Est. time needed: ${chalk.red("~10^" + exp.toFixed(0) + " years")}`,
    "",
    chalk.blue.bold("  🤖 LLM Monkey"),
    `     Total attempts:   ${l.attempts}`,
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
async function selectModel(client: CopilotClient): Promise<string> {
  console.log(chalk.gray("\n  Fetching available models..."));
  const models = await client.listModels();

  console.log("");
  console.log(chalk.bold("  Select a model for the LLM monkey:"));
  console.log("");
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const num = chalk.white.bold(`  ${String(i + 1).padStart(2)}.`);
    const name = chalk.cyan(m.name.padEnd(30));
    const id = chalk.gray(`(${m.id})`);
    console.log(`${num} ${name} ${id}`);
  }
  console.log("");

  const answer = await ask(chalk.white("  Choice [1]: "));

  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= models.length) {
    console.log(chalk.yellow(`  Invalid choice, using ${models[0].name}.`));
    return models[0].id;
  }

  console.log(chalk.green(`  ✓ Using ${models[idx].name}`));
  return models[idx].id;
}

// ─── Difficulty selection ───────────────────────────────────
async function selectDifficulty(): Promise<Difficulty> {
  console.log("");
  console.log(chalk.bold("  Select difficulty:"));
  console.log("");
  for (let i = 0; i < DIFFICULTIES.length; i++) {
    const d = DIFFICULTIES[i];
    const num = chalk.white.bold(`  ${i + 1}.`);
    const name = chalk.cyan(`${d.emoji} ${d.name}`.padEnd(16));
    const desc = chalk.gray(d.description);
    console.log(`${num} ${name} ${desc}`);
  }
  console.log("");

  const answer = await ask(chalk.white("  Choice [1]: "));

  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= DIFFICULTIES.length) {
    console.log(chalk.yellow("  Invalid choice, using Easy."));
    return DIFFICULTIES[0];
  }

  console.log(chalk.green(`  ✓ ${DIFFICULTIES[idx].emoji} ${DIFFICULTIES[idx].name}: "${DIFFICULTIES[idx].target}"`));
  return DIFFICULTIES[idx];
}

// ─── Main ───────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("");
  console.log(chalk.bold.yellow("  🐒 INFINITE MONKEYS vs LLMs — SHAKESPEARE RACE 🤖"));
  console.log(chalk.gray("  " + "━".repeat(52)));

  const client = new CopilotClient({ logLevel: "error" });
  await client.start();

  const model = await selectModel(client);
  const difficulty = await selectDifficulty();
  const target = difficulty.target;
  const evolution = buildEvolution(difficulty.hints);

  await countdown();

  process.stdout.write("\x1b[?25l"); // hide cursor
  const cleanup = async () => {
    process.stdout.write("\x1b[?25h\n");
    await client.stop().catch(() => {});
  };
  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  let randomState = createRandomMonkey(target);
  let llmState = createLLMMonkey(target, evolution);
  const startTime = Date.now();
  let raceOver = false;

  // LLM monkey — makes API calls via Copilot SDK
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
      process.stdout.write(`\x1b[2J\x1b[H${render(randomState, llmState, elapsed, target, `${difficulty.emoji} ${difficulty.name}`)}`);

      await new Promise((r) => setTimeout(r, UI_REFRESH_MS));
    }
  };

  // 🏁 Start the race
  await Promise.all([llmLoop(), randomLoop(), uiLoop()]);

  // Show final results
  const elapsed = Date.now() - startTime;
  process.stdout.write(`\x1b[2J\x1b[H${render(randomState, llmState, elapsed, target, `${difficulty.emoji} ${difficulty.name}`)}`);
  process.stdout.write(renderFinal(randomState, llmState, elapsed, target));
  process.stdout.write("\x1b[?25h"); // show cursor

  await client.stop().catch(() => {});
}

main().catch((err) => {
  process.stdout.write("\x1b[?25h");
  console.error(chalk.red(`\n  Error: ${err.message}\n`));
  process.exit(1);
});
