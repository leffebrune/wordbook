import { useEffect, useRef, useState } from 'react';
import { loadSheet } from './sheet';
import { loadApiKey } from './settings';
import { synthesizeSpeech } from './tts';
import { idleSpeech, SpeechPlayer } from './speechPlayer';

export function useSpeech() {
  const [state, setState] = useState(idleSpeech);
  const player = useRef<SpeechPlayer | null>(null);
  useEffect(() => {
    const instance = new SpeechPlayer({
      settings: async () => {
        const sheet = await loadSheet();
        return { model: sheet.ttsModel, voice: sheet.ttsVoice };
      },
      generate: synthesizeSpeech,
      audio: () => new Audio(),
      createUrl: blob => URL.createObjectURL(blob),
      revokeUrl: url => URL.revokeObjectURL(url)
    }, setState);
    player.current = instance;
    const onPageHide = () => instance.stop();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      instance.dispose();
      player.current = null;
    };
  }, []);
  return {
    state,
    read: (id: string, text: string) => player.current?.read(id, text, loadApiKey()),
    stop: () => player.current?.stop(),
    stopIf: (id: string) => player.current?.stopIf(id)
  };
}
