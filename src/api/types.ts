export type Rating = 's' | 'q' | 'e'
export type MediaKind = 'image' | 'animated' | 'video' | 'flash' | 'unknown'

export interface VideoSource {
  url: string
  width: number
  height: number
  /** MIME type guessed from the extension or codec. */
  type: string
  /** "original", "720p", "480p"… */
  label: string
  size: number | null
}

export interface Post {
  id: number
  createdAt: string
  md5: string
  ext: string
  size: number
  width: number
  height: number
  duration: number | null
  kind: MediaKind
  /** Original file; null when the post is deleted or hidden from this account. */
  fileUrl: string | null
  /** The image to show in the viewer (the sample, else the original). */
  sampleUrl: string | null
  sampleWidth: number
  sampleHeight: number
  /** Fallback when the preferred sample format fails. */
  sampleAltUrl: string | null
  previewUrl: string | null
  previewAltUrl: string | null
  previewWidth: number
  previewHeight: number
  videos: VideoSource[]
  score: { up: number; down: number; total: number }
  favCount: number
  isFavorited: boolean
  vote: number
  commentCount: number
  rating: Rating
  tags: string[]
  /** Category per tag when the site sends grouped tags (older response format). */
  tagCategories: Record<string, number> | null
  sources: string[]
  description: string
  uploaderId: number | null
  uploaderName: string | null
  pools: number[]
  parentId: number | null
  children: number[]
  hasNotes: boolean
  deleted: boolean
  pending: boolean
  flagged: boolean
  /** True when built from a stored snapshot: description, sources may be missing. */
  partial?: boolean
}

export interface TagInfo {
  id: number
  name: string
  postCount: number
  category: number
  antecedent?: string | null
}

export interface Pool {
  id: number
  name: string
  description: string
  category: 'series' | 'collection' | string
  isActive: boolean
  postIds: number[]
  postCount: number
  createdAt: string
  updatedAt: string
  creatorName: string | null
}

/** A set: a person's collection of posts (public, or private to its owner). */
export interface PostSet {
  id: number
  name: string
  shortname: string
  description: string
  isPublic: boolean
  postCount: number
  postIds: number[]
  creatorId: number | null
  transferOnDelete: boolean
  createdAt: string
  updatedAt: string
}

/** An artist's entry: other names, notes and links to their pages elsewhere. */
export interface ArtistInfo {
  id: number
  name: string
  otherNames: string[]
  groupName: string
  notes: string
  urls: { url: string; isActive: boolean }[]
}

/** A tag searched a lot today. */
export interface SearchTrend {
  tag: string
  count: number
}

/** A post the site finds visually close to another (its picture comparison), with how close. */
export interface SimilarPost {
  post: Post
  score: number
}

export interface Comment {
  id: number
  postId: number
  body: string
  score: number
  createdAt: string
  creatorName: string
  isHidden: boolean
  isSticky: boolean
}

export interface Note {
  id: number
  x: number
  y: number
  width: number
  height: number
  body: string
}

export interface WikiPage {
  id: number
  title: string
  body: string
  otherNames: string[]
}

export interface UserInfo {
  id: number
  name: string
  blacklistedTags: string | null
  level: string | null
}

export const TAG_CATEGORIES: { id: number; key: string; label: string; plural: string }[] = [
  { id: 1, key: 'artist', label: 'Artist', plural: 'Artists' },
  { id: 2, key: 'contributor', label: 'Contributor', plural: 'Contributors' },
  { id: 3, key: 'copyright', label: 'Copyright', plural: 'Copyrights' },
  { id: 4, key: 'character', label: 'Character', plural: 'Characters' },
  { id: 5, key: 'species', label: 'Species', plural: 'Species' },
  { id: 0, key: 'general', label: 'General', plural: 'General' },
  { id: 8, key: 'lore', label: 'Lore', plural: 'Lore' },
  { id: 7, key: 'meta', label: 'Meta', plural: 'Meta' },
  { id: 6, key: 'invalid', label: 'Invalid', plural: 'Invalid' },
]

export const CATEGORY_BY_KEY: Record<string, number> = Object.fromEntries(
  TAG_CATEGORIES.map((c) => [c.key, c.id]),
)
export const CATEGORY_LABEL: Record<number, string> = Object.fromEntries(
  TAG_CATEGORIES.map((c) => [c.id, c.label]),
)
