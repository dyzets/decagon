// electron-vite resolves `?asset` imports to a runtime file path (copied into out/).
declare module "*?asset" {
  const src: string;
  export default src;
}

// Renderer (Vite) image imports resolve to a served URL.
declare module "*.png" {
  const src: string;
  export default src;
}
