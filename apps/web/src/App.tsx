import {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from "react-router-dom";
import {
  ApiError,
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
  getPromptTemplates,
  getProjects,
  login as loginUser,
  register as registerUser,
  updateCategory,
  updateItem,
  updatePromptTemplates,
  updateProject,
  uploadItemImages
} from "./api";
import type { ApiErrorIssue } from "./api";
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
  PromptTemplateKind,
  PromptTemplatePlaceholder,
  PromptTemplateSet,
  Project
} from "./types";

type AuthMode = "login" | "register";

type ReportError = (error: unknown, fallbackMessage: string) => void;

type ReportNotice = (message: string) => void;
type ItemFormField = "type" | "categoryId" | "title" | "description" | "status" | "priority";
type ItemFormErrors = Partial<Record<ItemFormField, string>>;

const ITEM_TYPES: ItemType[] = ["issue", "feature"];
const ITEM_STATUSES: ItemStatus[] = ["open", "in_progress", "resolved", "archived"];
const ITEM_PRIORITIES: ItemPriority[] = ["low", "medium", "high", "critical"];
const CATEGORY_KINDS: CategoryKind[] = ["issue", "feature", "other"];
const PROMPT_TEMPLATE_KINDS: PromptTemplateKind[] = ["issue", "feature", "other"];
const EMPTY_PROMPT_TEMPLATES: PromptTemplateSet = {
  issue: "",
  feature: "",
  other: ""
};
const ITEM_FORM_FIELDS: ItemFormField[] = [
  "type",
  "categoryId",
  "title",
  "description",
  "status",
  "priority"
];

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

function getDefaultCategoryId(categories: Category[]): string | null {
  return categories[0]?.id || null;
}

function isItemFormField(pathPart: unknown): pathPart is ItemFormField {
  return typeof pathPart === "string" && ITEM_FORM_FIELDS.includes(pathPart as ItemFormField);
}

function mapItemFormIssues(issues: ApiErrorIssue[]): ItemFormErrors {
  const nextErrors: ItemFormErrors = {};

  for (const issue of issues) {
    const field = issue.path?.[0];
    if (!isItemFormField(field)) {
      continue;
    }
    if (!nextErrors[field]) {
      nextErrors[field] = issue.message;
    }
  }

  return nextErrors;
}

function buildPendingImageId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function BrandMark(props: { className?: string; alt?: string }): JSX.Element {
  const { className = "brand-mark", alt = "Issue Prompt Tracker logo" } = props;

  return <img alt={alt} className={className} src="/branding/logo-mark.svg" />;
}

type AppIconName =
  | "menu"
  | "close"
  | "plus"
  | "edit"
  | "trash"
  | "eye"
  | "logout"
  | "back"
  | "save"
  | "cancel"
  | "copy"
  | "download"
  | "folder"
  | "refresh"
  | "reset";

