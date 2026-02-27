import { CopilotClient, approveAll, type CopilotSession } from "@github/copilot-sdk";

export interface EvolutionLevel {
  name: string;
  emoji: string;
  prompt: string;
  maxAttempts: number;
}

// Shared early stages — same regardless of difficulty
const COMMON_STAGES: EvolutionLevel[] = [
  {
    name: "Random Mashing",
    emoji: "🐒",
    prompt:
      "You are a monkey hitting random keys on a typewriter. Produce exactly 20 characters of random gibberish with no real words. Output ONLY the characters, nothing else.",
    maxAttempts: 3,
  },
  {
    name: "Learning Letters",
    emoji: "🔤",
    prompt:
      "You are a monkey who has started to notice patterns in human writing. Type a short English-sounding phrase of about 20 characters. It can be nonsensical. Output ONLY the phrase.",
    maxAttempts: 3,
  },
  {
    name: "Forming Sentences",
    emoji: "✏️",
    prompt:
      "Write a short philosophical-sounding sentence, around 20 characters. It does not need to be a real quote. Output ONLY the sentence, nothing else.",
    maxAttempts: 3,
  },
  {
    name: "Pondering Existence",
    emoji: "🤔",
    prompt:
      "Write a very short phrase about whether something exists or doesn't. About 20 characters. Output ONLY the phrase, no quotation marks.",
    maxAttempts: 4,
  },
  {
    name: "Discovering Theater",
    emoji: "🎭",
    prompt:
      "Write a short dramatic line that a character on stage might say. Around 20 characters. Output ONLY the line, no quotation marks.",
    maxAttempts: 4,
  },
  {
    name: "Reading Old Books",
    emoji: "📚",
    prompt:
      "Type a short, well-known quote from old English literature. Around 20 characters. Output ONLY the quote, no attribution, no quotation marks.",
    maxAttempts: 5,
  },
];

export interface DifficultyHints {
  classicsPrompt: string;
  finalPrompt: string;
  perfectionPrompt: string;
}

export function buildEvolution(hints: DifficultyHints): EvolutionLevel[] {
  return [
    ...COMMON_STAGES,
    {
      name: "Studying the Classics",
      emoji: "🎓",
      prompt: hints.classicsPrompt,
      maxAttempts: 5,
    },
    {
      name: "Deep Contemplation",
      emoji: "🧠",
      prompt: hints.finalPrompt,
      maxAttempts: 5,
    },
    {
      name: "Perfecting the Quote",
      emoji: "✨",
      prompt: hints.perfectionPrompt,
      maxAttempts: 10,
    },
  ];
}

export interface AttemptRecord {
  level: string;
  emoji: string;
  attempt: string;
  score: number;
}

export interface LLMMonkeyState {
  target: string;
  targetLen: number;
  evolution: EvolutionLevel[];
  attempts: number;
  bestScore: number;
  bestAttempt: string;
  currentAttempt: string;
  evolutionLevel: number;
  evolutionName: string;
  evolutionEmoji: string;
  attemptsAtLevel: number;
  startTime: number;
  finished: boolean;
  history: AttemptRecord[];
}

export function createLLMMonkey(
  target: string,
  evolution: EvolutionLevel[],
): LLMMonkeyState {
  return {
    target,
    targetLen: target.length,
    evolution,
    attempts: 0,
    bestScore: 0,
    bestAttempt: "",
    currentAttempt: "",
    evolutionLevel: 0,
    evolutionName: evolution[0].name,
    evolutionEmoji: evolution[0].emoji,
    attemptsAtLevel: 0,
    startTime: Date.now(),
    finished: false,
    history: [],
  };
}

function scoreLLMAttempt(
  attempt: string,
  target: string,
): { score: number; bestWindow: string } {
  // Check exact containment (also with trimmed quotes)
  const cleaned = attempt.replace(/^["'\s]+|["'\s]+$/g, "");
  for (const text of [attempt, cleaned]) {
    if (text.includes(target)) {
      return { score: target.length, bestWindow: target };
    }
  }

  // Sliding window — find best character-by-character alignment
  const text = cleaned.length > 0 ? cleaned : attempt;
  let bestScore = 0;
  let bestWindow = text.substring(0, target.length);

  if (text.length >= target.length) {
    for (let i = 0; i <= text.length - target.length; i++) {
      let score = 0;
      for (let j = 0; j < target.length; j++) {
        if (text[i + j] === target[j]) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestWindow = text.substring(i, i + target.length);
      }
    }
  } else {
    // Text shorter than target — compare from start
    let score = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === target[i]) score++;
    }
    bestScore = score;
    bestWindow = text;
  }

  return { score: bestScore, bestWindow };
}

export async function runLLMAttempt(
  state: LLMMonkeyState,
  client: CopilotClient,
  model: string,
): Promise<LLMMonkeyState> {
  const level = state.evolution[state.evolutionLevel];

  let session: CopilotSession | undefined;
  try {
    // Fresh session per attempt — no accumulated context
    session = await client.createSession({ model, onPermissionRequest: approveAll });

    const response = await session.sendAndWait(
      { prompt: level.prompt },
      30_000,
    );

    const text = response?.data.content?.trim() || "";

    state.attempts++;
    state.attemptsAtLevel++;
    state.currentAttempt = text;

    const { score, bestWindow } = scoreLLMAttempt(text, state.target);

    state.history.push({
      level: level.name,
      emoji: level.emoji,
      attempt: text.length > 50 ? text.substring(0, 47) + "..." : text,
      score: score / state.targetLen,
    });

    if (score > state.bestScore) {
      state.bestScore = score;
      state.bestAttempt = bestWindow;
    }

    if (score >= state.targetLen) {
      state.finished = true;
      return state;
    }

    // Evolve if we've used all attempts at this level
    if (state.attemptsAtLevel >= level.maxAttempts) {
      if (state.evolutionLevel < state.evolution.length - 1) {
        state.evolutionLevel++;
        state.evolutionName = state.evolution[state.evolutionLevel].name;
        state.evolutionEmoji = state.evolution[state.evolutionLevel].emoji;
        state.attemptsAtLevel = 0;
      }
    }
  } catch (error: any) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } finally {
    if (session) await session.destroy().catch(() => {});
  }

  return state;
}
