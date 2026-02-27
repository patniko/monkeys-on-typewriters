const TARGET = "To be, or not to be";
const TARGET_CHARS = [...TARGET];
const TARGET_LEN = TARGET.length;

// Characters that could plausibly appear in the target
const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ,";
const CHARS = [...CHARSET];
const CHARSET_SIZE = CHARS.length;

export interface RandomMonkeyState {
  attempts: number;
  bestScore: number;
  bestAttempt: string;
  charsGenerated: number;
  startTime: number;
  finished: boolean;
}

export function createRandomMonkey(): RandomMonkeyState {
  return {
    attempts: 0,
    bestScore: 0,
    bestAttempt: "",
    charsGenerated: 0,
    startTime: Date.now(),
    finished: false,
  };
}

export function runBatch(
  state: RandomMonkeyState,
  batchSize: number,
): RandomMonkeyState {
  const buf: string[] = new Array(TARGET_LEN);

  for (let i = 0; i < batchSize; i++) {
    let score = 0;
    for (let j = 0; j < TARGET_LEN; j++) {
      const c = CHARS[(Math.random() * CHARSET_SIZE) | 0];
      buf[j] = c;
      if (c === TARGET_CHARS[j]) score++;
    }
    if (score > state.bestScore) {
      state.bestScore = score;
      state.bestAttempt = buf.join("");
      if (score === TARGET_LEN) {
        state.finished = true;
        state.attempts += i + 1;
        state.charsGenerated += (i + 1) * TARGET_LEN;
        return state;
      }
    }
  }

  state.attempts += batchSize;
  state.charsGenerated += batchSize * TARGET_LEN;
  return state;
}
