import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "sources/**", "docs/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: [] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports; use named exports." },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // Tool configs must default-export.
    files: ["**/vitest.config.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
