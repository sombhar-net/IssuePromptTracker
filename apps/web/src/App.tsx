import { FormEvent, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  clearAuthToken,
  createCategory,
  createItem,
  createItemPrompt,
  createProject,
  deleteCategory,
  deleteItem,
  deleteItemImage,
  deleteProject,
  downloadItemExport,
  downloadProjectExport,
  getAuthToken,
  getCategories,
  getItems,
  getMe,
  getProjects,
  login as loginUser,
  register as registerUser,
  updateCategory,
  updateItem,
  updateProject,
  uploadItemImages
} from "./api";
import type {
  AuthUser,
  Category,
  CategoryKind,
  Item,
  ItemFilters,
  ItemPayload,
  ItemPriority,
  ItemStatus,
  ItemType,
  Project
} from "./types";

type AuthMode = "login" | "register";

type ReportError = (error: unknown, fallbackMessage: string) => void;

type ReportNotice = (message: string) => void;

const ITEM_TYPES: ItemType[] = ["issue", "feature"];
const ITEM_STATUSES: ItemStatus[] = ["open", "in_progress", "resolved", "archived"];
const ITEM_PRIORITIES: ItemPriority[] = ["low", "medium", "high", "critical"];
const CATEGORY_KINDS: CategoryKind[] = ["issue", "feature", "other"];

const SELECTED_PROJECT_STORAGE_KEY = "aam_selected_project_id";

const DEFAULT_DRAFT: ItemPayload = {
  projectId: "",
  categoryId: null,
  type: "issue",
  title: "",
  description: "",
  status: "open",
  priority: "medium",
  tags: []
};

function titleize(value: string): string {
  return value
    .split("_")
    .map((token) => token[0]?.toUpperCase() + token.slice(1))
    .join(" ");
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getStoredProjectId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY) || "";
}

function persistProjectId(projectId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!projectId) {
    window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, projectId);
}

