// Everything the browser remembers between visits lives here.

// `?as=anything` gives a tab its own identity, so several players can be tested in one browser.
const seat = new URLSearchParams(location.search).get('as');
const scope = seat ? `fa_${seat.replace(/[^a-z0-9]/gi, '')}_` : 'fa_';
const store: Storage | null = (() => {
  try {
    return seat ? sessionStorage : localStorage;
  } catch {
    return null;
  }
})();

const KEYS = { playerId: `${scope}player_id`, name: `${scope}name`, room: `${scope}room`, settings: 'fa_settings' } as const;

function read(key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Private mode or storage disabled: the app still works for this visit.
  }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Settings {
  sound: boolean;
  experimental: boolean;
  oneoNumbersOnly: boolean;
  fortressMode: '10' | '50' | '100' | 'endless';
}

const DEFAULT_SETTINGS: Settings = { sound: true, experimental: false, oneoNumbersOnly: false, fortressMode: '10' };

export const storage = {
  playerId(): string {
    let id = read(KEYS.playerId);
    if (!id) {
      id = newId();
      write(KEYS.playerId, id);
    }
    return id;
  },
  name: () => read(KEYS.name) ?? '',
  setName: (name: string) => write(KEYS.name, name),
  room: () => read(KEYS.room),
  setRoom: (code: string | null) => write(KEYS.room, code),
  settings(): Settings {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(read(KEYS.settings) ?? '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },
  setSettings: (s: Settings) => write(KEYS.settings, JSON.stringify(s)),
};
