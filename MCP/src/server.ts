import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { buildCatalog } from "./catalog.js";
import { resolveRepositoryRoot } from "./repository.js";
import { TutorService } from "./service.js";
import { AREAS } from "./types.js";

export const SERVER_VERSION = (JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export interface CreateServerOptions {
  repositoryRoot?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const repositoryRoot = resolveRepositoryRoot(options.repositoryRoot);
  const catalog = buildCatalog(repositoryRoot);
  const tutor = new TutorService(catalog);
  const server = new McpServer({ name: "aimlinterviews-mcp", version: SERVER_VERSION });

  server.registerTool(
    "get_server_status",
    {
      title: "Get AIMLInterviews Tutor Status",
      description: "Report the curriculum root, source commit, and indexed content counts.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => tutor.status(),
  );

  server.registerTool(
    "list_problems",
    {
      title: "List Interview Problems",
      description: "Find AIMLInterviews practice problems by area, difficulty, tag, company mention, or text query.",
      inputSchema: z.object({
        area: z.enum(AREAS).optional().describe("Interview area to include."),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        tag: z.string().min(1).optional(),
        company: z.string().min(1).optional().describe("Company names explicitly mentioned in the source."),
        query: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) => tutor.listProblems(args),
  );

  server.registerTool(
    "get_problem",
    {
      title: "Get Interview Problem",
      description: "Retrieve a practice prompt and source metadata without a solution or reference answer.",
      inputSchema: z.object({ id: z.string().min(1).describe("Stable problem ID returned by list_problems.") }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => tutor.getProblem(id),
  );

  server.registerTool(
    "get_hint",
    {
      title: "Get Progressive Hint",
      description: "Return one spoiler-safe coaching hint. Request levels 1, 2, and 3 in order.",
      inputSchema: z.object({
        id: z.string().min(1),
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ id, level }) => tutor.getHint(id, level),
  );

  server.registerTool(
    "search_curriculum",
    {
      title: "Search Interview Curriculum",
      description: "Find relevant chapter sections and source locations without returning answer text.",
      inputSchema: z.object({
        query: z.string().min(1),
        area: z.enum(AREAS).optional(),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      annotations: readOnlyAnnotations,
    },
    async (args) => tutor.searchCurriculum(args),
  );

  server.registerTool(
    "get_learning_path",
    {
      title: "Build Learning Path",
      description: "Create a role-focused, source-linked AIMLInterviews study sequence.",
      inputSchema: z.object({
        goal: z.enum([
          "ml-engineer",
          "applied-scientist",
          "genai-engineer",
          "research-engineer",
          "coding-intensive",
          "leadership",
        ]),
        experience: z.enum(["early", "mid", "senior"]).default("mid"),
        weeks: z.number().int().min(1).max(16).default(4),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ goal, experience, weeks }) => tutor.getLearningPath(goal, experience, weeks),
  );

  server.registerTool(
    "get_company_prep",
    {
      title: "Build Company Preparation Plan",
      description: "Create a curriculum-based plan for a company and role without claiming access to private interview questions.",
      inputSchema: z.object({
        company: z.string().min(1).max(100),
        role: z.string().min(1).max(150),
        weeks: z.number().int().min(1).max(12).default(4),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ company, role, weeks }) => tutor.getCompanyPrep(company, role, weeks),
  );

  server.registerTool(
    "review_answer",
    {
      title: "Review Interview Answer",
      description: "Coach a candidate's answer with a rubric and follow-up questions. Does not execute code or reveal a solution.",
      inputSchema: z.object({
        id: z.string().min(1),
        answer: z.string().min(1).max(100_000),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ id, answer }) => tutor.reviewAnswer(id, answer),
  );

  registerPrompts(server);
  registerResources(server, catalog);
  return server;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "interview_tutor",
    {
      title: "AIMLInterviews Tutor",
      description: "Start a Socratic, no-spoilers interview coaching session.",
      argsSchema: z.object({
        area: z.enum(AREAS).optional(),
        difficulty: z.enum(["easy", "medium", "hard"]).optional(),
        topic: z.string().optional(),
      }),
    },
    ({ area, difficulty, topic }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Act as my AIMLInterviews coach.",
            `Select one problem${area ? ` in ${area}` : ""}${difficulty ? ` at ${difficulty} difficulty` : ""}${topic ? ` about ${topic}` : ""}.`,
            "Use list_problems and get_problem. Ask me to clarify and attempt it before helping.",
            "Give hints only when requested, one level at a time using get_hint.",
            "Never reveal a reference answer, complete implementation, or hidden source content.",
            "Use review_answer after my attempt and ask one targeted follow-up question.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "mock_interview",
    {
      title: "AI/ML Mock Interview",
      description: "Run a timed mock interview for a target role.",
      argsSchema: z.object({
        company: z.string().min(1),
        role: z.string().min(1),
        level: z.enum(["early", "mid", "senior"]).default("mid"),
        focus: z.enum(AREAS).optional(),
      }),
    },
    ({ company, role, level, focus }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Run a ${level}-level mock interview for a ${role} candidate targeting ${company}.`,
            focus ? `Focus on ${focus}.` : "Choose a balanced role-appropriate focus.",
            "Use get_company_prep for scope, then select one problem from the catalog.",
            "Interview me one question at a time. Do not provide solutions or lead with hints.",
            "Evaluate communication, assumptions, correctness, tradeoffs, and validation after my answer.",
          ].join("\n"),
        },
      }],
    }),
  );

  server.registerPrompt(
    "study_plan",
    {
      title: "AI/ML Interview Study Plan",
      description: "Create an actionable curriculum plan using catalog problems.",
      argsSchema: z.object({
        goal: z.enum([
          "ml-engineer",
          "applied-scientist",
          "genai-engineer",
          "research-engineer",
          "coding-intensive",
          "leadership",
        ]),
        experience: z.enum(["early", "mid", "senior"]).default("mid"),
        weeks: z.string().regex(/^(?:[1-9]|1[0-6])$/).default("4"),
      }),
    },
    ({ goal, experience, weeks }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `Build my ${weeks}-week ${goal} interview plan for a ${experience}-level candidate.`,
            "Call get_learning_path and preserve its source-linked problem IDs.",
            "Include weekly focus, practice, timed mocks, review, and 48-hour re-attempts.",
            "Keep the workload realistic and prioritize strong pattern recall over raw counts.",
          ].join("\n"),
        },
      }],
    }),
  );
}

function registerResources(server: McpServer, catalog: ReturnType<typeof buildCatalog>): void {
  server.registerResource(
    "curriculum-catalog",
    "aimlinterviews://catalog",
    {
      title: "AIMLInterviews Practice Catalog",
      description: "Problem and section metadata derived from the local public curriculum.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          sourceCommit: catalog.sourceCommit,
          generatedAt: catalog.generatedAt,
          problems: catalog.problems.map(({ prompt: _prompt, ...problem }) => problem),
          sections: catalog.sections.map(({ text: _text, ...section }) => section),
        }, null, 2),
      }],
    }),
  );

  server.registerResource(
    "tutor-policy",
    "aimlinterviews://tutor-policy",
    {
      title: "AIMLInterviews Tutor Policy",
      description: "No-spoilers coaching rules for MCP clients.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: [
          "# Tutor policy",
          "",
          "1. Present one problem at a time and let the candidate clarify it.",
          "2. Require an attempt before offering help.",
          "3. Give hint levels 1, 2, and 3 in order and only on request.",
          "4. Do not provide reference answers, complete implementations, or hidden solution text.",
          "5. Review reasoning and communication without executing submitted code.",
          "6. Cite the source path and commit for curriculum-derived content.",
        ].join("\n"),
      }],
    }),
  );
}
