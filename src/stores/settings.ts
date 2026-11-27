import { defineStore } from 'pinia'
import { persistent, readJson, writeJson } from './persist'

export type Layout = 'justified' | 'masonry' | 'grid' | 'feed'
/** What a double tap on a picture in the gallery does (on a touch screen). */
export type DoubleTap = 'zoom' | 'favorite' | 'vote' | 'none'
export type PreloadMode = 'off' | 'light' | 'balanced' | 'aggressive'
/** What the mouse wheel does over a picture in the gallery. */
export type WheelAction = 'none' | 'navigate' | 'zoom'
/** How the Pools tab lays pools out. */
export type PoolLayout = 'list' | 'large' | 'grid'

export interface Settings {
  // browsing
  layout: Layout
  /** The same on a phone held upright (composables/layout): Columns by default. */
  layoutPhone: Layout
  thumbSize: number
  /** The same on a phone held upright (its own, so a phone's choice leaves the computer's alone). */
  thumbSizePhone: number
  gridFit: 'contain' | 'cover'
  pageSize: number
  blacklistMode: 'hide' | 'mask'
  /** Masked: the gallery steps over them (the grid still shows them masked). */
  skipBlacklisted: boolean
  /** A blacklist line whose tags are all in the search is set aside on its results (stores/blacklist). */
  blacklistSearched: boolean
  showThumbStats: boolean
  hoverPreload: boolean
  /** Moving the mouse across a video's thumbnail plays through it (the video loads while hovered). */
  hoverScrub: boolean
  /** Interface effects: pages scanning in, brackets locking on, titles decoding (none with reduced motion). */
  fx: boolean
  /** Home shows the tags searched most today and the ones rising. */
  homeTrends: boolean
  /** Posts already opened in the gallery, in searches, Following, Popular and similar pictures:
      shown as the others, dimmed, or left out (stores/history: seen). */
  seenPosts: 'show' | 'dim' | 'hide'
  /** Private session: nothing is added to the history, the seen posts or the recent searches. */
  pauseHistory: boolean
  /** The installed app's icon shows how many new posts the followed tags have (where supported). */
  appBadge: boolean
  /** With encryption on: locks after this many minutes without use (0: never). */
  lockIdle: number
  /** With encryption on: locks after this many minutes in the background (0: at once, -1: never). */
  lockHidden: number
  /** While pawbs is in the background its content is covered (what the app switcher shows). */
  coverHidden: boolean
  defaultFilter: string
  blockFlash: boolean
  poolLayout: PoolLayout
  /** How a pool's page shows its posts: a grid, or the pages one under the other to scroll. */
  poolReader: 'grid' | 'scroll'
  poolsTab: 'browse' | 'library'
  /** The Sets page's tab when opened without one. */
  setsTab: 'collections' | 'browse' | 'library' | 'mine'
  // viewer
  imageQuality: 'auto' | 'sample' | 'original'
  videoQuality: 'auto' | 'original' | '720p' | '480p'
  autoplay: boolean
  startMuted: boolean
  muted: boolean
  loopVideos: boolean
  /** A-B loop in the gallery: mark a start and an end (A, or its button) and play that part over. */
  abLoop: boolean
  volume: number
  seekStep: number
  wheelAction: WheelAction
  idleDelay: number
  /** The mouse pointer goes with the controls when they hide (the gallery). */
  hideCursor: boolean
  /** Phones: Share (or Copy link) in the gallery's bar. */
  galleryShare: boolean
  /** Slideshow: seconds a picture stays (a video plays to its end). */
  slideshowSeconds: number
  // touch (gallery and feed)
  /** A double tap on a picture: zoom, save to favourites, vote up, or nothing (single taps then act at once). */
  doubleTap: DoubleTap
  /** A double tap on a video: seek on the sides and play / pause in the middle, or the picture's action. */
  doubleTapVideo: 'seek' | 'same'
  /** The thumb that holds the phone: the gallery's actions and the feed's rail sit on its side. */
  hand: 'right' | 'left'
  /** Swiping sideways steps between posts. */
  swipeStep: boolean
  /** Swiping down closes the gallery. */
  swipeClose: boolean
  /** A finger held on a playing video plays it at 2× until lifted. */
  holdFast: boolean
  /** A long press on a picture opens the post's menu, or the browser's own. */
  longPress: 'menu' | 'browser'
  /** A short vibration when a touch acts (double tap, long press, hold), where the browser can. */
  vibrate: boolean
  /** The feed's videos play with sound (they start muted until it is turned on). */
  feedSound: boolean
  /** In full screen, the screen turns to a video's orientation (where the browser can lock it). */
  videoTurn: boolean
  /** The browser's cast button on videos (Chrome shows one when a cast device is on the network). */
  castButton: boolean
  infoPanel: boolean
  showNotes: boolean
  zoomMode: 'fit' | 'width' | 'actual'
  // preloading
  preloadMode: PreloadMode
  /** How far ahead result lists load while scrolling: thumbnails of the next screens, the next pages. */
  gridPreload: PreloadMode
  // saving
  filenamePattern: string
  syncRemoteFavorites: boolean
  sendAccountAlways: boolean
  /** Saving a post to favourites votes it up on the account too. */
  upvoteOnFavorite: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  layout: 'justified',
  layoutPhone: 'masonry',
  thumbSize: 220,
  thumbSizePhone: 220,
  gridFit: 'contain',
  pageSize: 75,
  blacklistMode: 'hide',
  skipBlacklisted: false,
  blacklistSearched: false,
  showThumbStats: true,
  hoverPreload: true,
  hoverScrub: true,
  fx: true,
  homeTrends: true,
  seenPosts: 'show',
  pauseHistory: false,
  appBadge: true,
  lockIdle: 15,
  lockHidden: 5,
  coverHidden: false,
  defaultFilter: '',
  blockFlash: true,
  poolLayout: 'list',
  poolReader: 'grid',
  poolsTab: 'browse',
  setsTab: 'collections',
  imageQuality: 'auto',
  videoQuality: 'auto',
  autoplay: true,
  startMuted: false,
  muted: false,
  loopVideos: true,
  abLoop: true,
  volume: 0.8,
  seekStep: 5,
  wheelAction: 'zoom',
  idleDelay: 2500,
  hideCursor: true,
  galleryShare: true,
  slideshowSeconds: 6,
  doubleTap: 'zoom',
  doubleTapVideo: 'seek',
  hand: 'right',
  swipeStep: true,
  swipeClose: true,
  holdFast: true,
  longPress: 'menu',
  vibrate: true,
  feedSound: false,
  videoTurn: true,
  castButton: false,
  infoPanel: false,
  showNotes: true,
  zoomMode: 'fit',
  preloadMode: 'balanced',
  gridPreload: 'balanced',
  filenamePattern: '{id}-{artist}.{ext}',
  syncRemoteFavorites: true,
  sendAccountAlways: false,
  upvoteOnFavorite: false,
}

