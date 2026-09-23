import { createHash } from "node:crypto";

import {
  discoverMarkdownFiles,
  getSourceCommit,
  readRepositoryFile,
} from "./repository.js";
import type {
  Area,
  CurriculumCatalog,
  CurriculumSection,
  Difficulty,
  Problem,
} from "./types.js";

interface Heading {
  level: number;
  title: string;
  line: number;
}

const COMPANY_NAMES = [
  "Amazon",
  "Anthropic",
  "Apple",
  "Databricks",
  "DeepMind",
  "Google",
  "LinkedIn",
  "Meta",
  "Microsoft",
  "Midjourney",
  "Netflix",
  "OpenAI",
  "Perplexity",
  "Roku",
  "Uber",
  "xAI",
];

const SOLUTION_HEADING = /(?:reference response|solution|answer key)/i;

export function buildCatalog(root: string): CurriculumCatalog {
  const sourceCommit = getSourceCommit(root);
  const problems: Problem[] = [];
  const sections: CurriculumSection[] = [];

  for (const sourcePath of discoverMarkdownFiles(root)) {
    const markdown = readRepositoryFile(root, sourcePath);
    problems.push(...extractProblems(sourcePath, markdown, sourceCommit));
    if (!sourcePath.endsWith("pytorch-ml-coding.md")) {
      sections.push(...extractSections(sourcePath, markdown, sourceCommit));
    }
  }

  return {
    repositoryRoot: root,
    sourceCommit,
    generatedAt: new Date().toISOString(),
    problems: deduplicate(problems).sort(compareProblems),
    sections: deduplicateSections(sections),
  };
}

export function extractProblems(
  sourcePath: string,
  markdown: string,
  sourceCommit: string,
): Problem[] {
  const lines = markdown.split(/\r?\n/);
  const problems: Problem[] = [];
  const headings: Heading[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const heading = {
        level: headingMatch[1].length,
        title: stripMarkdown(headingMatch[2]),
        line: index + 1,
      };
      while (headings.length && headings.at(-1)!.level >= heading.level) headings.pop();
      headings.push(heading);

      if (/^question$/i.test(heading.title)) {
        const parent = headings.at(-2);
        if (parent) {
          const body: string[] = [];
          let cursor = index + 1;
          while (cursor < lines.length && !/^#{1,4}\s+/.test(lines[cursor])) {
            body.push(lines[cursor]);
            cursor += 1;
          }
          addProblem(problems, {
            title: parent.title.replace(/\s+[—-]\s+\d+\s+minutes?$/i, ""),
            prompt: sanitizePrompt(body.join("\n")),
            sourcePath,
            sourceLine: index + 1,
            sourceHeading: parent.title,
            headingContext: headings.map((item) => item.title),
            sourceCommit,
          });
        }
      }
      continue;
    }

    const context = headings.map((heading) => heading.title);
    const numbered = /^\s*\d+\.\s+\*\*(.+?)\*\*/.exec(line);
    if (numbered && shouldTreatNumberedItemAsProblem(sourcePath, context, numbered[1])) {
      addProblem(problems, {
        title: stripMarkdown(numbered[1]),
        prompt: stripMarkdown(numbered[1]),
        sourcePath,
        sourceLine: index + 1,
        sourceHeading: headings.at(-1)?.title ?? "Questions",
        headingContext: context,
        sourceCommit,
      });
      continue;
    }

    if (isQuestionListContext(context)) {
      const bullet = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
      if (bullet && (isQuestionLike(bullet[1]) || /^\s*\*\*/.test(bullet[1]))) {
        const title = stripMarkdown(bullet[1]);
        addProblem(problems, {
          title,
          prompt: title,
          sourcePath,
          sourceLine: index + 1,
          sourceHeading: headings.at(-1)?.title ?? "Sample Questions",
          headingContext: context,
          sourceCommit,
        });
      }
    }

    const priorityHeading = headings.find((heading) =>
      /Priority ML coding problems/i.test(heading.title),
    );
    if (priorityHeading) {
      const cells = parseMarkdownTableRow(line);
      if (
        cells.length >= 2 &&
        !/^Problem$/i.test(cells[0]) &&
        !/^---/.test(cells[0]) &&
        !/^All canonical/i.test(cells[0])
      ) {
        addProblem(problems, {
          title: cells[0],
          prompt: [
            `Implement ${cells[0]}.`,
            `Discuss ${cells[5] ?? "correctness and edge cases"}.`,
            `Difficulty: ${cells[1] ?? "unspecified"}.`,
            `Tags: ${cells[2] ?? "unspecified"}.`,
            `Companies: ${cells[3] ?? "none listed"}.`,
          ].join(" "),
          difficulty: parseDifficulty(cells[1]),
          tags: parseList(cells[2]),
          companies: parseCompanies(cells[3]),
          sourcePath,
          sourceLine: index + 1,
          sourceHeading: priorityHeading.title,
          headingContext: context,
          sourceCommit,
        });
      }
    }
  }

  return problems;
}

