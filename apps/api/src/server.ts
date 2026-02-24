import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { FastifyRequest } from "fastify";
import archiver from "archiver";
import bcrypt from "bcryptjs";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import jwt, { type SignOptions } from "jsonwebtoken";
import yaml from "js-yaml";
import { PrismaClient, type Prisma, type UserRole } from "@prisma/client";
import { z, ZodError } from "zod";
import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_TEMPLATE_KINDS,
  PROMPT_TEMPLATE_PLACEHOLDERS,
  buildItemYamlRecord,
  buildProjectYamlDocument,
  buildPromptText,
  resolvePromptTemplateKind,
  type PromptItemInput,
  type PromptTemplateKind
} from "@aam/shared";
import { env } from "./env.js";

interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AgentAuth {
  keyId: string;
  projectId: string;
}

interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    agentAuth?: AgentAuth;
  }
}

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const itemTypeSchema = z.enum(["issue", "feature"]);
const itemStatusSchema = z.enum(["open", "in_progress", "resolved", "archived"]);
const itemPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
const categoryKindSchema = z.enum(["issue", "feature", "other"]);
const promptTemplateTextSchema = z
  .string()
  .max(20000)
  .transform((value) => value.replace(/\r\n/g, "\n"))
  .refine((value) => value.trim().length > 0, {
    message: "Template cannot be empty"
  });
const promptTemplateSetSchema = z.object({
  issue: promptTemplateTextSchema,
  feature: promptTemplateTextSchema,
  other: promptTemplateTextSchema
});
const agentApiKeyHeaderName = "x-aam-api-key";
const agentApiTokenPrefix = "aam_pk";
const agentApiKeyCreateMaxAttempts = 5;
const agentIssueListLimitDefault = 20;
const agentIssueListLimitMax = 100;
const activityListLimitDefault = 50;
const activityListLimitMax = 200;
const agentResolveStatusSchema = z.enum(["resolved", "archived"]);
const itemActivityTypeSchema = z.enum([
  "ITEM_CREATED",
  "ITEM_UPDATED",
  "IMAGE_UPLOADED",
  "IMAGE_DELETED",
  "IMAGES_REORDERED",
  "RESOLUTION_NOTE",
  "STATUS_CHANGE"
]);
const activityQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(activityListLimitMax)
    .optional()
    .default(activityListLimitDefault),
  cursor: z.string().min(1).optional(),
  type: itemActivityTypeSchema.optional()
});
const queryBooleanSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return value;
}, z.boolean());
const userRoleSchema = z.enum(["ADMIN", "USER"]);

const authTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema
});

const apiModuleDir = path.dirname(fileURLToPath(import.meta.url));
const agentDocsDir = path.resolve(apiModuleDir, "../docs");
const agentDocsFileNames = [
  "agentic-coding.md",
  "agent-api-reference.md",
  "agent-polling-playbook.md"
] as const;

const publicPaths = new Set(["/healthz", "/api/auth/login", "/api/auth/register", "/api/agent/v1/docs.md"]);

function isAdmin(user: AuthUser): boolean {
  return user.role === "ADMIN";
}

function isPublicPath(url: string): boolean {
  const pathname = url.split("?")[0] || "/";
  if (pathname.startsWith("/uploads/")) {
    return true;
  }
  return publicPaths.has(pathname);
}

function isAgentPath(url: string): boolean {
  const pathname = url.split("?")[0] || "/";
  return pathname === "/api/agent/v1" || pathname.startsWith("/api/agent/v1/");
}

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function imagePublicUrl(relativePath: string): string {
  return `/uploads/${normalizeRelativePath(relativePath)}`;
}

function serializeUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

function signAuthToken(user: { id: string; email: string; role: UserRole }): string {
  const signOptions: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"]
  };

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    env.jwtSecret,
    signOptions
  );
}

function parseAuthUserFromRequest(request: FastifyRequest): AuthUser | null {
  const header = request.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    const payload = authTokenPayloadSchema.parse(decoded);

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role
    };
  } catch {
    return null;
  }
}

function parseAgentKeyToken(rawToken: string): { keyId: string; secret: string } | null {
  const token = rawToken.trim();
  if (!token) {
    return null;
  }

  const parts = token.split("_");
  if (parts.length < 4 || parts[0] !== "aam" || parts[1] !== "pk") {
    return null;
  }

  const keyId = parts[2];
  const secret = parts.slice(3).join("_");
  if (!keyId || !secret) {
    return null;
  }

  return { keyId, secret };
}

function extractAgentApiKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers[agentApiKeyHeaderName];
  if (typeof header === "string") {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0] || null;
  }
  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function parseAgentAuthFromRequest(request: FastifyRequest): Promise<AgentAuth | null> {
  const rawHeader = extractAgentApiKeyHeader(request);
  if (!rawHeader) {
    return null;
  }

  const parsed = parseAgentKeyToken(rawHeader);
  if (!parsed) {
    return null;
  }

  const key = await prisma.agentApiKey.findUnique({
    where: { id: parsed.keyId },
    select: {
      id: true,
      projectId: true,
      secretHash: true,
      revokedAt: true,
      lastUsedAt: true
    }
  });

  if (!key || key.revokedAt) {
    return null;
  }

  const validSecret = await bcrypt.compare(parsed.secret, key.secretHash);
  if (!validSecret) {
    return null;
  }

  const now = new Date();
  const refreshWindow = new Date(now.getTime() - 5 * 60 * 1000);
  if (!key.lastUsedAt || key.lastUsedAt < refreshWindow) {
    await prisma.agentApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: now }
    });
  }

  return {
    keyId: key.id,
    projectId: key.projectId
  };
}

function getAuthUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new Error("Auth user is missing from request context");
  }
  return request.authUser;
}

function getAgentAuth(request: FastifyRequest): AgentAuth {
  if (!request.agentAuth) {
    throw new Error("Agent auth is missing from request context");
  }
  return request.agentAuth;
}

type ItemActivityActorInput =
  | { actorType: "USER"; actorUserId: string; agentKeyId?: never }
  | { actorType: "AGENT"; agentKeyId: string; actorUserId?: never };

interface RecordItemActivityInput {
  itemId: string;
  type: z.infer<typeof itemActivityTypeSchema>;
  message: string;
  metadata?: Prisma.InputJsonValue;
  actor: ItemActivityActorInput;
}

function projectAccessWhere(user: AuthUser): Prisma.ProjectWhereInput {
  if (isAdmin(user)) {
    return {};
  }
  return { ownerId: user.id };
}

function itemAccessWhere(user: AuthUser): Prisma.ItemWhereInput {
  if (isAdmin(user)) {
    return {};
  }
  return { project: { ownerId: user.id } };
}

function itemActivityAccessWhere(user: AuthUser): Prisma.ItemActivityWhereInput {
  if (isAdmin(user)) {
    return {};
  }
  return { item: { project: { ownerId: user.id } } };
}

function buildPromptTemplateSet(
  rows: Array<{ kind: PromptTemplateKind; template: string }>
): Record<PromptTemplateKind, string> {
  const templates: Record<PromptTemplateKind, string> = { ...DEFAULT_PROMPT_TEMPLATES };

  for (const row of rows) {
    templates[row.kind] = row.template;
  }

  return templates;
}

