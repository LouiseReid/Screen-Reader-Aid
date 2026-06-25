import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Settings {
  liveTracking: boolean;
  pinned: boolean;
  opacity: number;
  captureShortcut: string;
  hasOnboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  liveTracking: true,
  pinned: true,
  opacity: 1,
  captureShortcut: 'CommandOrControl+Shift+A',
  hasOnboarded: false,
};

const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < OPACITY_MIN) return OPACITY_MIN;
  if (value > OPACITY_MAX) return OPACITY_MAX;
  return value;
}

function pickShortcut(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

export function mergeSettings(
  input: unknown,
  defaults: Settings = DEFAULT_SETTINGS,
): Settings {
  if (!isPlainObject(input)) return { ...defaults };
  return {
    liveTracking: pickBoolean(input.liveTracking, defaults.liveTracking),
    pinned: pickBoolean(input.pinned, defaults.pinned),
    opacity: pickOpacity(input.opacity, defaults.opacity),
    captureShortcut: pickShortcut(input.captureShortcut, defaults.captureShortcut),
    hasOnboarded: pickBoolean(input.hasOnboarded, defaults.hasOnboarded),
  };
}

export type SettingsListener = (settings: Settings) => void;

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<SettingsListener>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      this.current = mergeSettings(parsed);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn('[settings] failed to read', this.filePath, err);
      }
      this.current = { ...DEFAULT_SETTINGS };
    }
    return this.current;
  }

  get(): Settings {
    return { ...this.current };
  }

  async set(partial: Partial<Settings>): Promise<Settings> {
    const next = mergeSettings({ ...this.current, ...partial });
    const changed = !shallowEqual(this.current, next);
    this.current = next;
    if (changed) {
      this.writeQueue = this.writeQueue.then(() => this.writeToDisk(next));
      await this.writeQueue;
      for (const listener of this.listeners) {
        try {
          listener(this.get());
        } catch (err) {
          console.warn('[settings] listener threw', err);
        }
      }
    }
    return this.get();
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async writeToDisk(settings: Settings): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}

function shallowEqual(a: Settings, b: Settings): boolean {
  return (
    a.liveTracking === b.liveTracking &&
    a.pinned === b.pinned &&
    a.opacity === b.opacity &&
    a.captureShortcut === b.captureShortcut &&
    a.hasOnboarded === b.hasOnboarded
  );
}