export function extractSections(
  sourcePath: string,
  markdown: string,
  sourceCommit: string,
): CurriculumSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Heading[] = [];
  const sections: CurriculumSection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const heading: Heading = {
      level: match[1].length,
      title: stripMarkdown(match[2]),
      line: index + 1,
    };
    while (headings.length && headings.at(-1)!.level >= heading.level) headings.pop();
    headings.push(heading);
    if (SOLUTION_HEADING.test(heading.title)) continue;

    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const nextHeading = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[cursor]);
      if (nextHeading && nextHeading[1].length <= heading.level) break;
      if (nextHeading && SOLUTION_HEADING.test(nextHeading[2])) break;
      body.push(lines[cursor]);
      cursor += 1;
    }
    const text = sanitizeSection(body.join("\n"));
    if (!text) continue;
    const area = inferArea(sourcePath, headings.map((item) => item.title));
    sections.push({
      id: makeId("section", area, sourcePath, heading.title),
      title: heading.title,
      area,
      text,
      sourcePath,
      sourceLine: heading.line,
      sourceCommit,
    });
  }
  return sections;
}

function addProblem(
  output: Problem[],
  input: {
    title: string;
    prompt: string;
    sourcePath: string;
    sourceLine: number;
    sourceHeading: string;
    headingContext: string[];
    sourceCommit: string;
    difficulty?: Difficulty;
    tags?: string[];
    companies?: string[];
  },
): void {
  const title = input.title.trim();
  if (!title || SOLUTION_HEADING.test(title)) return;
  const area = inferArea(input.sourcePath, input.headingContext.concat(title));
  const combined = `${title} ${input.prompt}`;
  output.push({
    id: makeId("problem", area, input.sourcePath, `${input.sourceHeading}:${title}`),
    title,
    prompt: input.prompt || title,
    area,
    difficulty: input.difficulty ?? inferDifficulty(area, input.headingContext, combined),
    tags: unique([...(input.tags ?? []), ...inferTags(`${input.headingContext.join(" ")} ${combined}`)]),
    companies: input.companies ?? COMPANY_NAMES.filter((company) =>
      new RegExp(`\\b${company}\\b`, "i").test(combined),
    ),
    sourcePath: input.sourcePath,
    sourceLine: input.sourceLine,
    sourceHeading: input.sourceHeading,
    sourceCommit: input.sourceCommit,
  });
}

function shouldTreatNumberedItemAsProblem(
  sourcePath: string,
  context: string[],
  title: string,
): boolean {
  return (
    sourcePath.endsWith("pytorch-ml-coding.md") &&
    !context.some((heading) => /Contents/i.test(heading)) &&
    isQuestionLike(title)
  );
}

function isQuestionListContext(context: string[]): boolean {
  return context.some((heading) =>
    /(?:sample questions|common questions|system design sample questions)/i.test(heading),
  );
}

function isQuestionLike(value: string): boolean {
  const plain = stripMarkdown(value);
  return (
    plain.endsWith("?") ||
    /^(?:build|calculate|compare|compute|create|debug|define|demonstrate|design|describe|diagnose|discuss|evaluate|explain|find|handle|implement|review|save|show|train|walk|write|why|what|when|where|how)/i.test(
      plain,
    )
  );
}

