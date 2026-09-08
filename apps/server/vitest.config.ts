import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import * as ts from 'typescript';

/**
 * NestJS resolves constructor dependencies via `design:type` emitDecoratorMetadata.
 * esbuild (used by Vite/Vitest by default) emits `__decorate` but never `design:type`
 * metadata, so DI injects `undefined` for gateway/service deps and tests blow up.
 *
 * This pre-transform runs the TypeScript compiler over every `.ts` source file,
 * which honors `emitDecoratorMetadata`. The emitted ESM is then handed back to Vite.
 */
function decoratorMetadata() {
  return {
    name: 'qcardwars:decorator-metadata',
    enforce: 'pre' as const,
    transform(code, id) {
      if (id.includes('node_modules')) {
        return null;
      }
      // Match .ts/.mts/.cts/.tsx (but not .d.ts); Vite ids are absolute paths with dots.
      if (!/\.[cm]?tsx?$/.test(id) || /\.d\.ts$/.test(id)) {
        return null;
      }
      const output = ts.transpileModule(code, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          // Preserve `import type` elision and avoid helper duplication.
          verbatimModuleSyntax: false,
          importHelpers: false,
        },
        fileName: id,
        // Surface diagnostics so a bad file fails loudly instead of silently.
        reportDiagnostics: true,
      });
      const diagnostics = (output.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
      );
      if (diagnostics.length) {
        const message = diagnostics
          .map((d) => ts.formatDiagnostic(d, { writeLine: () => '' }))
          .join('\n');
        throw new Error(`[decorator-metadata] TypeScript error in ${id}:\n${message}`);
      }
      return { code: output.outputText, map: null };
    },
  };
}

// Read the server tsconfig so test runs match the real `emitDecoratorMetadata` baseline.
const tsconfig = JSON.parse(
  readFileSync(join(process.cwd(), 'tsconfig.json'), 'utf8'),
).compilerOptions ?? {};

export default defineConfig({
  plugins: [decoratorMetadata()],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
  esbuild: {
    // The TS pre-transform already emits metadata; keep esbuild off the TS transform
    // so it does not clobber `design:type` with its metadata-free output.
    target: tsconfig.target ?? 'es2022',
  },
});