async function getProjectPromptTemplateSet(projectId: string): Promise<Record<PromptTemplateKind, string>> {
  const templates = await prisma.promptTemplate.findMany({
    where: { projectId },
    select: {
      kind: true,
      template: true
    }
  });

  return buildPromptTemplateSet(templates);
}

async function ensureProjectAccess(projectId: string, user: AuthUser): Promise<{ id: string; ownerId: string | null; name: string }> {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...projectAccessWhere(user)
    },
    select: {
      id: true,
      ownerId: true,
      name: true
    }
  });

  if (!project) {
    throw new Error("PROJECT_NOT_FOUND");
  }

  return project;
}

function toPromptInput(item: {
  id: string;
  type: "issue" | "feature";
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "archived";
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  project: { name: string };
  category: { name: string; kind: "issue" | "feature" | "other" } | null;
  images: Array<{ relativePath: string; filename: string }>;
}): PromptItemInput {
  return {
    id: item.id,
    projectName: item.project.name,
    categoryName: item.category?.name ?? null,
    categoryKind: item.category?.kind ?? null,
    type: item.type,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    attachments: item.images.map((image) => ({
      path: `images/${normalizeRelativePath(image.relativePath)}`,
      label: image.filename
    })),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

const itemWithRelationsInclude = {
  project: true,
  category: true,
  images: {
    orderBy: { sortOrder: "asc" as const }
  }
} satisfies Prisma.ItemInclude;

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: typeof itemWithRelationsInclude;
}>;

const itemActivityWithRelationsInclude = {
  actorUser: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  agentKey: {
    select: {
      id: true,
      name: true,
      prefix: true
    }
  },
  item: {
    select: {
      id: true,
      title: true,
      type: true,
      projectId: true
    }
  }
} satisfies Prisma.ItemActivityInclude;

type ItemActivityWithRelations = Prisma.ItemActivityGetPayload<{
  include: typeof itemActivityWithRelationsInclude;
}>;

function toAgentIssueImageUrl(issueId: string, imageId: string): string {
  return `/api/agent/v1/issues/${issueId}/images/${imageId}`;
}

function encodeAgentIssuesCursor(item: { updatedAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: item.updatedAt.toISOString(),
      id: item.id
    }),
    "utf8"
  ).toString("base64url");
}

function decodeAgentIssuesCursor(cursor: string): { updatedAt: Date; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      updatedAt?: string;
      id?: string;
    };
    if (!decoded.updatedAt || !decoded.id) {
      return null;
    }

    const parsedDate = new Date(decoded.updatedAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return {
      updatedAt: parsedDate,
      id: decoded.id
    };
  } catch {
    return null;
  }
}

function encodeActivityCursor(activity: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: activity.createdAt.toISOString(),
      id: activity.id
    }),
    "utf8"
  ).toString("base64url");
}

function decodeActivityCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: string;
    };
    if (!decoded.createdAt || !decoded.id) {
      return null;
    }

    const parsedDate = new Date(decoded.createdAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return {
      createdAt: parsedDate,
      id: decoded.id
    };
  } catch {
    return null;
  }
}

function parseIsoDate(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function generateAgentKeySecret(): string {
  return randomBytes(24).toString("hex");
}

function generateAgentKeyPrefix(): string {
  return randomBytes(6).toString("hex");
}

function buildAgentApiKeyToken(keyId: string, secret: string): string {
  return `${agentApiTokenPrefix}_${keyId}_${secret}`;
}

async function buildAgentImagePayload(
  issueId: string,
  image: ItemWithRelations["images"][number],
  includeInline: boolean
): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
  inline?: { dataBase64: string; mimeType: string; sizeBytes: number };
  inlineSkippedReason?: string;
}> {
  const payload = {
    id: image.id,
    filename: image.filename,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    createdAt: image.createdAt.toISOString(),
    url: toAgentIssueImageUrl(issueId, image.id)
  };

  if (!includeInline) {
    return payload;
  }

  if (image.sizeBytes > env.agentInlineImageMaxBytes) {
    return {
      ...payload,
      inlineSkippedReason: "too_large"
    };
  }

  const imagePath = path.join(env.uploadDir, image.relativePath);
  if (!(await fileExists(imagePath))) {
    return {
      ...payload,
      inlineSkippedReason: "missing_file"
    };
  }

  try {
    const data = await fs.readFile(imagePath);
    return {
      ...payload,
      inline: {
        dataBase64: data.toString("base64"),
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes
      }
    };
  } catch {
    return {
      ...payload,
      inlineSkippedReason: "read_error"
    };
  }
}

async function buildAgentIssuePayload(
  item: ItemWithRelations,
  options: {
    includePrompts: boolean;
    includeImagesInline: boolean;
    templates?: Record<PromptTemplateKind, string>;
  }
) {
  const images = await Promise.all(
    item.images.map((image) => buildAgentImagePayload(item.id, image, options.includeImagesInline))
  );

  const payload = {
    id: item.id,
    projectId: item.projectId,
    categoryId: item.categoryId,
    type: item.type,
    title: item.title,
    description: item.description,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    category: item.category
      ? {
          id: item.category.id,
          name: item.category.name,
          kind: item.category.kind
        }
      : null,
    images
  };

  if (!options.includePrompts) {
    return payload;
  }

  const promptInput = toPromptInput(item);
  const templateKind = resolvePromptTemplateKind(promptInput);
  const template =
    options.templates?.[templateKind] ??
    (await prisma.promptTemplate.findUnique({
      where: {
        projectId_kind: {
          projectId: item.projectId,
          kind: templateKind
        }
      },
      select: { template: true }
    }))?.template;
  const promptText = buildPromptText(promptInput, template);
  const promptYaml = buildItemYamlRecord(promptInput, {
    templateKind,
    template,
    promptText
  });

  return {
    ...payload,
    prompt: {
      templateKind,
      text: promptText,
      yaml: promptYaml
    }
  };
}

function userActivityActor(user: AuthUser): ItemActivityActorInput {
  return {
    actorType: "USER",
    actorUserId: user.id
  };
}

function agentActivityActor(agentAuth: AgentAuth): ItemActivityActorInput {
  return {
    actorType: "AGENT",
    agentKeyId: agentAuth.keyId
  };
}

async function recordItemActivity(
  tx: Prisma.TransactionClient,
  input: RecordItemActivityInput
): Promise<void> {
  await tx.itemActivity.create({
    data: {
      itemId: input.itemId,
      actorType: input.actor.actorType,
      actorUserId: input.actor.actorType === "USER" ? input.actor.actorUserId : null,
      agentKeyId: input.actor.actorType === "AGENT" ? input.actor.agentKeyId : null,
      type: input.type,
      message: input.message,
      metadata: input.metadata
    }
  });
}

function serializeItemActivity(activity: ItemActivityWithRelations) {
  const actor =
    activity.actorType === "USER"
      ? {
          kind: "user" as const,
          userId: activity.actorUser?.id || null,
          email: activity.actorUser?.email || null,
          displayName: activity.actorUser?.displayName || null
        }
      : {
          kind: "agent" as const,
          keyId: activity.agentKey?.id || null,
          name: activity.agentKey?.name || null,
          prefix: activity.agentKey?.prefix || null
        };

  return {
    id: activity.id,
    itemId: activity.itemId,
    type: activity.type,
    actorType: activity.actorType,
    message: activity.message,
    metadata: activity.metadata,
    createdAt: activity.createdAt.toISOString(),
    actor,
    item: {
      id: activity.item.id,
      title: activity.item.title,
      type: activity.item.type,
      projectId: activity.item.projectId
    }
  };
}

