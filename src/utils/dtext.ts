/* A small, safe DText renderer for descriptions, comments and wiki excerpts. Everything is escaped
   first; only the markup below becomes HTML. Links to posts and searches stay inside the app
   (data-route), outside links open in a new tab.

   Generated HTML is never matched again: each link is set aside as soon as it is made (a placeholder
   of control characters, which the input cannot contain) and put back at the very end. Matching the
   later patterns over a link's attributes let crafted text break out of an href and add attributes
   of its own. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** The text as written (for a search built from it): the escaping undone. */
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

function safeUrl(u: string, base: string): string | null {
  try {
    const url = new URL(u.replace(/&amp;/g, '&'), base || undefined)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

function link(href: string, text: string): string {
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`
}

function routeLink(route: string, text: string): string {
  return `<a href="#${esc(route)}" data-route="${esc(route)}">${text}</a>`
}

/** The boards this app shows: a link to one of their posts, pools, sets, searches or wiki pages opens
    here, like post #123 does, instead of leaving for the site. */
const BOARD = /^(www\.)?(e621|e926)\.net$/
function hostOf(u: string): string {
  try {
    return new URL(u).host
  } catch {
    return ''
  }
}
function inAppRoute(href: string, base: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (!BOARD.test(url.hostname) && (!base || url.host !== hostOf(base))) return null
  const path = url.pathname.replace(/\/+$/, '')
  const tagSearch = (t: string) => `/posts?q=${encodeURIComponent(t.trim())}`
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/posts\/(\d+)$/)) || (m = path.match(/^\/post\/show\/(\d+)/))) return `/post/${m[1]}`
  if ((m = path.match(/^\/pools\/(\d+)$/))) return `/pools/${m[1]}`
  if ((m = path.match(/^\/(?:post_)?sets\/(\d+)$/))) return `/sets/${m[1]}`
  if (path === '/posts' || path === '') {
    const tags = url.searchParams.get('tags')
    return tags ? tagSearch(tags) : path ? '/posts' : null
  }
  // A wiki page by its title (a number is a page's id: no tag to search for).
  const title = path === '/wiki_pages/show_or_new' ? url.searchParams.get('title') : path.match(/^\/wiki_pages\/([^/]+)$/)?.[1]
  if (title && !/^\d+$/.test(title)) {
    try {
      return tagSearch(decodeURIComponent(title).toLowerCase().replace(/\s+/g, '_'))
    } catch {
      return null
    }
  }
  return null
}

/** A link from the text: to a page of the app when it points at one, else out to the web. */
function anyLink(href: string, text: string, base: string): string {
  const route = inAppRoute(href, base)
  return route ? routeLink(route, text) : link(href, text)
}

const HOLD = '\u0001'
/** Text the input cannot hold: control characters, our placeholders among them. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

function inline(s: string, base: string): string {
  // Links made below are set aside at once (see the header): later patterns only see placeholders.
  const held: string[] = []
  const hold = (html: string) => `${HOLD}${held.push(html) - 1}${HOLD}`
  let out = s
  // "text":url and "text":[url]. The lengths are bounded (as for [[…]] and {{…}} below): the text is
  // escaped by now, so a quote is "&quot;" and no longer ends the first group, and without a bound
  // each quote of a long line of them made the pattern read on to the end of the line.
  out = out.replace(/&quot;([^"\n\u0001]{1,300}?)&quot;:\[([^\]\s\u0001]{1,2000})\]/g, (m, t: string, u: string) => {
    const href = safeUrl(u, base)
    return href ? hold(anyLink(href, t, base)) : m
  })
  out = out.replace(/&quot;([^"\n\u0001]{1,300}?)&quot;:((?:https?:\/\/|\/)[^\s<\u0001]{1,2000}[^\s<.,;:!?)\]'"\u0001])/g, (m, t: string, u: string) => {
    const href = safeUrl(u, base)
    return href ? hold(anyLink(href, t, base)) : m
  })
  // [[wiki page|label]] → search for the tag
  out = out.replace(/\[\[([^\]|\u0001]{1,300})(?:\|([^\]\u0001]{1,300}))?\]\]/g, (_m, page: string, label?: string) => {
    const tag = unesc(page).trim().toLowerCase().replace(/\s+/g, '_')
    return hold(routeLink(`/posts?q=${encodeURIComponent(tag)}`, label ?? page))
  })
  // {{tag search}}
  out = out.replace(/\{\{([^}\u0001]{1,300})\}\}/g, (_m, q: string) => hold(routeLink(`/posts?q=${encodeURIComponent(unesc(q).trim())}`, q.trim())))
  // post #123, thumb #123, pool #12
  out = out.replace(/\b(post|thumb) #(\d+)/gi, (_m, _w: string, id: string) => hold(routeLink(`/post/${id}`, `post #${id}`)))
  out = out.replace(/\bpool #(\d+)/gi, (_m, id: string) => hold(routeLink(`/pools/${id}`, `pool #${id}`)))
  // bare URLs (the links above are placeholders now: nothing of theirs can match)
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<\u0001]+[^\s<.,;:!?)\]'"\u0001])/g, (m, pre: string, u: string) => {
    const href = safeUrl(u, base)
    return href ? pre + hold(anyLink(href, u, base)) : m
  })
  // simple tags
  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
    .replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '<sup>$1</sup>')
    .replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '<sub>$1</sub>')
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="dt-spoiler" tabindex="0">$1</span>')
    .replace(/\[color=[^\]]*\]([\s\S]*?)\[\/color\]/gi, '$1')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  // The links back, last: nothing ran over their HTML.
  return out.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => held[Number(i)] ?? '')
}

