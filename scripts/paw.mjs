// The pawbs mark on its 512 grid, for the build scripts (make-icons.mjs: icons and the social
// preview; site-pages.mjs: the static pages' title bar). src/components/PawMark.vue draws the same
// shapes (each toe in its own group there, for its closing animation): change both together.

/** The paw: a main pad and four toes. */
export const PAW = `<path d="M256 248c-30 0-52 22-70 46c-16 22-30 36-30 56c0 22 18 34 40 34c22 0 38-10 60-10s38 10 60 10c22 0 40-12 40-34c0-20-14-34-30-56c-18-24-40-46-70-46z"/>
    <ellipse cx="218" cy="176" rx="28" ry="38"/>
    <ellipse cx="294" cy="176" rx="28" ry="38"/>
    <ellipse cx="160" cy="236" rx="25" ry="33" transform="rotate(-24 160 236)"/>
    <ellipse cx="352" cy="236" rx="25" ry="33" transform="rotate(24 352 236)"/>`

/** The corner brackets of the app icon. */
export const BRACKETS = 'M104 104V150M104 104H150M408 104H362M408 104V150M104 408V362M104 408H150M408 408H362M408 408V362'
