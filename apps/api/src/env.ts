import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const apiRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRootDir = path.resolve(apiRootDir, "../..");

const envCandidates = [
  path.resolve(apiRootDir, ".env"),
  path.resolve(workspaceRootDir, ".env")
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

const schema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  PORT: z.coerce.number().optional().default(4000),
  DATABASE_URL: z.string().min(1),
  UPLOAD_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().optional().default(8),
  AGENT_INLINE_IMAGE_MAX_BYTES: z.coerce.number().optional().default(262144),
  CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
  JWT_SECRET: z.string().optional().default("change-me-in-production"),
  JWT_EXPIRES_IN: z.string().optional().default("7d"),
  ADMIN_EMAIL: z.string().email().optional().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(8).optional().default("Admin123!"),
  ADMIN_NAME: z.string().min(1).optional().default("Admin")
});

const parsed = schema.parse(process.env);
const defaultUploadDir = parsed.NODE_ENV === "production" ? "/data/uploads" : "./uploads";
const uploadDir = resolveUploadDir(parsed.UPLOAD_DIR || defaultUploadDir);

function resolveUploadDir(rawUploadDir: string): string {
  if (path.isAbsolute(rawUploadDir)) {
    return rawUploadDir;
  }

  const normalized = rawUploadDir.replace(/\\/g, "/").replace(/^\.\//, "");

  // Backward compatibility: older env files used "./apps/api/uploads" from workspace root.
  if (normalized.startsWith("apps/api/")) {
    return path.resolve(workspaceRootDir, normalized);
  }

  return path.resolve(apiRootDir, rawUploadDir);
}

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  uploadDir,
  maxUploadBytes: parsed.MAX_UPLOAD_MB * 1024 * 1024,
  agentInlineImageMaxBytes: parsed.AGENT_INLINE_IMAGE_MAX_BYTES,
  corsOrigins: parsed.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  jwtSecret: parsed.JWT_SECRET,
  jwtExpiresIn: parsed.JWT_EXPIRES_IN,
  adminEmail: parsed.ADMIN_EMAIL.toLowerCase(),
  adminPassword: parsed.ADMIN_PASSWORD,
  adminName: parsed.ADMIN_NAME
};
