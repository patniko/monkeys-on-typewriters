const BASE_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ,";

export interface RandomMonkeyState {
  targetChars: string[];
  targetLen: number;
  chars: string[];
  charsetSize: number;
  attempts: number;
  bestScore: number;
  bestAttempt: string;
  charsGenerated: number;
  startTime: number;
  finished: boolean;
}

export function createRandomMonkey(target: string): RandomMonkeyState {
  // Build charset that includes all characters in the target
  const all = new Set([...BASE_CHARSET, ...target]);
  const chars = [...all];
  return {
    targetChars: [...target],
    targetLen: target.length,
    chars,
    charsetSize: chars.length,
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
  const { targetChars, targetLen, chars, charsetSize } = state;
  const buf: string[] = new Array(targetLen);

  for (let i = 0; i < batchSize; i++) {
    let score = 0;
    for (let j = 0; j < targetLen; j++) {
      const c = chars[(Math.random() * charsetSize) | 0];
      buf[j] = c;
      if (c === targetChars[j]) score++;
    }
    if (score > state.bestScore) {
      state.bestScore = score;
      state.bestAttempt = buf.join("");
      if (score === targetLen) {
        state.finished = true;
        state.attempts += i + 1;
        state.charsGenerated += (i + 1) * targetLen;
        return state;
      }
    }
  }

  state.attempts += batchSize;
  state.charsGenerated += batchSize * targetLen;
  return state;
}
