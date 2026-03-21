import path from "path";
import { fileURLToPath } from "url";
import nextEnv from "@next/env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Monorepo: pick up NEXT_PUBLIC_* (and other vars) from repo-root .env — Next only reads frontend/ by default.
nextEnv.loadEnvConfig(path.join(__dirname, ".."));

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
