# CasaControl 🏠

A self-hosted Android **home hub + phone remote**, built with React Native / Expo.

Turn an always-on Android tablet into a home dashboard — play Spotify through a
Bluetooth speaker, power the speaker and a PS5 on/off, and control it all from
your phone, at home over WiFi or away via Tailscale. There's also a built-in
Claude assistant that can act on your home in natural language.

No cloud backend. Your data stays on your network.

## Apps

- `apps/tablet` — the always-on hub. Runs a tiny on-device HTTP server, holds the
  Spotify session, drives the Bluetooth speaker, and exposes device controls.
- `apps/phone` — the remote. Search & play music, control playback/volume, power
  devices, and talk to the assistant.
- `packages/shared` — shared TypeScript: domain types, the Spotify Web API client,
  the hub HTTP client, the Claude assistant, and constants/theme.

## Features

- **Spotify** — search, play/queue, browse playlists, playback + volume control.
  Can **start music from nothing** even when no Spotify device is active (the hub
  wakes the tablet's Spotify and starts playback on it).
- **Bluetooth speaker (UE BOOM)** — power on/off over BLE (reverse-engineered UE
  power characteristic), and volume control via the tablet's media stream.
- **PS5** — Wake-on-LAN + status.
- **Local device discovery** — mDNS + network scan.
- **Remote access** — via [Tailscale](https://tailscale.com), no port forwarding.
- **Claude assistant** — a tool-use agent (`claude-opus-4-8`) that can search &
  play music, control the speaker/PS5, answer questions about home state, and
  chain several actions in one request. Multi-turn chat with state-aware suggestions.
- **Reliability** — an Android foreground service keeps the hub reachable while
  the tablet is idle.

## Tech stack

- Expo SDK 52 (custom dev client / prebuild) + TypeScript
- Expo Router (file-based navigation)
- NativeWind (Tailwind for RN) — off-white & gold theme
- Zustand for state
- Yarn 1.x workspaces monorepo; `patch-package` for one RN patch

The phone ↔ hub link is a **hand-rolled HTTP/1.1 server** on the tablet
(`react-native-tcp-socket`) — React Native can't host Express — with a matching
`HubClient` on the phone. See `apps/tablet/lib/server/hubServer.ts` and
`packages/shared/src/api/hubClient.ts`.

## Prerequisites

- Node.js 18+
- Yarn 1.x (Classic)
- Android Studio + an Android device (tested on Android 14)

> **Why a custom dev client, not Expo Go?** Several native modules aren't in Expo
> Go: an on-device TCP/HTTP server, UDP (Wake-on-LAN), mDNS, BLE, media-volume
> control, and a foreground service. Build once with `expo prebuild` +
> `expo run:android`, then iterate on JS as usual.

## Getting started

```bash
# 1. Install workspaces (also applies patch-package patches)
yarn install

# 2. Configure
cp .env.example .env        # fill in Spotify client id, etc. (see below)

# 3. Generate native projects (they're gitignored — regenerated from app.json
#    + config plugins) and build onto a connected device:
yarn workspace @casacontrol/tablet android
yarn workspace @casacontrol/phone android
```

Type-check everything:

```bash
yarn typecheck
```

> **Monorepo build note:** the release builds set `EXPO_NO_METRO_WORKSPACE_ROOT=1`
> so Metro treats the app dir (not the workspace root) as its server root — needed
> for Expo Router + release bundling in this workspace layout.

## Configuration

Copy `.env.example` → `.env`. Nothing here is secret at runtime — on-device
secrets (Spotify tokens, the optional Anthropic key) live in **Expo SecureStore**.
Key values:

| Var | Where | What |
|---|---|---|
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` | both | Spotify app client id (PKCE, no secret) |
| `EXPO_PUBLIC_ANTHROPIC_API_KEY` | phone | optional; assistant (also settable in-app) |
| `EXPO_PUBLIC_PS5_MAC` / `_IP` | tablet | PS5 Wake-on-LAN |
| `EXPO_PUBLIC_UE_BOOM_MAC` | tablet | speaker BLE id — find via `GET /ble/discover` |
| `EXPO_PUBLIC_TABLET_BT_MAC` | tablet | tablet's own BT MAC, **paired** with the BOOM |
| `EXPO_PUBLIC_HUB_LOCAL_IP` / `_TAILSCALE_IP` | phone | default hub addresses (editable in-app) |

For Spotify, register the redirect URIs `casacontrol://callback` and
`casacontrol-hub://callback` in the Spotify developer dashboard.

## Monorepo layout

```
CasaControl/
├─ apps/
│  ├─ tablet/           # Expo Router app — always-on hub
│  │  └─ lib/           #   hub server, discovery, BLE, Spotify control, FGS
│  └─ phone/            # Expo Router app — remote
│     ├─ app/(tabs)/    #   Remote · Search · Devices · Settings
│     └─ lib/           #   assistant, music, connection, controls
├─ packages/
│  └─ shared/src/       # @casacontrol/shared
│     ├─ types/         #   domain models
│     ├─ api/           #   HubClient (phone → tablet HTTP)
│     ├─ spotify/       #   Spotify Web API client + store
│     ├─ devices/       #   ps5, printer
│     └─ ai/            #   Claude tool-use assistant
├─ patches/             # patch-package patches
├─ .env.example
└─ package.json         # Yarn workspaces root
```

## The Claude assistant

Tap the ✨ button on the phone. It's a **tool-use agent**: it can call home tools
(`search_and_play`, `play/pause/next`, `set_volume`, `power_on/off_speaker`,
`wake_ps5`, `get_status`), chain several in one turn, and answer questions about
current state. Example: *"turn on the speaker and play some Daft Punk"* powers the
BOOM and starts the music. Set your Anthropic key in **Settings** (SecureStore) —
the app calls Claude directly from the device, so treat the key as personal.

## Remote access (Tailscale)

Install [Tailscale](https://tailscale.com) on the tablet and phone, sign in with
the same account, and note the tablet's `100.x.x.x` address. In the phone's
**Settings**, set the **Local WiFi IP** and **Tailscale IP**, then switch between
**Home** (fast, local) and **Remote** (Tailscale) — a badge shows the live
latency. The tablet must stay powered, on WiFi, with Tailscale running.

## Notes & attributions

- UE BOOM BLE power control is derived from community reverse-engineering
  (see `kancelott/ue-boom-2-bt-le-reverse-engineering`). The power write is a
  7-byte `<paired-controller-MAC><cmd>` to characteristic `c6d6dc0d…`.
- Built for personal use; hardware ids are configured via `.env`, not hardcoded.