export const useSettings = defineStore('settings', () => {
  // Before 1.2.1 the wheel had an on/off "step between posts" switch: keep that choice.
  const stored = readJson<Partial<Settings> & { wheelNavigation?: boolean }>('settings', {})
  const s = persistent<Settings>('settings', { ...DEFAULT_SETTINGS }, { merge: true })
  if (stored.wheelAction === undefined && stored.wheelNavigation) s.value.wheelAction = 'navigate'
  delete (s.value as Partial<Settings> & { wheelNavigation?: boolean }).wheelNavigation
  // Before 1.9.1 a double-click on a thumbnail could switch every picture to 1:1 without anyone
  // choosing it: start again from Fit, once.
  if (!readJson<boolean>('zoom-reset-1.9.1', false)) {
    s.value.zoomMode = 'fit'
    writeJson('zoom-reset-1.9.1', true)
  }
  // Since 1.18.0 the wheel zooms by default: the old default (nothing) becomes Zoom, once; a choice
  // made after that stays.
  if (!readJson<boolean>('wheel-zoom-1.18', false)) {
    if (s.value.wheelAction === 'none') s.value.wheelAction = 'zoom'
    writeJson('wheel-zoom-1.18', true)
  }
  function reset() {
    s.value = { ...DEFAULT_SETTINGS }
  }
  return { s, reset }
})
