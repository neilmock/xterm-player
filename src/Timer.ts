export const TICK_INTERVAL = 1000 / 30

type TickerCallback = () => void

export interface ITicker {
  start(cb: TickerCallback): void
  stop(): void
  now(): number
}

export class DummyTicker implements ITicker {
  private _cb: TickerCallback | null = null
  private _time: number = 0

  constructor(private _interval: number = TICK_INTERVAL) { }

  public start(cb: TickerCallback): void {
    this._cb = cb
  }
  public stop(): void {
    this._cb = null
  }
  public now(): number {
    return this._time
  }
  public tick(): void {
    this._time += this._interval
    if (this._cb) {
      this._cb()
    }
  }
}

export class IntervalTicker implements ITicker {
  private _tid: NodeJS.Timeout | null = null
  public constructor(public interval: number = TICK_INTERVAL) { }
  public start(cb: TickerCallback): void {
    this.stop()
    this._tid = setInterval(cb, this.interval)
  }
  public stop(): void {
    if (this._tid) {
      clearInterval(this._tid)
      this._tid = null
    }
  }
  public now(): number { return Date.now() }
}

export class AnimationFrameTicker implements ITicker {
  private _rafid: number = 0
  private _cb: TickerCallback | null = null
  private _tick() {
    if (this._cb) { this._cb() }
    if (this._rafid) {
      this._rafid = requestAnimationFrame(this._tick.bind(this))
    }
  }
  public start(cb: TickerCallback): void {
    this.stop()
    this._cb = cb
    this._rafid = requestAnimationFrame(this._tick.bind(this))
  }
  public stop(): void {
    if (this._rafid) {
      cancelAnimationFrame(this._rafid)
      this._rafid = 0
    }
    this._cb = null
  }
  public now(): number { return performance.now() }
}

const TIMESCALE_MIN = 0, TIMESCALE_MAX = 5

export enum ITimerState { RUNNING, PAUSED, STOPPED }
export type ITimerReadyCallback = () => void
export type ITimerTickCallback = (time: number) => void
export type ITimerStateChangeCallback = (state: ITimerState) => void

export interface ITimer {
  readonly ready: boolean
  readonly state: ITimerState
  readonly duration: number
  readonly progress: number
  timescale: number
  time: number

  start(): void
  pause(): void
  stop(): void

  isRunning(): boolean
  isPaused(): boolean
  isStopped(): boolean

  onReady(cb: ITimerReadyCallback): ITimer
  onTick(cb: ITimerTickCallback): ITimer
  onStateChange(cb: ITimerStateChangeCallback): ITimer
}

export class SimpleTimer implements ITimer {
  public readonly ready = true
  private _lasttime: number = 0
  private _time: number = 0
  private _delay: number = 0
  private _timescale: number = 1
  private _state: ITimerState = ITimerState.PAUSED
  private _onReadyCb: ITimerReadyCallback = () => { }
  private _onTickCb: ITimerTickCallback = () => { }
  private _onStateChangeCb: ITimerStateChangeCallback = () => { }

  public constructor(
    private _ticker: ITicker,
    private _duration: number = Infinity
  ) { }

  public get duration(): number { return this._duration }

  public get timescale(): number { return this._timescale }
  public set timescale(timescale: number) {
    if (timescale <= TIMESCALE_MIN || timescale > TIMESCALE_MAX) {
      throw new Error(`timescale must be between ${TIMESCALE_MIN} and ${TIMESCALE_MAX}`)
    }
    this._timescale = timescale
  }

  public get time(): number { return this._time }
  public set time(time: number) {
    if (time < 0) { time = 0 }
    if (time === this._time) { return }
    if (time > this._duration) {
      this._time = this._duration
      this.stop()
    } else {
      this._time = time
    }
    this._delay = 0
    this._lasttime = this._ticker.now()
  }

  private _setState(state: ITimerState): void {
    if (this._state !== state) {
      this._state = state
      this._onStateChangeCb(this._state)
    }
  }

  public get state(): ITimerState { return this._state }
  public get progress(): number { return this.time / this._duration }

