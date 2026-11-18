// Live audio plumbing for the sales call: cut a continuous stream into
// utterance-sized recordings (voice-activity detection on the signal level)
// so each one can be transcribed on its own.

export interface SegmentInfo {
  startedAt: number
  durationMs: number
  speechMs: number
  // Share of this segment's speech during which the OTHER stream was also
  // speaking — close to 1 means the mic was just hearing the speakers.
  overlapRatio: number
}

const MIN_SPEECH_MS = 250     // less than this is a click, not speech
const END_SILENCE_MS = 700    // pause that ends an utterance
const SOFT_MAX_MS = 12_000    // long monologue: cut at the next short pause…
const HARD_MAX_MS = 20_000    // …or here regardless
const IDLE_RESTART_MS = 4_000 // keep leading silence in a segment short

export class UtteranceRecorder {
  level = 0

  private cur: { rec: MediaRecorder; chunks: Blob[]; startedAt: number } | null = null
  private speechMs = 0
  private silenceMs = 0
  private overlapMs = 0
  private lastTick = 0
  private stopped = false
  private readonly buf: Float32Array<ArrayBuffer>

  constructor(
    private readonly stream: MediaStream,
    private readonly analyser: AnalyserNode,
    private readonly opts: {
      threshold: number
      mimeType: string
      onSegment: (blob: Blob, info: SegmentInfo) => void
      otherActive?: () => boolean
    },
  ) {
    this.buf = new Float32Array(analyser.fftSize)
  }

  get speaking() {
    return this.level > this.opts.threshold
  }

  start() {
    this.begin()
  }

  // Drive this from a timer that is NOT throttled in background tabs
  // (see startTicker) — during a call the user is looking at the Meet tab.
  tick(now: number) {
    if (this.stopped || !this.cur) return
    const dt = Math.min(Math.max(now - this.lastTick, 0), 250)
    this.lastTick = now

    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    this.level = Math.sqrt(sum / this.buf.length)

    if (this.speaking) {
      this.speechMs += dt
      this.silenceMs = 0
      if (this.opts.otherActive?.()) this.overlapMs += dt
    } else {
      this.silenceMs += dt
    }

    const dur = now - this.cur.startedAt
    const hasSpeech = this.speechMs >= MIN_SPEECH_MS
    if (hasSpeech && this.silenceMs >= END_SILENCE_MS) this.cut(true)
    else if (dur >= SOFT_MAX_MS && this.silenceMs >= 250) this.cut(hasSpeech)
    else if (dur >= HARD_MAX_MS) this.cut(hasSpeech)
    else if (!hasSpeech && dur >= IDLE_RESTART_MS && this.silenceMs >= 500) this.cut(false)
  }

  // Flush what is being said right now and stop for good
  stop() {
    if (this.stopped) return
    this.stopped = true
    this.cut(this.speechMs >= MIN_SPEECH_MS)
  }

  private begin() {
    try {
      const chunks: Blob[] = []
      const rec = new MediaRecorder(this.stream, {
        ...(this.opts.mimeType ? { mimeType: this.opts.mimeType } : {}),
        audioBitsPerSecond: 32_000,
      })
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      rec.start()
      const now = Date.now()
      this.cur = { rec, chunks, startedAt: now }
      this.speechMs = 0
      this.silenceMs = 0
      this.overlapMs = 0
      this.lastTick = now
    } catch {
      // The track ended (e.g. tab sharing was stopped) — nothing left to record
      this.stopped = true
      this.cur = null
    }
  }

  // Each segment is its own MediaRecorder run, so every blob is a complete,
  // independently decodable file.
  private cut(keep: boolean) {
    const cur = this.cur
    if (!cur) return
    const info: SegmentInfo = {
      startedAt: cur.startedAt,
      durationMs: Date.now() - cur.startedAt,
      speechMs: this.speechMs,
      overlapRatio: this.speechMs > 0 ? this.overlapMs / this.speechMs : 0,
    }
    cur.rec.onstop = () => {
      if (keep && cur.chunks.length > 0) {
        this.opts.onSegment(new Blob(cur.chunks, { type: cur.rec.mimeType || this.opts.mimeType }), info)
      }
    }
    try { cur.rec.stop() } catch { /* already inactive */ }
    this.cur = null
    if (!this.stopped) this.begin()
  }
}

// A steady tick from a Web Worker: unlike setInterval on the page, it keeps
// its rate while the tab is in the background.
export function startTicker(onTick: () => void, ms = 50): () => void {
  const url = URL.createObjectURL(
    new Blob([`setInterval(function(){postMessage(0)},${ms})`], { type: 'application/javascript' }),
  )
  const worker = new Worker(url)
  worker.onmessage = onTick
  return () => {
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}

export function pickAudioMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}
