import path from "node:path";
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
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
const userRoleSchema = z.enum(["ADMIN", "USER"]);

const authTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  role: userRoleSchema
});

const publicPaths = new Set(["/healthz", "/api/auth/login", "/api/auth/register"]);

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

function getAuthUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new Error("Auth user is missing from request context");
  }
  return request.authUser;
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

  request.log.error(error);

  if (!reply.sent) {
    reply.status(500).send({ message: "Unexpected server error" });
  }
});

app.get("/healthz", async () => ({ ok: true }));

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

  const item = await prisma.item.create({
    data: {
      ownerId: project.ownerId ?? authUser.id,
      projectId: body.projectId,
      categoryId: body.categoryId,
      type: body.type,
      title: body.title.trim(),
      description: body.description.trim(),
      status: body.status,
      priority: body.priority,
      tags: body.tags.map((tag) => tag.trim()).filter(Boolean)
    },
    include: {
      project: true,
      category: true,
      images: true
    }
  });

  return reply.status(201).send(item);
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
      ownerId: true
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

  return prisma.item.update({
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
      tags: body.tags?.map((tag) => tag.trim()).filter(Boolean)
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    }
  });
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
    select: { id: true }
  });

  if (!existing) {
    return reply.status(404).send({ message: "Item not found" });
  }

  const item = await prisma.item.update({
    where: { id: params.id },
    data: {
      status: body.status
    },
    include: {
      project: true,
      category: true,
      images: {
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  return {
    ...item,
    images: item.images.map((image) => ({
      ...image,
      url: imagePublicUrl(image.relativePath)
    }))
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

  return reply.status(201).send(uploadedImages);
});

app.delete("/api/items/:id/images/:imageId", async (request, reply) => {
  const authUser = getAuthUser(request);
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

  await prisma.itemImage.delete({ where: { id: image.id } });
  await fs.rm(path.join(env.uploadDir, image.relativePath), { force: true });

  return reply.status(204).send();
});

app.patch("/api/items/:id/images/reorder", async (request, reply) => {
  const authUser = getAuthUser(request);
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

  await prisma.$transaction(
    body.imageIds.map((imageId, index) =>
      prisma.itemImage.update({
        where: { id: imageId },
        data: { sortOrder: index }
      })
    )
  );

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
