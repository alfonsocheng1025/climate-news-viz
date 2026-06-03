/**
 * Pre-bundle the Vercel serverless function into a single self-contained CJS
 * file at api-dist/index.js. This sidesteps Vercel's Node File Trace, which
 * mis-resolves our ESM + TS server modules. Everything (express, gdelt, routes)
 * is inlined so the function has zero runtime module-resolution needs.
 */
import { build as esbuild } from "esbuild";

async function buildApi() {
  await esbuild({
    entryPoints: ["server/serverless.ts"],
    platform: "node",
    target: "node20",
    bundle: true,
    format: "esm",
    outfile: "api/index.js",
    // esbuild ESM banner to polyfill require/__dirname for any CJS deps inlined.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    // better-sqlite3 is a native module never reached by the API path; mark it
    // external so esbuild doesn't try to bundle the .node binary.
    external: ["better-sqlite3"],
    logLevel: "info",
  });

  console.log("✓ api/index.js built");
}

buildApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
