import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { buildCatalog } from "../src/catalog.js";
import { createServer } from "../src/server.js";
import { TutorService } from "../src/service.js";
import { createFixtureRepository } from "./fixture.js";

test("tutor service supports discovery, hints, planning, and spoiler-safe review", () => {
  const root = createFixtureRepository();
  try {
    const catalog = buildCatalog(root);
    const tutor = new TutorService(catalog);
    const problem = catalog.problems.find((item) => item.area === "pytorch");
    assert.ok(problem);

    assert.match(textOf(tutor.listProblems({ area: "pytorch" })), /pytorch/i);
    assert.equal(textOf(tutor.getProblem(problem.id)).includes("SECRET"), false);
    assert.match(textOf(tutor.getHint(problem.id, 1)), /Hint 1\/3/);
    assert.match(textOf(tutor.getHint(problem.id, 3)), /without revealing the solution/i);
    assert.match(textOf(tutor.searchCurriculum({ query: "evaluation" })), /src\/ml-fundamental\.md/);
    assert.match(textOf(tutor.getLearningPath("ml-engineer", "mid", 4)), /4 week/);
    assert.match(textOf(tutor.getCompanyPrep("ExampleCo", "GenAI Engineer", 3)), /not a claim/i);
    const metaPlan = tutor.getCompanyPrep("Meta", "ML Engineer", 3);
    const googlePlan = tutor.getCompanyPrep("Google", "ML Engineer", 3);
    assert.equal((metaPlan.structuredContent as Record<string, unknown>).companyTaggedCount, 1);
    assert.equal((googlePlan.structuredContent as Record<string, unknown>).companyTaggedCount, 1);
    const metaMlCoding = planArea(metaPlan, "ml-coding");
    const googleMlCoding = planArea(googlePlan, "ml-coding");
    assert.equal((metaMlCoding.problems[0] as { title: string }).title, "Stable softmax");
    assert.equal((googleMlCoding.problems[0] as { title: string }).title, "Pairwise ranking loss");
    assert.match(textOf(tutor.reviewAnswer(problem.id, "I would choose this because it handles constraints and I would test edge cases.")), /does not provide a reference answer/i);
    assert.equal(tutor.getProblem("missing").isError, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("server registers MCP v2 tool schemas", async () => {
  const root = createFixtureRepository();
  const server = createServer({ repositoryRoot: root });
  try {
    assert.ok(server.toolInputSchemaJson("list_problems"));
    assert.ok(server.toolInputSchemaJson("get_hint"));
    assert.ok(server.toolInputSchemaJson("review_answer"));
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  const block = result.content.find((item) => item.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function planArea(
  result: { structuredContent?: unknown },
  area: string,
): { problems: Array<Record<string, unknown>> } {
  const content = result.structuredContent as Record<string, unknown>;
  const plan = content.plan as Array<{
    area: string;
    problems: Array<Record<string, unknown>>;
  }>;
  const entry = plan.find((item) => item.area === area);
  assert.ok(entry);
  return entry;
}