  public onReady(cb: ITimerReadyCallback): ITimer {
    this._onReadyCb = cb
    this._onReadyCb() // This is intended to make initialization process the same as MediaTimer
    return this
  }
  public onTick(cb: ITimerTickCallback): ITimer {
    this._onTickCb = cb
    return this
  }
  public onStateChange(cb: ITimerStateChangeCallback): ITimer {
    this._onStateChangeCb = cb
    return this
  }

  public isRunning(): boolean { return this._state === ITimerState.RUNNING }
  public isPaused(): boolean { return this._state === ITimerState.PAUSED }
  public isStopped(): boolean { return this._state === ITimerState.STOPPED }

  public start(): void {
    if (this.isRunning()) {
      return
    }
    if ((!this.isRunning()) && (this.time >= this._duration)) {
      return
    }
    this._setState(ITimerState.RUNNING)
    this._lasttime = this._ticker.now()
    this._ticker.start(() => {
      const now = this._ticker.now()

      let elapsed = now - this._lasttime
      if (this._delay) {
        if (elapsed > this._delay) {
          elapsed -= this._delay
          this._delay = 0
        } else {
          this._delay -= elapsed
        }
        this._lasttime = now
        return
      }

      const delta = elapsed * this._timescale
      if ((this._time + delta) > this._duration) {
        this._time = this._duration
        this.stop()
      } else {
        this._time += delta
      }
      this._lasttime = now
      this._onTickCb(this._time)
    })
  }
  public pause(): void {
    this._ticker.stop()
    this._setState(ITimerState.PAUSED)
  }
  public stop(): void {
    this._ticker.stop()
    this._setState(ITimerState.STOPPED)
  }
  public delay(t: number): void {
    if (t > 0) {
      this._delay += t
    }
  }
}

export class MediaTimer implements ITimer {
  private _ready: boolean = false
  private _state: ITimerState = ITimerState.PAUSED
  private _ticker = new AnimationFrameTicker()
  private _onReadyCb: ITimerReadyCallback = () => { }
  private _onTickCb: ITimerTickCallback = () => { }
  private _onStateChangeCb: ITimerStateChangeCallback = () => { }

  constructor(private _media: HTMLMediaElement) {
    this._media.addEventListener('canplay', () => { this._ready = true; this._onReadyCb() })
    this._media.addEventListener('play', () => { this._setState(ITimerState.RUNNING) })
    this._media.addEventListener('pause', () => { this._setState(ITimerState.PAUSED) })
    this._media.addEventListener('ended', () => {
      this.stop()
      this._onTickCb(this.time)
    })
  }

  public get ready(): boolean { return this._ready }
  public get progress(): number { return this._media.currentTime / this._media.duration }
  public get duration(): number { return this._media.duration * 1000 }
  public get state(): ITimerState { return this._state }
  public get time(): number { return this._media.currentTime * 1000 }
  public set time(t: number) { if (this._ready) { this._media.currentTime = t / 1000 } }
  public get timescale(): number { return this._media.playbackRate }
  public set timescale(s: number) { this._media.playbackRate = s }

  private _setState(state: ITimerState) {
    if (this._state !== state) {
      this._state = state
      this._onStateChangeCb(this._state)
    }
  }

  public start(): void {
    if (!this._ready) { return }
    this._ticker.start(() => {
      this._onTickCb(this.time)
    })
    this._media.play()
  }
  public pause(): void {
    if (!this._ready) { return }
    this._ticker.stop()
    this._media.pause()
  }
  public stop(): void {
    if (!this._ready) { return }
    this._ticker.stop()
    this._setState(ITimerState.STOPPED)
  }
  public isRunning(): boolean { return !this._media.paused && !this._media.ended }
  public isPaused(): boolean { return this._media.paused }
  public isStopped(): boolean { return this._media.ended || (this._ready && (this._media.currentTime >= this._media.duration)) }

  public onReady(cb: ITimerReadyCallback): ITimer {
    this._onReadyCb = cb
    return this
  }
  public onTick(cb: ITimerTickCallback): ITimer {
    this._onTickCb = cb
    return this
  }
  public onStateChange(cb: ITimerStateChangeCallback): ITimer {
    this._onStateChangeCb = cb
    return this
  }
}
