import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_SUGGESTIONS, type AnthropicMessage } from '@casacontrol/shared';
import { runAssistantChat, getSuggestions } from '../lib/assistant';
import { useVoiceInput } from '../lib/useVoiceInput';
import { useThemeColors, useThemeVars } from '../lib/theme';
import { RichText } from './RichText';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

/** Recognition languages for voice input. The recognizer needs to be told which. */
const LANGS = [
  { code: 'en-US', label: 'EN' },
  { code: 'fr-FR', label: 'FR' },
] as const;
const LANG_KEY = 'voice_lang';

/** Floating assistant button → a multi-turn chat that can act on the home. */
export function AssistantFab() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<AnthropicMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const [lang, setLang] = useState<string>('en-US');
  const theme = useThemeColors();
  const themeVars = useThemeVars();
  const scrollRef = useRef<ScrollView>(null);

  // Restore the last-used voice language.
  useEffect(() => {
    void SecureStore.getItemAsync(LANG_KEY).then((v) => {
      if (v) setLang(v);
    });
  }, []);

  // Fetch fresh, state-aware suggestions each time the sheet opens empty.
  useEffect(() => {
    if (open && turns.length === 0) {
      void getSuggestions().then(setSuggestions).catch(() => {});
    }
  }, [open, turns.length]);

  useEffect(() => {
    if (turns.length) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [turns, busy]);

  const submit = async (command?: string) => {
    const q = (command ?? text).trim();
    if (!q || busy) return;
    setText('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { reply, history: h } = await runAssistantChat(q, history);
      setHistory(h);
      setTurns((t) => [...t, { role: 'assistant', text: reply }]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: 'assistant', text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    setTurns([]);
    setHistory([]);
    setText('');
  };

  // Voice input → fills the box live, and auto-sends on the final transcript.
  const { recognizing, toggle: toggleVoice, abort } = useVoiceInput({
    onTranscript: (t, isFinal) => {
      setText(t);
      if (isFinal) void submit(t);
    },
    onError: (msg) => setTurns((t) => [...t, { role: 'assistant', text: msg }]),
  });

  // Stop listening if the sheet is dismissed mid-dictation.
  useEffect(() => {
    if (!open && recognizing) abort();
  }, [open, recognizing, abort]);

  const cycleLang = () => {
    const idx = (LANGS.findIndex((l) => l.code === lang) + 1) % LANGS.length;
    const next = (LANGS[idx] ?? LANGS[0]).code;
    setLang(next);
    void SecureStore.setItemAsync(LANG_KEY, next);
  };
  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? 'EN';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="absolute bottom-6 right-6 w-16 h-16 rounded-full bg-gold items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <Ionicons name="sparkles" size={28} color={theme.accentInk} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end"
          style={themeVars}
        >
          <Pressable className="flex-1" onPress={() => setOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 pb-10" style={{ maxHeight: '80%' }}>
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-ink text-xl font-bold">Ask CasaControl</Text>
              <View className="flex-row items-center gap-1">
                <Pressable
                  onPress={cycleLang}
                  className="px-2.5 py-1 mr-1 rounded-full bg-offWhite border border-line/5 active:opacity-60"
                >
                  <Text className="text-ink/60 text-xs font-semibold">{langLabel}</Text>
                </Pressable>
                {turns.length > 0 && (
                  <Pressable onPress={newChat} className="p-1 flex-row items-center active:opacity-60">
                    <Ionicons name="add-circle-outline" size={20} color={theme.muted} />
                    <Text className="text-ink/50 text-xs ml-1">New</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setOpen(false)} className="p-1 ml-2">
                  <Ionicons name="close" size={24} color={theme.muted} />
                </Pressable>
              </View>
            </View>

            {turns.length > 0 ? (
              <ScrollView
                ref={scrollRef}
                className="mb-4"
                style={{ maxHeight: 360 }}
                contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
                keyboardShouldPersistTaps="handled"
              >
                {turns.map((t, i) => (
                  <View
                    key={i}
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      t.role === 'user'
                        ? 'self-end bg-gold rounded-br-sm'
                        : 'self-start bg-offWhite border border-line/5 rounded-bl-sm'
                    }`}
                  >
                    {t.role === 'user' ? (
                      <Text className="text-accentInk leading-5">{t.text}</Text>
                    ) : (
                      <RichText text={t.text} color={theme.ink} />
                    )}
                  </View>
                ))}
                {busy && (
                  <View className="self-start bg-offWhite border border-line/5 rounded-2xl rounded-bl-sm px-4 py-3">
                    <ActivityIndicator color={theme.gold} size="small" />
                  </View>
                )}
              </ScrollView>
            ) : (
              <View className="flex-row flex-wrap gap-2 mb-4">
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => submit(s)}
                    className="bg-offWhite border border-line/5 rounded-full px-3 py-1.5 active:opacity-70"
                  >
                    <Text className="text-ink/60 text-xs">{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View className="flex-row items-center gap-2">
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={recognizing ? 'Listening…' : 'Ask, command, or tap the mic…'}
                placeholderTextColor={theme.muted}
                onSubmitEditing={() => submit()}
                returnKeyType="send"
                editable={!busy && !recognizing}
                className="flex-1 bg-offWhite rounded-full px-4 py-3 text-ink border border-line/5"
              />
              <Pressable
                onPress={() => toggleVoice(lang)}
                disabled={busy}
                className={`w-12 h-12 rounded-full items-center justify-center active:opacity-80 disabled:opacity-40 ${
                  recognizing ? 'bg-red-500' : 'bg-offWhite border border-line/5'
                }`}
              >
                <Ionicons name="mic" size={22} color={recognizing ? '#FFFFFF' : theme.ink} />
              </Pressable>
              <Pressable
                onPress={() => submit()}
                disabled={busy}
                className="w-12 h-12 rounded-full bg-gold items-center justify-center active:opacity-80 disabled:opacity-40"
              >
                {busy ? (
                  <ActivityIndicator color={theme.accentInk} />
                ) : (
                  <Ionicons name="arrow-up" size={22} color={theme.accentInk} />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
