import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env")
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

const schema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  PORT: z.coerce.number().optional().default(4000),
  DATABASE_URL: z.string().min(1),
  UPLOAD_DIR: z.string().optional().default("./uploads"),
  MAX_UPLOAD_MB: z.coerce.number().optional().default(8),
  CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
  JWT_SECRET: z.string().optional().default("change-me-in-production"),
  JWT_EXPIRES_IN: z.string().optional().default("7d"),
  ADMIN_EMAIL: z.string().email().optional().default("admin@example.com"),
  ADMIN_PASSWORD: z.string().min(8).optional().default("Admin123!"),
  ADMIN_NAME: z.string().min(1).optional().default("Admin")
});

const parsed = schema.parse(process.env);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  uploadDir: path.isAbsolute(parsed.UPLOAD_DIR)
    ? parsed.UPLOAD_DIR
    : path.resolve(process.cwd(), parsed.UPLOAD_DIR),
  maxUploadBytes: parsed.MAX_UPLOAD_MB * 1024 * 1024,
  corsOrigins: parsed.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  jwtSecret: parsed.JWT_SECRET,
  jwtExpiresIn: parsed.JWT_EXPIRES_IN,
  adminEmail: parsed.ADMIN_EMAIL.toLowerCase(),
  adminPassword: parsed.ADMIN_PASSWORD,
  adminName: parsed.ADMIN_NAME
};
