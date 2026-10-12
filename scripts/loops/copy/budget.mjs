// The copy budget and how a screen is scored against it. Pure, so it is tested without a browser.
export const TITLE_WORDS_MAX = 4;
export const HELP_WORDS_MAX = 12;
export const HELP_SENTENCES_MAX = 1;
export const SCREEN_WORDS_MAX = 120;
const SENTENCE_RULE_MIN_WORDS = 5;
const PHRASE_MIN_WORDS = 3;

export function wordsOf(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function sentencesOf(text) {
  const ends = text.trim().match(/[.!?]+(?=\s+\S|$)/g);
  return Math.max(ends?.length ?? 0, text.trim() ? 1 : 0);
}

const normal = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

function repeats(texts) {
  const seen = new Map();
  for (const text of texts) seen.set(text, (seen.get(text) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([text, n]) => ({ text, times: n }));
}

/**
 * Turns what the page collector saw on one screen into its budget violations and the words over
 * the screen limit. `repeatable` holds only what sits outside list rows, because a row's status
 * or action legitimately appears once per row.
 */
export function assessScreen(raw) {
  const longTitles = raw.headings
    .filter((title) => wordsOf(title) > TITLE_WORDS_MAX)
    .map((title) => `title ${wordsOf(title)}w: ${title}`);
  const longHelp = raw.blocks
    .filter((block) => {
      const words = wordsOf(block);
      return (
        words > HELP_WORDS_MAX ||
        (words >= SENTENCE_RULE_MIN_WORDS && sentencesOf(block) > HELP_SENTENCES_MAX)
      );
    })
    .map((block) => `help ${wordsOf(block)}w/${sentencesOf(block)}s: ${block}`);
  const repeatedPhrases = repeats(
    raw.repeatable.phrases.filter((p) => wordsOf(p) >= PHRASE_MIN_WORDS).map(normal),
  );
  const repeatedActions = repeats(raw.repeatable.actions.map(normal));
  const violations = [
    ...longTitles,
    ...longHelp,
    ...repeatedPhrases.flatMap(({ text, times }) =>
      Array(times - 1).fill(`phrase x${times}: ${text}`),
    ),
    ...repeatedActions.flatMap(({ text, times }) =>
      Array(times - 1).fill(`action x${times}: ${text}`),
    ),
  ];
  const excessWords = Math.max(0, raw.words - SCREEN_WORDS_MAX);
  return {
    words: raw.words,
    fullWords: raw.fullWords,
    excessWords,
    counts: {
      longTitles: longTitles.length,
      longHelp: longHelp.length,
      repeatedPhrases: repeatedPhrases.reduce((n, r) => n + r.times - 1, 0),
      repeatedActions: repeatedActions.reduce((n, r) => n + r.times - 1, 0),
    },
    violations,
    cost: violations.length + excessWords / 10,
  };
}

export function scoreOf(assessed) {
  const violations = assessed.reduce((n, s) => n + s.violations.length, 0);
  const excess = assessed.reduce((n, s) => n + s.excessWords, 0);
  return Math.round((violations + excess / 10) * 10) / 10;
}
