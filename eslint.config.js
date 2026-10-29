import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", ".wrangler/", "docs/"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    rules: {
      // 사용자 입력은 textContent 로만 넣는다.
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "textContent 를 쓰세요." },
        { property: "outerHTML", message: "textContent 를 쓰세요." },
        { property: "insertAdjacentHTML", message: "textContent 를 쓰세요." },
      ],
      "no-restricted-globals": ["error", "eval"],
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.js", "*.ts", "test/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // page.evaluate 안의 코드는 브라우저에서 실행된다.
    files: ["scripts/screenshots.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
