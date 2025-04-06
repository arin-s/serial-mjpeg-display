import { defineConfig , globalIgnores } from "eslint/config";
import globals from "globals";
import js from "@eslint/js";
import tseslint from "typescript-eslint";


export default defineConfig([
  /*{
    files: ["**src/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: globals.browser },
    plugins: { js },
  },*/
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
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