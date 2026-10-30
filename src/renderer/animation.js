export class GPUAnimation {
  constructor({ decoder, track, draw, onFrame, onPlaying, onError }) {
    Object.assign(this, { decoder, track, draw, onFrame, onPlaying, onError });
    this.count = track.frameCount; this.index = 0; this.playing = false; this.closed = false; this.serial = 0; this.loops = 0;
  }
  static async create(bytes, type, callbacks) {
    if (!('ImageDecoder' in window) || !await ImageDecoder.isTypeSupported(type)) return null;
    const decoder = new ImageDecoder({ data: bytes, type, preferAnimation: true });
    try {
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || track.frameCount < 2) { decoder.close(); return null; }
      return new GPUAnimation({ decoder, track, ...callbacks });
    } catch (error) { decoder.close(); throw error; }
  }
  async show(index, serial) {
    const { image } = await this.decoder.decode({ frameIndex: index, completeFramesOnly: true });
    try {
      if (this.closed || serial !== this.serial) return null;
      this.draw(image); this.index = index; this.onFrame(index);
      return Math.max(20, (image.duration || 100000) / 1000);
    } finally { image.close(); }
  }
  play() {
    if (this.closed || this.playing) return;
    this.playing = true; this.loops = 0; this.onPlaying(true);
    this.tick(++this.serial);
  }
  pause() {
    this.playing = false; this.serial++; clearTimeout(this.timer); this.onPlaying(false);
  }
  async tick(serial) {
    if (this.closed || !this.playing || serial !== this.serial) return;
    const started = performance.now();
    try {
      const duration = await this.show(this.index, serial);
      if (duration === null || this.closed || serial !== this.serial) return;
      const next = this.index + 1;
      this.timer = setTimeout(() => {
        if (next >= this.count) {
          if (Number.isFinite(this.track.repetitionCount) && this.loops++ >= this.track.repetitionCount) { this.pause(); return; }
          this.index = 0;
        } else this.index = next;
        this.tick(serial);
      }, Math.max(0, duration - (performance.now() - started)));
    } catch (error) { if (!this.closed && serial === this.serial) { this.pause(); this.onError(error); } }
  }
  async seek(index) {
    this.pause();
    try { await this.show(((index % this.count) + this.count) % this.count, this.serial); }
    catch (error) { if (!this.closed) this.onError(error); }
  }
  close() { this.pause(); this.closed = true; this.decoder.close(); }
}
