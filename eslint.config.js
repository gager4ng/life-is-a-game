import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // The engine is pure and deterministic: no I/O, no wall clock, no Math.random.
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["node:*", "fs", "path", "os", "child_process"] },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the world RNG (rng.ts)." },
        { object: "Date", property: "now", message: "Use the world clock (time.ts)." },
        { object: "performance", property: "now", message: "Use the world clock (time.ts)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Wall-clock time breaks determinism. Use the world clock.",
        },
      ],
      "no-restricted-globals": ["error", "console", "process", "setTimeout", "setInterval"],
    },
  },
  {
    files: ["apps/**/*.ts", "**/*.config.{js,ts}", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/web/src/**/*.ts", "apps/web/e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
