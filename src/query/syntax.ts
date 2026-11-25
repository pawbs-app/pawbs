/* Reading and writing search strings. A query is a list of tokens; the text the person types and
   the query assistant are two views of the same list, so neither loses what the other set. */
import { MAX_TAGS, META_BY_KEY, METATAGS, type MetaTag } from './metatags'

export type Prefix = '' | '-' | '~'

export interface Token {
  /** The text as written (normalised spacing). */
  raw: string
  prefix: Prefix
  kind: 'tag' | 'meta' | 'open' | 'close'
  /** Tag name (lowercase) or metatag key (canonical). */
  name: string
  /** Metatag value. */
  value: string
  meta: MetaTag | null
  wildcard: boolean
}

export function makeToken(raw: string): Token {
  let prefix: Prefix = ''
  let body = raw
  if (body === '(' || body === ')') {
    return { raw: body, prefix: '', kind: body === '(' ? 'open' : 'close', name: body, value: '', meta: null, wildcard: false }
  }
  if (body.length > 1 && (body[0] === '-' || body[0] === '~')) {
    prefix = body[0] as Prefix
    body = body.slice(1)
  }
  if (body === '(') {
    return { raw, prefix, kind: 'open', name: '(', value: '', meta: null, wildcard: false }
  }
  const colon = body.indexOf(':')
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase()
    const meta = META_BY_KEY.get(key)
    if (meta) {
      const value = body.slice(colon + 1)
      return { raw: `${prefix}${key}:${value}`, prefix, kind: 'meta', name: meta.key, value, meta, wildcard: value.includes('*') }
    }
  }
  const name = body.toLowerCase()
  return { raw: prefix + name, prefix, kind: 'tag', name, value: '', meta: null, wildcard: name.includes('*') }
}

export function tokenize(q: string): Token[] {
  const out: Token[] = []
  // Split on whitespace; keep parentheses that stand alone or lead a group ("-(" "~(").
  for (const part of q.trim().split(/\s+/)) {
    if (!part) continue
    out.push(makeToken(part))
  }
  return out
}

export function serialize(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join(' ')
}

export function tagToken(name: string, prefix: Prefix = ''): Token {
  return makeToken(prefix + name)
}

export function metaToken(key: string, value: string, prefix: Prefix = ''): Token {
  return makeToken(`${prefix}${key}:${value}`)
}

/** Tags in the query a person meant to include (for highlighting, follow, etc.). */
export function positiveTags(q: string): string[] {
  return tokenize(q)
    .filter((t) => t.kind === 'tag' && t.prefix !== '-' && !t.wildcard && t.raw !== '-' && t.raw !== '~') // (a sign alone is no tag)
    .map((t) => t.name)
}

export function hasOrder(q: string): string | null {
  const t = tokenize(q).find((x) => x.kind === 'meta' && x.name === 'order' && x.prefix === '')
  return t ? t.value.toLowerCase() : null
}

// ---------- ranges ----------

export interface Range {
  min: string
  max: string
}

/** Parse "10..20", ">=5", "<3", "7" into inclusive bounds as strings ("" = open). Strict bounds
 *  become inclusive ones for whole numbers (">10" → min 11) when `integer` is set. */
export function parseRange(v: string, integer = true): Range {
  const s = v.trim()
  if (s.includes('..')) {
    const [a, b] = s.split('..')
    return { min: a ?? '', max: b ?? '' }
  }
  const bump = (x: string, d: number) => (integer && /^-?\d+$/.test(x) ? String(parseInt(x, 10) + d) : x)
  if (s.startsWith('>=')) return { min: s.slice(2), max: '' }
  if (s.startsWith('<=')) return { min: '', max: s.slice(2) }
  if (s.startsWith('>')) return { min: bump(s.slice(1), 1), max: '' }
  if (s.startsWith('<')) return { min: '', max: bump(s.slice(1), -1) }
  return { min: s, max: s }
}

export interface Annotated {
  t: Token
  depth: number
  /** Index of the group-opening token this token belongs to (depth-0 groups only), -1 if none. */
  group: number
}

/** Tokens with their nesting depth; group members point to their top-level opening token. */
export function annotate(tokens: Token[]): Annotated[] {
  const out: Annotated[] = []
  let depth = 0
  let top = -1
  tokens.forEach((t, i) => {
    if (t.kind === 'open') {
      if (depth === 0) top = i
      out.push({ t, depth, group: top })
      depth++
      return
    }
    if (t.kind === 'close') {
      depth = Math.max(0, depth - 1)
      out.push({ t, depth, group: top })
      if (depth === 0) top = -1
      return
    }
    out.push({ t, depth, group: depth > 0 ? top : -1 })
  })
  return out
}

export interface Group {
  prefix: Prefix
  /** Inner tokens as text (nested groups kept verbatim). */
  inner: Token[]
  start: number
  end: number
}

