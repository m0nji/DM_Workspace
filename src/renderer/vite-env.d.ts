/// <reference types="vite/client" />

// Static assets imported by the renderer resolve to their bundled URL.
declare module '*.svg' {
  const src: string;
  export default src;
}
