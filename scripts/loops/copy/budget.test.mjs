import assert from "node:assert/strict";
import { test } from "node:test";
import { assessScreen, scoreOf, sentencesOf, wordsOf } from "./budget.mjs";

const screen = (over = {}) => ({
  words: 40,
  fullWords: 40,
  headings: ["Requests"],
  blocks: [],
  repeatable: { phrases: [], actions: [] },
  ...over,
});

test("counts words and sentences", () => {
  assert.equal(wordsOf("  one two\nthree "), 3);
  assert.equal(sentencesOf("Sent. Waiting for a reply."), 2);
  assert.equal(sentencesOf("Mailbox at example.com is fine"), 1);
});

test("a clean screen costs nothing", () => {
  const result = assessScreen(screen());
  assert.deepEqual(result.violations, []);
  assert.equal(result.cost, 0);
});

test("flags titles over four words and help over a sentence or twelve words", () => {
  const result = assessScreen(
    screen({
      headings: ["Connect your own mailbox now please"],
      blocks: [
        "We send from your own mailbox. Replies come back to it.",
        "This one sentence is much too long because it keeps going on and on and on.",
        "Short and fine.",
      ],
    }),
  );
  assert.equal(result.counts.longTitles, 1);
  assert.equal(result.counts.longHelp, 2);
});

test("flags a repeated phrase and a repeated action but only counts the extras", () => {
  const result = assessScreen(
    screen({
      repeatable: {
        phrases: ["Add a profile first", "add a profile first", "Mail"],
        actions: ["Add profile", "Add profile", "Add profile"],
      },
    }),
  );
  assert.equal(result.counts.repeatedPhrases, 1);
  assert.equal(result.counts.repeatedActions, 2);
});

test("words over 120 count a tenth each toward the score", () => {
  const heavy = assessScreen(screen({ words: 170 }));
  assert.equal(heavy.excessWords, 50);
  assert.equal(scoreOf([heavy, assessScreen(screen({ headings: ["a b c d e"] }))]), 6);
});

test("sibling help blocks count together so splitting a note does not hide its sentences", () => {
  const split = assessScreen(
    screen({
      blocks: ["Back up the whole data volume.", "Without the key nothing opens."],
      stacks: [["Back up the whole data volume.", "Without the key nothing opens."]],
    }),
  );
  assert.equal(split.counts.longHelp, 1);
  const single = assessScreen(screen({ blocks: ["Back up the whole data volume."], stacks: [] }));
  assert.equal(single.counts.longHelp, 0);
});
