import type {
  AuthMeResponse,
  AuthResponse,
  AuthUser,
  Category,
  CategoryKind,
  Item,
  ItemFilters,
  ItemPayload,
  PromptTemplateSet,
  PromptTemplatesResponse,
  Project,
  PromptResponse
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const UPLOAD_BASE = import.meta.env.VITE_UPLOAD_BASE_URL || "";
const TOKEN_STORAGE_KEY = "aam_auth_token";

export interface ApiErrorIssue {
  path?: Array<string | number>;
  message: string;
}

interface ApiErrorPayload {
  message?: string;
  issues?: ApiErrorIssue[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiErrorIssue[];

  constructor(status: number, message: string, issues: ApiErrorIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

let authToken: string | null =
  typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("/")) {
    return `${UPLOAD_BASE}${path}`;
  }
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

function saveToken(token: string | null): void {
  authToken = token;
  if (typeof window === "undefined") {
    return;
  }

  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers || {});

  if (authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    typeof init.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: buildHeaders(init)
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, init);

  if (!response.ok) {
    if (response.status === 401) {
      saveToken(null);
    }

    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.message || `Request failed (${response.status})`,
      payload?.issues || []
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function parseFilenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) {
    return fallback;
  }

  const match = disposition.match(/filename="?([^";]+)"?/i);
  if (!match || !match[1]) {
    return fallback;
  }

  return match[1];
}

async function downloadFromApi(path: string, fallbackName: string): Promise<void> {
  const response = await fetchApi(path);

  if (!response.ok) {
    if (response.status === 401) {
      saveToken(null);
    }

    const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
    throw new ApiError(
      response.status,
      payload?.message || `Download failed (${response.status})`,
      payload?.issues || []
    );
  }

  const filename = parseFilenameFromDisposition(
    response.headers.get("content-disposition"),
    fallbackName
  );

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(objectUrl);
}

export function getAuthToken(): string | null {
  return authToken;
}

export function clearAuthToken(): void {
  saveToken(null);
}

export async function login(payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  saveToken(response.token);
  return response;
}

export async function register(payload: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthResponse> {
  const response = await request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  saveToken(response.token);
  return response;
}

export async function getMe(): Promise<AuthUser> {
  const response = await request<AuthMeResponse>("/auth/me");
  return response.user;
}

export async function getProjects(): Promise<Project[]> {
  return request<Project[]>("/projects");
}

export async function createProject(payload: { name: string; description?: string }): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateProject(
  id: string,
  payload: { name?: string; description?: string | null }
): Promise<Project> {
  return request<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${id}`, {
    method: "DELETE"
  });
}

export async function getCategories(): Promise<Category[]> {
  return request<Category[]>("/categories");
}

export async function createCategory(payload: { name: string; kind: CategoryKind }): Promise<Category> {
  return request<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateCategory(
  id: string,
  payload: { name?: string; kind?: CategoryKind }
): Promise<Category> {
  return request<Category>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteCategory(id: string): Promise<void> {
  return request<void>(`/categories/${id}`, {
    method: "DELETE"
  });
}

export async function getItems(projectId: string, filters: ItemFilters = {}): Promise<Item[]> {
  const query = new URLSearchParams({ projectId });

  if (filters.type) query.set("type", filters.type);
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.categoryId) query.set("categoryId", filters.categoryId);
  if (filters.tag) query.set("tag", filters.tag);
  if (filters.search) query.set("search", filters.search);

  const data = await request<Item[]>(`/items?${query.toString()}`);
  return data.map((item) => ({
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: normalizePath(image.url)
    }))
  }));
}

export async function createItem(payload: ItemPayload): Promise<Item> {
  return request<Item>("/items", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateItem(id: string, payload: Partial<ItemPayload>): Promise<Item> {
  return request<Item>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteItem(id: string): Promise<void> {
  return request<void>(`/items/${id}`, {
    method: "DELETE"
  });
}

export async function uploadItemImages(itemId: string, files: File[]): Promise<void> {
  const body = new FormData();
  for (const file of files) {
    body.append("files", file);
  }

  await request(`/items/${itemId}/images`, {
    method: "POST",
    body
  });
}

export async function deleteItemImage(itemId: string, imageId: string): Promise<void> {
  return request<void>(`/items/${itemId}/images/${imageId}`, {
    method: "DELETE"
  });
}

export async function createItemPrompt(itemId: string): Promise<PromptResponse> {
  return request<PromptResponse>(`/prompts/item/${itemId}`, {
    method: "POST"
  });
}

export async function getPromptTemplates(projectId: string): Promise<PromptTemplatesResponse> {
  return request<PromptTemplatesResponse>(`/prompt-templates/${projectId}`);
}

export async function updatePromptTemplates(
  projectId: string,
  templates: PromptTemplateSet
): Promise<{ projectId: string; templates: PromptTemplateSet }> {
  return request<{ projectId: string; templates: PromptTemplateSet }>(
    `/prompt-templates/${projectId}`,
    {
      method: "PUT",
      body: JSON.stringify({ templates })
    }
  );
}

export async function downloadItemExport(itemId: string): Promise<void> {
  return downloadFromApi(`/exports/item/${itemId}.zip`, `item-${itemId}-prompt.zip`);
}

export async function downloadProjectExport(projectId: string, type?: string): Promise<void> {
  const query = type ? `?type=${encodeURIComponent(type)}` : "";
  return downloadFromApi(
    `/exports/project/${projectId}.zip${query}`,
    `project-${projectId}-prompts.zip`
  );
}