function inferArea(sourcePath: string, context: string[]): Area {
  const joined = context.join(" ").toLowerCase();
  if (sourcePath.includes("pytorch-ml-coding")) return "pytorch";
  if (sourcePath.includes("MLC/")) return "ml-coding";
  if (sourcePath.includes("MLSD/")) return "system-design";
  if (sourcePath.endsWith("behavior.md")) return "behavioral";
  if (sourcePath.endsWith("lc-coding.md")) return "general-coding";
  if (
    sourcePath.endsWith("ml-fundamental.md") &&
    /(?:llm|genai|multimodal|foundation model|diffusion|vision-language)/.test(joined)
  ) {
    return "genai";
  }
  return "ml-fundamentals";
}

function inferDifficulty(area: Area, context: string[], text: string): Difficulty {
  const joined = `${context.join(" ")} ${text}`.toLowerCase();
  if (/(?:advanced|expert|hard|distributed|flashattention|grpo|rlhf|vla|diffusion)/.test(joined)) {
    return "hard";
  }
  if (area === "system-design" || /(?:medium|training loop|attention|pca|decision tree)/.test(joined)) {
    return "medium";
  }
  return "easy";
}

function inferTags(text: string): string[] {
  const normalized = text.toLowerCase();
  const dictionary: Record<string, RegExp> = {
    algorithms: /algorithm|complexity|array|tree|graph/,
    agents: /\bagent(?:ic|s)?\b|tool use/,
    attention: /attention|transformer|kv cache|gqa|mqa/,
    behavioral: /behavior|leadership|project|stakeholder/,
    coding: /implement|code|function|debug/,
    evaluation: /metric|evaluation|precision|recall|f1|auc/,
    llm: /llm|language model|rag|prompt|token/,
    multimodal: /multimodal|vision-language|vlm|vla|diffusion/,
    pytorch: /pytorch|tensor|autograd|dataloader|cuda/,
    ranking: /ranking|recommendation|search|retrieval/,
    training: /training|gradient|optimizer|fine-tun|rlhf|grpo/,
  };
  return Object.entries(dictionary)
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([tag]) => tag);
}

function parseMarkdownTableRow(line: string): string[] {
  if (!line.includes("|")) return [];
  const cells = line.split("|");
  if (!cells[0]?.trim()) cells.shift();
  if (!cells.at(-1)?.trim()) cells.pop();
  return cells.map((cell) => stripMarkdown(cell.trim()));
}

function parseDifficulty(value: string | undefined): Difficulty | undefined {
  const match = /\b(easy|medium|hard)\b/i.exec(value ?? "");
  return match?.[1].toLowerCase() as Difficulty | undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return unique(
    value
      .split(/[,;\u00b7]/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item && !/^(?:-|none|n\/a|unspecified)$/i.test(item)),
  );
}

function parseCompanies(value: string | undefined): string[] | undefined {
  const items = parseList(value);
  if (items === undefined) return undefined;
  return unique(
    items.map((item) => {
      const known = COMPANY_NAMES.find((company) => company.toLowerCase() === item);
      return known ?? item.replace(/\b\w/g, (character) => character.toUpperCase());
    }),
  ).sort((left, right) => left.localeCompare(right));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sanitizePrompt(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, "[code scaffold omitted; inspect the source file during practice]")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4_000);
}

function sanitizeSection(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*\d+\.\s+\*\*(.+?)\*\*.*$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6_000);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<a\s+[^>]*><\/a>/gi, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeId(kind: "problem" | "section", area: Area, path: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52) || kind;
  const hash = createHash("sha256")
    .update(`${path}\0${title}`)
    .digest("hex")
    .slice(0, 8);
  return `aiml:${kind}:${area}:${slug}-${hash}`;
}

function deduplicate(problems: Problem[]): Problem[] {
  return [...new Map(problems.map((problem) => [problem.id, problem])).values()];
}

function deduplicateSections(sections: CurriculumSection[]): CurriculumSection[] {
  return [...new Map(sections.map((section) => [section.id, section])).values()];
}

function compareProblems(left: Problem, right: Problem): number {
  return (
    left.area.localeCompare(right.area) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.sourceLine - right.sourceLine
  );
}
