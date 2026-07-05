import { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileAction } from '@casacontrol/shared';
import { profilesStore, useProfiles } from '../lib/profiles';
import { useThemeColors, useThemeVars } from '../lib/theme';

/** Human summary of what a single capability action would do. */
function actionSummary(a: ProfileAction): string {
  switch (a.capability) {
    case 'ble_write':
      return `BLE write → ${a.serviceUUID.slice(0, 8)}… / ${a.characteristicUUID.slice(0, 8)}…\npayload: ${a.payloadTemplate}`;
    case 'wake_on_lan':
      return `Wake-on-LAN → ${a.macTemplate}${a.port ? ` :${a.port}` : ''}`;
    case 'http_request':
      return `HTTP ${a.method} → ${a.urlTemplate}${a.bodyTemplate ? `\nbody: ${a.bodyTemplate}` : ''}`;
    case 'mdns_resolve':
      return `mDNS resolve → ${a.serviceType}`;
  }
}

/** The human approval gate — a generated profile is never saved without this. */
export function ProfileReviewModal() {
  const pending = useProfiles((s) => s.pending);
  const theme = useThemeColors();
  const themeVars = useThemeVars();
  const [saving, setSaving] = useState(false);

  const profile = pending?.profile;
  const visible = !!pending;

  const onApprove = async () => {
    setSaving(true);
    try {
      await profilesStore.getState().approve();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => profilesStore.getState().discard()}>
      <View className="flex-1 justify-end bg-black/50">
        <View style={themeVars} className="bg-offWhite rounded-t-3xl max-h-[85%]">
          <ScrollView contentContainerStyle={{ padding: 24 }}>
            <View className="flex-row items-center mb-1">
              <View className="bg-gold/20 rounded-full px-2 py-0.5 mr-2">
                <Text className="text-goldDark text-[10px] font-bold uppercase tracking-wide">AI-generated</Text>
              </View>
              {profile ? (
                <Text className="text-ink/50 text-xs">confidence {Math.round(profile.confidence * 100)}%</Text>
              ) : null}
            </View>
            <Text className="text-ink text-2xl font-bold mb-1">{profile?.deviceName ?? ''}</Text>
            <Text className="text-ink/50 text-xs mb-4">
              Review this generated control before saving. Nothing runs until you approve it.
            </Text>

            {/* Actions */}
            <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2">Actions it enables</Text>
            {profile
              ? Object.entries(profile.actions).map(([name, action]) => (
                  <View key={name} className="bg-surface rounded-xl p-3 mb-2 border border-line/5">
                    <Text className="text-ink font-semibold mb-1">{name}</Text>
                    <View className="flex-row items-center mb-1">
                      <View className="bg-ink/10 rounded px-1.5 py-0.5">
                        <Text className="text-ink/60 text-[10px] font-mono">{action.capability}</Text>
                      </View>
                    </View>
                    <Text className="text-ink/50 text-[11px] font-mono">{actionSummary(action)}</Text>
                  </View>
                ))
              : null}

            {/* Citations */}
            {profile && profile.citations.length > 0 ? (
              <>
                <Text className="text-ink/60 text-xs uppercase tracking-wider mb-2 mt-3">Sources</Text>
                {profile.citations.map((url) => (
                  <Pressable key={url} onPress={() => void Linking.openURL(url)} className="flex-row items-center mb-1.5 active:opacity-60">
                    <Ionicons name="link" size={13} color={theme.goldDark} style={{ marginRight: 6 }} />
                    <Text className="text-goldDark text-xs flex-1" numberOfLines={1}>{url}</Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            {/* Buttons */}
            <View className="flex-row mt-6">
              <Pressable
                onPress={() => profilesStore.getState().discard()}
                className="flex-1 rounded-full py-3 mr-2 items-center border border-line/15 active:opacity-70"
              >
                <Text className="text-ink/70 font-semibold">Discard</Text>
              </Pressable>
              <Pressable
                onPress={onApprove}
                disabled={saving}
                className="flex-1 rounded-full py-3 ml-2 items-center bg-gold active:opacity-80"
              >
                {saving ? (
                  <ActivityIndicator size="small" color={theme.accentInk} />
                ) : (
                  <Text className="text-accentInk font-semibold">Approve &amp; save</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
