import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

export default tseslint.config(
  {
    ignores: [
      "**/.nuxt/**",
      "**/.output/**",
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.node },
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        ecmaVersion: "latest",
        parser: tseslint.parser,
        sourceType: "module",
      },
    },
    rules: { "no-undef": "off" },
  },
  {
    files: ["apps/webs/app/pages/**/*.vue"],
    rules: { "vue/multi-word-component-names": "off" },
  },
  {
    files: ["**/*.vue"],
    rules: {
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
);
