/**
 * Voice input for the assistant: on-device speech-to-text via
 * expo-speech-recognition (Android SpeechRecognizer). The recognized transcript
 * is fed to the existing tool-use agent, so voice commands work exactly like
 * typed ones. `lang` selects the recognition language (e.g. 'en-US' / 'fr-FR');
 * the recognizer needs to know which language it's transcribing.
 */
import { useCallback, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

interface Options {
  /** Fired for interim + final results. `isFinal` marks the last transcript. */
  onTranscript: (text: string, isFinal: boolean) => void;
  /** Human-readable error to surface (permission denied, no speech, etc.). */
  onError?: (message: string) => void;
}

function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is off. Enable it in Settings to use voice.';
    case 'no-speech':
      return "I didn't catch that — try again.";
    case 'network':
      return 'Speech recognition needs a network connection right now.';
    case 'language-not-supported':
      return "That language isn't available for voice on this device.";
    default:
      return message || 'Voice recognition failed. Try again.';
  }
}

/** Speech-to-text controller. Call `toggle(lang)` to start/stop dictation. */
export function useVoiceInput({ onTranscript, onError }: Options) {
  const [recognizing, setRecognizing] = useState(false);
  // Keep the latest callbacks in a ref so the (once-subscribed) event handlers
  // always call the current closures without re-subscribing each render.
  const cb = useRef({ onTranscript, onError });
  cb.current = { onTranscript, onError };

  useSpeechRecognitionEvent('start', () => setRecognizing(true));
  useSpeechRecognitionEvent('end', () => setRecognizing(false));
  useSpeechRecognitionEvent('result', (e) => {
    const transcript = e.results[0]?.transcript ?? '';
    if (transcript) cb.current.onTranscript(transcript, e.isFinal);
  });
  useSpeechRecognitionEvent('error', (e) => {
    setRecognizing(false);
    cb.current.onError?.(friendlyError(e.error, e.message));
  });

  const start = useCallback(async (lang: string) => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        cb.current.onError?.('Microphone access is off. Enable it in Settings to use voice.');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
      });
    } catch (err) {
      setRecognizing(false);
      cb.current.onError?.(err instanceof Error ? err.message : 'Could not start voice input.');
    }
  }, []);

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  /** Stop immediately without emitting a final result (used when closing UI). */
  const abort = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
  }, []);

  const toggle = useCallback(
    (lang: string) => {
      if (recognizing) stop();
      else void start(lang);
    },
    [recognizing, start, stop],
  );

  return { recognizing, toggle, stop, abort };
}
