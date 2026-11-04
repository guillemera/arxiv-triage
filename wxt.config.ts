import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { collectPackages, writeNotices } from './scripts/third-party-notices';
import { ORT_FILES } from './src/embedder/model';

const isE2E = process.env.E2E === '1';
/** An e2e build that keeps the real embedding model (to test it in Firefox, where Playwright can't go). */
const realModel = isE2E && process.env.E2E_REAL_MODEL === '1';
const fakeEmbedder = isE2E && !realModel;
/** Packages whose code is in the build, for THIRD_PARTY_NOTICES.txt. */
const bundledPackages = new Set<string>();

export default defineConfig({
  srcDir: 'src',
  outDir: realModel ? 'dist-e2e-real' : isE2E ? 'dist-e2e' : 'dist',
  outDirTemplate: '{{browser}}',
  // The sources zip addons.mozilla.org asks for: what builds the extension, not tests or test output.
  zip: { excludeSources: ['tests/**', 'test-results/**', 'playwright-report/**', 'dist-e2e/**', 'dist-e2e-real/**'] },
  manifestVersion: 3,
  vite: () => ({
    define: { __E2E__: JSON.stringify(isE2E), __FAKE_EMBEDDER__: JSON.stringify(fakeEmbedder) },
    resolve: {
      // transformers.js imports ONNX Runtime's WebGPU build. We only run on the CPU, so use the
      // plain WebAssembly build (a 14 MB binary instead of 27 MB), in its "external wasm" variant:
      // the bundled variants reference the .wasm via import.meta.url, which makes Vite emit a
      // second copy (or inline it as base64 into background.js). We ship it ourselves in /ort/.
      alias: [
        { find: /^onnxruntime-web\/webgpu$/, replacement: resolve('node_modules/onnxruntime-web/dist/ort.wasm.min.mjs') },
      ],
    },
    plugins: [collectPackages(bundledPackages)],
  }),
  manifest: ({ browser }) => ({
    name: 'arXiv Triage',
    description: 'Scores and triages arXiv listings by relevance to you, and learns from your feedback.',
    permissions: ['storage', ...(browser === 'chrome' ? ['offscreen'] : [])],
    host_permissions: ['https://arxiv.org/*', 'https://export.arxiv.org/*', 'https://inspirehep.net/*'],
    // AI second opinion: requested one origin at a time, only when the user connects a provider.
    // The presets are listed for clarity; https://*/* covers a custom server's address.
    optional_host_permissions: [
      'https://api.anthropic.com/*',
      'https://api.deepseek.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.groq.com/*',
      'https://api.mistral.ai/*',
      'https://api.openai.com/*',
      'https://openrouter.ai/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
      'https://*/*',
    ],
    commands: {
      'toggle-overlay': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: 'Switch the arXiv Triage overlay on or off',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Cross-origin isolation gives extension pages SharedArrayBuffer, so the embedding model can
    // run on several threads. Extension pages only load their own files and CORS fetches.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'arxiv-triage@guillemera.github.io',
              strict_min_version: '128.0',
              // Nothing is sent to the extension's author; see the README's privacy notes.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  hooks: {
    // ONNX Runtime's WebAssembly files must ship inside the extension (MV3 forbids remote code).
    'build:publicAssets': (_wxt, files) => {
      if (fakeEmbedder) return;
      for (const f of ORT_FILES) {
        files.push({ absoluteSrc: resolve('node_modules/onnxruntime-web/dist', f), relativeDest: `ort/${f}` });
      }
    },
    // The e2e build also runs on fixture pages served from localhost.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!isE2E) return;
      for (const cs of manifest.content_scripts ?? []) {
        cs.matches = [...(cs.matches ?? []), 'http://localhost/*', 'http://127.0.0.1/*'];
      }
      // Tests talk to fake provider endpoints without the permission prompt.
      manifest.host_permissions = [...(manifest.host_permissions ?? []), 'https://api.anthropic.com/*', 'https://api.openai.com/*'];
    },
    // The licences of the third-party code the build contains (copied ONNX Runtime files included).
    'build:done': (wxt) => {
      const copied = fakeEmbedder ? [] : [resolve('node_modules/onnxruntime-web')];
      writeNotices(wxt.config.outDir, [...bundledPackages, ...copied]);
    },
  },
});