interface AuthScreenProps {
  busy: boolean;
  authMode: AuthMode;
  authEmail: string;
  authPassword: string;
  authDisplayName: string;
  errorMessage: string;
  notice: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  onAuthDisplayNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function AuthScreen(props: AuthScreenProps): JSX.Element {
  const {
    busy,
    authMode,
    authEmail,
    authPassword,
    authDisplayName,
    errorMessage,
    notice,
    onAuthModeChange,
    onAuthEmailChange,
    onAuthPasswordChange,
    onAuthDisplayNameChange,
    onSubmit
  } = props;

  return (
    <main className="auth-page">
      <div className="glow" />
      <section className="auth-card">
        <header>
          <p className="kicker">Issue Prompt Tracker</p>
          <h1>Capture what breaks, ship what works</h1>
          <p>Sign in to manage projects, issues, screenshots, and AI prompt exports.</p>
        </header>

        {errorMessage && <div className="alert error">{errorMessage}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="pill-switch" role="tablist" aria-label="Authentication mode">
          <button
            className={authMode === "login" ? "active" : ""}
            onClick={() => onAuthModeChange("login")}
            type="button"
          >
            Login
          </button>
          <button
            className={authMode === "register" ? "active" : ""}
            onClick={() => onAuthModeChange("register")}
            type="button"
          >
            Register
          </button>
        </div>

        <form className="stacked-form" onSubmit={onSubmit}>
          {authMode === "register" && (
            <input
              placeholder="Display name (optional)"
              value={authDisplayName}
              onChange={(event) => onAuthDisplayNameChange(event.target.value)}
            />
          )}
          <input
            autoComplete="email"
            placeholder="Email"
            type="email"
            value={authEmail}
            onChange={(event) => onAuthEmailChange(event.target.value)}
          />
          <input
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            placeholder="Password"
            type="password"
            value={authPassword}
            onChange={(event) => onAuthPasswordChange(event.target.value)}
          />
          <button className="primary" disabled={busy} type="submit">
            {authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="helper">Admin access comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.</p>
      </section>
    </main>
  );
}

interface ProjectsPageProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  refreshWorkspace: (preferredProjectId?: string) => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function ProjectsPage(props: ProjectsPageProps): JSX.Element {
  const { projects, selectedProjectId, onSelectProject, refreshWorkspace, reportError, reportNotice } = props;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function submitProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    try {
      setBusy(true);
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined
      });
      await refreshWorkspace(project.id);
      setName("");
      setDescription("");
      reportNotice("Project created");
    } catch (error) {
      reportError(error, "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  async function renameProject(project: Project): Promise<void> {
    const nextName = window.prompt("Rename project", project.name);
    if (!nextName) {
      return;
    }

    try {
      setBusy(true);
      await updateProject(project.id, { name: nextName.trim() });
      await refreshWorkspace(project.id);
      reportNotice("Project updated");
    } catch (error) {
      reportError(error, "Failed to update project");
    } finally {
      setBusy(false);
    }
  }

  async function removeProject(project: Project): Promise<void> {
    const confirmed = window.confirm(
      `Delete project "${project.name}"? This requires deleting linked items first.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setBusy(true);
      await deleteProject(project.id);
      await refreshWorkspace();
      reportNotice("Project deleted");
    } catch (error) {
      reportError(error, "Failed to delete project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Projects</p>
          <h2>Manage Product Contexts</h2>
        </div>
      </header>

      <article className="panel-card">
        <h3>Create Project</h3>
        <form className="stacked-form" onSubmit={submitProject}>
          <input
            placeholder="Project name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            placeholder="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button className="primary" disabled={busy} type="submit">
            Add Project
          </button>
        </form>
      </article>

      <article className="panel-card">
        <h3>All Projects</h3>
        {projects.length === 0 && <p className="helper">No projects yet.</p>}

        <div className="row-stack">
          {projects.map((project) => (
            <div className="row-card" key={project.id}>
              <label className="row-title">
                <input
                  checked={selectedProjectId === project.id}
                  onChange={() => onSelectProject(project.id)}
                  type="radio"
                  name="currentProject"
                />
                <span>{project.name}</span>
              </label>
              <div className="inline-actions">
                <button onClick={() => void renameProject(project)} type="button">
                  Rename
                </button>
                <button className="danger" onClick={() => void removeProject(project)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

interface CategoriesPageProps {
  categories: Category[];
  refreshWorkspace: () => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function CategoriesPage(props: CategoriesPageProps): JSX.Element {
  const { categories, refreshWorkspace, reportError, reportNotice } = props;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("other");

  async function submitCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    try {
      setBusy(true);
      await createCategory({
        name: name.trim(),
        kind
      });
      setName("");
      await refreshWorkspace();
      reportNotice("Category created");
    } catch (error) {
      reportError(error, "Failed to create category");
    } finally {
      setBusy(false);
    }
  }

  async function renameCategory(category: Category): Promise<void> {
    const nextName = window.prompt("Rename category", category.name);
    if (!nextName) {
      return;
    }

    try {
      setBusy(true);
      await updateCategory(category.id, { name: nextName.trim() });
      await refreshWorkspace();
      reportNotice("Category renamed");
    } catch (error) {
      reportError(error, "Failed to rename category");
    } finally {
      setBusy(false);
    }
  }

  async function changeKind(category: Category, nextKind: CategoryKind): Promise<void> {
    try {
      setBusy(true);
      await updateCategory(category.id, { kind: nextKind });
      await refreshWorkspace();
      reportNotice("Category kind updated");
    } catch (error) {
      reportError(error, "Failed to update category kind");
    } finally {
      setBusy(false);
    }
  }

  async function removeCategory(category: Category): Promise<void> {
    const confirmed = window.confirm(`Delete category "${category.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setBusy(true);
      await deleteCategory(category.id);
      await refreshWorkspace();
      reportNotice("Category deleted");
    } catch (error) {
      reportError(error, "Failed to delete category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Categories</p>
          <h2>Control Global Labels</h2>
        </div>
      </header>

      <article className="panel-card">
        <h3>Create Category</h3>
        <form className="stacked-form" onSubmit={submitCategory}>
          <input
            placeholder="Category name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>
            {CATEGORY_KINDS.map((entry) => (
              <option key={entry} value={entry}>
                {titleize(entry)}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy} type="submit">
            Add Category
          </button>
        </form>
      </article>

      <article className="panel-card">
        <h3>All Categories</h3>
        {categories.length === 0 && <p className="helper">No categories yet.</p>}

        <div className="row-stack">
          {categories.map((category) => (
            <div className="row-card" key={category.id}>
              <div className="row-title">
                <strong>{category.name}</strong>
              </div>
              <div className="inline-actions">
                <select
                  value={category.kind}
                  onChange={(event) => void changeKind(category, event.target.value as CategoryKind)}
                >
                  {CATEGORY_KINDS.map((entry) => (
                    <option key={entry} value={entry}>
                      {titleize(entry)}
                    </option>
                  ))}
                </select>
                <button onClick={() => void renameCategory(category)} type="button">
                  Rename
                </button>
                <button className="danger" onClick={() => void removeCategory(category)} type="button">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

interface IssuesPageProps {
  selectedProjectId: string;
  selectedProjectName: string;
  categories: Category[];
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function IssuesPage(props: IssuesPageProps): JSX.Element {
  const { selectedProjectId, selectedProjectName, categories, reportError, reportNotice } = props;
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draft, setDraft] = useState<ItemPayload>(DEFAULT_DRAFT);

  useEffect(() => {
    setDraft((current) => ({ ...current, projectId: selectedProjectId }));
  }, [selectedProjectId]);

  async function refreshItems(): Promise<void> {
    if (!selectedProjectId) {
      setItems([]);
      return;
    }

    try {
      setLoadingItems(true);
      const nextItems = await getItems(selectedProjectId);
      setItems(nextItems);
    } catch (error) {
      reportError(error, "Failed to load issues/features");
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    void refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  function resetForm(): void {
    setDraft({ ...DEFAULT_DRAFT, projectId: selectedProjectId });
    setTagInput("");
    setPendingFiles([]);
    setEditingItemId(null);
  }

  function beginEdit(item: Item): void {
    setEditingItemId(item.id);
    setDraft({
      projectId: item.projectId,
      categoryId: item.categoryId,
      type: item.type,
      title: item.title,
      description: item.description,
      status: item.status,
      priority: item.priority,
      tags: item.tags
    });
    setTagInput(item.tags.join(", "));
    setPendingFiles([]);
  }

  async function submitIssue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedProjectId) {
      reportError(new Error("No project selected"), "Select a project first");
      return;
    }

    if (!draft.title.trim() || !draft.description.trim()) {
      reportError(new Error("Validation failed"), "Title and description are required");
      return;
    }

    try {
      setBusy(true);
      const payload: ItemPayload = {
        ...draft,
        projectId: selectedProjectId,
        categoryId: draft.categoryId || null,
        title: draft.title.trim(),
        description: draft.description.trim(),
        tags: parseTags(tagInput)
      };

      let targetId = editingItemId;
      if (editingItemId) {
        const updated = await updateItem(editingItemId, payload);
        targetId = updated.id;
      } else {
        const created = await createItem(payload);
        targetId = created.id;
      }

      if (targetId && pendingFiles.length > 0) {
        await uploadItemImages(targetId, pendingFiles);
      }

      await refreshItems();
      resetForm();
      reportNotice(editingItemId ? "Item updated" : "Item created");
    } catch (error) {
      reportError(error, "Failed to save item");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: Item): Promise<void> {
    const confirmed = window.confirm(`Delete ${item.type} "${item.title}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setBusy(true);
      await deleteItem(item.id);
      await refreshItems();
      if (editingItemId === item.id) {
        resetForm();
      }
      reportNotice("Item deleted");
    } catch (error) {
      reportError(error, "Failed to delete item");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(itemId: string, imageId: string): Promise<void> {
    try {
      setBusy(true);
      await deleteItemImage(itemId, imageId);
      await refreshItems();
      reportNotice("Image removed");
    } catch (error) {
      reportError(error, "Failed to remove image");
    } finally {
      setBusy(false);
    }
  }

  if (!selectedProjectId) {
    return (
      <section className="page-section">
        <article className="panel-card">
          <h2>No Project Selected</h2>
          <p className="helper">Create/select a project on the Projects page to start adding issues.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Issues & Features</p>
          <h2>{selectedProjectName}</h2>
        </div>
      </header>

      <article className="panel-card">
        <h3>{editingItemId ? "Edit Item" : "Create Item"}</h3>
        <form className="stacked-form" onSubmit={submitIssue}>
          <div className="grid-two">
            <label>
              Type
              <select
                value={draft.type}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, type: event.target.value as ItemType }))
                }
              >
                {ITEM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {titleize(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={draft.categoryId || ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    categoryId: event.target.value || null
                  }))
                }
              >
                <option value="">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Title
            <input
              placeholder="Short headline"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            />
          </label>

          <label>
            Description
            <textarea
              placeholder="What happened?"
              rows={5}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>

          <div className="grid-three">
            <label>
              Status
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, status: event.target.value as ItemStatus }))
                }
              >
                {ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {titleize(status)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, priority: event.target.value as ItemPriority }))
                }
              >
                {ITEM_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {titleize(priority)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Tags
              <input
                placeholder="ios, checkout"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
              />
            </label>
          </div>

          <label>
            Screenshots
            <input
              accept="image/*"
              capture="environment"
              multiple
              type="file"
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                setPendingFiles(files);
              }}
            />
          </label>

          <div className="inline-actions">
            <button className="primary" disabled={busy} type="submit">
              {editingItemId ? "Save" : "Create"}
            </button>
            {editingItemId && (
              <button onClick={resetForm} type="button">
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </article>

      <article className="panel-card">
        <h3>Current Items</h3>
        {loadingItems && <p className="helper">Loading items...</p>}
        {!loadingItems && items.length === 0 && <p className="helper">No issues/features recorded yet.</p>}

        <div className="item-grid">
          {items.map((item) => (
            <article className="item-tile" key={item.id}>
              <div className="item-top">
                <h4>{item.title}</h4>
                <span className="tag-chip">{titleize(item.type)}</span>
              </div>
              <p>{item.description}</p>
              <div className="meta-line">
                <span>{titleize(item.status)}</span>
                <span>{titleize(item.priority)}</span>
                <span>{item.tags.length ? item.tags.join(", ") : "no tags"}</span>
              </div>

              {item.images.length > 0 && (
                <div className="thumb-grid">
                  {item.images.map((image) => (
                    <figure key={image.id}>
                      <img alt={image.filename} loading="lazy" src={image.url} />
                      <button className="danger" onClick={() => void removeImage(item.id, image.id)} type="button">
                        Remove
                      </button>
                    </figure>
                  ))}
                </div>
              )}

              <div className="inline-actions">
                <button onClick={() => beginEdit(item)} type="button">
                  Edit
                </button>
                <button className="danger" onClick={() => void removeItem(item)} type="button">
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}

interface PromptsPageProps {
  selectedProjectId: string;
  selectedProjectName: string;
  categories: Category[];
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function PromptsPage(props: PromptsPageProps): JSX.Element {
  const { selectedProjectId, selectedProjectName, categories, reportError, reportNotice } = props;

  const [items, setItems] = useState<Item[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [manualCopyFallback, setManualCopyFallback] = useState("");
  const [busy, setBusy] = useState(false);

  const [filters, setFilters] = useState<ItemFilters>({
    search: ""
  });

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  async function refreshItems(): Promise<void> {
    if (!selectedProjectId) {
      setItems([]);
      setSelectedItemId(null);
      return;
    }

    try {
      const nextItems = await getItems(selectedProjectId, filters);
      setItems(nextItems);

      const stillExists = nextItems.some((item) => item.id === selectedItemId);
      if (!stillExists) {
        setSelectedItemId(nextItems[0]?.id ?? null);
      }
    } catch (error) {
      reportError(error, "Failed to load prompt items");
    }
  }

  useEffect(() => {
    void refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, filters]);

  useEffect(() => {
    const loadPrompt = async (): Promise<void> => {
      if (!selectedItemId) {
        setPromptText("");
        return;
      }

      try {
        const response = await createItemPrompt(selectedItemId);
        setPromptText(response.text);
      } catch (error) {
        reportError(error, "Failed to generate prompt");
      }
    };

    void loadPrompt();
  }, [selectedItemId, reportError]);

  async function copyPrompt(): Promise<void> {
    if (!selectedItemId) {
      return;
    }

    try {
      setBusy(true);
      const response = await createItemPrompt(selectedItemId);
      setPromptText(response.text);

      try {
        await navigator.clipboard.writeText(response.text);
        setManualCopyFallback("");
        reportNotice("Prompt copied to clipboard");
      } catch {
        setManualCopyFallback(response.text);
        reportNotice("Clipboard blocked. Copy from fallback text area.");
      }
    } catch (error) {
      reportError(error, "Failed to copy prompt");
    } finally {
      setBusy(false);
    }
  }

  async function downloadItemPrompt(): Promise<void> {
    if (!selectedItemId) {
      return;
    }

    try {
      setBusy(true);
      await downloadItemExport(selectedItemId);
      reportNotice("Item prompt package downloaded");
    } catch (error) {
      reportError(error, "Failed to download item prompt package");
    } finally {
      setBusy(false);
    }
  }

  async function downloadProjectPrompt(): Promise<void> {
    if (!selectedProjectId) {
      return;
    }

    try {
      setBusy(true);
      await downloadProjectExport(selectedProjectId, filters.type ? filters.type : undefined);
      reportNotice("Project prompt package downloaded");
    } catch (error) {
      reportError(error, "Failed to download project prompt package");
    } finally {
      setBusy(false);
    }
  }

  if (!selectedProjectId) {
    return (
      <section className="page-section">
        <article className="panel-card">
          <h2>No Project Selected</h2>
          <p className="helper">Select a project on the Projects page to generate prompts.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Prompt Studio</p>
          <h2>{selectedProjectName}</h2>
        </div>
        <button className="primary" disabled={busy} onClick={() => void downloadProjectPrompt()} type="button">
          Download Project YAML + Images
        </button>
      </header>

      <article className="panel-card">
        <h3>Filters</h3>
        <div className="grid-three">
          <label>
            Search
            <input
              placeholder="Title or description"
              value={filters.search || ""}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </label>

          <label>
            Type
            <select
              value={filters.type || ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  type: (event.target.value as ItemType) || undefined
                }))
              }
            >
              <option value="">Any</option>
              {ITEM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleize(type)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select
              value={filters.status || ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: (event.target.value as ItemStatus) || undefined
                }))
              }
            >
              <option value="">Any</option>
              {ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {titleize(status)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select
              value={filters.priority || ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  priority: (event.target.value as ItemPriority) || undefined
                }))
              }
            >
              <option value="">Any</option>
              {ITEM_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {titleize(priority)}
                </option>
              ))}
            </select>
          </label>

          <label>
            Category
            <select
              value={filters.categoryId || ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  categoryId: event.target.value || undefined
                }))
              }
            >
              <option value="">Any</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tag
            <input
              placeholder="Single tag"
              value={filters.tag || ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  tag: event.target.value || undefined
                }))
              }
            />
          </label>
        </div>
      </article>

      <article className="panel-card prompt-layout">
        <div className="prompt-list">
          {items.length === 0 && <p className="helper">No matching items.</p>}
          {items.map((item) => (
            <button
              className={`prompt-item ${selectedItemId === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setSelectedItemId(item.id)}
              type="button"
            >
              <strong>{item.title}</strong>
              <span>
                {titleize(item.type)} · {titleize(item.priority)} · {item.images.length} image(s)
              </span>
            </button>
          ))}
        </div>

        <div className="prompt-preview">
          {!selectedItem && <p className="helper">Select an item to preview its prompt.</p>}
          {selectedItem && (
            <>
              <h3>{selectedItem.title}</h3>
              <p>{selectedItem.description}</p>
              <div className="inline-actions">
                <button className="primary" disabled={busy} onClick={() => void copyPrompt()} type="button">
                  Copy Prompt
                </button>
                <button disabled={busy} onClick={() => void downloadItemPrompt()} type="button">
                  Download Item YAML + Images
                </button>
              </div>
              <textarea readOnly rows={16} value={promptText} />
            </>
          )}

          {manualCopyFallback && (
            <div className="fallback-copy">
              <p>Clipboard blocked. Copy manually from here:</p>
              <textarea readOnly rows={10} value={manualCopyFallback} />
            </div>
          )}
        </div>
      </article>
    </section>
  );
}

interface ShellProps {
  currentUser: AuthUser;
  projects: Project[];
  categories: Category[];
  selectedProjectId: string;
  setSelectedProjectId: (projectId: string) => void;
  refreshWorkspace: (preferredProjectId?: string) => Promise<void>;
  onLogout: () => void;
  errorMessage: string;
  notice: string;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function AppShell(props: ShellProps): JSX.Element {
  const {
    currentUser,
    projects,
    categories,
    selectedProjectId,
    setSelectedProjectId,
    refreshWorkspace,
    onLogout,
    errorMessage,
    notice,
    reportError,
    reportNotice
  } = props;
  const navigate = useNavigate();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const navItems = [
    { to: "/issues", label: "Issues" },
    { to: "/projects", label: "Projects" },
    { to: "/categories", label: "Categories" },
    { to: "/prompts", label: "Prompts" }
  ];

  return (
    <div className="shell-wrap">
      <aside className="sidebar">
        <div className="brand">
          <p className="kicker">AAM Tracker</p>
          <h1>Issue Prompt Lab</h1>
          <p>Capture bugs and ideas fast, then export clean AI-ready prompts.</p>
        </div>

        <nav className="side-nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="identity-card">
          <div>
            <strong>{currentUser.displayName || currentUser.email}</strong>
            <p>{currentUser.email}</p>
          </div>
          <span className="tag-chip">{currentUser.role}</span>
          <button onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </aside>

      <main className="shell-main">
        <header className="topbar">
          <div className="project-picker">
            <label>
              Active Project
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                <option value="">No project selected</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={() => navigate("/projects")} type="button">
              Manage Projects
            </button>
          </div>

          <div className="current-project-pill">
            <span>Current:</span>
            <strong>{selectedProject?.name || "None"}</strong>
          </div>
        </header>

        {errorMessage && <div className="alert error">{errorMessage}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="route-host">
          <Routes>
            <Route
              path="/projects"
              element={
                <ProjectsPage
                  projects={projects}
                  selectedProjectId={selectedProjectId}
                  onSelectProject={setSelectedProjectId}
                  refreshWorkspace={refreshWorkspace}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/categories"
              element={
                <CategoriesPage
                  categories={categories}
                  refreshWorkspace={async () => refreshWorkspace()}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/issues"
              element={
                <IssuesPage
                  categories={categories}
                  selectedProjectId={selectedProjectId}
                  selectedProjectName={selectedProject?.name || "No Project"}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/prompts"
              element={
                <PromptsPage
                  categories={categories}
                  selectedProjectId={selectedProjectId}
                  selectedProjectName={selectedProject?.name || "No Project"}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route path="*" element={<Navigate replace to="/issues" />} />
          </Routes>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile">
        {navItems.map((item) => (
          <NavLink
            className={({ isActive }) => (isActive ? "mobile-link active" : "mobile-link")}
            key={item.to}
            to={item.to}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function App(): JSX.Element {
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");

  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(getStoredProjectId);

  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");

  function resetWorkspaceState(): void {
    setProjects([]);
    setCategories([]);
    setSelectedProjectId("");
    persistProjectId("");
  }

  function resolveApiError(error: unknown, fallbackMessage: string): string {
    const message = error instanceof Error ? error.message : fallbackMessage;

    if (message.toLowerCase().includes("unauthorized")) {
      clearAuthToken();
      setCurrentUser(null);
      resetWorkspaceState();
      return "Session expired. Please sign in again.";
    }

    return message;
  }

  const reportError: ReportError = (error, fallbackMessage) => {
    setNotice("");
    setErrorMessage(resolveApiError(error, fallbackMessage));
  };

  const reportNotice: ReportNotice = (message) => {
    setErrorMessage("");
    setNotice(message);
  };

  async function refreshWorkspace(preferredProjectId?: string): Promise<void> {
    if (!currentUser) {
      return;
    }

    const [projectData, categoryData] = await Promise.all([getProjects(), getCategories()]);
    setProjects(projectData);
    setCategories(categoryData);

    const preferred = preferredProjectId ?? selectedProjectId;
    const preferredStillExists = projectData.some((project) => project.id === preferred);
    const nextSelected = preferredStillExists ? preferred : projectData[0]?.id || "";

    setSelectedProjectId(nextSelected);
    persistProjectId(nextSelected);
  }

  useEffect(() => {
    const initializeAuth = async (): Promise<void> => {
      setAuthReady(false);

      const token = getAuthToken();
      if (!token) {
        setAuthReady(true);
        return;
      }

      try {
        const me = await getMe();
        setCurrentUser(me);
      } catch {
        clearAuthToken();
        setCurrentUser(null);
      } finally {
        setAuthReady(true);
      }
    };

    void initializeAuth();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const loadWorkspace = async (): Promise<void> => {
      try {
        await refreshWorkspace();
      } catch (error) {
        reportError(error, "Failed to load workspace");
      }
    };

    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    persistProjectId(selectedProjectId);
  }, [selectedProjectId]);

  async function submitAuth(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!authEmail.trim() || !authPassword.trim()) {
      setErrorMessage("Email and password are required");
      return;
    }

    try {
      setBusy(true);
      setErrorMessage("");
      const normalizedEmail = authEmail.trim().toLowerCase();

      if (authMode === "login") {
        const response = await loginUser({
          email: normalizedEmail,
          password: authPassword
        });
        setCurrentUser(response.user);
        reportNotice(`Welcome back, ${response.user.email}`);
      } else {
        const response = await registerUser({
          email: normalizedEmail,
          password: authPassword,
          displayName: authDisplayName.trim() || undefined
        });
        setCurrentUser(response.user);
        reportNotice(`Account created for ${response.user.email}`);
      }

      setAuthPassword("");
      setAuthDisplayName("");
    } catch (error) {
      reportError(error, "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function logout(): void {
    clearAuthToken();
    setCurrentUser(null);
    resetWorkspaceState();
    setNotice("Signed out");
  }

  if (!authReady) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Checking session...</h1>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        authDisplayName={authDisplayName}
        authEmail={authEmail}
        authMode={authMode}
        authPassword={authPassword}
        busy={busy}
        errorMessage={errorMessage}
        notice={notice}
        onAuthDisplayNameChange={setAuthDisplayName}
        onAuthEmailChange={setAuthEmail}
        onAuthModeChange={setAuthMode}
        onAuthPasswordChange={setAuthPassword}
        onSubmit={submitAuth}
      />
    );
  }

  return (
    <BrowserRouter>
      <AppShell
        categories={categories}
        currentUser={currentUser}
        errorMessage={errorMessage}
        notice={notice}
        onLogout={logout}
        projects={projects}
        refreshWorkspace={refreshWorkspace}
        reportError={reportError}
        reportNotice={reportNotice}
        selectedProjectId={selectedProjectId}
        setSelectedProjectId={setSelectedProjectId}
      />
    </BrowserRouter>
  );
}
