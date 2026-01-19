/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_TON_CONNECT_MANIFEST_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

