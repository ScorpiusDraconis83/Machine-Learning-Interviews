import { getAnswerReviewChecklist, getProgressiveHint } from "./hints.js";
import type {
  Area,
  CurriculumCatalog,
  CurriculumSection,
  Difficulty,
  Problem,
  ToolTextResult,
} from "./types.js";

export type LearningGoal =
  | "ml-engineer"
  | "applied-scientist"
  | "genai-engineer"
  | "research-engineer"
  | "coding-intensive"
  | "leadership";

export type ExperienceLevel = "early" | "mid" | "senior";

interface ProblemFilters {
  area?: Area;
  difficulty?: Difficulty;
  tag?: string;
  company?: string;
  query?: string;
  limit?: number;
}

interface SearchFilters {
  query: string;
  area?: Area;
  limit?: number;
}

const GOAL_AREAS: Record<LearningGoal, Area[]> = {
  "ml-engineer": ["general-coding", "ml-coding", "pytorch", "ml-fundamentals", "system-design", "behavioral"],
  "applied-scientist": ["ml-fundamentals", "genai", "ml-coding", "system-design", "behavioral"],
  "genai-engineer": ["genai", "pytorch", "ml-coding", "system-design", "behavioral"],
  "research-engineer": ["pytorch", "ml-coding", "ml-fundamentals", "genai", "behavioral"],
  "coding-intensive": ["general-coding", "ml-coding", "pytorch", "ml-fundamentals"],
  leadership: ["system-design", "behavioral", "ml-fundamentals", "genai"],
};

export class TutorService {
  constructor(private readonly catalog: CurriculumCatalog) {}

  status(): ToolTextResult {
    const counts = Object.fromEntries(
      [...new Set(this.catalog.problems.map((problem) => problem.area))]
        .sort()
        .map((area) => [area, this.catalog.problems.filter((problem) => problem.area === area).length]),
    );
    return result(
      `AIMLInterviews catalog loaded from ${this.catalog.repositoryRoot} at commit ${this.catalog.sourceCommit}.`,
      {
        repositoryRoot: this.catalog.repositoryRoot,
        sourceCommit: this.catalog.sourceCommit,
        generatedAt: this.catalog.generatedAt,
        problemCount: this.catalog.problems.length,
        sectionCount: this.catalog.sections.length,
        counts,
      },
    );
  }

  listProblems(filters: ProblemFilters): ToolTextResult {
    const limit = clamp(filters.limit ?? 20, 1, 100);
    const problems = this.catalog.problems.filter((problem) => {
      if (filters.area && problem.area !== filters.area) return false;
      if (filters.difficulty && problem.difficulty !== filters.difficulty) return false;
      if (filters.tag && !includes(problem.tags, filters.tag)) return false;
      if (filters.company && !includes(problem.companies, filters.company)) return false;
      if (filters.query && !matchesProblem(problem, filters.query)) return false;
      return true;
    });
    const selected = problems.slice(0, limit).map(problemSummary);
    return result(
      selected.length
        ? selected.map((problem) => `${problem.id} | ${problem.title} | ${problem.area} | ${problem.difficulty}`).join("\n")
        : "No matching problems found. Broaden the filters or use search_curriculum for topic discovery.",
      { totalMatches: problems.length, returned: selected.length, problems: selected },
    );
  }

  getProblem(id: string): ToolTextResult {
    const problem = this.findProblem(id);
    if (!problem) return toolError(`Unknown problem ID: ${id}`);
    return result(
      [
        problem.title,
        "",
        problem.prompt,
        "",
        "Start by clarifying requirements and explaining your approach. Request hint level 1 only when needed.",
        "",
        `Source: ${problem.sourcePath}:${problem.sourceLine} @ ${problem.sourceCommit}`,
      ].join("\n"),
      { problem },
    );
  }

  getHint(id: string, level: 1 | 2 | 3): ToolTextResult {
    const problem = this.findProblem(id);
    if (!problem) return toolError(`Unknown problem ID: ${id}`);
    const hint = getProgressiveHint(problem, level);
    return result(`Hint ${level}/3 for ${problem.title}:\n${hint}`, {
      problemId: id,
      level,
      hint,
      spoilerPolicy: "This hint provides process guidance, not an answer or implementation.",
    });
  }

