/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vue" />

declare const __APP_VERSION__: string
declare const __BUILD_REF__: string

interface ImportMetaEnv {
  readonly VITE_DOWNLOADS?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
