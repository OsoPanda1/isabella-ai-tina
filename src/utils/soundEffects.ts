import { getAudioContextConstructor } from "./audioContext";

class SoundManager {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioContextClass = getAudioContextConstructor();
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playBeep(freq = 600, duration = 0.04, type: OscillatorType = "sine", gainVal = 0.03): void {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio playback fails silently if browser policy blocks autoplay before interaction
    }
  }

  playSuccess(): void {
    this.playBeep(880, 0.04, "sine", 0.03);
    setTimeout(() => this.playBeep(1320, 0.06, "sine", 0.03), 50);
  }

  playArrival(): void {
    this.playBeep(523.25, 0.05, "sine", 0.03);
    setTimeout(() => this.playBeep(659.25, 0.05, "sine", 0.03), 60);
    setTimeout(() => this.playBeep(783.99, 0.08, "sine", 0.03), 120);
  }

  playSynapseRoute(): void {
    this.playBeep(740, 0.03, "triangle", 0.02);
    setTimeout(() => this.playBeep(980, 0.04, "triangle", 0.02), 40);
  }

  playModuleEngage(freq = 800): void {
    this.playBeep(freq, 0.05, "sine", 0.03);
  }

  playChime(): void {
    this.playSuccess();
  }

  playPulse(): void {
    this.playBeep(440, 0.03, "sine", 0.02);
  }

  playWarning(): void {
    this.playBeep(320, 0.08, "sawtooth", 0.04);
  }

  play(_sound?: unknown): void {
    this.playBeep(600, 0.03);
  }
}

export const soundManager = new SoundManager();
