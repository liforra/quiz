// Loads the env files. This has to be its own module, imported *first* by
// server/index.js: ES module bodies are evaluated before the importing
// module's own statements, so any sibling module that reads process.env at
// import time (server/authentik.js) would otherwise see an empty environment.

// GROQ_API_KEY and the Authentik client secret are real secrets, unlike the
// Firebase client config in the (git-tracked) .env — they belong in
// .env.local, which .gitignore already excludes via the `*.local` pattern.
try {
  process.loadEnvFile?.(new URL('../.env.local', import.meta.url));
} catch {
  // .env.local is optional — AI features and SSO just stay disabled without it.
}

// .env holds the *public* Firebase client config, which Vite bundles into the
// frontend. The Authentik login needs two of those values server-side too
// (project id + VITE_APP_ID, the Firestore data root), so load it as well.
// Values already set by .env.local / the real environment win.
try {
  process.loadEnvFile?.(new URL('../.env', import.meta.url));
} catch {
  // optional
}
