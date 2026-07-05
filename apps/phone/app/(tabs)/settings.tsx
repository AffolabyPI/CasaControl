import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { HUB_SERVER_PORT } from '@casacontrol/shared';
import { connectionStore, useConnection } from '../../lib/connection';
import { getApiKey, setApiKey } from '../../lib/assistant';
import { useThemeColors, useThemeMode, setThemeMode, type ThemeMode } from '../../lib/theme';

export default function Settings() {
  const theme = useThemeColors();
  const themeMode = useThemeMode();
  const mode = useConnection((s) => s.mode);
  const localIp = useConnection((s) => s.localIp);
  const tailscaleIp = useConnection((s) => s.tailscaleIp);
  const latencyMs = useConnection((s) => s.latencyMs);
  const reachable = useConnection((s) => s.reachable);
  const connecting = useConnection((s) => s.connecting);

  const [localDraft, setLocalDraft] = useState(localIp);
  const [remoteDraft, setRemoteDraft] = useState(tailscaleIp);
  const [apiKeyDraft, setApiKeyDraft] = useState('');

  useEffect(() => setLocalDraft(localIp), [localIp]);
  useEffect(() => setRemoteDraft(tailscaleIp), [tailscaleIp]);
  useEffect(() => {
    void getApiKey().then(setApiKeyDraft);
  }, []);

  const save = () =>
    void connectionStore
      .getState()
      .setIps({ localIp: localDraft.trim(), tailscaleIp: remoteDraft.trim() });

  // The URL actually in use for the current mode — makes it obvious that Home
  // and Remote point at different addresses.
  const activeIp = mode === 'remote' ? tailscaleIp : localIp;

  const statusColor = connecting
    ? theme.gold
    : reachable
      ? theme.online
      : theme.danger;
  const statusLabel = connecting
    ? 'Connecting…'
    : reachable
      ? 'Connected'
      : 'Hub unreachable';

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-ink text-3xl font-bold mb-6">Settings</Text>

        {/* Connection status */}
        <View className="bg-surface rounded-2xl p-4 mb-6 border border-line/5 flex-row items-center">
          {connecting ? (
            <ActivityIndicator size="small" color={theme.gold} style={{ marginRight: 12 }} />
          ) : (
            <View
              className="w-3 h-3 rounded-full mr-3"
              style={{ backgroundColor: statusColor }}
            />
          )}
          <View className="flex-1">
            <Text className="text-ink font-semibold">{statusLabel}</Text>
            <Text className="text-ink/50 text-xs">
              {mode === 'remote' ? 'Remote (Tailscale)' : 'Home (local WiFi)'}
              {latencyMs != null ? ` · ${latencyMs} ms` : ''}
            </Text>
            <Text className="text-ink/40 text-[11px] mt-0.5">
              → http://{activeIp || '(not set)'}:{HUB_SERVER_PORT}
            </Text>
          </View>
          <Pressable
            onPress={() => connectionStore.getState().ping()}
            disabled={connecting}
            className="p-2 active:opacity-60"
          >
            <Ionicons name="refresh" size={20} color={theme.goldDark} />
          </Pressable>
        </View>

        {/* Mode toggle */}
        <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2">Mode</Text>
        <View className="flex-row bg-surface rounded-2xl p-1 mb-6 border border-line/5">
          <ModeButton
            active={mode === 'home'}
            label="Home"
            sub="Local WiFi · fast"
            icon="home"
            onPress={() => connectionStore.getState().setMode('home')}
          />
          <ModeButton
            active={mode === 'remote'}
            label="Remote"
            sub="Tailscale"
            icon="globe"
            onPress={() => connectionStore.getState().setMode('remote')}
          />
        </View>

        {/* Hub addresses */}
        <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2">Hub addresses</Text>
        <View className="bg-surface rounded-2xl p-4 border border-line/5">
          <Field
            label="Local WiFi IP"
            placeholder="192.168.1.50"
            value={localDraft}
            onChangeText={setLocalDraft}
            onBlur={save}
            numeric
          />
          <View className="h-4" />
          <Field
            label="Tailscale IP (100.x.x.x)"
            placeholder="100.100.100.100"
            value={remoteDraft}
            onChangeText={setRemoteDraft}
            onBlur={save}
            numeric
          />
        </View>

        <Pressable
          onPress={save}
          className="bg-gold rounded-full py-3 mt-6 items-center active:opacity-80"
        >
          <Text className="text-accentInk font-semibold">Save & reconnect</Text>
        </Pressable>

        {/* Appearance */}
        <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2 mt-8">Appearance</Text>
        <View className="flex-row bg-surface rounded-2xl p-1 border border-line/5">
          <AppearanceButton current={themeMode} value="system" label="System" icon="phone-portrait" />
          <AppearanceButton current={themeMode} value="light" label="Light" icon="sunny" />
          <AppearanceButton current={themeMode} value="dark" label="Dark" icon="moon" />
        </View>

        {/* Claude assistant key */}
        <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2 mt-8">
          Assistant
        </Text>
        <View className="bg-surface rounded-2xl p-4 border border-line/5">
          <Field
            label="Anthropic API key (stored in SecureStore)"
            placeholder="sk-ant-…"
            value={apiKeyDraft}
            onChangeText={setApiKeyDraft}
            onBlur={() => void setApiKey(apiKeyDraft.trim())}
            secure
          />
        </View>

        <Text className="text-ink/40 text-xs mt-6 leading-5">
          Home mode connects over your local network (lowest latency). Remote mode
          reaches the hub through Tailscale from anywhere — install Tailscale on both
          devices and use the tablet's 100.x.x.x address. See the README's
          "Remote Access Setup".
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeButton({
  active,
  label,
  sub,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 rounded-xl py-3 items-center ${active ? 'bg-gold' : ''}`}
    >
      <Ionicons name={icon} size={20} color={active ? theme.accentInk : theme.muted} />
      <Text className={`font-semibold mt-1 ${active ? 'text-accentInk' : 'text-ink/50'}`}>
        {label}
      </Text>
      <Text className={active ? 'text-accentInk/70 text-xs' : 'text-ink/30 text-xs'}>{sub}</Text>
    </Pressable>
  );
}

function AppearanceButton({
  current,
  value,
  label,
  icon,
}: {
  current: ThemeMode;
  value: ThemeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const theme = useThemeColors();
  const active = current === value;
  return (
    <Pressable
      onPress={() => setThemeMode(value)}
      className={`flex-1 rounded-xl py-3 items-center ${active ? 'bg-gold' : ''}`}
    >
      <Ionicons name={icon} size={18} color={active ? theme.accentInk : theme.muted} />
      <Text className={`font-semibold text-xs mt-1 ${active ? 'text-accentInk' : 'text-ink/50'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  numeric = false,
  secure = false,
  ...props
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  onBlur: () => void;
  numeric?: boolean;
  secure?: boolean;
}) {
  const theme = useThemeColors();
  return (
    <View>
      <Text className="text-ink/50 text-xs mb-1">{label}</Text>
      <TextInput
        {...props}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={numeric ? 'numbers-and-punctuation' : 'default'}
        placeholderTextColor={theme.muted}
        className="bg-offWhite rounded-lg px-3 py-2.5 text-ink border border-line/5"
      />
    </View>
  );
}
