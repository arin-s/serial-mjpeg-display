import { defineConfig , globalIgnores } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from '@stylistic/eslint-plugin'


export default defineConfig([
  {
    files: ["**src/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: globals.browser },
    plugins: { js , tseslint, stylistic },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    jsx: false,
  }),
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  globalIgnores([
    "tmp/*",
    "dist/*",
    "eslint.config.js",
    "vite.config.js"
  ]),
]);