import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/** HTML is only ever built by src/render/h.ts, which escapes and sanitizes everything. */
const noHandBuiltHtml = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "TemplateElement[value.raw=/<[a-zA-Z!]/]",
      message: "Build HTML with h() from src/render/h.ts so values are escaped.",
    },
    {
      selector: "Literal[value=/<[a-zA-Z][a-zA-Z0-9]*[ >]/]",
      message: "Build HTML with h() from src/render/h.ts so values are escaped.",
    },
  ],
};

export default defineConfig(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },
  { files: ["src/**/*.ts"], ignores: ["src/render/h.ts"], rules: noHandBuiltHtml },
);
