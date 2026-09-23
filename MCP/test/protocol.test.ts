import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { createServer } from "../src/server.js";
import { createFixtureRepository } from "./fixture.js";

test("MCP v2 client can list and call tutor tools", async () => {
  const root = createFixtureRepository();
  const server = createServer({ repositoryRoot: root });
  const client = new Client({ name: "aimlinterviews-mcp-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "get_company_prep",
        "get_hint",
        "get_learning_path",
        "get_problem",
        "get_server_status",
        "list_problems",
        "review_answer",
        "search_curriculum",
      ],
    );
    const called = await client.callTool({
      name: "list_problems",
      arguments: { area: "pytorch" },
    });
    assert.equal(called.isError, undefined);
    assert.match(textOf(called), /pytorch/i);
    const listedContent = called.structuredContent as {
      problems: Array<{ id: string }>;
    };
    const problemId = listedContent.problems[0]?.id;
    assert.ok(problemId);

    const toolCalls = [
      { name: "get_server_status", arguments: {} },
      { name: "get_problem", arguments: { id: problemId } },
      { name: "get_hint", arguments: { id: problemId, level: 1 } },
      { name: "search_curriculum", arguments: { query: "evaluation" } },
      { name: "get_learning_path", arguments: { goal: "ml-engineer", experience: "mid", weeks: 4 } },
      { name: "get_company_prep", arguments: { company: "Meta", role: "ML Engineer", weeks: 4 } },
      { name: "review_answer", arguments: { id: problemId, answer: "I would clarify constraints, explain tradeoffs, and test edge cases." } },
    ];
    for (const request of toolCalls) {
      const response = await client.callTool(request);
      assert.equal(response.isError, undefined, `${request.name} returned an MCP error`);
    }

    const prompts = await client.listPrompts();
    assert.deepEqual(
      prompts.prompts.map((prompt) => prompt.name).sort(),
      ["interview_tutor", "mock_interview", "study_plan"],
    );
    const studyPlan = await client.getPrompt({
      name: "study_plan",
      arguments: { goal: "ml-engineer", experience: "mid", weeks: "6" },
    });
    assert.match(promptTextOf(studyPlan), /6-week ml-engineer/);
    await client.getPrompt({
      name: "interview_tutor",
      arguments: { area: "ml-coding", difficulty: "medium" },
    });
    await client.getPrompt({
      name: "mock_interview",
      arguments: { company: "Meta", role: "ML Engineer", level: "mid" },
    });

    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), [
      "aimlinterviews://catalog",
      "aimlinterviews://tutor-policy",
    ]);
    const catalogResource = await client.readResource({ uri: "aimlinterviews://catalog" });
    const policyResource = await client.readResource({ uri: "aimlinterviews://tutor-policy" });
    assert.match(JSON.stringify(catalogResource), /sourceCommit/);
    assert.match(JSON.stringify(policyResource), /Do not provide reference answers/i);
  } finally {
    await client.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function textOf(result: { content: Array<Record<string, unknown>> }): string {
  const block = result.content.find((item) => item.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

function promptTextOf(result: { messages: Array<{ content: unknown }> }): string {
  return result.messages
    .map((message) => {
      const content = message.content as { type?: string; text?: string };
      return content.type === "text" ? content.text ?? "" : "";
    })
    .join("\n");
}