function buildActivityWhere(input: {
  projectId?: string;
  itemId?: string;
  type?: z.infer<typeof itemActivityTypeSchema>;
  since?: Date;
  cursor?: { createdAt: Date; id: string } | null;
  accessWhere?: Prisma.ItemActivityWhereInput;
}): Prisma.ItemActivityWhereInput {
  const whereClauses: Prisma.ItemActivityWhereInput[] = [];

  if (input.accessWhere && Object.keys(input.accessWhere).length > 0) {
    whereClauses.push(input.accessWhere);
  }

  if (input.projectId) {
    whereClauses.push({
      item: {
        projectId: input.projectId
      }
    });
  }

  if (input.itemId) {
    whereClauses.push({
      itemId: input.itemId
    });
  }

  if (input.type) {
    whereClauses.push({
      type: input.type
    });
  }

  if (input.since) {
    whereClauses.push({
      createdAt: { gte: input.since }
    });
  }

  if (input.cursor) {
    whereClauses.push({
      OR: [
        { createdAt: { lt: input.cursor.createdAt } },
        {
          createdAt: input.cursor.createdAt,
          id: { lt: input.cursor.id }
        }
      ]
    });
  }

  if (whereClauses.length === 0) {
    return {};
  }

  if (whereClauses.length === 1) {
    return whereClauses[0];
  }

  return { AND: whereClauses };
}

interface ItemUpdateSnapshot {
  projectId: string;
  categoryId: string | null;
  type: "issue" | "feature";
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "archived";
  priority: "low" | "medium" | "high" | "critical";
  tags: string[];
}

function toMetadataJsonValue(value: string | string[] | null): Prisma.JsonValue | null {
  return value;
}

function summarizeItemFieldChanges(
  previous: ItemUpdateSnapshot,
  next: ItemUpdateSnapshot
): Array<{
  field: keyof ItemUpdateSnapshot;
  from: Prisma.JsonValue | null;
  to: Prisma.JsonValue | null;
}> {
  const changes: Array<{
    field: keyof ItemUpdateSnapshot;
    from: Prisma.JsonValue | null;
    to: Prisma.JsonValue | null;
  }> = [];

  const scalarFields: Array<keyof ItemUpdateSnapshot> = [
    "projectId",
    "categoryId",
    "type",
    "title",
    "description",
    "status",
    "priority"
  ];

  for (const field of scalarFields) {
    if (previous[field] !== next[field]) {
      changes.push({
        field,
        from: toMetadataJsonValue(previous[field]),
        to: toMetadataJsonValue(next[field])
      });
    }
  }

  if (JSON.stringify(previous.tags) !== JSON.stringify(next.tags)) {
    changes.push({
      field: "tags",
      from: toMetadataJsonValue(previous.tags),
      to: toMetadataJsonValue(next.tags)
    });
  }

  return changes;
}

async function loadAgentDocsMarkdown(): Promise<string> {
  const sections = await Promise.all(
    agentDocsFileNames.map(async (fileName) => {
      const filePath = path.join(agentDocsDir, fileName);
      const content = await fs.readFile(filePath, "utf8");
      return content.trim();
    })
  );

  return sections.filter(Boolean).join("\n\n---\n\n");
}

async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(env.uploadDir, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureAdminUser(): Promise<void> {
  const adminEmail = env.adminEmail.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  let adminUser: { id: string; email: string };

  if (existing) {
    const updates: { role?: UserRole; displayName?: string | null } = {};

    if (existing.role !== "ADMIN") {
      updates.role = "ADMIN";
    }

    if (!existing.displayName && env.adminName) {
      updates.displayName = env.adminName;
    }

    if (Object.keys(updates).length > 0) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: updates,
        select: {
          id: true,
          email: true
        }
      });
      adminUser = updated;
    } else {
      adminUser = {
        id: existing.id,
        email: existing.email
      };
    }
  } else {
    const passwordHash = await bcrypt.hash(env.adminPassword, 10);
    const created = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        displayName: env.adminName,
        role: "ADMIN"
      },
      select: {
        id: true,
        email: true
      }
    });
    adminUser = created;
    app.log.info(
      { email: adminEmail },
      "Created default admin user. Update ADMIN_PASSWORD in your environment for production."
    );
  }

  // Backfill pre-auth rows to ensure existing data is visible under the admin account.
  const [projectBackfill, itemBackfill] = await prisma.$transaction([
    prisma.project.updateMany({
      where: { ownerId: null },
      data: { ownerId: adminUser.id }
    }),
    prisma.item.updateMany({
      where: { ownerId: null },
      data: { ownerId: adminUser.id }
    })
  ]);

  if (projectBackfill.count > 0 || itemBackfill.count > 0) {
    app.log.info(
      {
        reassignedProjects: projectBackfill.count,
        reassignedItems: itemBackfill.count,
        adminEmail: adminUser.email
      },
      "Backfilled legacy records to admin ownership"
    );
  }
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Validation failed",
      issues: error.issues
    });
  }

  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;

  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return reply.status(statusCode).send({
      message: error instanceof Error ? error.message : "Request failed"
    });
  }

  request.log.error(error);

  if (!reply.sent) {
    reply.status(500).send({ message: "Unexpected server error" });
  }
});

app.get("/healthz", async () => ({ ok: true }));

app.get("/api/agent/v1/docs.md", async (request, reply) => {
  try {
    const markdown = await loadAgentDocsMarkdown();
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(markdown);
  } catch (error) {
    request.log.error(error, "Failed to load agent API docs markdown");
    return reply.status(500).send({ message: "Failed to load agent API docs markdown" });
  }
});

await ensureUploadDir();

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"), false);
  },
  credentials: true
});

await app.register(multipart, {
  limits: {
    fileSize: env.maxUploadBytes,
    files: 12
  }
});

await app.register(fastifyStatic, {
  root: env.uploadDir,
  prefix: "/uploads/",
  decorateReply: false
});

app.addHook("preHandler", async (request, reply) => {
  if (request.method === "OPTIONS") {
    return;
  }

  if (isPublicPath(request.url)) {
    return;
  }

  if (isAgentPath(request.url)) {
    const agentAuth = await parseAgentAuthFromRequest(request);
    if (!agentAuth) {
      return reply.status(401).send({ message: "Unauthorized" });
    }
    request.agentAuth = agentAuth;
    return;
  }

  const authUser = parseAuthUserFromRequest(request);
  if (!authUser) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  request.authUser = authUser;
});

app.post("/api/auth/register", async (request, reply) => {
  const body = z
    .object({
      email: z.string().email(),
      password: z.string().min(8).max(128),
      displayName: z.string().min(1).max(120).optional().nullable()
    })
    .parse(request.body);

  const normalizedEmail = body.email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true }
  });

  if (exists) {
    return reply.status(409).send({ message: "A user with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      displayName: body.displayName?.trim() || null,
      role: "USER"
    }
  });

  const token = signAuthToken({ id: user.id, email: user.email, role: user.role });
  return reply.status(201).send({ token, user: serializeUser(user) });
});

