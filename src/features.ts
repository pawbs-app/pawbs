/** Saving post files (the gallery's Download, saving many posts, Settings › Saving): only in a build
    made with VITE_DOWNLOADS=on. */
export const DOWNLOADS = import.meta.env.VITE_DOWNLOADS === 'on'

/** The beta channel: the same build served at an address starting with "beta." (beta.pawbs.app),
    where changes are tried before they reach the main site. Its storage is that address's own. */
export const BETA = typeof location !== 'undefined' && location.hostname.startsWith('beta.')

/** The commit this build was made from (set by CI), or '' for a local build. */
export const BUILD_REF: string = __BUILD_REF__
