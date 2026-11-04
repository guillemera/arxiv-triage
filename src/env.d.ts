/** True in the end-to-end test builds (`E2E=1`), which also run on localhost. */
declare const __E2E__: boolean;
/** True when the e2e build uses a tiny stand-in for the embedding model (unless `E2E_REAL_MODEL=1`). */
declare const __FAKE_EMBEDDER__: boolean;
