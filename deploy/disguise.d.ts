// Types for deploy/disguise.js (plain JavaScript, run by nginx), as the dev server uses it.
declare const disguise: {
  manifestFor(kind: string, query: string): Record<string, unknown> | null
  pageFor(template: string, kind: string, query: string): string | null
  manifest(r: unknown): void
  page(r: unknown): void
}
export default disguise
