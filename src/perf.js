export class FrameMeter {
  constructor(sampleSeconds = 0.75) {
    this.sampleSeconds = Math.max(0.25, Number(sampleSeconds) || 0.75);
    this.frames = 0;
    this.elapsed = 0;
    this.worstFrameMs = 0;
    this.maxCalls = 0;
    this.maxTriangles = 0;
  }

  sample(elapsedSeconds, render = {}) {
    const elapsed = Number(elapsedSeconds);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return null;
    this.frames++;
    this.elapsed += elapsed;
    this.worstFrameMs = Math.max(this.worstFrameMs, elapsed * 1000);
    this.maxCalls = Math.max(this.maxCalls, Number(render.calls) || 0);
    this.maxTriangles = Math.max(this.maxTriangles, Number(render.triangles) || 0);
    if (this.elapsed + 1e-9 < this.sampleSeconds) return null;

    const snapshot = {
      fps: Math.max(0, Math.round(this.frames / this.elapsed)),
      frameMs: this.frames ? (this.elapsed * 1000) / this.frames : 0,
      worstFrameMs: this.worstFrameMs,
      calls: this.maxCalls,
      triangles: this.maxTriangles,
    };
    this.frames = 0;
    this.elapsed = 0;
    this.worstFrameMs = 0;
    this.maxCalls = 0;
    this.maxTriangles = 0;
    return snapshot;
  }
}

export function fpsBand(fps) {
  const value = Number(fps) || 0;
  if (value < 30) return 'bad';
  if (value < 50) return 'warn';
  return 'good';
}