app.post("/api/auth/login", async (request, reply) => {
  const body = z
    .object({
      email: z.string().email(),
      password: z.string().min(1)
    })
    .parse(request.body);

  const normalizedEmail = body.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    return reply.status(401).send({ message: "Invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordMatches) {
    return reply.status(401).send({ message: "Invalid email or password" });
  }

  const token = signAuthToken({ id: user.id, email: user.email, role: user.role });
  return { token, user: serializeUser(user) };
});

app.get("/api/auth/me", async (request, reply) => {
  const authUser = getAuthUser(request);

  const user = await prisma.user.findUnique({
    where: { id: authUser.id }
  });

  if (!user) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  return { user: serializeUser(user) };
});

app.get("/api/projects", async (request) => {
  const authUser = getAuthUser(request);

  return prisma.project.findMany({
    where: projectAccessWhere(authUser),
    orderBy: { updatedAt: "desc" }
  });
});

app.post("/api/projects", async (request, reply) => {
  const authUser = getAuthUser(request);
  const body = z
    .object({
      name: z.string().min(1).max(120),
      description: z.string().max(1000).optional().nullable()
    })
    .parse(request.body);

  const project = await prisma.project.create({
    data: {
      ownerId: authUser.id,
      name: body.name.trim(),
      description: body.description?.trim() || null
    }
  });

  return reply.status(201).send(project);
});

app.patch("/api/projects/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(1000).optional().nullable()
    })
    .parse(request.body);

  const existing = await prisma.project.findFirst({
    where: {
      id: params.id,
      ...projectAccessWhere(authUser)
    },
    select: { id: true }
  });

  if (!existing) {
    return reply.status(404).send({ message: "Project not found" });
  }

  return prisma.project.update({
    where: { id: params.id },
    data: {
      name: body.name?.trim(),
      description:
        body.description === undefined ? undefined : body.description?.trim() || null
    }
  });
});

app.delete("/api/projects/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const project = await prisma.project.findFirst({
    where: {
      id: params.id,
      ...projectAccessWhere(authUser)
    },
    select: { id: true }
  });

  if (!project) {
    return reply.status(404).send({ message: "Project not found" });
  }

  const linkedItemsCount = await prisma.item.count({
    where: { projectId: params.id }
  });

  if (linkedItemsCount > 0) {
    return reply.status(409).send({
      message: "Cannot delete project with linked items. Remove items first."
    });
  }

  await prisma.project.delete({ where: { id: params.id } });
  return reply.status(204).send();
});

app.post("/api/projects/:projectId/agent-keys", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      name: z.string().min(1).max(120)
    })
    .parse(request.body);

  try {
    await ensureProjectAccess(params.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  let created:
    | {
        id: string;
        name: string;
        prefix: string;
        createdAt: Date;
      }
    | null = null;
  let secretForToken = "";

  for (let attempt = 0; attempt < agentApiKeyCreateMaxAttempts; attempt += 1) {
    const secret = generateAgentKeySecret();
    const prefix = generateAgentKeyPrefix();
    const secretHash = await bcrypt.hash(secret, 10);

    try {
      created = await prisma.agentApiKey.create({
        data: {
          projectId: params.projectId,
          createdByUserId: authUser.id,
          name: body.name.trim(),
          prefix,
          secretHash
        },
        select: {
          id: true,
          name: true,
          prefix: true,
          createdAt: true
        }
      });
      secretForToken = secret;
      break;
    } catch (error) {
      const canRetry = attempt < agentApiKeyCreateMaxAttempts - 1;
      if (canRetry && isUniqueConstraintError(error)) {
        continue;
      }
      throw error;
    }
  }

  if (!created) {
    return reply.status(500).send({ message: "Failed to create API key" });
  }

  return reply.status(201).send({
    keyId: created.id,
    name: created.name,
    prefix: created.prefix,
    token: buildAgentApiKeyToken(created.id, secretForToken),
    createdAt: created.createdAt.toISOString()
  });
});

app.get("/api/projects/:projectId/agent-keys", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

  try {
    await ensureProjectAccess(params.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  const keys = await prisma.agentApiKey.findMany({
    where: {
      projectId: params.projectId
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true
    }
  });

  return keys.map((key) => ({
    keyId: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() || null,
    revokedAt: key.revokedAt?.toISOString() || null
  }));
});

app.delete("/api/projects/:projectId/agent-keys/:keyId", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z
    .object({
      projectId: z.string().min(1),
      keyId: z.string().min(1)
    })
    .parse(request.params);

  try {
    await ensureProjectAccess(params.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  const key = await prisma.agentApiKey.findFirst({
    where: {
      id: params.keyId,
      projectId: params.projectId
    },
    select: {
      id: true,
      revokedAt: true
    }
  });

  if (!key) {
    return reply.status(404).send({ message: "API key not found" });
  }

  if (!key.revokedAt) {
    await prisma.agentApiKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() }
    });
  }

  return reply.status(204).send();
});

app.get("/api/categories", async () => {
  return prisma.category.findMany({
    orderBy: { name: "asc" }
  });
});

app.post("/api/categories", async (request, reply) => {
  const body = z
    .object({
      name: z.string().min(1).max(80),
      kind: categoryKindSchema.optional().default("other")
    })
    .parse(request.body);

  const category = await prisma.category.create({
    data: {
      name: body.name.trim(),
      kind: body.kind
    }
  });

  return reply.status(201).send(category);
});

app.patch("/api/categories/:id", async (request, reply) => {
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      name: z.string().min(1).max(80).optional(),
      kind: categoryKindSchema.optional()
    })
    .parse(request.body);

  const category = await prisma.category.findUnique({
    where: { id: params.id },
    select: { id: true }
  });

  if (!category) {
    return reply.status(404).send({ message: "Category not found" });
  }

  return prisma.category.update({
    where: { id: params.id },
    data: {
      name: body.name?.trim(),
      kind: body.kind
    }
  });
});

app.delete("/api/categories/:id", async (request, reply) => {
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const category = await prisma.category.findUnique({
    where: { id: params.id },
    select: { id: true }
  });

  if (!category) {
    return reply.status(404).send({ message: "Category not found" });
  }

  const linkedItemsCount = await prisma.item.count({
    where: { categoryId: params.id }
  });

  if (linkedItemsCount > 0) {
    return reply.status(409).send({
      message: "Cannot delete category currently used by items."
    });
  }

  await prisma.category.delete({ where: { id: params.id } });
  return reply.status(204).send();
});

app.get("/api/items", async (request) => {
  const authUser = getAuthUser(request);
  const query = z
    .object({
      projectId: z.string().min(1).optional(),
      type: itemTypeSchema.optional(),
      status: itemStatusSchema.optional(),
      priority: itemPrioritySchema.optional(),
      categoryId: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      search: z.string().min(1).optional()
    })
    .parse(request.query);

  const items = await prisma.item.findMany({
    where: {
      projectId: query.projectId,
      type: query.type,
      status: query.status,
      priority: query.priority,
      categoryId: query.categoryId,
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {}),
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return items.map((item) => ({
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
  }));
});

app.post("/api/items", async (request, reply) => {
  const authUser = getAuthUser(request);
  const body = z
    .object({
      projectId: z.string().min(1),
      categoryId: z.string().min(1),
      type: itemTypeSchema,
      title: z.string().max(200).optional().default(""),
      description: z.string().max(8000).optional().default(""),
      status: itemStatusSchema.optional().default("open"),
      priority: itemPrioritySchema.optional().default("medium"),
      tags: z.array(z.string().min(1).max(40)).optional().default([])
    })
    .parse(request.body);

  let project: { id: string; ownerId: string | null; name: string };
  try {
    project = await ensureProjectAccess(body.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  const category = await prisma.category.findUnique({
    where: { id: body.categoryId },
    select: { id: true }
  });

  if (!category) {
    return reply.status(400).send({
      message: "Validation failed",
      issues: [{ path: ["categoryId"], message: "Category does not exist" }]
    });
  }

  const actor = userActivityActor(authUser);
  const trimmedTags = body.tags.map((tag) => tag.trim()).filter(Boolean);
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        ownerId: project.ownerId ?? authUser.id,
        projectId: body.projectId,
        categoryId: body.categoryId,
        type: body.type,
        title: body.title.trim(),
        description: body.description.trim(),
        status: body.status,
        priority: body.priority,
        tags: trimmedTags
      },
      include: {
        project: true,
        category: true,
        images: {
          orderBy: { sortOrder: "asc" }
        }
      }
    });

    await recordItemActivity(tx, {
      itemId: created.id,
      actor,
      type: "ITEM_CREATED",
      message: "Item created",
      metadata: {
        type: created.type,
        status: created.status,
        priority: created.priority
      }
    });

    return created;
  });

  return reply.status(201).send({
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
  });
});

