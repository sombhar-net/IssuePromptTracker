import { PromptItemInput } from "./types";

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

const fallback = "Not provided";

function toSentenceCase(value: string): string {
  return value
    .split("_")
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}

export function buildPromptText(item: PromptItemInput): string {
  const tags = item.tags.length > 0 ? item.tags.join(", ") : "none";
  const attachmentLines =
    item.attachments.length > 0
      ? item.attachments
          .map((attachment, index) => {
            const label = attachment.label ? ` (${attachment.label})` : "";
            return `${index + 1}. ${attachment.path}${label}`;
          })
          .join("\n")
      : "1. none";

  return [
    "[GOAL]",
    `Propose a practical solution for this ${item.type}.`,
    "",
    "[PROJECT_CONTEXT]",
    `Project: ${item.projectName}`,
    `Category: ${item.categoryName ?? "uncategorized"}`,
    `Status: ${toSentenceCase(item.status)}`,
    `Priority: ${toSentenceCase(item.priority)}`,
    `Tags: ${tags}`,
    "",
    "[PROBLEM_SUMMARY]",
    item.title,
    item.description,
    "",
    "[REPRODUCTION_STEPS]",
    fallback,
    "",
    "[EXPECTED_BEHAVIOR]",
    fallback,
    "",
    "[ACTUAL_BEHAVIOR]",
    fallback,
    "",
    "[ATTACHMENTS]",
    attachmentLines,
    "",
    "[CONSTRAINTS]",
    "Keep the response specific, implementation-ready, and scoped to this item.",
    "",
    "[REQUESTED_OUTPUT]",
    "Return root cause hypotheses, fixes with tradeoffs, and an ordered implementation plan."
  ].join("\n");
}

export function buildItemYamlRecord(item: PromptItemInput): ItemPromptYamlRecord {
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
    prompt: {
      goal: `Propose a practical solution for this ${item.type}.`,
      project_context: `Project: ${item.projectName}`,
      problem_summary: `${item.title}\n${item.description}`,
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
