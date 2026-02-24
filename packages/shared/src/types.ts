export type ItemType = "issue" | "feature";
export type PromptTemplateKind = ItemType | "other";

export type ItemStatus = "open" | "in_progress" | "in_review" | "resolved" | "archived";

export type ItemPriority = "low" | "medium" | "high" | "critical";

export interface PromptAttachment {
  path: string;
  label?: string;
}

export interface PromptItemInput {
  id: string;
  projectName: string;
  categoryName?: string | null;
  categoryKind?: PromptTemplateKind | null;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: ItemPriority;
  tags: string[];
  attachments: PromptAttachment[];
  createdAt: string;
  updatedAt: string;
}
