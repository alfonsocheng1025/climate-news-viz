import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

let appPromise: Promise<any> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
}

// Vercel Node serverless handler (CommonJS export after esbuild bundling).
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const app = await getApp();
    return (app as (req: IncomingMessage, res: ServerResponse) => void)(
      req,
      res,
    );
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "handler_init_failed",
        message: String(err?.message || err),
      }),
    );
  }
}
