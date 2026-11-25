/* What the search language understands besides plain tags. Drives autocomplete, the query
   assistant and the checks on a query. */

export type MetaValueKind = 'enum' | 'int' | 'float' | 'date' | 'size' | 'ratio' | 'user' | 'text' | 'bool' | 'pool' | 'id'

export interface MetaValue {
  value: string
  label: string
  hint?: string
}

export interface MetaTag {
  key: string
  aliases?: string[]
  label: string
  kind: MetaValueKind
  hint: string
  values?: MetaValue[]
  example: string
  /** Accepts ranges: 10..20, >10, <=5. */
  range?: boolean
  group: 'Sort' | 'Content' | 'Counts' | 'File' | 'People' | 'Relations' | 'Status' | 'Text' | 'Other'
}

const BOOL: MetaValue[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const ORDER_VALUES: MetaValue[] = [
  { value: 'id', label: 'Newest', hint: 'Default: newest uploads first' },
  { value: 'id_asc', label: 'Oldest', hint: 'Oldest uploads first' },
  { value: 'score', label: 'Score', hint: 'Highest score first' },
  { value: 'score_asc', label: 'Lowest score' },
  { value: 'favcount', label: 'Favourites', hint: 'Most favourited first' },
  { value: 'favcount_asc', label: 'Fewest favourites' },
  { value: 'random', label: 'Random', hint: 'Shuffled; pair with randseed: to repeat an order' },
  { value: 'hot', label: 'Hot', hint: 'Recent and well received' },
  { value: 'comment_count', label: 'Most comments' },
  { value: 'comment_bumped', label: 'Recently commented' },
  { value: 'mpixels', label: 'Highest resolution' },
  { value: 'mpixels_asc', label: 'Lowest resolution' },
  { value: 'filesize', label: 'Largest file' },
  { value: 'filesize_asc', label: 'Smallest file' },
  { value: 'duration', label: 'Longest video' },
  { value: 'duration_asc', label: 'Shortest video' },
  { value: 'landscape', label: 'Widest first' },
  { value: 'portrait', label: 'Tallest first' },
  { value: 'tagcount', label: 'Most tags' },
  { value: 'tagcount_asc', label: 'Fewest tags' },
  { value: 'change', label: 'Recently changed' },
  { value: 'note', label: 'Recently noted' },
]

export const RATING_VALUES: MetaValue[] = [
  { value: 's', label: 'Safe' },
  { value: 'q', label: 'Questionable' },
  { value: 'e', label: 'Explicit' },
]

export const TYPE_VALUES: MetaValue[] = [
  { value: 'jpg', label: 'JPEG image' },
  { value: 'png', label: 'PNG image' },
  { value: 'webp', label: 'WebP image' },
  { value: 'gif', label: 'GIF (often animated)' },
  { value: 'webm', label: 'WebM video' },
  { value: 'mp4', label: 'MP4 video' },
  { value: 'swf', label: 'Flash' },
]

export const STATUS_VALUES: MetaValue[] = [
  { value: 'active', label: 'Active', hint: 'Approved and visible' },
  { value: 'pending', label: 'Pending', hint: 'Waiting for approval' },
  { value: 'flagged', label: 'Flagged', hint: 'Flagged for deletion' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'modqueue', label: 'Mod queue', hint: 'Pending or flagged' },
  { value: 'any', label: 'Any', hint: 'Include deleted posts' },
]

export const DATE_PRESETS: MetaValue[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
  { value: 'year', label: 'Past year' },
  { value: 'decade', label: 'Past decade' },
]

export const METATAGS: MetaTag[] = [
  { key: 'order', label: 'Sort', kind: 'enum', values: ORDER_VALUES, hint: 'How results are sorted', example: 'order:score', group: 'Sort' },
  { key: 'randseed', label: 'Random seed', kind: 'int', hint: 'Repeatable order:random', example: 'randseed:42', group: 'Sort' },
  { key: 'rating', label: 'Rating', kind: 'enum', values: RATING_VALUES, hint: 's, q or e (safe, questionable, explicit)', example: 'rating:s', group: 'Content' },
  { key: 'type', aliases: ['filetype'], label: 'File type', kind: 'enum', values: TYPE_VALUES, hint: 'The file format', example: 'type:webm', group: 'File' },
  { key: 'score', label: 'Score', kind: 'int', range: true, hint: 'Up votes minus down votes', example: 'score:>100', group: 'Counts' },
  { key: 'favcount', label: 'Favourites', kind: 'int', range: true, hint: 'Times favourited', example: 'favcount:50..200', group: 'Counts' },
  { key: 'comment_count', aliases: ['comments'], label: 'Comments', kind: 'int', range: true, hint: 'Number of comments', example: 'comment_count:>10', group: 'Counts' },
  { key: 'tagcount', label: 'Tag count', kind: 'int', range: true, hint: 'Number of tags', example: 'tagcount:<20', group: 'Counts' },
  { key: 'gentags', label: 'General tags', kind: 'int', range: true, hint: 'Count of general tags', example: 'gentags:<10', group: 'Counts' },
  { key: 'arttags', label: 'Artist tags', kind: 'int', range: true, hint: 'Count of artist tags', example: 'arttags:>1', group: 'Counts' },
  { key: 'chartags', label: 'Character tags', kind: 'int', range: true, hint: 'Count of character tags', example: 'chartags:1', group: 'Counts' },
  { key: 'copytags', label: 'Copyright tags', kind: 'int', range: true, hint: 'Count of copyright tags', example: 'copytags:0', group: 'Counts' },
  { key: 'spectags', label: 'Species tags', kind: 'int', range: true, hint: 'Count of species tags', example: 'spectags:>2', group: 'Counts' },
  { key: 'metatags', label: 'Meta tags', kind: 'int', range: true, hint: 'Count of meta tags', example: 'metatags:>3', group: 'Counts' },
  { key: 'lortags', label: 'Lore tags', kind: 'int', range: true, hint: 'Count of lore tags', example: 'lortags:>0', group: 'Counts' },
  { key: 'invtags', label: 'Invalid tags', kind: 'int', range: true, hint: 'Count of invalid tags', example: 'invtags:>0', group: 'Counts' },
  { key: 'id', label: 'Post ID', kind: 'int', range: true, hint: 'One id or a range', example: 'id:>1000000', group: 'Other' },
  { key: 'date', label: 'Upload date', kind: 'date', range: true, values: DATE_PRESETS, hint: 'YYYY-MM-DD, a range, or today, week, month, year, 3_days_ago…', example: 'date:2024-01-01..2024-06-30', group: 'Content' },
  { key: 'width', label: 'Width', kind: 'int', range: true, hint: 'Pixels', example: 'width:>=1920', group: 'File' },
  { key: 'height', label: 'Height', kind: 'int', range: true, hint: 'Pixels', example: 'height:>=1080', group: 'File' },
  { key: 'mpixels', label: 'Megapixels', kind: 'float', range: true, hint: 'Width × height ÷ 1,000,000', example: 'mpixels:>4', group: 'File' },
  { key: 'ratio', label: 'Aspect ratio', kind: 'ratio', range: true, hint: 'Width ÷ height, or W:H', example: 'ratio:16:9', group: 'File' },
  { key: 'filesize', label: 'File size', kind: 'size', range: true, hint: 'With KB or MB', example: 'filesize:>5MB', group: 'File' },
  { key: 'duration', label: 'Duration', kind: 'float', range: true, hint: 'Video length in seconds', example: 'duration:>30', group: 'File' },
  { key: 'md5', label: 'MD5', kind: 'text', hint: 'The file hash', example: 'md5:0123…', group: 'File' },
  { key: 'user', label: 'Uploader', kind: 'user', hint: 'Uploaded by this user', example: 'user:name', group: 'People' },
  { key: 'fav', label: 'Favourited by', kind: 'user', hint: 'In this user’s favourites', example: 'fav:name', group: 'People' },
  { key: 'approver', label: 'Approver', kind: 'user', hint: 'Approved by this user', example: 'approver:name', group: 'People' },
  { key: 'commenter', aliases: ['comm'], label: 'Commenter', kind: 'user', hint: 'Commented by this user', example: 'commenter:name', group: 'People' },
  { key: 'noter', label: 'Note author', kind: 'user', hint: 'Has notes by this user', example: 'noter:name', group: 'People' },
  { key: 'voted', label: 'Voted', kind: 'user', hint: 'Voted by this user (your own account)', example: 'voted:name', group: 'People' },
  { key: 'upvote', label: 'Up-voted', kind: 'user', hint: 'Up-voted by this user (your own account)', example: 'upvote:name', group: 'People' },
  { key: 'downvote', label: 'Down-voted', kind: 'user', hint: 'Down-voted by this user (your own account)', example: 'downvote:name', group: 'People' },
  { key: 'pool', label: 'Pool', kind: 'pool', hint: 'A pool by id or name', example: 'pool:1234', group: 'Relations' },
  { key: 'set', label: 'Set', kind: 'text', hint: 'A post set by id or short name', example: 'set:1234', group: 'Relations' },
  { key: 'parent', label: 'Parent', kind: 'id', hint: 'Children of this post, or none / any', values: [{ value: 'none', label: 'No parent' }, { value: 'any', label: 'Has a parent' }], example: 'parent:12345', group: 'Relations' },
  { key: 'child', label: 'Children', kind: 'enum', values: [{ value: 'none', label: 'No children' }, { value: 'any', label: 'Has children' }], hint: 'none or any', example: 'child:any', group: 'Relations' },
  { key: 'ischild', label: 'Is a child', kind: 'bool', values: BOOL, hint: 'Has a parent post', example: 'ischild:true', group: 'Relations' },
  { key: 'isparent', label: 'Is a parent', kind: 'bool', values: BOOL, hint: 'Has child posts', example: 'isparent:true', group: 'Relations' },
  { key: 'inpool', label: 'In a pool', kind: 'bool', values: BOOL, hint: 'Belongs to any pool', example: 'inpool:true', group: 'Relations' },
  { key: 'status', label: 'Status', kind: 'enum', values: STATUS_VALUES, hint: 'Moderation state', example: 'status:pending', group: 'Status' },
  { key: 'ratinglocked', label: 'Rating locked', kind: 'bool', values: BOOL, hint: '', example: 'ratinglocked:true', group: 'Status' },
  { key: 'notelocked', label: 'Notes locked', kind: 'bool', values: BOOL, hint: '', example: 'notelocked:true', group: 'Status' },
  { key: 'source', label: 'Source', kind: 'text', hint: 'Source URL starts with…, or none', example: 'source:*twitter*', values: [{ value: 'none', label: 'No source' }], group: 'Text' },
  { key: 'hassource', label: 'Has source', kind: 'bool', values: BOOL, hint: '', example: 'hassource:false', group: 'Text' },
  { key: 'description', label: 'Description', kind: 'text', hint: 'Description contains', example: 'description:comic', group: 'Text' },
  { key: 'hasdescription', label: 'Has description', kind: 'bool', values: BOOL, hint: '', example: 'hasdescription:true', group: 'Text' },
  { key: 'note', label: 'Note text', kind: 'text', hint: 'Notes contain', example: 'note:hello', group: 'Text' },
  { key: 'delreason', label: 'Deletion reason', kind: 'text', hint: 'With status:deleted', example: 'delreason:*duplicate*', group: 'Text' },
]

export const META_BY_KEY: Map<string, MetaTag> = new Map()
for (const m of METATAGS) {
  META_BY_KEY.set(m.key, m)
  for (const a of m.aliases ?? []) META_BY_KEY.set(a, m)
}

export const MAX_TAGS = 40

/** File-type groups the assistant offers, and the formats each covers. */
export const MEDIA_GROUPS: { key: 'image' | 'animated' | 'video' | 'flash'; label: string; types: string[] }[] = [
  { key: 'image', label: 'Image', types: ['jpg', 'png', 'webp'] },
  { key: 'animated', label: 'GIF', types: ['gif'] },
  { key: 'video', label: 'Video', types: ['webm', 'mp4'] },
  { key: 'flash', label: 'Flash', types: ['swf'] },
]
