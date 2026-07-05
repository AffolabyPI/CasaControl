import { useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { DeviceProfile } from '@casacontrol/shared';
import { profilesStore, useProfiles } from '../lib/profiles';
import { useThemeColors } from '../lib/theme';

/** Cached device profiles — builtin + approved AI-generated. Delete to re-enable research. */
export default function ManageProfiles() {
  const router = useRouter();
  const theme = useThemeColors();
  const profiles = useProfiles((s) => s.profiles);

  useFocusEffect(
    useCallback(() => {
      void profilesStore.getState().refresh();
    }, []),
  );

  return (
    <SafeAreaView className="flex-1 bg-offWhite">
      <View className="px-6 pt-4 pb-2 flex-row items-center">
        <Pressable onPress={() => router.back()} className="mr-3 active:opacity-60">
          <Ionicons name="chevron-back" size={26} color={theme.ink} />
        </Pressable>
        <Text className="text-ink text-2xl font-bold">Device profiles</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-ink/50 text-xs mb-4 leading-5">
          Control profiles the hub uses. Builtin ones ship with the app; AI-generated
          ones were researched and approved by you. Deleting an AI profile makes that
          device eligible for research again.
        </Text>

        {profiles.length === 0 ? (
          <View className="items-center mt-16">
            <Ionicons name="file-tray-outline" size={40} color={theme.muted} />
            <Text className="text-ink/40 mt-3 text-center">
              No profiles yet. On the Devices screen, tap “Try to add control” on an
              unknown device.
            </Text>
          </View>
        ) : (
          profiles.map((p) => <ProfileCard key={p.profileId} profile={p} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileCard({ profile }: { profile: DeviceProfile }) {
  const theme = useThemeColors();
  const ai = profile.source === 'ai_generated';

  const onDelete = () =>
    Alert.alert('Delete profile', `Remove the profile for ${profile.deviceName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void profilesStore.getState().remove(profile.profileId),
      },
    ]);

  return (
    <View className="bg-surface rounded-2xl p-4 mb-3 border border-line/5">
      <View className="flex-row items-center mb-1">
        <Text className="text-ink font-semibold flex-1">{profile.deviceName}</Text>
        <View className={`rounded-full px-2 py-0.5 ${ai ? 'bg-gold/20' : 'bg-ink/10'}`}>
          <Text className={`text-[10px] font-bold uppercase tracking-wide ${ai ? 'text-goldDark' : 'text-ink/50'}`}>
            {ai ? 'AI-generated' : 'Builtin'}
          </Text>
        </View>
      </View>
      <Text className="text-ink/40 text-xs mb-2">
        {Object.keys(profile.actions).join(', ')}
        {ai ? ` · ${Math.round(profile.confidence * 100)}% confidence` : ''}
      </Text>
      {ai ? (
        <Pressable onPress={onDelete} className="flex-row items-center self-start active:opacity-60">
          <Ionicons name="trash-outline" size={14} color={theme.danger} />
          <Text className="text-danger text-xs font-semibold ml-1">Delete</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