app.get("/api/items/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
  };
});

app.patch("/api/items/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      projectId: z.string().min(1).optional(),
      categoryId: z.string().min(1).optional(),
      type: itemTypeSchema.optional(),
      title: z.string().max(200).optional(),
      description: z.string().max(8000).optional(),
      status: itemStatusSchema.optional(),
      priority: itemPrioritySchema.optional(),
      tags: z.array(z.string().min(1).max(40)).optional()
    })
    .parse(request.body);

  const existing = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    select: {
      id: true,
      projectId: true,
      ownerId: true,
      categoryId: true,
      type: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      tags: true
    }
  });

  if (!existing) {
    return reply.status(404).send({ message: "Item not found" });
  }

  let nextOwnerId: string | undefined;
  if (body.projectId) {
    try {
      const project = await ensureProjectAccess(body.projectId, authUser);
      nextOwnerId = project.ownerId ?? authUser.id;
    } catch {
      return reply.status(404).send({ message: "Target project not found" });
    }
  }

  if (body.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
      select: { id: true }
    });

    if (!category) {
      return reply.status(400).send({
        message: "Validation failed",
        issues: [{ path: ["categoryId"], message: "Category does not exist" }]
      });
    }
  }

  const actor = userActivityActor(authUser);
  const nextTags = body.tags?.map((tag) => tag.trim()).filter(Boolean);

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id: params.id },
      data: {
        ownerId: nextOwnerId,
        projectId: body.projectId,
        categoryId: body.categoryId,
        type: body.type,
        title: body.title?.trim(),
        description: body.description?.trim(),
        status: body.status,
        priority: body.priority,
        tags: nextTags
      },
      include: {
        project: true,
        category: true,
        images: {
          orderBy: { sortOrder: "asc" }
        }
      }
    });

    const previousSnapshot: ItemUpdateSnapshot = {
      projectId: existing.projectId,
      categoryId: existing.categoryId,
      type: existing.type,
      title: existing.title,
      description: existing.description,
      status: existing.status,
      priority: existing.priority,
      tags: existing.tags
    };
    const nextSnapshot: ItemUpdateSnapshot = {
      projectId: updated.projectId,
      categoryId: updated.categoryId,
      type: updated.type,
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      tags: updated.tags
    };
    const changes = summarizeItemFieldChanges(previousSnapshot, nextSnapshot);

    if (changes.length > 0) {
      const statusChange = changes.find((change) => change.field === "status");

      if (statusChange) {
        await recordItemActivity(tx, {
          itemId: updated.id,
          actor,
          type: "STATUS_CHANGE",
          message: `Status changed from ${statusChange.from} to ${statusChange.to}`,
          metadata: {
            from: statusChange.from,
            to: statusChange.to
          }
        });
      }

      const nonStatusChanges = changes.filter((change) => change.field !== "status");
      if (nonStatusChanges.length > 0) {
        await recordItemActivity(tx, {
          itemId: updated.id,
          actor,
          type: "ITEM_UPDATED",
          message: `Updated fields: ${nonStatusChanges.map((change) => change.field).join(", ")}`,
          metadata: {
            fields: nonStatusChanges
          }
        });
      }
    }

    return updated;
  });

  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
  };
});

app.patch("/api/items/:id/status", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      status: itemStatusSchema
    })
    .parse(request.body);

  const existing = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!existing) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const actor = userActivityActor(authUser);
  const item = await prisma.$transaction(async (tx) => {
    let updated: ItemWithRelations;

    if (existing.status === body.status) {
      const found = await tx.item.findUnique({
        where: { id: existing.id },
        include: itemWithRelationsInclude
      });
      if (!found) {
        throw new Error("Item not found");
      }
      updated = found;
    } else {
      updated = await tx.item.update({
        where: { id: params.id },
        data: {
          status: body.status
        },
        include: itemWithRelationsInclude
      });

      await recordItemActivity(tx, {
        itemId: updated.id,
        actor,
        type: "STATUS_CHANGE",
        message: `Status changed from ${existing.status} to ${body.status}`,
        metadata: {
          from: existing.status,
          to: body.status
        }
      });
    }

    return updated;
  });

  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
  };
});

app.get("/api/items/:id/activities", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const query = activityQuerySchema.parse(request.query);
  const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;

  if (query.cursor && !cursor) {
    return reply.status(400).send({ message: "Invalid cursor" });
  }

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    select: { id: true }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const where = buildActivityWhere({
    itemId: params.id,
    type: query.type,
    cursor,
    accessWhere: itemActivityAccessWhere(authUser)
  });

  const rows = await prisma.itemActivity.findMany({
    where,
    include: itemActivityWithRelationsInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1
  });

  const hasNext = rows.length > query.limit;
  const pageRows = hasNext ? rows.slice(0, query.limit) : rows;

  return {
    itemId: params.id,
    activities: pageRows.map(serializeItemActivity),
    page: {
      limit: query.limit,
      nextCursor:
        hasNext && pageRows.length > 0 ? encodeActivityCursor(pageRows[pageRows.length - 1]) : null
    }
  };
});

app.get("/api/activities", async (request, reply) => {
  const authUser = getAuthUser(request);
  const query = z
    .object({
      projectId: z.string().min(1),
      itemId: z.string().min(1).optional(),
      since: z.string().min(1).optional()
    })
    .merge(activityQuerySchema)
    .parse(request.query);

  const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;
  if (query.cursor && !cursor) {
    return reply.status(400).send({ message: "Invalid cursor" });
  }

  const since = query.since ? parseIsoDate(query.since) : null;
  if (query.since && !since) {
    return reply.status(400).send({ message: "Invalid since date" });
  }

  try {
    await ensureProjectAccess(query.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  const where = buildActivityWhere({
    projectId: query.projectId,
    itemId: query.itemId,
    type: query.type,
    since: since || undefined,
    cursor,
    accessWhere: itemActivityAccessWhere(authUser)
  });

  const rows = await prisma.itemActivity.findMany({
    where,
    include: itemActivityWithRelationsInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1
  });

  const hasNext = rows.length > query.limit;
  const pageRows = hasNext ? rows.slice(0, query.limit) : rows;

  return {
    projectId: query.projectId,
    activities: pageRows.map(serializeItemActivity),
    page: {
      limit: query.limit,
      nextCursor:
        hasNext && pageRows.length > 0 ? encodeActivityCursor(pageRows[pageRows.length - 1]) : null
    }
  };
});

app.delete("/api/items/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    include: {
      images: true
    }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  await prisma.item.delete({ where: { id: params.id } });

  await Promise.all(
    item.images.map(async (image) => {
      const filePath = path.join(env.uploadDir, image.relativePath);
      await fs.rm(filePath, { force: true });
    })
  );

  return reply.status(204).send();
});

