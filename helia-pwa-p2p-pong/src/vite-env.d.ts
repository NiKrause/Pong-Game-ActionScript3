/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_MULTIADDR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
