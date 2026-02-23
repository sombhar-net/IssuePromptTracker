import { PromptItemInput, PromptTemplateKind } from "./types";

export interface ItemPromptYamlRecord {
  id: string;
  type: PromptItemInput["type"];
  category: string | null;
  title: string;
  description: string;
  status: PromptItemInput["status"];
  priority: PromptItemInput["priority"];
  tags: string[];
  attachments: Array<{ path: string; label?: string }>;
  prompt_template_kind: PromptTemplateKind;
  prompt_template: string;
  prompt_text: string;
  prompt: {
    goal: string;
    project_context: string;
    problem_summary: string;
    reproduction_steps: string;
    expected_behavior: string;
    actual_behavior: string;
    impact: string;
    constraints: string;
    requested_output: string;
  };
  timestamps: {
    created_at: string;
    updated_at: string;
  };
}

export interface PromptTemplatePlaceholder {
  token: string;
  description: string;
}

export interface BuildItemYamlRecordOptions {
  template?: string;
  templateKind?: PromptTemplateKind;
  promptText?: string;
}

const fallback = "Not provided";
const none = "none";
const uncategorized = "uncategorized";

export const PROMPT_TEMPLATE_KINDS: PromptTemplateKind[] = ["issue", "feature", "other"];

export const PROMPT_TEMPLATE_PLACEHOLDERS: PromptTemplatePlaceholder[] = [
  { token: "project.name", description: "Active project name." },
  { token: "category.name", description: "Category name or uncategorized." },
  { token: "category.kind", description: "Resolved template kind (issue/feature/other)." },
  { token: "item.id", description: "Item identifier." },
  { token: "item.type", description: "Stored item type (issue/feature)." },
  { token: "item.kind", description: "Resolved template kind (issue/feature/other)." },
  { token: "item.title", description: "Item title." },
  { token: "item.description", description: "Item description." },
  { token: "item.status", description: "Current status (sentence case)." },
  { token: "item.priority", description: "Current priority (sentence case)." },
  { token: "item.tags", description: "Comma-separated tags or none." },
  { token: "attachments.count", description: "Number of attached images." },
  { token: "attachments.list", description: "Numbered image list with paths and labels." },
  { token: "timestamps.created_at", description: "Item creation timestamp (ISO)." },
  { token: "timestamps.updated_at", description: "Item update timestamp (ISO)." }
];

const DEFAULT_ISSUE_TEMPLATE = [
  "[GOAL]",
  "Investigate and resolve this issue with implementation-ready guidance.",
  "",
  "[PROJECT_CONTEXT]",
  "Project: {{project.name}}",
  "Category: {{category.name}} ({{category.kind}})",
  "Status: {{item.status}}",
  "Priority: {{item.priority}}",
  "Tags: {{item.tags}}",
  "",
  "[PROBLEM_SUMMARY]",
  "Title: {{item.title}}",
  "Description:",
  "{{item.description}}",
  "",
  "[ATTACHMENTS]",
  "{{attachments.list}}",
  "",
  "[REQUESTED_OUTPUT]",
  "Return likely root causes, concrete fixes with tradeoffs, and a step-by-step implementation plan."
].join("\n");

const DEFAULT_FEATURE_TEMPLATE = [
  "[GOAL]",
  "Design and implement this feature request in a practical way.",
  "",
  "[PROJECT_CONTEXT]",
  "Project: {{project.name}}",
  "Category: {{category.name}} ({{category.kind}})",
  "Status: {{item.status}}",
  "Priority: {{item.priority}}",
  "Tags: {{item.tags}}",
  "",
  "[FEATURE_REQUEST]",
  "Title: {{item.title}}",
  "Description:",
  "{{item.description}}",
  "",
  "[ATTACHMENTS]",
  "{{attachments.list}}",
  "",
  "[REQUESTED_OUTPUT]",
  "Return approach options, implementation details, and an ordered delivery plan."
].join("\n");

const DEFAULT_OTHER_TEMPLATE = [
  "[GOAL]",
  "Analyze this work item and propose the most practical path forward.",
  "",
  "[PROJECT_CONTEXT]",
  "Project: {{project.name}}",
  "Category: {{category.name}} ({{category.kind}})",
  "Status: {{item.status}}",
  "Priority: {{item.priority}}",
  "Tags: {{item.tags}}",
  "",
  "[ITEM_DETAILS]",
  "Type: {{item.type}}",
  "Title: {{item.title}}",
  "Description:",
  "{{item.description}}",
  "",
  "[ATTACHMENTS]",
  "{{attachments.list}}",
  "",
  "[REQUESTED_OUTPUT]",
  "Return a recommended plan, alternatives with tradeoffs, and concrete next actions."
].join("\n");

export const DEFAULT_PROMPT_TEMPLATES: Record<PromptTemplateKind, string> = {
  issue: DEFAULT_ISSUE_TEMPLATE,
  feature: DEFAULT_FEATURE_TEMPLATE,
  other: DEFAULT_OTHER_TEMPLATE
};

