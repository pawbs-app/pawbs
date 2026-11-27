// The installed beta app's own name. beta.pawbs.app runs the very image the main site runs (a release
// promotes that image as it is), so the build cannot know which address it will serve: it writes a
// second manifest, and nginx sends it to an address starting with "beta." (deploy/nginx.conf). Installed
// side by side, the two apps are then told apart by name: "pawbs beta".
import { readFileSync, writeFileSync } from 'node:fs'

const DIST = new URL('../dist/', import.meta.url)
const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', DIST), 'utf8'))
m.name = `${m.name} beta`
m.short_name = `${m.short_name} beta`
writeFileSync(new URL('manifest-beta.webmanifest', DIST), JSON.stringify(m))
console.log(`dist/manifest-beta.webmanifest: ${m.name}`)
