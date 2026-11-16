// Live speech-to-text for the Standup speaker, using the browser's Web Speech API
// (Chrome, Edge, Safari). Where it isn't available the game simply runs without a transcript.

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

const Ctor = (): (new () => Recognition) | undefined =>
  (window as unknown as Record<string, unknown>).SpeechRecognition as never ??
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition as never;

export const speechSupported = () => !!Ctor();

/** Start listening. `onText` gets the whole transcript so far. Returns a stop function. */
export function startSpeech(onText: (text: string) => void, onState: (listening: boolean) => void): () => void {
  const SR = Ctor();
  if (!SR) return () => {};
  let stopped = false;
  let finals = '';
  let rec: Recognition | null = null;

  const begin = () => {
    if (stopped) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let sessionFinal = '';
    rec.onresult = (e) => {
      let interim = '';
      sessionFinal = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) sessionFinal += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      onText((finals + sessionFinal + interim).replace(/\s+/g, ' ').trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true;
    };
    // Mobile browsers end recognition after a pause; pick up where we left off.
    rec.onend = () => {
      finals += sessionFinal;
      if (stopped) onState(false);
      else setTimeout(begin, 250);
    };
    try {
      rec.start();
      onState(true);
    } catch {
      onState(false);
    }
  };

  begin();
  return () => {
    stopped = true;
    try {
      rec?.stop();
    } catch {
      // already stopped
    }
    onState(false);
  };
}
