/* pawbs's blacklist and the signed-in account's own (the site's setting, `blacklisted_tags`).

   When an account signs in (first setup, an account saved for a site, or once for an account that
   was signed in before this existed): the account's blacklist is copied over when pawbs has none;
   when both have one and they differ, the difference is kept (stores/blacklist: conflict) and
   Settings asks which to use (components/BlacklistNotice). Settings › Blacklist can pull, push or
   merge at any time (components/BlacklistSync).

   Lines are compared as rules: surrounding and repeated spaces, case and order do not matter. */
import { getUser, setAccountBlacklist } from '@/api/endpoints'
import { useBlacklist } from '@/stores/blacklist'
import { useSites } from '@/stores/sites'
import { useUi } from '@/stores/ui'

/** The rules of a blacklist, one per non-empty line. */
export function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}
const norm = (l: string) => l.replace(/\s+/g, ' ').toLowerCase()

export interface BlacklistDiff {
  /** Rules only pawbs has. */
  onlyHere: string[]
  /** Rules only the account has. */
  onlyThere: string[]
}
export function diffBlacklists(here: string, there: string): BlacklistDiff {
  const a = linesOf(here)
  const b = linesOf(there)
  const inA = new Set(a.map(norm))
  const inB = new Set(b.map(norm))
  return { onlyHere: a.filter((l) => !inB.has(norm(l))), onlyThere: b.filter((l) => !inA.has(norm(l))) }
}
export const sameBlacklist = (d: BlacklistDiff) => !d.onlyHere.length && !d.onlyThere.length
/** pawbs's rules as they are, then the account's that pawbs lacks. */
export function mergeBlacklists(here: string, there: string): string {
  const { onlyThere } = diffBlacklists(here, there)
  return [...linesOf(here), ...onlyThere].join('\n')
}

/** The active site's account, or null for a guest. */
function account() {
  const s = useSites().active
  return s?.username && s.apiKey ? s : null
}
const accountKey = (s: { url: string; username: string }) => `${s.url}|${s.username.toLowerCase()}`

/** The account's blacklist, read now. */
export async function readAccountBlacklist(): Promise<{ userId: number; text: string }> {
  const s = account()
  if (!s) throw new Error('No account is signed in on this site.')
  const user = await getUser(s.username)
  if (!user) throw new Error('The site did not return the account.')
  return { userId: user.id, text: user.blacklistedTags ?? '' }
}
/** Replace the account's blacklist with this text. */
export async function writeAccountBlacklist(userId: number, text: string): Promise<void> {
  await setAccountBlacklist(userId, text)
  clearConflict()
}

function clearConflict() {
  const bl = useBlacklist()
  const s = account()
  if (bl.conflict && (!s || accountKey({ url: bl.conflict.site, username: bl.conflict.user }) === accountKey(s))) bl.conflict = null
}

/**
 * Compare pawbs's blacklist with the signed-in account's: copy it over when pawbs has none, note
 * the difference when both have rules. Once per account unless `force` (a sign-in). `known`: the
 * account as just read (first setup), to spare a request.
 */
export async function compareWithAccount(opts: { force?: boolean; known?: { userId: number; text: string } } = {}): Promise<void> {
  const s = account()
  if (!s) return
  const bl = useBlacklist()
  const key = accountKey(s)
  if (!opts.force && bl.compared.includes(key)) return
  let acc = opts.known
  if (!acc) {
    try {
      acc = await readAccountBlacklist()
    } catch {
      return // not now (offline, the site down): asked again at the next start
    }
  }
  bl.compared = [...bl.compared.filter((k) => k !== key), key]
  const accountRules = linesOf(acc.text)
  if (!accountRules.length) return clearConflict()
  if (!linesOf(bl.text).length) {
    bl.text = accountRules.join('\n')
    clearConflict()
    useUi().toast(`Blacklist copied from your ${s.name} account (${accountRules.length} rule${accountRules.length === 1 ? '' : 's'})`, { tone: 'ok', ms: 6000 })
    return
  }
  if (sameBlacklist(diffBlacklists(bl.text, acc.text))) return clearConflict()
  bl.conflict = { site: s.url, siteName: s.name, user: s.username, userId: acc.userId, account: acc.text }
}

/** Settle a noted difference: use the account's rules, keep pawbs's, or merge both into pawbs. */
export function resolveConflict(choice: 'account' | 'pawbs' | 'merge'): void {
  const bl = useBlacklist()
  const c = bl.conflict
  if (!c) return
  const before = bl.text
  if (choice === 'account') bl.text = linesOf(c.account).join('\n')
  else if (choice === 'merge') bl.text = mergeBlacklists(bl.text, c.account)
  bl.conflict = null
  const ui = useUi()
  if (choice === 'pawbs') ui.toast('Kept pawbs’s blacklist', { tone: 'ok' })
  else
    ui.toast(choice === 'account' ? 'Now using the account’s blacklist' : 'Blacklists merged', {
      tone: 'ok',
      action: { label: 'Undo', run: () => ((bl.text = before), (bl.conflict = c)) },
    })
}