/** Markup is read in the first characters only (a site's own limit for a description is of this
    order); what follows is shown as plain text. Text of any length comes from the site, and several
    patterns here take time that grows with the square of it. */
const MAX_MARKUP = 20_000

export function renderDText(src: string, base = ''): string {
  if (!src) return ''
  if (src.length > MAX_MARKUP) {
    // Cut at a line break when one is near, so no line is split in two.
    const nl = src.lastIndexOf('\n', MAX_MARKUP)
    const cut = nl > MAX_MARKUP - 2000 ? nl : MAX_MARKUP
    const rest = esc(src.slice(cut).replace(/\r\n?/g, '\n').replace(CONTROL, '').trim())
    return renderDText(src.slice(0, cut), base) + (rest ? `<p>${rest.replace(/\n/g, '<br>')}</p>` : '')
  }
  let s = esc(src.replace(/\r\n?/g, '\n').replace(CONTROL, ''))
  // Block code first, so nothing inside it is transformed.
  const codes: string[] = []
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, c: string) => {
    codes.push(`<pre class="dt-code">${c.replace(/^\n|\n$/g, '')}</pre>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/\[quote\]\n?([\s\S]*?)\n?\[\/quote\]/gi, '<blockquote>$1</blockquote>')
  s = s.replace(/\[section(?:,expanded)?(?:=([^\]]*))?\]\n?([\s\S]*?)\n?\[\/section\]/gi, (_m, title: string | undefined, body: string) => `<details><summary>${title ?? 'Section'}</summary>${body}</details>`)
  s = s.replace(/\[\/?(table|thead|tbody|tr|td|th|center|left|right)\]/gi, '')

  const lines = s.split('\n')
  const html: string[] = []
  let list: string[] = []
  let para: string[] = []
  const flushPara = () => {
    if (para.length) html.push(`<p>${para.map((l) => inline(l, base)).join('<br>')}</p>`)
    para = []
  }
  const flushList = () => {
    if (list.length) html.push(`<ul>${list.map((l) => `<li>${inline(l, base)}</li>`).join('')}</ul>`)
    list = []
  }
  for (const line of lines) {
    const h = line.match(/^h([1-6])\.\s*(.*)$/)
    const li = line.match(/^\*+\s+(.*)$/)
    if (h) {
      flushPara()
      flushList()
      html.push(`<p class="dt-h">${inline(h[2], base)}</p>`)
    } else if (li) {
      flushPara()
      list.push(li[1])
    } else if (!line.trim()) {
      flushPara()
      flushList()
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  let out = html.join('')
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '')
  return out
}

/** Plain-text excerpt of DText (for previews). */
export function dtextExcerpt(src: string, max = 240): string {
  const t = src
    .replace(/\[\/?[a-z]+(=[^\]]*)?\]/gi, '')
    .replace(/&quot;|"([^"]+)":\S+/g, '$1')
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, a: string, _b, c?: string) => c ?? a)
    .replace(/thumb #\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
