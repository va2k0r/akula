/**
 * Resolves files copied from public/ against Vite's configured deployment
 * base. Local development remains rooted at /, while GitHub Pages uses
 * /akula/ without breaking models, textures, Draco decoders, or audio.
 */
export function publicAssetPath(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, "")}`;
}
