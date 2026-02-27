import OpenAI from "openai";

export const TARGET = "To be, or not to be";
const TARGET_LEN = TARGET.length;

interface EvolutionLevel {
  name: string;
  emoji: string;
  prompt: string;
  maxAttempts: number;
  temperature: number;
}

const EVOLUTION: EvolutionLevel[] = [
  {
    name: "Random Mashing",
    emoji: "🐒",
    prompt:
      "You are a monkey hitting random keys on a typewriter. Produce exactly 20 characters of random gibberish with no real words. Output ONLY the characters, nothing else.",
    maxAttempts: 2,
    temperature: 1.5,
  },
  {
    name: "Learning Letters",
    emoji: "🔤",
    prompt:
      "You are a monkey who has started to notice patterns in human writing. Type a short English-sounding phrase of about 20 characters. It can be nonsensical. Output ONLY the phrase.",
    maxAttempts: 2,
    temperature: 1.2,
  },
  {
    name: "Discovering Drama",
    emoji: "🎭",
    prompt:
      "You are a monkey who has been watching humans perform in a theater. Type a short dramatic phrase you might have overheard, around 20 characters. Output ONLY the phrase.",
    maxAttempts: 2,
    temperature: 1.0,
  },
  {
    name: "Reading Shakespeare",
    emoji: "📚",
    prompt:
      "You are a monkey who found a book of Shakespeare. Type a famous short Shakespeare quote from memory. You might not remember it perfectly. Output ONLY the quote, no attribution, no quotation marks.",
    maxAttempts: 3,
    temperature: 0.9,
  },
  {
    name: "Shakespeare Scholar",
    emoji: "🎓",
    prompt:
      "Type a very famous short Shakespeare quote about existence. Output ONLY the exact quote, nothing else, no quotation marks.",
    maxAttempts: 3,
    temperature: 0.7,
  },
  {
    name: "Hamlet Expert",
    emoji: "🧠",
    prompt:
      "What is the most famous opening of a soliloquy in Hamlet? Output ONLY the first clause (before any comma that follows the main thought), no quotation marks.",
    maxAttempts: 5,
    temperature: 0.3,
  },
];

export interface AttemptRecord {
  level: string;
  emoji: string;
  attempt: string;
  score: number;
}

export interface LLMMonkeyState {
  attempts: number;
  bestScore: number;
  bestAttempt: string;
  currentAttempt: string;
  evolutionLevel: number;
  evolutionName: string;
  evolutionEmoji: string;
  attemptsAtLevel: number;
  tokensUsed: number;
  startTime: number;
  finished: boolean;
  history: AttemptRecord[];
}

export function createLLMMonkey(): LLMMonkeyState {
  return {
    attempts: 0,
    bestScore: 0,
    bestAttempt: "",
    currentAttempt: "",
    evolutionLevel: 0,
    evolutionName: EVOLUTION[0].name,
    evolutionEmoji: EVOLUTION[0].emoji,
    attemptsAtLevel: 0,
    tokensUsed: 0,
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
  client: OpenAI,
  model: string,
): Promise<LLMMonkeyState> {
  const level = EVOLUTION[state.evolutionLevel];

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: level.prompt }],
      max_tokens: 60,
      temperature: level.temperature,
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    const tokens = response.usage?.total_tokens || 0;

    state.attempts++;
    state.attemptsAtLevel++;
    state.tokensUsed += tokens;
    state.currentAttempt = text;

    const { score, bestWindow } = scoreLLMAttempt(text, TARGET);

    state.history.push({
      level: level.name,
      emoji: level.emoji,
      attempt: text.length > 50 ? text.substring(0, 47) + "..." : text,
      score: score / TARGET_LEN,
    });

    if (score > state.bestScore) {
      state.bestScore = score;
      state.bestAttempt = bestWindow;
    }

    if (score >= TARGET_LEN) {
      state.finished = true;
      return state;
    }

    // Evolve if we've used all attempts at this level
    if (state.attemptsAtLevel >= level.maxAttempts) {
      if (state.evolutionLevel < EVOLUTION.length - 1) {
        state.evolutionLevel++;
        state.evolutionName = EVOLUTION[state.evolutionLevel].name;
        state.evolutionEmoji = EVOLUTION[state.evolutionLevel].emoji;
        state.attemptsAtLevel = 0;
      }
    }
  } catch (error: any) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return state;
}
