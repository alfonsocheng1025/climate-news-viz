import "dotenv/config";
import { createServer } from "node:http";
import { createApp, log } from "./app";
import { serveStatic } from "./static";

// Standalone long-running server (used by the Computer deployment via
// `node dist/index.cjs` and by `npm run dev`). NOT used on Vercel — there the
// serverless handler in api/[...path].ts imports createApp() directly.
(async () => {
  const app = await createApp();
  const httpServer = createServer(app);

  // Serve the built client (production) or wire up Vite (development).
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
