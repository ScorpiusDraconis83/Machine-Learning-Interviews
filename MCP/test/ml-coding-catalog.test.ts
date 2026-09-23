import assert from "node:assert/strict";
import { test } from "node:test";

import { extractProblems } from "../src/catalog.js";

const SOURCE_PATH = "src/MLC/ml-coding.md";
const HEADER = `| Problem | Difficulty | Tags | Company tags | Answer | Interview focus |
| --- | --- | --- | --- | --- | --- |`;
const ROWS = [
  "| k-nearest neighbors | ![Medium](../assets/difficulty-medium.svg) | distance, ranking, classification, vectorization | Uber, LinkedIn, Meta | [Python](answer.py) | Pairwise distances and top-k selection |",
  "| Sample-weighted losses | Medium | losses, distributed | Google | [Python](answer.py) | Reduction semantics |",
  "| Causal attention mask | Easy | attention, masking | OpenAI | [Python](answer.py) | Mask orientation |",
  "| Classifier-free guidance | Easy | diffusion, conditioning | Midjourney | [Python](answer.py) | Conditional interpolation |",
].join("\n");

test("ML coding category headings preserve legacy problem IDs", () => {
  const legacy = extractProblems(
    SOURCE_PATH,
    `## Priority ML coding problems\n\n${HEADER}\n${ROWS}`,
    "commit-a",
  );
  const categorized = extractProblems(
    SOURCE_PATH,
    `## Priority ML coding problems\n\n### Classic ML\n\n${HEADER}\n${ROWS}`,
    "commit-a",
  );

  assert.equal(legacy.length, 4);
  assert.equal(categorized.length, 4);
  assert.equal(categorized[0].id, legacy[0].id);
  assert.equal(categorized[0].sourceHeading, "Priority ML coding problems");
  assert.equal(categorized[0].difficulty, "medium");
  assert.deepEqual(categorized[0].companies, ["LinkedIn", "Meta", "Uber"]);
  assert.ok(categorized[0].tags.includes("ranking"));
  assert.ok(categorized[0].tags.includes("classification"));
  assert.ok(categorized[0].tags.includes("vectorization"));
  assert.equal(categorized[0].tags.includes("agents"), false);
  assert.equal(categorized[0].prompt.includes("answer.py"), false);

  assert.equal(categorized[1].difficulty, "medium");
  assert.ok(categorized[1].tags.includes("distributed"));
  assert.equal(categorized[2].difficulty, "easy");
  assert.ok(categorized[2].tags.includes("attention"));
  assert.equal(categorized[3].difficulty, "easy");
  assert.ok(categorized[3].tags.includes("diffusion"));
});
