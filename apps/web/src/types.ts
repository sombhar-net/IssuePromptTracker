export type ItemType = "issue" | "feature";
export type ItemStatus = "open" | "in_progress" | "resolved" | "archived";
export type ItemPriority = "low" | "medium" | "high" | "critical";
export type CategoryKind = "issue" | "feature" | "other";
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
