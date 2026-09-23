import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createFixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "aimlinterviews-mcp-"));
  const files: Record<string, string> = {
    "README.md": "# AIMLInterviews\n",
    "src/lc-coding.md": [
      "# General coding",
      "## Common Questions",
      "- How would you find two values that sum to a target?",
    ].join("\n"),
    "src/MLC/ml-coding.md": [
      "# ML coding",
      "## Priority ML coding problems",
      "| Problem | Difficulty | Tags | Company tags | Answer | Interview focus |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Stable softmax | Easy | numerical stability, vectorization | Meta | answer | Stable exponentials |",
      "| Pairwise ranking loss | Medium | ranking, losses | Google | answer | Pairwise comparisons |",
      "## Interview method",
      "Explain shapes, tests, and complexity.",
    ].join("\n"),
    "src/MLC/pytorch-ml-coding.md": [
      "# PyTorch coding",
      "## Batched linear layer - 20 minutes",
      "#### Question",
      "Implement a batched linear layer and explain tensor shapes.",
      "#### Reference response",
      "SECRET_REFERENCE_IMPLEMENTATION",
      "## Common tensor questions",
      "1. **How do you stop gradients through a tensor?**",
      "Answer: SECRET_INLINE_ANSWER",
    ].join("\n"),
    "src/ml-fundamental.md": [
      "# ML fundamentals",
      "## Sample Questions",
      "- Explain the bias-variance tradeoff?",
      "## Evaluation",
      "Choose metrics that match the business objective.",
    ].join("\n"),
    "src/MLSD/ml-system-design.md": [
      "# ML system design",
      "## System Design Sample Questions",
      "- Design a production recommendation system?",
    ].join("\n"),
    "src/behavioral/behavior.md": [
      "# Behavioral",
      "## Common Questions",
      "- Tell me about a difficult technical decision?",
    ].join("\n"),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
  return root;
}
