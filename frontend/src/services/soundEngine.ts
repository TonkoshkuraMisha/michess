// --- FILE: frontend/src/services/soundEngine.ts ---

export type SoundEventType =
    | 'move'
    | 'capture'
    | 'check'
    | 'castle'
    | 'promote'
    | 'premove'
    | 'illegal'
    | 'start'
    | 'victory'
    | 'defeat'
    | 'draw'
    | 'offer'
    | 'decline'
    | 'chat'
    | 'low_time';

const MUTE_STORAGE_KEY = 'michess_sound_muted';

class SoundEngine {
    private ctx: AudioContext | null = null;
    private muted: boolean = false;

    constructor() {
        if (typeof window !== 'undefined') {
            this.muted = localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
        }
    }

    public isMuted(): boolean {
        return this.muted;
    }

    public setMuted(mute: boolean): void {
        this.muted = mute;
        if (typeof window !== 'undefined') {
            localStorage.setItem(MUTE_STORAGE_KEY, String(mute));
        }
    }

    public toggleMute(): boolean {
        this.setMuted(!this.muted);
        return this.muted;
    }

    private getContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as unknown as {
                webkitAudioContext?: typeof AudioContext
            }).webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {
            });
        }
        return this.ctx;
    }

    private playTone(
        freq: number,
        durationSec: number,
        delaySec: number = 0,
        type: OscillatorType = 'sine',
        peakGain: number = 0.14,
        endFreq?: number
    ): void {
        const ctx = this.getContext();
        if (!ctx) return;

        const startTime = ctx.currentTime + delaySec;
        const stopTime = startTime + durationSec;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        if (endFreq !== undefined) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), stopTime);
        }

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, durationSec * 0.2));
        gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(stopTime + 0.01);
    }

    /**
     * Стук фигуры о доску: короткий всплеск шума через полосовой фильтр. Звуки синтезируются
     * целиком — готовых записей в проекте нет (см. ATTRIBUTION.md), поэтому нет и вопросов
     * о лицензии на них.
     */
    private playKnock(volume: number = 0.5, centerFreq: number = 950, delaySec: number = 0): void {
        const ctx = this.getContext();
        if (!ctx) return;

        const durationSec = 0.07;
        const frameCount = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
        const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < frameCount; i++) {
            // Шум с быстрым спадом: резкая атака и короткий «деревянный» хвост.
            samples[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frameCount, 3);
        }

        const startTime = ctx.currentTime + delaySec;
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(centerFreq, startTime);
        filter.Q.setValueAtTime(1.4, startTime);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start(startTime);

        // Низкий «корпус» удара — без него стук звучит как щелчок.
        this.playTone(centerFreq / 5.5, 0.06, delaySec, 'triangle', volume * 0.3, centerFreq / 11);
    }

    public play(event: SoundEventType): void {
        if (this.muted) return;

        switch (event) {
            case 'move':
                this.playKnock(0.5, 950);
                break;

            case 'capture':
                // Взятие: два удара подряд — фигура снята, фигура поставлена.
                this.playKnock(0.55, 1500);
                this.playKnock(0.6, 800, 0.045);
                break;

            case 'castle':
                this.playKnock(0.45, 950);
                this.playKnock(0.5, 850, 0.095);
                break;

            case 'check':
                this.playKnock(0.4, 1100);
                this.playTone(587.33, 0.11, 0, 'triangle', 0.16);
                this.playTone(880.0, 0.24, 0.08, 'sine', 0.18, 830.0);
                break;

            case 'promote':
                this.playKnock(0.4, 950);
                this.playTone(523.25, 0.10, 0, 'triangle', 0.14);
                this.playTone(659.25, 0.10, 0.07, 'triangle', 0.15);
                this.playTone(783.99, 0.12, 0.14, 'triangle', 0.16);
                this.playTone(1046.5, 0.25, 0.21, 'sine', 0.18);
                break;

            case 'premove':
                this.playTone(420, 0.045, 0, 'sine', 0.09, 310);
                break;

            case 'illegal':
                this.playTone(155, 0.11, 0, 'sawtooth', 0.14, 115);
                this.playTone(130, 0.14, 0.09, 'sawtooth', 0.14, 95);
                break;

            case 'start':
                this.playTone(440.0, 0.12, 0, 'triangle', 0.12);
                this.playTone(554.37, 0.14, 0.09, 'triangle', 0.13);
                this.playTone(659.25, 0.26, 0.18, 'sine', 0.15);
                break;

            case 'chat':
                this.playTone(660, 0.07, 0, 'sine', 0.11);
                this.playTone(880, 0.11, 0.06, 'sine', 0.12);
                break;

            case 'offer':
                this.playTone(587.33, 0.14, 0, 'sine', 0.16);
                this.playTone(783.99, 0.22, 0.12, 'sine', 0.16);
                this.playTone(987.77, 0.28, 0.24, 'triangle', 0.14);
                break;

            case 'decline':
                this.playTone(440.0, 0.12, 0, 'triangle', 0.13);
                this.playTone(329.63, 0.22, 0.11, 'triangle', 0.13);
                break;

            case 'low_time':
                this.playTone(880.0, 0.08, 0, 'square', 0.11);
                this.playTone(880.0, 0.08, 0.12, 'square', 0.11);
                this.playTone(1046.5, 0.14, 0.24, 'square', 0.13);
                break;

            case 'victory':
                this.playTone(523.25, 0.12, 0, 'triangle', 0.16);
                this.playTone(659.25, 0.12, 0.10, 'triangle', 0.16);
                this.playTone(783.99, 0.14, 0.20, 'triangle', 0.17);
                this.playTone(1046.5, 0.38, 0.30, 'sine', 0.20);
                break;

            case 'defeat':
                this.playTone(392.0, 0.16, 0, 'triangle', 0.15);
                this.playTone(349.23, 0.16, 0.14, 'triangle', 0.15);
                this.playTone(311.13, 0.18, 0.28, 'triangle', 0.15);
                this.playTone(261.63, 0.40, 0.42, 'sine', 0.17);
                break;

            case 'draw':
                this.playTone(440.0, 0.16, 0, 'triangle', 0.14);
                this.playTone(523.25, 0.16, 0.14, 'triangle', 0.14);
                this.playTone(440.0, 0.30, 0.28, 'sine', 0.14);
                break;
        }
    }
}

export const soundEngine = new SoundEngine();

/**
 * Определяет подходящий звуковой эффект хода по его нотации SAN.
 */
export function resolveMoveSound(san?: string | null): SoundEventType {
    if (!san) return 'move';
    if (san.includes('#') || san.includes('+')) return 'check';
    if (san.includes('=')) return 'promote';
    if (san.startsWith('O-O')) return 'castle';
    if (san.includes('x')) return 'capture';
    return 'move';
}