import { globalIgnores } from "eslint/config";
import globals from "globals";
import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  globalIgnores([
    "public/sw.js",
    ".turbo/**",
    ".vercel/**",
    "node_modules.old/**",
  ]),
  {
    files: ["scripts/**/*.{js,mjs,ts}", "set-password.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