function AppIcon(props: { name: AppIconName; className?: string }): JSX.Element {
  const { name, className = "btn-icon" } = props;

  const sharedProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true
  } as const;

  switch (name) {
    case "menu":
      return (
        <svg {...sharedProps}>
          <path d="M4 7H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M4 12H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M4 17H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "close":
      return (
        <svg {...sharedProps}>
          <path d="M6 6L18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "plus":
      return (
        <svg {...sharedProps}>
          <path d="M12 5V19" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M5 12H19" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "edit":
      return (
        <svg {...sharedProps}>
          <path d="M4 20H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path
            d="M14.5 5.5L18.5 9.5L9 19H5V15L14.5 5.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "trash":
      return (
        <svg {...sharedProps}>
          <path d="M5 7H19" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M9 7V5H15V7" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M7 7L8 19H16L17 7" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      );
    case "eye":
      return (
        <svg {...sharedProps}>
          <path
            d="M2.5 12C4.2 8.3 7.6 6 12 6C16.4 6 19.8 8.3 21.5 12C19.8 15.7 16.4 18 12 18C7.6 18 4.2 15.7 2.5 12Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <circle cx="12" cy="12" fill="currentColor" r="2.5" />
        </svg>
      );
    case "logout":
      return (
        <svg {...sharedProps}>
          <path d="M10 5H6V19H10" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M14 16L18 12L14 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M18 12H9" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "back":
      return (
        <svg {...sharedProps}>
          <path d="M10 6L4 12L10 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M4 12H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "save":
      return (
        <svg {...sharedProps}>
          <path
            d="M5 4H16L20 8V20H5V4Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path d="M8 4V10H15V4" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
          <path d="M8 20V14H16V20" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      );
    case "cancel":
      return (
        <svg {...sharedProps}>
          <path d="M6 6L18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "copy":
      return (
        <svg {...sharedProps}>
          <rect height="12" rx="2" stroke="currentColor" width="10" x="9" y="8" />
          <rect height="12" rx="2" stroke="currentColor" width="10" x="5" y="4" />
        </svg>
      );
    case "download":
      return (
        <svg {...sharedProps}>
          <path d="M12 4V14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M8 10L12 14L16 10" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M5 19H19" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      );
    case "folder":
      return (
        <svg {...sharedProps}>
          <path
            d="M3 7H10L12 9H21V18H3V7Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "refresh":
      return (
        <svg {...sharedProps}>
          <path d="M4 12A8 8 0 0 1 18 7" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M18 4V8H14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          <path d="M20 12A8 8 0 0 1 6 17" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M6 20V16H10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        </svg>
      );
    case "reset":
      return (
        <svg {...sharedProps}>
          <path d="M12 4V8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M12 16V20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M4 12H8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <path d="M16 12H20" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    default:
      return (
        <svg {...sharedProps}>
          <circle cx="12" cy="12" fill="currentColor" r="2" />
        </svg>
      );
  }
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
        <header className="auth-head">
          <div className="logo-lockup">
            <BrandMark className="brand-mark brand-mark-lg" />
            <div className="brand-copy">
              <p className="kicker">Issue Prompt Tracker</p>
              <h1>Capture what breaks, ship what works</h1>
            </div>
          </div>
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
          <button className="primary button-with-icon" disabled={busy} type="submit">
            <AppIcon name={authMode === "login" ? "save" : "plus"} />
            {authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="helper">Admin access comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.</p>
      </section>
    </main>
  );
}

interface ProjectsListPageProps {
  projects: Project[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  refreshWorkspace: (preferredProjectId?: string) => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function ProjectsListPage(props: ProjectsListPageProps): JSX.Element {
  const { projects, selectedProjectId, onSelectProject, refreshWorkspace, reportError, reportNotice } = props;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

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
        <button className="primary button-with-icon" onClick={() => navigate("/projects/new")} type="button">
          <AppIcon name="plus" />
          Create Project
        </button>
      </header>

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
                <button className="button-with-icon" onClick={() => navigate(`/projects/${project.id}/edit`)} type="button">
                  <AppIcon name="edit" />
                  Edit
                </button>
                <button
                  className="danger button-with-icon"
                  disabled={busy}
                  onClick={() => void removeProject(project)}
                  type="button"
                >
                  <AppIcon name="trash" />
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

interface ProjectFormPageProps {
  projects: Project[];
  refreshWorkspace: (preferredProjectId?: string) => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function ProjectFormPage(props: ProjectFormPageProps): JSX.Element {
  const { projects, refreshWorkspace, reportError, reportNotice } = props;
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const isEditMode = Boolean(projectId);
  const editingProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects]
  );

  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!isEditMode) {
      setName("");
      setDescription("");
      return;
    }

    if (!editingProject) {
      return;
    }

    setName(editingProject.name);
    setDescription(editingProject.description || "");
  }, [editingProject, isEditMode]);

  async function submitProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!name.trim()) {
      reportError(undefined, "Project name is required");
      return;
    }

    try {
      setBusy(true);

      if (isEditMode && projectId) {
        await updateProject(projectId, {
          name: name.trim(),
          description: description.trim() ? description.trim() : null
        });
        await refreshWorkspace(projectId);
        reportNotice("Project updated");
      } else {
        const created = await createProject({
          name: name.trim(),
          description: description.trim() || undefined
        });
        await refreshWorkspace(created.id);
        reportNotice("Project created");
      }

      navigate("/projects");
    } catch (error) {
      reportError(error, isEditMode ? "Failed to update project" : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  if (isEditMode && !editingProject) {
    return (
      <section className="page-section">
        <header className="section-head">
          <div>
            <p className="kicker">Projects</p>
            <h2>Project Not Found</h2>
          </div>
          <button className="button-with-icon" onClick={() => navigate("/projects")} type="button">
            <AppIcon name="back" />
            Back to Projects
          </button>
        </header>
        <article className="panel-card">
          <p className="helper">The requested project could not be found in your current workspace.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Projects</p>
          <h2>{isEditMode ? "Update Project" : "Create Project"}</h2>
        </div>
        <button className="button-with-icon" onClick={() => navigate("/projects")} type="button">
          <AppIcon name="back" />
          Back to Projects
        </button>
      </header>

      <article className="panel-card">
        <form className="stacked-form" onSubmit={submitProject}>
          <label>
            Project name
            <input
              placeholder="Project name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Description
            <input
              placeholder="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="inline-actions">
            <button className="primary button-with-icon" disabled={busy} type="submit">
              <AppIcon name={isEditMode ? "save" : "plus"} />
              {isEditMode ? "Save Project" : "Create Project"}
            </button>
            <button className="button-with-icon" onClick={() => navigate("/projects")} type="button">
              <AppIcon name="cancel" />
              Cancel
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

interface CategoriesListPageProps {
  categories: Category[];
  refreshWorkspace: () => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function CategoriesListPage(props: CategoriesListPageProps): JSX.Element {
  const { categories, refreshWorkspace, reportError, reportNotice } = props;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

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
        <button className="primary button-with-icon" onClick={() => navigate("/categories/new")} type="button">
          <AppIcon name="plus" />
          Create Category
        </button>
      </header>

      <article className="panel-card">
        <h3>All Categories</h3>
        {categories.length === 0 && <p className="helper">No categories yet.</p>}

        <div className="row-stack">
          {categories.map((category) => (
            <div className="row-card" key={category.id}>
              <div className="row-title">
                <strong>{category.name}</strong>
                <span className="tag-chip">{titleize(category.kind)}</span>
              </div>
              <div className="inline-actions">
                <button className="button-with-icon" onClick={() => navigate(`/categories/${category.id}/edit`)} type="button">
                  <AppIcon name="edit" />
                  Edit
                </button>
                <button
                  className="danger button-with-icon"
                  disabled={busy}
                  onClick={() => void removeCategory(category)}
                  type="button"
                >
                  <AppIcon name="trash" />
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

interface CategoryFormPageProps {
  categories: Category[];
  refreshWorkspace: () => Promise<void>;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function CategoryFormPage(props: CategoryFormPageProps): JSX.Element {
  const { categories, refreshWorkspace, reportError, reportNotice } = props;
  const navigate = useNavigate();
  const { categoryId } = useParams<{ categoryId: string }>();
  const isEditMode = Boolean(categoryId);
  const editingCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) ?? null,
    [categoryId, categories]
  );

  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("other");

  useEffect(() => {
    if (!isEditMode) {
      setName("");
      setKind("other");
      return;
    }

    if (!editingCategory) {
      return;
    }

    setName(editingCategory.name);
    setKind(editingCategory.kind);
  }, [editingCategory, isEditMode]);

  async function submitCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      reportError(undefined, "Category name is required");
      return;
    }

    try {
      setBusy(true);
      if (isEditMode && categoryId) {
        await updateCategory(categoryId, { name: name.trim(), kind });
        reportNotice("Category updated");
      } else {
        await createCategory({
          name: name.trim(),
          kind
        });
        reportNotice("Category created");
      }
      await refreshWorkspace();
      navigate("/categories");
    } catch (error) {
      reportError(error, isEditMode ? "Failed to update category" : "Failed to create category");
    } finally {
      setBusy(false);
    }
  }

  if (isEditMode && !editingCategory) {
    return (
      <section className="page-section">
        <header className="section-head">
          <div>
            <p className="kicker">Categories</p>
            <h2>Category Not Found</h2>
          </div>
          <button className="button-with-icon" onClick={() => navigate("/categories")} type="button">
            <AppIcon name="back" />
            Back to Categories
          </button>
        </header>
        <article className="panel-card">
          <p className="helper">The requested category could not be found.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Categories</p>
          <h2>{isEditMode ? "Update Category" : "Create Category"}</h2>
        </div>
        <button className="button-with-icon" onClick={() => navigate("/categories")} type="button">
          <AppIcon name="back" />
          Back to Categories
        </button>
      </header>

      <article className="panel-card">
        <form className="stacked-form" onSubmit={submitCategory}>
          <label>
            Category name
            <input
              placeholder="Category name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>
              {CATEGORY_KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {titleize(entry)}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-actions">
            <button className="primary button-with-icon" disabled={busy} type="submit">
              <AppIcon name={isEditMode ? "save" : "plus"} />
              {isEditMode ? "Save Category" : "Create Category"}
            </button>
            <button className="button-with-icon" onClick={() => navigate("/categories")} type="button">
              <AppIcon name="cancel" />
              Cancel
            </button>
          </div>
        </form>
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
  mode: "list" | "form";
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface PreviewImageModal {
  url: string;
  filename: string;
  pendingId?: string;
  itemId?: string;
  imageId?: string;
}

function IssuesPage(props: IssuesPageProps): JSX.Element {
  const { selectedProjectId, selectedProjectName, categories, reportError, reportNotice, mode } = props;
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId: string }>();
  const editItemId = mode === "form" ? itemId : undefined;
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draft, setDraft] = useState<ItemPayload>(() => ({
    ...DEFAULT_DRAFT,
    projectId: selectedProjectId,
    categoryId: getDefaultCategoryId(categories)
  }));
  const [fieldErrors, setFieldErrors] = useState<ItemFormErrors>({});
  const [isDropzoneActive, setIsDropzoneActive] = useState(false);
  const [previewImage, setPreviewImage] = useState<PreviewImageModal | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const isFormMode = mode === "form";
  const isEditMode = Boolean(editItemId);

  function clearFieldError(field: ItemFormField): void {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  useEffect(() => {
    setDraft((current) => ({ ...current, projectId: selectedProjectId }));
  }, [selectedProjectId]);

  useEffect(() => {
    setDraft((current) => {
      if (editingItemId) {
        return current;
      }

      const categoryStillExists = current.categoryId
        ? categories.some((category) => category.id === current.categoryId)
        : false;

      if (categoryStillExists) {
        return current;
      }

      const fallbackCategoryId = getDefaultCategoryId(categories);
      if (current.categoryId === fallbackCategoryId) {
        return current;
      }

      return {
        ...current,
        categoryId: fallbackCategoryId
      };
    });
  }, [categories, editingItemId]);

  useEffect(() => {
    const previousImages = pendingImagesRef.current;
    const currentIds = new Set(pendingImages.map((image) => image.id));

    for (const image of previousImages) {
      if (!currentIds.has(image.id)) {
        URL.revokeObjectURL(image.previewUrl);
      }
    }

    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(
    () => () => {
      for (const image of pendingImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    },
    []
  );

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

  function appendPendingFiles(files: File[]): void {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    setPendingImages((current) => {
      const knownIds = new Set(current.map((image) => image.id));
      const nextImages = [...current];

      for (const file of imageFiles) {
        const id = buildPendingImageId(file);
        if (knownIds.has(id)) {
          continue;
        }

        nextImages.push({
          id,
          file,
          previewUrl: URL.createObjectURL(file)
        });
        knownIds.add(id);
      }

      return nextImages;
    });
  }

  function clearPendingImages(): void {
    setPendingImages([]);
    setPreviewImage((current) => (current?.pendingId ? null : current));
  }

  function removePendingImage(pendingId: string): void {
    setPendingImages((current) => current.filter((image) => image.id !== pendingId));
    setPreviewImage((current) => (current?.pendingId === pendingId ? null : current));
  }

  function openFilePicker(): void {
    fileInputRef.current?.click();
  }

  function handleDropzoneDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropzoneActive(true);
  }

  function handleDropzoneDragLeave(event: DragEvent<HTMLDivElement>): void {
    const related = event.relatedTarget as Node | null;
    if (!related || !event.currentTarget.contains(related)) {
      setIsDropzoneActive(false);
    }
  }

  function handleDropzoneDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDropzoneActive(false);
    appendPendingFiles(Array.from(event.dataTransfer.files || []));
  }

  function handleDropzoneKeydown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  }

  function handleDropzonePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const imageFiles = Array.from(event.clipboardData.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    appendPendingFiles(imageFiles);
    reportNotice(`${imageFiles.length} image(s) pasted from clipboard`);
  }

  useEffect(() => {
    void refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  useEffect(() => {
    if (!isFormMode) {
      return;
    }

    if (!editItemId) {
      if (editingItemId) {
        resetForm();
      }
      return;
    }

    const targetItem = items.find((item) => item.id === editItemId);
    if (!targetItem) {
      return;
    }

    if (editingItemId !== editItemId) {
      beginEdit(targetItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFormMode, editItemId, items, editingItemId]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  function resetForm(): void {
    setDraft({
      ...DEFAULT_DRAFT,
      projectId: selectedProjectId,
      categoryId: getDefaultCategoryId(categories)
    });
    setTagInput("");
    clearPendingImages();
    setEditingItemId(null);
    setFieldErrors({});
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
    clearPendingImages();
    setFieldErrors({});
  }

  async function submitIssue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedProjectId) {
      reportError(new Error("No project selected"), "Select a project first");
      return;
    }

    const nextErrors: ItemFormErrors = {};

    if (!draft.type) {
      nextErrors.type = "Type is required.";
    }
    if (!draft.categoryId) {
      nextErrors.categoryId =
        categories.length === 0
          ? "Create at least one category before creating an item."
          : "Category is required.";
    }
    if (!draft.status) {
      nextErrors.status = "Status is required.";
    }
    if (!draft.priority) {
      nextErrors.priority = "Priority is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      reportError(undefined, "Please fix the highlighted fields.");
      return;
    }

    setFieldErrors({});

    try {
      setBusy(true);
      const wasEditing = Boolean(editingItemId);
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

      if (targetId && pendingImages.length > 0) {
        await uploadItemImages(
          targetId,
          pendingImages.map((image) => image.file)
        );
      }

      await refreshItems();
      resetForm();
      reportNotice(wasEditing ? "Item updated" : "Item created");
      if (isFormMode) {
        navigate("/issues");
      }
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        const mappedErrors = mapItemFormIssues(error.issues);
        if (Object.keys(mappedErrors).length > 0) {
          setFieldErrors((current) => ({ ...current, ...mappedErrors }));
        }
      }
      reportError(error, "Failed to save item");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: Item): Promise<void> {
    const itemLabel = item.title.trim() || "Untitled item";
    const confirmed = window.confirm(`Delete ${item.type} "${itemLabel}"?`);
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
      setPreviewImage((current) =>
        current?.itemId === itemId && current.imageId === imageId ? null : current
      );
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

  const missingEditTarget =
    isFormMode &&
    isEditMode &&
    !loadingItems &&
    !items.some((item) => item.id === editItemId);

  return (
    <>
      <section className="page-section">
        <header className="section-head">
          <div>
            <p className="kicker">Issues & Features</p>
            <h2>{isFormMode ? (isEditMode ? "Update Item" : "Create Item") : selectedProjectName}</h2>
          </div>
          {isFormMode ? (
            <button className="button-with-icon" onClick={() => navigate("/issues")} type="button">
              <AppIcon name="back" />
              Back to Issues
            </button>
          ) : (
            <button className="primary button-with-icon" onClick={() => navigate("/issues/new")} type="button">
              <AppIcon name="plus" />
              Create Item
            </button>
          )}
        </header>

        {isFormMode && (
          <article className="panel-card">
            <h3>{isEditMode ? "Update Item" : "Create Item"}</h3>
            <form className="stacked-form" onSubmit={submitIssue}>
            <div className="grid-two">
              <label className={fieldErrors.type ? "field-with-error" : ""}>
                Type *
                <select
                  aria-invalid={Boolean(fieldErrors.type)}
                  value={draft.type}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, type: event.target.value as ItemType }));
                    clearFieldError("type");
                  }}
                >
                  {ITEM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {titleize(type)}
                    </option>
                  ))}
                </select>
                {fieldErrors.type && <span className="field-error">{fieldErrors.type}</span>}
              </label>
              <label className={fieldErrors.categoryId ? "field-with-error" : ""}>
                Category *
                <select
                  aria-invalid={Boolean(fieldErrors.categoryId)}
                  value={draft.categoryId || ""}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      categoryId: event.target.value || null
                    }));
                    clearFieldError("categoryId");
                  }}
                >
                  <option value="" disabled>
                    {categories.length === 0 ? "No categories available" : "Select category"}
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.categoryId && <span className="field-error">{fieldErrors.categoryId}</span>}
              </label>
            </div>

            <label className={fieldErrors.title ? "field-with-error" : ""}>
              Title
              <input
                aria-invalid={Boolean(fieldErrors.title)}
                placeholder="Short headline"
                value={draft.title}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, title: event.target.value }));
                  clearFieldError("title");
                }}
              />
              {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
            </label>

            <label className={fieldErrors.description ? "field-with-error" : ""}>
              Description
              <textarea
                aria-invalid={Boolean(fieldErrors.description)}
                placeholder="What happened?"
                rows={5}
                value={draft.description}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, description: event.target.value }));
                  clearFieldError("description");
                }}
              />
              {fieldErrors.description && (
                <span className="field-error">{fieldErrors.description}</span>
              )}
            </label>

            <div className="grid-three">
              <label className={fieldErrors.status ? "field-with-error" : ""}>
                Status *
                <select
                  aria-invalid={Boolean(fieldErrors.status)}
                  value={draft.status}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, status: event.target.value as ItemStatus }));
                    clearFieldError("status");
                  }}
                >
                  {ITEM_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {titleize(status)}
                    </option>
                  ))}
                </select>
                {fieldErrors.status && <span className="field-error">{fieldErrors.status}</span>}
              </label>

              <label className={fieldErrors.priority ? "field-with-error" : ""}>
                Priority *
                <select
                  aria-invalid={Boolean(fieldErrors.priority)}
                  value={draft.priority}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, priority: event.target.value as ItemPriority }));
                    clearFieldError("priority");
                  }}
                >
                  {ITEM_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {titleize(priority)}
                    </option>
                  ))}
                </select>
                {fieldErrors.priority && <span className="field-error">{fieldErrors.priority}</span>}
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

            <div className="screenshot-field">
              <label>Screenshots</label>
              <input
                ref={fileInputRef}
                accept="image/*"
                capture="environment"
                className="sr-only"
                multiple
                type="file"
                onChange={(event) => {
                  appendPendingFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
              <div
                aria-label="Screenshot dropzone"
                className={isDropzoneActive ? "dropzone active" : "dropzone"}
                onDragLeave={handleDropzoneDragLeave}
                onDragOver={handleDropzoneDragOver}
                onDrop={handleDropzoneDrop}
                onKeyDown={handleDropzoneKeydown}
                onPaste={handleDropzonePaste}
                onClick={(event) => event.currentTarget.focus()}
                role="button"
                tabIndex={0}
              >
                <p className="dropzone-title">Drop screenshots here</p>
                <p className="helper">
                  Tap choose for file/camera, or focus here and paste image from clipboard (Ctrl/Cmd+V).
                </p>
              </div>
              <div className="inline-actions">
                <button className="button-with-icon" onClick={openFilePicker} type="button">
                  <AppIcon name="plus" />
                  Choose Screenshots
                </button>
                {pendingImages.length > 0 && (
                  <button className="button-with-icon" onClick={clearPendingImages} type="button">
                    <AppIcon name="refresh" />
                    Clear Queue
                  </button>
                )}
              </div>

              {pendingImages.length > 0 && (
                <div className="pending-upload-panel">
                  <div className="pending-upload-head">
                    <h4>Pending Uploads ({pendingImages.length})</h4>
                    <p className="helper">Images upload when you save this item.</p>
                  </div>
                  <div className="media-preview-grid">
                    {pendingImages.map((image) => (
                      <article className="media-preview-card" key={image.id}>
                        <button
                          className="media-thumb"
                          onClick={() =>
                            setPreviewImage({
                              url: image.previewUrl,
                              filename: image.file.name,
                              pendingId: image.id
                            })
                          }
                          type="button"
                        >
                          <img alt={image.file.name} loading="lazy" src={image.previewUrl} />
                        </button>
                        <div className="media-card-meta">
                          <strong title={image.file.name}>{image.file.name}</strong>
                          <span>{formatFileSize(image.file.size)}</span>
                        </div>
                        <div className="inline-actions">
                          <button
                            aria-label="Preview queued image"
                            className="icon-button"
                            onClick={() =>
                              setPreviewImage({
                                url: image.previewUrl,
                                filename: image.file.name,
                                pendingId: image.id
                              })
                            }
                            title="Preview"
                            type="button"
                          >
                            <AppIcon name="eye" />
                          </button>
                          <button
                            aria-label="Remove queued image"
                            className="danger icon-button"
                            onClick={() => removePendingImage(image.id)}
                            title="Remove"
                            type="button"
                          >
                            <AppIcon name="trash" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>

              <div className="inline-actions">
                <button className="primary button-with-icon" disabled={busy} type="submit">
                  <AppIcon name={isEditMode ? "save" : "plus"} />
                  {isEditMode ? "Save Item" : "Create Item"}
                </button>
                <button className="button-with-icon" onClick={() => navigate("/issues")} type="button">
                  <AppIcon name="cancel" />
                  Cancel
                </button>
              </div>
            </form>
            {missingEditTarget && (
              <p className="helper">Could not find this item in the currently selected project.</p>
            )}
          </article>
        )}

        {!isFormMode && (
          <article className="panel-card">
            <h3>Current Items</h3>
            {loadingItems && <p className="helper">Loading items...</p>}
            {!loadingItems && items.length === 0 && <p className="helper">No issues/features recorded yet.</p>}

            <div className="item-grid">
              {items.map((item) => (
                <article className="item-tile" key={item.id}>
                  <div className="item-top">
                    <h4>{item.title || "Untitled item"}</h4>
                    <span className="tag-chip">{titleize(item.type)}</span>
                  </div>
                  <p>{item.description || "No description provided."}</p>
                  <div className="meta-line">
                    <span>{titleize(item.status)}</span>
                    <span>{titleize(item.priority)}</span>
                    <span>{item.tags.length ? item.tags.join(", ") : "no tags"}</span>
                  </div>

                  {item.images.length > 0 && (
                    <div className="thumb-grid">
                      {item.images.map((image) => (
                        <figure key={image.id}>
                          <button
                            className="thumb-action"
                            onClick={() =>
                              setPreviewImage({
                                url: image.url,
                                filename: image.filename,
                                itemId: item.id,
                                imageId: image.id
                              })
                            }
                            type="button"
                          >
                            <img alt={image.filename} loading="lazy" src={image.url} />
                          </button>
                          <div className="inline-actions">
                            <button
                              aria-label="Preview image"
                              className="icon-button"
                              onClick={() =>
                                setPreviewImage({
                                  url: image.url,
                                  filename: image.filename,
                                  itemId: item.id,
                                  imageId: image.id
                                })
                              }
                              title="Preview"
                              type="button"
                            >
                              <AppIcon name="eye" />
                            </button>
                            <button
                              aria-label="Remove image"
                              className="danger icon-button"
                              onClick={() => void removeImage(item.id, image.id)}
                              title="Remove"
                              type="button"
                            >
                              <AppIcon name="trash" />
                            </button>
                          </div>
                        </figure>
                      ))}
                    </div>
                  )}

                  <div className="inline-actions">
                    <button
                      aria-label="Edit item"
                      className="icon-button"
                      onClick={() => navigate(`/issues/${item.id}/edit`)}
                      title="Edit"
                      type="button"
                    >
                      <AppIcon name="edit" />
                    </button>
                    <button
                      aria-label="Delete item"
                      className="danger icon-button"
                      onClick={() => void removeItem(item)}
                      title="Delete"
                      type="button"
                    >
                      <AppIcon name="trash" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>
        )}
      </section>

      {previewImage && (
        <div
          aria-label="Image preview"
          aria-modal="true"
          className="image-modal-backdrop"
          onClick={() => setPreviewImage(null)}
          role="dialog"
        >
          <article className="image-modal" onClick={(event) => event.stopPropagation()}>
            <header className="image-modal-head">
              <strong title={previewImage.filename}>{previewImage.filename}</strong>
              <button className="button-with-icon" onClick={() => setPreviewImage(null)} type="button">
                <AppIcon name="close" />
                Close
              </button>
            </header>
            <img alt={previewImage.filename} src={previewImage.url} />
            <div className="inline-actions">
              {previewImage.pendingId ? (
                <button
                  className="danger button-with-icon"
                  onClick={() => {
                    if (previewImage.pendingId) {
                      removePendingImage(previewImage.pendingId);
                    }
                  }}
                  type="button"
                >
                  <AppIcon name="trash" />
                  Remove from Queue
                </button>
              ) : (
                <button
                  className="danger button-with-icon"
                  disabled={busy}
                  onClick={() => {
                    if (!previewImage.itemId || !previewImage.imageId) {
                      return;
                    }

                    void removeImage(previewImage.itemId, previewImage.imageId);
                  }}
                  type="button"
                >
                  <AppIcon name="trash" />
                  Remove from Item
                </button>
              )}
            </div>
          </article>
        </div>
      )}
    </>
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
        <button
          className="primary button-with-icon"
          disabled={busy}
          onClick={() => void downloadProjectPrompt()}
          type="button"
        >
          <AppIcon name="download" />
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
                <button
                  className="primary button-with-icon"
                  disabled={busy}
                  onClick={() => void copyPrompt()}
                  type="button"
                >
                  <AppIcon name="copy" />
                  Copy Prompt
                </button>
                <button className="button-with-icon" disabled={busy} onClick={() => void downloadItemPrompt()} type="button">
                  <AppIcon name="download" />
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

interface PromptTemplatesPageProps {
  selectedProjectId: string;
  selectedProjectName: string;
  reportError: ReportError;
  reportNotice: ReportNotice;
}

function PromptTemplatesPage(props: PromptTemplatesPageProps): JSX.Element {
  const { selectedProjectId, selectedProjectName, reportError, reportNotice } = props;

  const [templates, setTemplates] = useState<PromptTemplateSet>(EMPTY_PROMPT_TEMPLATES);
  const [savedTemplates, setSavedTemplates] = useState<PromptTemplateSet>(EMPTY_PROMPT_TEMPLATES);
  const [defaultTemplates, setDefaultTemplates] = useState<PromptTemplateSet>(EMPTY_PROMPT_TEMPLATES);
  const [placeholders, setPlaceholders] = useState<PromptTemplatePlaceholder[]>([]);
  const [showPlaceholderReference, setShowPlaceholderReference] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const hasUnsavedChanges = useMemo(
    () => PROMPT_TEMPLATE_KINDS.some((kind) => templates[kind] !== savedTemplates[kind]),
    [savedTemplates, templates]
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setTemplates(EMPTY_PROMPT_TEMPLATES);
      setSavedTemplates(EMPTY_PROMPT_TEMPLATES);
      setDefaultTemplates(EMPTY_PROMPT_TEMPLATES);
      setPlaceholders([]);
      return;
    }

    let mounted = true;

    const loadTemplates = async (): Promise<void> => {
      try {
        setLoading(true);
        const response = await getPromptTemplates(selectedProjectId);
        if (!mounted) {
          return;
        }

        setTemplates(response.templates);
        setSavedTemplates(response.templates);
        setDefaultTemplates(response.defaults);
        setPlaceholders(response.placeholders);
      } catch (error) {
        if (mounted) {
          reportError(error, "Failed to load prompt templates");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadTemplates();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  function updateTemplate(kind: PromptTemplateKind, value: string): void {
    setTemplates((current) => ({
      ...current,
      [kind]: value
    }));
  }

  function revertUnsaved(): void {
    setTemplates(savedTemplates);
  }

  function resetToDefaults(): void {
    setTemplates(defaultTemplates);
  }

  async function saveTemplates(): Promise<void> {
    if (!selectedProjectId || !hasUnsavedChanges) {
      return;
    }

    try {
      setBusy(true);
      const response = await updatePromptTemplates(selectedProjectId, templates);
      setTemplates(response.templates);
      setSavedTemplates(response.templates);
      reportNotice("Prompt templates saved");
    } catch (error) {
      reportError(error, "Failed to save prompt templates");
    } finally {
      setBusy(false);
    }
  }

  async function copyPlaceholder(token: string): Promise<void> {
    const wrapped = `{{${token}}}`;

    try {
      await navigator.clipboard.writeText(wrapped);
      reportNotice(`Copied placeholder: ${wrapped}`);
    } catch (error) {
      reportError(error, "Failed to copy placeholder");
    }
  }

  if (!selectedProjectId) {
    return (
      <section className="page-section">
        <article className="panel-card">
          <h2>No Project Selected</h2>
          <p className="helper">Select a project on the Projects page to edit prompt templates.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-section">
      <header className="section-head">
        <div>
          <p className="kicker">Prompt Template Editor</p>
          <h2>{selectedProjectName}</h2>
        </div>
        <div className="inline-actions">
          <button
            className="primary button-with-icon"
            disabled={busy || loading || !hasUnsavedChanges}
            onClick={() => void saveTemplates()}
            type="button"
          >
            <AppIcon name="save" />
            Save Templates
          </button>
          <button className="button-with-icon" disabled={busy || loading || !hasUnsavedChanges} onClick={revertUnsaved} type="button">
            <AppIcon name="refresh" />
            Revert Unsaved
          </button>
          <button className="button-with-icon" disabled={busy || loading} onClick={resetToDefaults} type="button">
            <AppIcon name="reset" />
            Reset to Defaults
          </button>
        </div>
      </header>

      {loading && (
        <article className="panel-card">
          <p className="helper">Loading templates...</p>
        </article>
      )}

      <article className="panel-card">
        <div className="section-head">
          <h3>Placeholder Reference</h3>
          <button onClick={() => setShowPlaceholderReference((current) => !current)} type="button">
            {showPlaceholderReference ? "Hide" : "Show"} Placeholders
          </button>
        </div>

        {showPlaceholderReference && (
          <>
            <p className="helper">
              Click a placeholder to copy it. Use values like <code>{"{{item.title}}"}</code> in templates.
            </p>
            <div className="placeholder-grid">
              {placeholders.map((placeholder) => (
                <button
                  className="placeholder-row placeholder-copy"
                  key={placeholder.token}
                  onClick={() => void copyPlaceholder(placeholder.token)}
                  type="button"
                >
                  <code>{`{{${placeholder.token}}}`}</code>
                  <span>{placeholder.description}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {!showPlaceholderReference && (
          <p className="helper">
            Placeholder list is collapsed by default.
          </p>
        )}
      </article>

      <article className="panel-card template-editor-grid">
        {PROMPT_TEMPLATE_KINDS.map((kind) => {
          const dirty = templates[kind] !== savedTemplates[kind];

          return (
            <label key={kind} className="template-editor-field">
              <span className="template-editor-title">{titleize(kind)} Template</span>
              <textarea
                rows={14}
                value={templates[kind]}
                onChange={(event) => updateTemplate(kind, event.target.value)}
              />
              <span className={dirty ? "template-status dirty" : "template-status"}>
                {dirty ? "Unsaved changes" : "Saved"}
              </span>
            </label>
          );
        })}
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
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const navItems = [
    { to: "/issues", label: "Issues" },
    { to: "/projects", label: "Projects" },
    { to: "/categories", label: "Categories" },
    { to: "/prompts", label: "Prompts" },
    { to: "/prompt-templates", label: "Templates" }
  ];

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell-wrap">
      <button
        aria-label="Close menu"
        className={mobileMenuOpen ? "mobile-sidebar-backdrop show" : "mobile-sidebar-backdrop"}
        onClick={() => setMobileMenuOpen(false)}
        type="button"
      />

      <aside className={mobileMenuOpen ? "sidebar mobile-open" : "sidebar"}>
        <div className="brand">
          <div className="brand-head">
            <div className="logo-lockup">
              <BrandMark />
              <div className="brand-copy">
                <p className="kicker">AAM Tracker</p>
                <h1>Issue Prompt Lab</h1>
              </div>
            </div>
            <button
              aria-label="Close menu"
              className="mobile-sidebar-close icon-button"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
            >
              <AppIcon name="close" />
            </button>
          </div>
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
          <button className="button-with-icon" onClick={onLogout} type="button">
            <AppIcon name="logout" />
            Logout
          </button>
        </div>
      </aside>

      <main className="shell-main">
        <header className="topbar">
          <button
            className="mobile-menu-button button-with-icon"
            onClick={() => setMobileMenuOpen(true)}
            type="button"
          >
            <AppIcon name="menu" />
            Menu
          </button>
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
          </div>
        </header>

        {errorMessage && <div className="alert error">{errorMessage}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="route-host">
          <Routes>
            <Route
              path="/projects"
              element={
                <ProjectsListPage
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
              path="/projects/new"
              element={
                <ProjectFormPage
                  projects={projects}
                  refreshWorkspace={refreshWorkspace}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/projects/:projectId/edit"
              element={
                <ProjectFormPage
                  projects={projects}
                  refreshWorkspace={refreshWorkspace}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/categories"
              element={
                <CategoriesListPage
                  categories={categories}
                  refreshWorkspace={async () => refreshWorkspace()}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/categories/new"
              element={
                <CategoryFormPage
                  categories={categories}
                  refreshWorkspace={async () => refreshWorkspace()}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/categories/:categoryId/edit"
              element={
                <CategoryFormPage
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
                  mode="list"
                  selectedProjectId={selectedProjectId}
                  selectedProjectName={selectedProject?.name || "No Project"}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/issues/new"
              element={
                <IssuesPage
                  categories={categories}
                  mode="form"
                  selectedProjectId={selectedProjectId}
                  selectedProjectName={selectedProject?.name || "No Project"}
                  reportError={reportError}
                  reportNotice={reportNotice}
                />
              }
            />
            <Route
              path="/issues/:itemId/edit"
              element={
                <IssuesPage
                  categories={categories}
                  mode="form"
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
            <Route
              path="/prompt-templates"
              element={
                <PromptTemplatesPage
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
    if (error instanceof ApiError && error.status === 401) {
      clearAuthToken();
      setCurrentUser(null);
      resetWorkspaceState();
      return "Session expired. Please sign in again.";
    }

    if (error instanceof ApiError) {
      if (error.issues.length > 0) {
        const issueMessage = error.issues
          .map((issue) => issue.message.trim())
          .filter(Boolean)
          .join(" ");

        if (issueMessage) {
          return issueMessage;
        }
      }

      if (error.message && error.message.toLowerCase() !== "validation failed") {
        return error.message;
      }

      return fallbackMessage;
    }

    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("unauthorized")) {
      clearAuthToken();
      setCurrentUser(null);
      resetWorkspaceState();
      return "Session expired. Please sign in again.";
    }

    if (!message || message.toLowerCase() === "validation failed") {
      return fallbackMessage;
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
          <div className="logo-lockup">
            <BrandMark className="brand-mark brand-mark-lg" />
            <h1>Checking session...</h1>
          </div>
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