  searchCurriculum(filters: SearchFilters): ToolTextResult {
    const terms = tokenize(filters.query);
    if (!terms.length) return toolError("Search query must contain at least one word.");
    const limit = clamp(filters.limit ?? 15, 1, 50);
    const ranked = this.catalog.sections
      .filter((section) => !filters.area || section.area === filters.area)
      .map((section) => ({ section, score: scoreSection(section, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.section.title.localeCompare(right.section.title));
    const sections = ranked.slice(0, limit).map(({ section }) => sectionSummary(section));
    return result(
      sections.length
        ? sections.map((section) => `${section.id} | ${section.title} | ${section.source}`).join("\n")
        : "No matching curriculum sections found.",
      {
        query: filters.query,
        returned: sections.length,
        sections,
        note: "Search returns section locations, not answer text, to preserve the tutor's no-spoilers workflow.",
      },
    );
  }

  getLearningPath(goal: LearningGoal, experience: ExperienceLevel, weeks: number): ToolTextResult {
    const duration = clamp(weeks, 1, 16);
    const areas = GOAL_AREAS[goal];
    const targetPerWeek = experience === "early" ? 6 : experience === "mid" ? 8 : 10;
    const phases = areas.map((area, index) => {
      const startWeek = Math.floor((index * duration) / areas.length) + 1;
      const endWeek = Math.max(startWeek, Math.floor(((index + 1) * duration) / areas.length));
      const problems = this.catalog.problems
        .filter((problem) => problem.area === area)
        .slice(0, Math.max(2, Math.min(targetPerWeek, duration * 2)))
        .map(problemSummary);
      const topics = this.catalog.sections.filter((section) => section.area === area).slice(0, 6).map(sectionSummary);
      return { area, startWeek, endWeek, problems, topics };
    });
    const text = phases
      .map((phase) => `Weeks ${phase.startWeek}-${phase.endWeek}: ${phase.area} (${phase.problems.length} catalog problems, ${phase.topics.length} chapter topics)`)
      .join("\n");
    return result(
      `${goal} learning path for ${duration} week(s), ${experience} level:\n${text}\n\nUse get_problem, attempt independently, and request hints in order. Re-attempt missed problems within 48 hours.`,
      { goal, experience, weeks: duration, targetProblemsPerWeek: targetPerWeek, phases },
    );
  }

  getCompanyPrep(company: string, role: string, weeks: number): ToolTextResult {
    const duration = clamp(weeks, 1, 12);
    const areas = roleAreas(role);
    const plan = areas.map((area) => {
      const areaProblems = this.catalog.problems.filter((problem) => problem.area === area);
      const companyTagged = areaProblems.filter((problem) => matchesCompany(problem.companies, company));
      const fallback = areaProblems.filter((problem) => !matchesCompany(problem.companies, company));
      const selected = [...companyTagged, ...fallback].slice(0, 8);
      return {
        area,
        companyTaggedCount: Math.min(companyTagged.length, selected.length),
        problems: selected.map(problemSummary),
        topics: this.catalog.sections.filter((section) => section.area === area).slice(0, 6).map(sectionSummary),
      };
    });
    const taggedTotal = plan.reduce((total, entry) => total + entry.companyTaggedCount, 0);
    return result(
      [
        `${company} preparation plan for ${role}, ${duration} week(s).`,
        "This is a curriculum-based plan inferred from the role, not a claim about current company questions.",
        "",
        ...plan.map((entry) => `${entry.area}: ${entry.problems.length} practice problems (${entry.companyTaggedCount} explicitly tagged for ${company}) and ${entry.topics.length} chapter topics`),
        "",
        taggedTotal ? "Company-tagged source problems are listed first; role-relevant curriculum fills remaining slots." : `No source problems are explicitly tagged for ${company}; this plan uses role-relevant curriculum instead.`,
        "Finish with timed mixed mocks and verify current interview-loop details directly with the recruiter.",
      ].join("\n"),
      { company, role, weeks: duration, areas, plan, companyTaggedCount: taggedTotal, basis: "Exact source company tags first, followed by role-relevant AIMLInterviews curriculum fallback" },
    );
  }

  reviewAnswer(id: string, answer: string): ToolTextResult {
    const problem = this.findProblem(id);
    if (!problem) return toolError(`Unknown problem ID: ${id}`);
    if (!answer.trim()) return toolError("Answer must not be empty.");
    const checklist = getAnswerReviewChecklist(problem);
    const observations = answerObservations(answer);
    return result(
      [
        `Coaching review for ${problem.title}`,
        "",
        ...observations.map((item) => `- ${item}`),
        "",
        "Self-review checklist:",
        ...checklist.map((item) => `- ${item}`),
        "",
        "Revise the weakest point first. This review intentionally does not provide a reference answer.",
      ].join("\n"),
      { problemId: id, observations, checklist, executedCode: false, referenceAnswerProvided: false },
    );
  }

  private findProblem(id: string): Problem | undefined {
    return this.catalog.problems.find((problem) => problem.id === id);
  }
}

function problemSummary(problem: Problem): Record<string, unknown> {
  return {
    id: problem.id,
    title: problem.title,
    area: problem.area,
    difficulty: problem.difficulty,
    tags: problem.tags,
    companies: problem.companies,
    source: `${problem.sourcePath}:${problem.sourceLine}`,
    sourceCommit: problem.sourceCommit,
  };
}

function sectionSummary(section: CurriculumSection): Record<string, unknown> {
  return {
    id: section.id,
    title: section.title,
    area: section.area,
    source: `${section.sourcePath}:${section.sourceLine}`,
    sourceCommit: section.sourceCommit,
  };
}

function scoreSection(section: CurriculumSection, terms: string[]): number {
  const title = section.title.toLowerCase();
  const text = section.text.toLowerCase();
  return terms.reduce((score, term) => score + (title.includes(term) ? 5 : 0) + (text.includes(term) ? 1 : 0), 0);
}

function matchesProblem(problem: Problem, query: string): boolean {
  const haystack = [problem.title, problem.prompt, problem.area, ...problem.tags, ...problem.companies]
    .join(" ")
    .toLowerCase();
  return tokenize(query).every((term) => haystack.includes(term));
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9+.-]+/g) ?? [];
}

function includes(values: string[], query: string): boolean {
  const normalized = query.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function matchesCompany(values: string[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return values.some((value) => value.toLowerCase() === normalized);
}

function roleAreas(role: string): Area[] {
  const normalized = role.toLowerCase();
  if (/manager|director|lead|strateg/.test(normalized)) return GOAL_AREAS.leadership;
  if (/research/.test(normalized)) return GOAL_AREAS["research-engineer"];
  if (/genai|llm|agent/.test(normalized)) return GOAL_AREAS["genai-engineer"];
  if (/scientist/.test(normalized)) return GOAL_AREAS["applied-scientist"];
  return GOAL_AREAS["ml-engineer"];
}

function answerObservations(answer: string): string[] {
  const words = answer.trim().split(/\s+/).length;
  const observations = [`The response contains about ${words} words; calibrate depth to the interview time box.`];
  if (!/(?:assum|constraint|requirement)/i.test(answer)) observations.push("Assumptions and constraints are not explicit yet.");
  if (!/(?:test|edge case|failure|validate|evaluation)/i.test(answer)) observations.push("Validation, edge cases, or failure modes need more attention.");
  if (!/(?:trade-?off|because|reason|choose|choice)/i.test(answer)) observations.push("The rationale and tradeoffs should be made explicit.");
  if (observations.length === 1) observations.push("The response covers assumptions, rationale, and validation signals; tighten any unsupported claims.");
  return observations;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function result(text: string, structuredContent: Record<string, unknown>): ToolTextResult {
  return { content: [{ type: "text", text }], structuredContent };
}

function toolError(message: string): ToolTextResult {
  return { content: [{ type: "text", text: message }], isError: true, structuredContent: { error: message } };
}