export function topGroups(tokens: Token[]): Group[] {
  const groups: Group[] = []
  let depth = 0
  let cur: Group | null = null
  tokens.forEach((t, i) => {
    if (t.kind === 'open') {
      if (depth === 0) cur = { prefix: t.prefix, inner: [], start: i, end: i }
      else cur?.inner.push(t)
      depth++
    } else if (t.kind === 'close') {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && cur) {
        cur.end = i
        groups.push(cur)
        cur = null
      } else cur?.inner.push(t)
    } else if (depth > 0) cur?.inner.push(t)
  })
  return groups
}

export function formatRange(r: Range): string | null {
  const min = r.min.trim()
  const max = r.max.trim()
  if (!min && !max) return null
  if (min && max) return min === max ? min : `${min}..${max}`
  if (min) return `>=${min}`
  return `<=${max}`
}

// ---------- checks ----------

export interface Issue {
  level: 'error' | 'warn' | 'info'
  message: string
  token?: string
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

// (A value may hold a single dot, as in 1.5 or 4.5mb; two in a row are the range's own.)
const RANGE_RE = /^(>=|<=|>|<)?(?:[^.<>=]|\.(?!\.))+$|^(?:[^.<>=]|\.(?!\.))*\.\.(?:[^.<>=]|\.(?!\.))*$/
const NUM = /^-?\d+(\.\d+)?$/
const SIZE = /^\d+(\.\d+)?(b|kb|mb|gb)?$/i
const DATE_ABS = /^\d{4}-\d{1,2}-\d{1,2}$/
const DATE_REL = /^(today|yesterday|day|week|month|year|decade|\d+_?(days?|weeks?|months?|years?|decades?)_?ago)$/i
const RATIO = /^\d+(\.\d+)?(:\d+(\.\d+)?)?$/

function checkScalar(kind: MetaTag['kind'], v: string): boolean {
  if (!v) return false
  switch (kind) {
    case 'int':
    case 'id':
      return NUM.test(v) || /^\d+(,\d+)*$/.test(v)
    case 'float':
      return NUM.test(v)
    case 'size':
      return SIZE.test(v)
    case 'date': {
      if (DATE_REL.test(v)) return true
      if (!DATE_ABS.test(v)) return false
      // A day that exists: 2026-02-30 or 9999-99-99 have the shape of a date and match nothing.
      const [y, m, d] = v.split('-').map(Number)
      const day = new Date(Date.UTC(y, m - 1, d))
      return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d
    }
    case 'ratio':
      return RATIO.test(v)
    default:
      return true
  }
}

/** More terms than the site takes in one search: it would only answer with an error. */
export function tooManyTerms(q: string): boolean {
  return tokenize(q).filter((t) => t.kind === 'tag' || t.kind === 'meta').length > MAX_TAGS
}

export function checkQuery(q: string): Issue[] {
  const issues: Issue[] = []
  const tokens = tokenize(q)
  const counted = tokens.filter((t) => t.kind === 'tag' || t.kind === 'meta')
  if (counted.length > MAX_TAGS) {
    issues.push({ level: 'error', message: `${counted.length} terms: the site accepts at most ${MAX_TAGS} in one search` })
  }
  let depth = 0
  for (const t of tokens) {
    if (t.kind === 'open') depth++
    if (t.kind === 'close') depth--
    if (depth < 0) {
      issues.push({ level: 'error', message: 'A closing parenthesis has no opening one', token: t.raw })
      depth = 0
    }
  }
  if (depth > 0) issues.push({ level: 'error', message: 'A group is not closed: add “)”' })

  const seen = new Map<string, Token>()
  for (const t of tokens) {
    if (t.kind !== 'tag' && t.kind !== 'meta') continue
    const id = t.kind === 'tag' ? t.name : `${t.name}:${t.value.toLowerCase()}`
    const prev = seen.get(id)
    if (prev) {
      if (prev.prefix === t.prefix) issues.push({ level: 'warn', message: `“${t.raw}” appears twice`, token: t.raw })
      else if ((prev.prefix === '-') !== (t.prefix === '-'))
        issues.push({ level: 'error', message: `“${id}” is both wanted and excluded: nothing can match`, token: t.raw })
    }
    seen.set(id, t)
  }

  const ors = annotate(tokens).filter((a) => a.depth === 0 && a.t.prefix === '~' && a.t.kind !== 'close').map((a) => a.t)
  if (ors.length === 1) issues.push({ level: 'warn', message: `“${ors[0].raw}” is the only “any of” term: add another, or drop the ~`, token: ors[0].raw })
  const orKinds = new Set(ors.map((t) => (t.kind === 'meta' ? t.name : t.kind)))
  if (orKinds.size > 1)
    issues.push({ level: 'info', message: 'All ~ terms form one “any of” set, whatever their kind: group them with ~( … ) to keep sets apart' })
  if (tokens.some((t) => t.raw === '~')) issues.push({ level: 'error', message: 'A lone “~” matches nothing: write ~tag, or ~( … ) for a group' })
  if (tokens.some((t) => t.raw === '-')) issues.push({ level: 'error', message: 'A lone “-” excludes nothing: write -tag, or -( … ) for a group' })

  const orders = tokens.filter((t) => t.kind === 'meta' && t.name === 'order' && t.prefix === '')
  if (orders.length > 1) issues.push({ level: 'warn', message: 'Several order: terms: only one sort applies' })
  if (tokens.some((t) => t.kind === 'meta' && t.name === 'randseed') && !orders.some((o) => o.value === 'random'))
    issues.push({ level: 'info', message: 'randseed: only matters with order:random' })

  const wild = tokens.filter((t) => t.wildcard && t.kind === 'tag')
  if (wild.length > 1) issues.push({ level: 'warn', message: 'Several wildcards: the site may refuse or truncate them; keep one' })
  for (const w of wild) {
    if (w.name.replace(/\*/g, '').length < 2) issues.push({ level: 'warn', message: `“${w.raw}” is too broad to expand`, token: w.raw })
  }

  for (const t of tokens) {
    if (t.kind === 'meta' && t.meta) {
      const m = t.meta
      const v = t.value
      if (!v) {
        issues.push({ level: 'error', message: `“${t.raw}” needs a value, e.g. ${m.example}`, token: t.raw })
        continue
      }
      if (m.kind === 'enum' && m.values) {
        const ok = m.values.some((x) => x.value === v.toLowerCase()) || (m.key === 'rating' && /^(safe|questionable|explicit)$/i.test(v))
        if (!ok) issues.push({ level: 'error', message: `“${v}” is not a value of ${m.key}: (try ${m.values.slice(0, 4).map((x) => x.value).join(', ')}…)`, token: t.raw })
      } else if (m.kind === 'bool') {
        if (!/^(true|false|yes|no)$/i.test(v)) issues.push({ level: 'error', message: `${m.key}: takes true or false`, token: t.raw })
      } else if (m.range || ['int', 'float', 'size', 'date', 'ratio', 'id'].includes(m.kind)) {
        if (m.values?.some((x) => x.value === v.toLowerCase())) continue
        if (!RANGE_RE.test(v)) {
          issues.push({ level: 'error', message: `“${t.raw}” has a malformed range (use 5..10, >5, <=10)`, token: t.raw })
          continue
        }
        const r = parseRange(v)
        const parts = v.includes('..') ? [r.min, r.max].filter(Boolean) : [v.replace(/^(>=|<=|>|<)/, '')]
        if (!parts.every((p) => checkScalar(m.kind, p)))
          issues.push({ level: 'error', message: `“${t.raw}” has a value ${m.key}: cannot read (e.g. ${m.example})`, token: t.raw })
      }
    } else if (t.kind === 'tag' && t.name.includes(':')) {
      const key = t.name.split(':')[0]
      if (/^[a-z_]{3,}$/.test(key)) {
        const near = METATAGS.map((m) => ({ m, d: editDistance(key, m.key) })).sort((a, b) => a.d - b.d)[0]
        if (near && near.d > 0 && near.d <= 2) issues.push({ level: 'warn', message: `“${key}:” is not a filter the site knows: did you mean ${near.m.key}:?`, token: t.raw })
      }
    }
  }
  return issues
}

/** Put a token in a query (replacing an existing one with the same name), or take it out. */
export function toggleTag(q: string, name: string, prefix: Prefix = ''): string {
  const tokens = tokenize(q)
  const idx = tokens.findIndex((t) => t.kind === 'tag' && t.name === name.toLowerCase())
  if (idx >= 0) {
    if (tokens[idx].prefix === prefix) tokens.splice(idx, 1)
    else tokens[idx] = tagToken(name, prefix)
  } else tokens.push(tagToken(name, prefix))
  return serialize(tokens)
}

export function withTag(q: string, name: string, prefix: Prefix = ''): string {
  const tokens = tokenize(q).filter((t) => !(t.kind === 'tag' && t.name === name.toLowerCase()))
  tokens.push(tagToken(name, prefix))
  return serialize(tokens)
}

/** Combine the person's query with the default filter from settings (without repeating terms). */
export function withDefaultFilter(q: string, filter: string): string {
  if (!filter.trim()) return q.trim()
  const have = new Set(tokenize(q).map((t) => t.raw.toLowerCase()))
  const haveOrder = tokenize(q).some((t) => t.kind === 'meta' && t.name === 'order')
  const extra = tokenize(filter).filter((t) => !have.has(t.raw.toLowerCase()) && !(haveOrder && t.kind === 'meta' && t.name === 'order'))
  return [q.trim(), serialize(extra)].filter(Boolean).join(' ')
}

/** The upload date a query is limited to, as `date:<=YYYY-MM-DD` ("jump to a date"), if any. */
export function dateLimit(q: string): string | null {
  const t = tokenize(q).find((x) => x.kind === 'meta' && x.name === 'date' && x.prefix === '' && /^<=?\d{4}-\d{2}-\d{2}$/.test(x.value))
  return t ? t.value.replace(/^<=?/, '') : null
}

/** The query from a date back (posts uploaded that day or before), in place of any date term it had;
    no date: without one. */
export function atDate(q: string, day: string | null): string {
  const tokens = tokenize(q).filter((t) => !(t.kind === 'meta' && t.name === 'date'))
  if (day) tokens.push(metaToken('date', `<=${day}`))
  return serialize(tokens)
}

/** Readable form of a tag name. */
export function prettyTag(name: string): string {
  return name.replace(/_/g, ' ')
}
