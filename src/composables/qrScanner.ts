/* Reading QR codes with the camera, inside the app: the browser's own BarcodeDetector where it has
   one (Chrome, Edge, Android), otherwise jsQR (loaded only then) on frames drawn to a small canvas. */

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

export class CameraUnavailableError extends Error {}

/** Start the camera into `video` and call `onText` with each code read; return true from it to stop.
    Resolves to a function that stops the camera. */
export async function startQrScanner(video: HTMLVideoElement, onText: (text: string) => boolean | void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraUnavailableError('This browser gives no access to a camera here.')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
  } catch (e) {
    const name = (e as DOMException).name
    throw new CameraUnavailableError(
      name === 'NotAllowedError' ? 'Camera access was refused: allow it in the browser, or enter the code instead.' : 'No camera could be opened: enter the code instead.',
    )
  }
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  let detector: Detector | null = null
  let jsQR: typeof import('jsqr').default | null = null
  try {
    await video.play().catch(() => {})
    const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector
    try {
      if (Native && (await Native.getSupportedFormats()).includes('qr_code')) detector = new Native({ formats: ['qr_code'] })
    } catch {
      detector = null
    }
    if (!detector) jsQR = (await import('jsqr')).default
  } catch {
    // The reader could not be loaded (offline, say): the camera goes off again.
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    throw new CameraUnavailableError('The code reader could not be loaded: enter the code instead.')
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  let stopped = false
  const stop = () => {
    stopped = true
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
  }
  const tick = async () => {
    if (stopped) return
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        let text: string | undefined
        if (detector) text = (await detector.detect(video))[0]?.rawValue
        else if (jsQR && ctx) {
          const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight))
          const w = Math.round(video.videoWidth * scale)
          const h = Math.round(video.videoHeight * scale)
          canvas.width = w
          canvas.height = h
          ctx.drawImage(video, 0, 0, w, h)
          text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' })?.data
        }
        if (text && onText(text) === true) return stop()
      }
    } catch {
      /* a frame that could not be read: try the next one */
    }
    if (!stopped) setTimeout(tick, 120)
  }
  void tick()
  return stop
}
