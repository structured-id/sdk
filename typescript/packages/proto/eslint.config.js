import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "src/generated/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Methods that implement an interface keep its parameters even when
      // they refuse the call; such parameters are named with a leading `_`.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