app.post("/api/items/:id/images", async (request, reply) => {
  const authUser = getAuthUser(request);
  const actor = userActivityActor(authUser);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    select: {
      id: true
    }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const existingCount = await prisma.itemImage.count({
    where: { itemId: item.id }
  });

  const uploadedImages = [] as Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    relativePath: string;
    sortOrder: number;
    url: string;
  }>;

  let sortOrder = existingCount;
  const parts = request.parts();

  for await (const part of parts) {
    if (part.type !== "file") {
      continue;
    }

    if (!part.mimetype.startsWith("image/")) {
      return reply.status(400).send({ message: "Only image uploads are allowed" });
    }

    const originalName = part.filename || "upload";
    const sanitized = sanitizeFilename(originalName) || "image";
    const extension = path.extname(sanitized);
    const base = extension ? sanitized.slice(0, -extension.length) : sanitized;
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${
      extension || ".png"
    }`;

    const relativePath = normalizeRelativePath(path.join(item.id, uniqueName));
    const absolutePath = path.join(env.uploadDir, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await pipeline(part.file, createWriteStream(absolutePath));

    const stats = await fs.stat(absolutePath);

    const image = await prisma.itemImage.create({
      data: {
        itemId: item.id,
        filename: originalName,
        mimeType: part.mimetype,
        sizeBytes: stats.size,
        relativePath,
        sortOrder
      }
    });

    uploadedImages.push({
      id: image.id,
      filename: image.filename,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      relativePath: image.relativePath,
      sortOrder: image.sortOrder,
      url: imagePublicUrl(image.relativePath)
    });

    sortOrder += 1;
  }

  if (uploadedImages.length === 0) {
    return reply.status(400).send({ message: "No image files were uploaded" });
  }

  await prisma.itemActivity.create({
    data: {
      itemId: item.id,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      type: "IMAGE_UPLOADED",
      message: `Uploaded ${uploadedImages.length} image(s)`,
      metadata: {
        count: uploadedImages.length,
        imageIds: uploadedImages.map((image) => image.id),
        filenames: uploadedImages.map((image) => image.filename)
      }
    }
  });

  return reply.status(201).send(uploadedImages);
});

app.delete("/api/items/:id/images/:imageId", async (request, reply) => {
  const authUser = getAuthUser(request);
  const actor = userActivityActor(authUser);
  const params = z
    .object({
      id: z.string().min(1),
      imageId: z.string().min(1)
    })
    .parse(request.params);

  const image = await prisma.itemImage.findFirst({
    where: {
      id: params.imageId,
      itemId: params.id,
      ...(isAdmin(authUser) ? {} : { item: { project: { ownerId: authUser.id } } })
    }
  });

  if (!image) {
    return reply.status(404).send({ message: "Image not found" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.itemImage.delete({ where: { id: image.id } });
    await recordItemActivity(tx, {
      itemId: image.itemId,
      actor,
      type: "IMAGE_DELETED",
      message: `Removed image ${image.filename}`,
      metadata: {
        imageId: image.id,
        filename: image.filename
      }
    });
  });
  await fs.rm(path.join(env.uploadDir, image.relativePath), { force: true });

  return reply.status(204).send();
});

app.patch("/api/items/:id/images/reorder", async (request, reply) => {
  const authUser = getAuthUser(request);
  const actor = userActivityActor(authUser);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      imageIds: z.array(z.string().min(1)).min(1)
    })
    .parse(request.body);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    select: { id: true }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const images = await prisma.itemImage.findMany({
    where: {
      itemId: params.id
    },
    select: { id: true }
  });

  if (images.length !== body.imageIds.length) {
    return reply.status(400).send({
      message: "Reorder payload must contain every image id for the item"
    });
  }

  const knownIds = new Set(images.map((image) => image.id));
  for (const imageId of body.imageIds) {
    if (!knownIds.has(imageId)) {
      return reply.status(400).send({ message: `Unknown image id: ${imageId}` });
    }
  }

  await prisma.$transaction(async (tx) => {
    await Promise.all(
      body.imageIds.map((imageId, index) =>
        tx.itemImage.update({
          where: { id: imageId },
          data: { sortOrder: index }
        })
      )
    );

    await recordItemActivity(tx, {
      itemId: item.id,
      actor,
      type: "IMAGES_REORDERED",
      message: "Reordered item screenshots",
      metadata: {
        imageIds: body.imageIds
      }
    });
  });

  return reply.status(204).send();
});

app.get("/api/prompt-templates/:projectId", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

  try {
    await ensureProjectAccess(params.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  const templates = await getProjectPromptTemplateSet(params.projectId);

  return {
    projectId: params.projectId,
    templates,
    defaults: DEFAULT_PROMPT_TEMPLATES,
    placeholders: PROMPT_TEMPLATE_PLACEHOLDERS
  };
});

app.put("/api/prompt-templates/:projectId", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      templates: promptTemplateSetSchema
    })
    .parse(request.body);

  try {
    await ensureProjectAccess(params.projectId, authUser);
  } catch {
    return reply.status(404).send({ message: "Project not found" });
  }

  await prisma.$transaction(
    PROMPT_TEMPLATE_KINDS.map((kind) =>
      prisma.promptTemplate.upsert({
        where: {
          projectId_kind: {
            projectId: params.projectId,
            kind
          }
        },
        update: {
          template: body.templates[kind]
        },
        create: {
          projectId: params.projectId,
          kind,
          template: body.templates[kind]
        }
      })
    )
  );

  return reply.send({
    projectId: params.projectId,
    templates: body.templates
  });
});

app.post("/api/prompts/item/:id", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const promptInput = toPromptInput(item);
  const templateKind = resolvePromptTemplateKind(promptInput);
  const template = await prisma.promptTemplate.findUnique({
    where: {
      projectId_kind: {
        projectId: item.projectId,
        kind: templateKind
      }
    },
    select: {
      template: true
    }
  });

  const text = buildPromptText(promptInput, template?.template);
  const yamlRecord = buildItemYamlRecord(promptInput, {
    templateKind,
    template: template?.template,
    promptText: text
  });

  return {
    text,
    yaml: yamlRecord
  };
});

app.post("/api/prompts/project/:projectId", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
  const query = z
    .object({
      type: itemTypeSchema.optional()
    })
    .parse(request.query);

  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      ...projectAccessWhere(authUser)
    }
  });

  if (!project) {
    return reply.status(404).send({ message: "Project not found" });
  }

  const items = await prisma.item.findMany({
    where: {
      projectId: project.id,
      type: query.type,
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const projectTemplates = await getProjectPromptTemplateSet(project.id);
  const yamlItems = items.map((item) => {
    const promptInput = toPromptInput(item);
    const templateKind = resolvePromptTemplateKind(promptInput);
    const template = projectTemplates[templateKind];
    const promptText = buildPromptText(promptInput, template);

    return buildItemYamlRecord(promptInput, {
      templateKind,
      template,
      promptText
    });
  });

  return {
    yaml: buildProjectYamlDocument({
      projectName: project.name,
      generatedAt: new Date().toISOString(),
      items: yamlItems,
      warnings: []
    })
  };
});

app.get("/api/exports/item/:id.zip", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  if (!item) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const warnings: string[] = [];
  const promptInput = toPromptInput(item);
  const templateKind = resolvePromptTemplateKind(promptInput);
  const template = await prisma.promptTemplate.findUnique({
    where: {
      projectId_kind: {
        projectId: item.projectId,
        kind: templateKind
      }
    },
    select: {
      template: true
    }
  });
  const promptText = buildPromptText(promptInput, template?.template);
  const yamlRecord = buildItemYamlRecord(promptInput, {
    templateKind,
    template: template?.template,
    promptText
  });

  const payload = {
    version: 1,
    generated_at: new Date().toISOString(),
    project: {
      id: item.projectId,
      name: item.project.name
    },
    warnings,
    item: yamlRecord
  };

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (error: Error) => {
    request.log.error(error);
    if (!reply.sent) {
      reply.code(500).send({ message: "Failed to stream export archive" });
    }
  });

  for (const image of item.images) {
    const sourcePath = path.join(env.uploadDir, image.relativePath);
    const targetPath = `images/${normalizeRelativePath(image.relativePath)}`;

    if (await fileExists(sourcePath)) {
      archive.file(sourcePath, { name: targetPath });
    } else {
      warnings.push(`Missing file for image ${image.id}: ${targetPath}`);
    }
  }

  archive.append(yaml.dump(payload, { noRefs: true, lineWidth: -1 }), {
    name: "prompt.yaml"
  });

  reply.header("Content-Type", "application/zip");
  reply.header(
    "Content-Disposition",
    `attachment; filename="item-${item.id}-prompt.zip"`
  );

  void archive.finalize();
  return reply.send(archive);
});

app.get("/api/exports/project/:projectId.zip", async (request, reply) => {
  const authUser = getAuthUser(request);
  const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
  const query = z
    .object({
      type: itemTypeSchema.optional()
    })
    .parse(request.query);

  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      ...projectAccessWhere(authUser)
    }
  });

  if (!project) {
    return reply.status(404).send({ message: "Project not found" });
  }

  const items = await prisma.item.findMany({
    where: {
      projectId: project.id,
      type: query.type,
      ...itemAccessWhere(authUser)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const warnings: string[] = [];
  const projectTemplates = await getProjectPromptTemplateSet(project.id);
  const yamlItems = items.map((item) => {
    const promptInput = toPromptInput(item);
    const templateKind = resolvePromptTemplateKind(promptInput);
    const template = projectTemplates[templateKind];
    const promptText = buildPromptText(promptInput, template);

    return buildItemYamlRecord(promptInput, {
      templateKind,
      template,
      promptText
    });
  });

  const payload = buildProjectYamlDocument({
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    items: yamlItems,
    warnings
  });

  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (error: Error) => {
    request.log.error(error);
    if (!reply.sent) {
      reply.code(500).send({ message: "Failed to stream export archive" });
    }
  });

  for (const item of items) {
    for (const image of item.images) {
      const sourcePath = path.join(env.uploadDir, image.relativePath);
      const targetPath = `images/${normalizeRelativePath(image.relativePath)}`;

      if (await fileExists(sourcePath)) {
        archive.file(sourcePath, { name: targetPath });
      } else {
        warnings.push(`Missing file for image ${image.id}: ${targetPath}`);
      }
    }
  }

  archive.append(yaml.dump(payload, { noRefs: true, lineWidth: -1 }), {
    name: "prompts.yaml"
  });

  reply.header("Content-Type", "application/zip");
  reply.header(
    "Content-Disposition",
    `attachment; filename="project-${project.id}-prompts.zip"`
  );

  void archive.finalize();
  return reply.send(archive);
});

app.get("/api/agent/v1/activities", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const query = z
    .object({
      itemId: z.string().min(1).optional(),
      since: z.string().min(1).optional()
    })
    .merge(activityQuerySchema)
    .parse(request.query);

  const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;
  if (query.cursor && !cursor) {
    return reply.status(400).send({ message: "Invalid cursor" });
  }

  const since = query.since ? parseIsoDate(query.since) : null;
  if (query.since && !since) {
    return reply.status(400).send({ message: "Invalid since date" });
  }

  const where = buildActivityWhere({
    projectId: agentAuth.projectId,
    itemId: query.itemId,
    type: query.type,
    since: since || undefined,
    cursor
  });

  const rows = await prisma.itemActivity.findMany({
    where,
    include: itemActivityWithRelationsInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1
  });

  const hasNext = rows.length > query.limit;
  const pageRows = hasNext ? rows.slice(0, query.limit) : rows;

  return {
    projectId: agentAuth.projectId,
    activities: pageRows.map(serializeItemActivity),
    page: {
      limit: query.limit,
      nextCursor:
        hasNext && pageRows.length > 0 ? encodeActivityCursor(pageRows[pageRows.length - 1]) : null
    }
  };
});

app.get("/api/agent/v1/project", async (request, reply) => {
  const agentAuth = getAgentAuth(request);

  const project = await prisma.project.findUnique({
    where: { id: agentAuth.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!project) {
    return reply.status(404).send({ message: "Project not found" });
  }

  const [categories, templates] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" }
    }),
    getProjectPromptTemplateSet(project.id)
  ]);

  return {
    project: {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString()
    },
    categories,
    promptTemplates: {
      templates,
      defaults: DEFAULT_PROMPT_TEMPLATES,
      placeholders: PROMPT_TEMPLATE_PLACEHOLDERS
    }
  };
});

app.get("/api/agent/v1/issues", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const query = z
    .object({
      type: itemTypeSchema.optional(),
      status: itemStatusSchema.optional(),
      priority: itemPrioritySchema.optional(),
      categoryId: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      search: z.string().min(1).optional(),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(agentIssueListLimitMax)
        .optional()
        .default(agentIssueListLimitDefault),
      cursor: z.string().min(1).optional(),
      includePrompts: queryBooleanSchema.optional().default(true),
      includeImagesInline: queryBooleanSchema.optional().default(false)
    })
    .parse(request.query);

  const cursor = query.cursor ? decodeAgentIssuesCursor(query.cursor) : null;
  if (query.cursor && !cursor) {
    return reply.status(400).send({ message: "Invalid cursor" });
  }

  const whereClauses: Prisma.ItemWhereInput[] = [
    {
      projectId: agentAuth.projectId,
      type: query.type,
      status: query.status,
      priority: query.priority,
      categoryId: query.categoryId
    }
  ];

  if (query.tag) {
    whereClauses.push({ tags: { has: query.tag } });
  }

  if (query.search) {
    whereClauses.push({
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } }
      ]
    });
  }

  if (cursor) {
    whereClauses.push({
      OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        {
          updatedAt: cursor.updatedAt,
          id: { lt: cursor.id }
        }
      ]
    });
  }

  const where: Prisma.ItemWhereInput =
    whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

  const rows = await prisma.item.findMany({
    where,
    include: itemWithRelationsInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1
  });

  const hasNext = rows.length > query.limit;
  const pageItems = hasNext ? rows.slice(0, query.limit) : rows;
  const templates = query.includePrompts
    ? await getProjectPromptTemplateSet(agentAuth.projectId)
    : undefined;

  const issues = await Promise.all(
    pageItems.map((item) =>
      buildAgentIssuePayload(item, {
        includePrompts: query.includePrompts,
        includeImagesInline: query.includeImagesInline,
        templates
      })
    )
  );

  return {
    projectId: agentAuth.projectId,
    issues,
    page: {
      limit: query.limit,
      nextCursor:
        hasNext && pageItems.length > 0
          ? encodeAgentIssuesCursor(pageItems[pageItems.length - 1])
          : null
    }
  };
});

app.get("/api/agent/v1/issues/:id", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const query = z
    .object({
      includePrompts: queryBooleanSchema.optional().default(true),
      includeImagesInline: queryBooleanSchema.optional().default(false)
    })
    .parse(request.query);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      projectId: agentAuth.projectId
    },
    include: itemWithRelationsInclude
  });

  if (!item) {
    return reply.status(404).send({ message: "Issue not found" });
  }

  const templates = query.includePrompts
    ? await getProjectPromptTemplateSet(agentAuth.projectId)
    : undefined;

  const issue = await buildAgentIssuePayload(item, {
    includePrompts: query.includePrompts,
    includeImagesInline: query.includeImagesInline,
    templates
  });

  return { issue };
});

app.get("/api/agent/v1/issues/:id/work-context", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const query = z
    .object({
      includeImagesInline: queryBooleanSchema.optional().default(false)
    })
    .parse(request.query);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      projectId: agentAuth.projectId
    },
    include: itemWithRelationsInclude
  });

  if (!item) {
    return reply.status(404).send({ message: "Issue not found" });
  }

  const templates = await getProjectPromptTemplateSet(agentAuth.projectId);
  const issue = await buildAgentIssuePayload(item, {
    includePrompts: true,
    includeImagesInline: query.includeImagesInline,
    templates
  });

  return {
    issue,
    preActionChecklist: {
      required: [
        "Read issue.prompt.text",
        "Read issue.prompt.yaml",
        "Download and review every entry in issue.images before implementing or resolving"
      ],
      imageCount: issue.images.length
    }
  };
});

app.get("/api/agent/v1/issues/:id/activities", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const query = activityQuerySchema.parse(request.query);
  const cursor = query.cursor ? decodeActivityCursor(query.cursor) : null;

  if (query.cursor && !cursor) {
    return reply.status(400).send({ message: "Invalid cursor" });
  }

  const issue = await prisma.item.findFirst({
    where: {
      id: params.id,
      projectId: agentAuth.projectId
    },
    select: { id: true }
  });

  if (!issue) {
    return reply.status(404).send({ message: "Issue not found" });
  }

  const where = buildActivityWhere({
    projectId: agentAuth.projectId,
    itemId: params.id,
    type: query.type,
    cursor
  });

  const rows = await prisma.itemActivity.findMany({
    where,
    include: itemActivityWithRelationsInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1
  });

  const hasNext = rows.length > query.limit;
  const pageRows = hasNext ? rows.slice(0, query.limit) : rows;

  return {
    issueId: params.id,
    activities: pageRows.map(serializeItemActivity),
    page: {
      limit: query.limit,
      nextCursor:
        hasNext && pageRows.length > 0 ? encodeActivityCursor(pageRows[pageRows.length - 1]) : null
    }
  };
});

app.get("/api/agent/v1/issues/:id/prompt", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);

  const item = await prisma.item.findFirst({
    where: {
      id: params.id,
      projectId: agentAuth.projectId
    },
    include: itemWithRelationsInclude
  });

  if (!item) {
    return reply.status(404).send({ message: "Issue not found" });
  }

  const templates = await getProjectPromptTemplateSet(agentAuth.projectId);
  const promptInput = toPromptInput(item);
  const templateKind = resolvePromptTemplateKind(promptInput);
  const template = templates[templateKind];
  const text = buildPromptText(promptInput, template);
  const yamlRecord = buildItemYamlRecord(promptInput, {
    templateKind,
    template,
    promptText: text
  });

  return {
    issueId: item.id,
    templateKind,
    text,
    yaml: yamlRecord
  };
});

app.get("/api/agent/v1/issues/:issueId/images/:imageId", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z
    .object({
      issueId: z.string().min(1),
      imageId: z.string().min(1)
    })
    .parse(request.params);

  const image = await prisma.itemImage.findFirst({
    where: {
      id: params.imageId,
      itemId: params.issueId,
      item: {
        projectId: agentAuth.projectId
      }
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      relativePath: true
    }
  });

  if (!image) {
    return reply.status(404).send({ message: "Image not found" });
  }

  const imagePath = path.join(env.uploadDir, image.relativePath);
  if (!(await fileExists(imagePath))) {
    return reply.status(404).send({ message: "Image file missing" });
  }

  reply.header("Content-Type", image.mimeType);
  reply.header(
    "Content-Disposition",
    `inline; filename="${sanitizeFilename(image.filename) || "image"}"`
  );
  return reply.send(createReadStream(imagePath));
});

app.post("/api/agent/v1/issues/:id/resolve", async (request, reply) => {
  const agentAuth = getAgentAuth(request);
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z
    .object({
      status: agentResolveStatusSchema,
      resolutionNote: z
        .string()
        .max(4000)
        .transform((value) => value.trim())
        .refine((value) => value.length > 0, {
          message: "Resolution note is required"
        })
    })
    .parse(request.body);

  const existing = await prisma.item.findFirst({
    where: {
      id: params.id,
      projectId: agentAuth.projectId
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!existing) {
    return reply.status(404).send({ message: "Issue not found" });
  }

  const statusChanged = existing.status !== body.status;
  const actor = agentActivityActor(agentAuth);
  const transactionResult = await prisma.$transaction(async (tx) => {
    let item: ItemWithRelations;

    if (statusChanged) {
      item = await tx.item.update({
        where: { id: existing.id },
        data: {
          status: body.status
        },
        include: itemWithRelationsInclude
      });

      await recordItemActivity(tx, {
        itemId: existing.id,
        actor,
        type: "STATUS_CHANGE",
        message: `Status changed from ${existing.status} to ${body.status}`,
        metadata: {
          from: existing.status,
          to: body.status
        }
      });
    } else {
      const found = await tx.item.findUnique({
        where: { id: existing.id },
        include: itemWithRelationsInclude
      });
      if (!found) {
        throw new Error("Issue not found");
      }
      item = found;
    }

    const resolutionActivity = await tx.itemActivity.create({
      data: {
        itemId: existing.id,
        actorType: actor.actorType,
        agentKeyId: actor.agentKeyId,
        type: "RESOLUTION_NOTE",
        message: body.resolutionNote
      }
    });

    return {
      item,
      resolutionActivity
    };
  });

  const templates = await getProjectPromptTemplateSet(agentAuth.projectId);
  const issue = await buildAgentIssuePayload(transactionResult.item, {
    includePrompts: true,
    includeImagesInline: false,
    templates
  });

  return {
    issue,
    statusChanged,
    resolution: {
      id: transactionResult.resolutionActivity.id,
      message: transactionResult.resolutionActivity.message,
      createdAt: transactionResult.resolutionActivity.createdAt.toISOString()
    }
  };
});

const start = async (): Promise<void> => {
  try {
    await ensureAdminUser();
    await app.listen({ port: env.port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of shutdownSignals) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await start();
