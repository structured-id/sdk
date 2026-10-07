import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // tsup's declaration build sets `baseUrl` itself, which TypeScript 6
  // deprecates; the project's own tsconfig sets no deprecated option.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
});
