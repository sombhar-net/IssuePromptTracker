export type ItemType = "issue" | "feature";
export type ItemStatus = "open" | "in_progress" | "resolved" | "archived";
export type ItemPriority = "low" | "medium" | "high" | "critical";
export type ItemActivityType =
  | "ITEM_CREATED"
  | "ITEM_UPDATED"
  | "IMAGE_UPLOADED"
  | "IMAGE_DELETED"
  | "IMAGES_REORDERED"
  | "RESOLUTION_NOTE"
  | "STATUS_CHANGE";
export type CategoryKind = "issue" | "feature" | "other";
export type PromptTemplateKind = CategoryKind;
export type UserRole = "ADMIN" | "USER";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAgentKey {
  keyId: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ProjectAgentKeyCreateResponse {
  keyId: string;
  name: string;
  prefix: string;
  token: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  createdAt: string;
  updatedAt: string;
}

export interface ItemImage {
  id: string;
  itemId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  relativePath: string;
  sortOrder: number;
  createdAt: string;
  url: string;
}

export interface Item {
  id: string;
  projectId: string;
  categoryId: string | null;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: ItemPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  project: Project;
  category: Category | null;
  images: ItemImage[];
}

export interface ItemActivityActorUser {
  kind: "user";
  userId: string | null;
  email: string | null;
  displayName: string | null;
}

export interface ItemActivityActorAgent {
  kind: "agent";
  keyId: string | null;
  name: string | null;
  prefix: string | null;
}

export type ItemActivityActor = ItemActivityActorUser | ItemActivityActorAgent;

export interface ItemActivity {
  id: string;
  itemId: string;
  type: ItemActivityType;
  actorType: "USER" | "AGENT";
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: ItemActivityActor;
  item: {
    id: string;
    title: string;
    type: ItemType;
    projectId: string;
  };
}

export interface ActivityPageInfo {
  limit: number;
  nextCursor: string | null;
}

export interface ActivityFeedResponse {
  projectId?: string;
  itemId?: string;
  issueId?: string;
  activities: ItemActivity[];
  page: ActivityPageInfo;
}

export interface ItemPayload {
  projectId: string;
  categoryId: string | null;
  type: ItemType;
  title: string;
  description: string;
  status: ItemStatus;
  priority: ItemPriority;
  tags: string[];
}

export interface ItemFilters {
  type?: ItemType;
  status?: ItemStatus;
  priority?: ItemPriority;
  categoryId?: string;
  tag?: string;
  search?: string;
}

export interface PromptResponse {
  text: string;
  yaml: Record<string, unknown>;
}

export interface PromptTemplateSet {
  issue: string;
  feature: string;
  other: string;
}

export interface PromptTemplatePlaceholder {
  token: string;
  description: string;
}

export interface PromptTemplatesResponse {
  projectId: string;
  templates: PromptTemplateSet;
  defaults: PromptTemplateSet;
  placeholders: PromptTemplatePlaceholder[];
}
