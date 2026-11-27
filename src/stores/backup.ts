import { defineStore } from 'pinia'
import { computed } from 'vue'
import { persistent, vaultMeta } from './persist'
import { useSites } from './sites'
import { collectData } from '@/services/backupData'
import { saveJson } from '@/services/download'
import { APP_VERSION } from '@/api/client'

/* When the data was last saved to a file, and the reminder to do it (components/BackupReminder):
   pawbs' data lives in this browser alone, which may clear it. */
const DAY = 86_400_000

export const useBackup = defineStore('backup', () => {
  /** The last backup file saved (ms), 0 for none. */
  const last = persistent<number>('backup:last', 0)
  /** "Not now" on the reminder. */
  const snoozed = persistent<number>('backup:snoozed', 0)
  /** The first start that knew about backups: no reminder in the first week. */
  const since = persistent<number>('backup:since', 0)
  if (!since.value) since.value = Date.now()

  /** A reminder is due: a week of use, no backup or reminder for a month. */
  function due(now = Date.now()): boolean {
    return now - since.value > 7 * DAY && now - last.value > 30 * DAY && now - snoozed.value > 30 * DAY
  }

  /** The file would hold secrets (an API key, data kept encrypted): it is then saved from Settings ›
      Data, where it gets a password. */
  const needsPassword = computed(() => useSites().sites.some((s) => !!s.apiKey) || !!vaultMeta())

  /** One tap, when nothing in it needs a password. */
  function savePlain() {
    const head = { app: 'NgGallery', version: APP_VERSION, exportedAt: new Date().toISOString() }
    saveJson({ ...head, data: collectData() }, `pawbs-backup-${head.exportedAt.slice(0, 10)}.json`)
    last.value = Date.now()
  }

  return { last, snoozed, since, due, needsPassword, savePlain }
})
