import type { TestProject } from "vitest/node";
import { reset, targetUrl } from "../scripts/local-db.mjs";

export default async function setup(project: TestProject) {
  let url: string;
  if (process.env.DB_RESET === "0") {
    const u = new URL(targetUrl());
    if (process.env.SUPABASE_LOCAL !== "1") u.pathname = `/${process.env.MASKINID_DB ?? "maskinid"}`;
    url = u.toString();
  } else {
    url = await reset({ quiet: true });
  }
  project.provide("dbUrl", url);
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