function toSentenceCase(value: string): string {
  return value
    .split("_")
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function valueOrFallback(value?: string | null): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function resolveCategoryName(value?: string | null): string {
  const normalized = value?.trim();
  return normalized ? normalized : uncategorized;
}

function buildTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(", ") : none;
}

function buildAttachmentLines(item: PromptItemInput): string {
  return item.attachments.length > 0
    ? item.attachments
        .map((attachment, index) => {
          const label = attachment.label ? ` (${attachment.label})` : "";
          return `${index + 1}. ${attachment.path}${label}`;
        })
        .join("\n")
    : `1. ${none}`;
}

export function resolvePromptTemplateKind(item: Pick<PromptItemInput, "type" | "categoryKind">): PromptTemplateKind {
  if (item.categoryKind && PROMPT_TEMPLATE_KINDS.includes(item.categoryKind)) {
    return item.categoryKind;
  }

  return item.type;
}

export function getDefaultPromptTemplate(kind: PromptTemplateKind): string {
  return DEFAULT_PROMPT_TEMPLATES[kind];
}

function placeholderValues(item: PromptItemInput, templateKind: PromptTemplateKind): Record<string, string> {
  return {
    "project.name": valueOrFallback(item.projectName),
    "category.name": resolveCategoryName(item.categoryName),
    "category.kind": templateKind,
    "item.id": item.id,
    "item.type": item.type,
    "item.kind": templateKind,
    "item.title": valueOrFallback(item.title),
    "item.description": valueOrFallback(item.description),
    "item.status": toSentenceCase(item.status),
    "item.priority": toSentenceCase(item.priority),
    "item.tags": buildTags(item.tags),
    "attachments.count": String(item.attachments.length),
    "attachments.list": buildAttachmentLines(item),
    "timestamps.created_at": item.createdAt,
    "timestamps.updated_at": item.updatedAt
  };
}

export function renderPromptTemplate(
  template: string,
  item: PromptItemInput,
  templateKind?: PromptTemplateKind
): string {
  const resolvedKind = templateKind ?? resolvePromptTemplateKind(item);
  const values = placeholderValues(item, resolvedKind);
  const normalizedTemplate = normalizeLineBreaks(template);

  return normalizedTemplate.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, token: string) => {
    return values[token] ?? match;
  });
}

export function buildPromptText(item: PromptItemInput, template?: string): string {
  const resolvedKind = resolvePromptTemplateKind(item);
  const effectiveTemplate =
    template && template.trim() ? normalizeLineBreaks(template) : getDefaultPromptTemplate(resolvedKind);

  return renderPromptTemplate(effectiveTemplate, item, resolvedKind);
}

function promptGoal(templateKind: PromptTemplateKind): string {
  if (templateKind === "other") {
    return "Propose a practical solution for this work item.";
  }

  return `Propose a practical solution for this ${templateKind}.`;
}

function buildProblemSummary(item: PromptItemInput): string {
  const title = valueOrFallback(item.title);
  const description = valueOrFallback(item.description);
  const merged = [title, description].filter((line) => line !== fallback).join("\n");
  return merged || fallback;
}

export function buildItemYamlRecord(
  item: PromptItemInput,
  options: BuildItemYamlRecordOptions = {}
): ItemPromptYamlRecord {
  const templateKind = options.templateKind ?? resolvePromptTemplateKind(item);
  const templateSource =
    options.template && options.template.trim()
      ? normalizeLineBreaks(options.template)
      : getDefaultPromptTemplate(templateKind);
  const promptText = options.promptText ?? renderPromptTemplate(templateSource, item, templateKind);

  return {
    id: item.id,
    type: item.type,
    category: item.categoryName ?? null,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    attachments: item.attachments.map((attachment) => ({
      path: attachment.path,
      label: attachment.label
    })),
    prompt_template_kind: templateKind,
    prompt_template: templateSource,
    prompt_text: promptText,
    prompt: {
      goal: promptGoal(templateKind),
      project_context: `Project: ${valueOrFallback(item.projectName)}`,
      problem_summary: buildProblemSummary(item),
      reproduction_steps: fallback,
      expected_behavior: fallback,
      actual_behavior: fallback,
      impact: fallback,
      constraints: "Keep the response specific, implementation-ready, and scoped to this item.",
      requested_output:
        "Return root cause hypotheses, fixes with tradeoffs, and an ordered implementation plan."
    },
    timestamps: {
      created_at: item.createdAt,
      updated_at: item.updatedAt
    }
  };
}

export function buildProjectYamlDocument(args: {
  projectName: string;
  generatedAt: string;
  items: ItemPromptYamlRecord[];
  warnings?: string[];
}): Record<string, unknown> {
  return {
    version: 1,
    generated_at: args.generatedAt,
    project: {
      name: args.projectName
    },
    warnings: args.warnings ?? [],
    items: args.items
  };
}
