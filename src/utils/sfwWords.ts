/* Words that mark a name or a description as adult, for the lists of the safe board (e926): public
   sets and pools are named by their makers, and the same names show on both boards, so a safe-only
   list could still read like an adult one. A listing whose name or description holds one of these is
   left out there. Deliberately broad: a few harmless lists left out cost less than the word showing.

   WORDS match whole words only (short ones would hit other words: "cum" in "cumulus"); STEMS match
   the start of a word ("kink" in "Kinktober", "masturbat" in "masturbation"). */

const WORDS = [
  'anal', 'anus', 'ass', 'asses', 'boob', 'boobs', 'cock', 'cocks', 'cum', 'cums', 'dick', 'dicks', 'dildo', 'dildos',
  'futa', 'herm', 'herms', 'horny', 'hump', 'humping', 'knot', 'knots', 'knotted', 'knotting', 'lewd', 'lewds', 'milf',
  'nsfw', 'nude', 'nudes', 'nudity', 'naked', 'r34', 'rape', 'raped', 'scat', 'semen', 'sex', 'sexy', 'slut', 'sluts',
  'tits', 'titty', 'titties', 'vore', 'xxx', 'yiff', 'yiffy', 'gore', 'cub', 'cubs', 'loli', 'shota', 'incest',
  'bdsm', 'bondage', 'breed', 'breeding', 'bred', 'mating', 'musk', 'musky', 'thong', 'thongs', 'panties', 'lingerie',
  'bulge', 'bulges', 'diaper', 'diapers', 'inflation', 'pregnant', 'pregnancy', 'preg', 'lactation', 'lactating',
  'onahole', 'condom', 'condoms', 'stripper', 'strippers', 'striptease', 'whore', 'whores', 'hung', 'thicc', 'butt',
  'butts', 'booty', 'pee', 'piss', 'watersports', 'omorashi', 'internals', 'sissy', 'feet', 'in heat', 'nnn', 'no nut',
  'busty', 'buxom', 'bimbo', 'harem', 'hyper', 'lust', 'lustful', 'lusty',
]
const STEMS = [
  'porn', 'hentai', 'erotic', 'fetish', 'kink', 'fleshlight', 'masturbat', 'ejaculat', 'orgasm', 'penetrat', 'genital',
  'penis', 'vagin', 'pussy', 'pussies', 'clit', 'nipple', 'fellat', 'blowjob', 'handjob', 'footjob', 'rimjob',
  'cunnilingus', 'sperm', 'creampie', 'cumshot', 'cumdump', 'fuck', 'seduc', 'sextoy', 'vibrator', 'rule34',
  'rule 34', 'nsfw', 'bukkake', 'gangbang', 'orgy', 'orgies', 'paizuri', 'ahegao', 'smother', 'vorn', 'throb', 'hypno',
  'cuck', 'breast',
]

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
const PATTERN = new RegExp(`(?:^|[^a-z0-9])(?:(?:${WORDS.map(esc).join('|')})(?![a-z0-9])|(?:${STEMS.map(esc).join('|')}))`, 'i')

/** The text holds a word of the adult list (underscores read as spaces, as in pool names, and joined
    words split where a capital starts one: "DummyThicc" is "Dummy Thicc"). */
export function looksExplicit(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && PATTERN.test(t.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')))
}
