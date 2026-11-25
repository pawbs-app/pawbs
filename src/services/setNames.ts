/* Short names of sets (what `set:<shortname>` searches use): the site wants 3 to 50 characters of
   lower-case letters, digits and underscores, with at least one letter. */
export const SHORTNAME_RULE = /^(?=.*[a-z])[a-z0-9_]{3,50}$/

/** A short name made from a set's name: "My Favourite Foxes!" → "my_favourite_foxes". */
export function shortnameFor(name: string): string {
  let s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
  if (!/[a-z]/.test(s)) s = `set_${s}`.slice(0, 50)
  if (s.length < 3) s = `${s}_set`.replace(/^_+/, '').padEnd(3, '_')
  return s
}
