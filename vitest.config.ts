import * as path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * `src/overleaf/realtimeSync.ts` and its neighbours import the `vscode` module, which only exists
 * inside the extension host. Aliasing it to a mock lets those modules be unit tested; everything
 * that does not import `vscode` is unaffected.
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/mocks/vscode.ts')
    }
  },
  test: {
    include: ['test/**/*.test.ts']
  }
});
