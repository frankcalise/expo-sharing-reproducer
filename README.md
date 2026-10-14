# expo-sharing reproducer: `useIncomingShare` out of sync with native

`useIncomingShare()` can report a share that native has already cleared. In one case it keeps
reporting it forever and never resolves it. This is a minimal Expo SDK 58 (beta) app that shows
this on Android.

## At a glance

All screenshots come from a Pixel 9 Pro (Android API 37) running a release build, sharing an image
from Chrome. Click a thumbnail for the full-size image.

### Strong form: the clear runs before the hook's mount effect

`handle-share` calls `clearSharedPayloads()` in a `useLayoutEffect`, in the same component that
calls `useIncomingShare()`.

| 0. Turn on `clearEarly` | 1. Share an image from Chrome | 2. Background → foreground |
| :-: | :-: | :-: |
| <a href="repro/strong-0-clearEarly-on.png"><img src="repro/strong-0-clearEarly-on.png" width="220"></a> | <a href="repro/strong-1-shared.png"><img src="repro/strong-1-shared.png" width="220"></a> | <a href="repro/strong-2-after-bg-fg.png"><img src="repro/strong-2-after-bg-fg.png" width="220"></a> |
| Toggle on the Home tab. | **MISMATCH**: native is `[]`, but the hook still has the payload. `resolvedSharedPayloads` is `[]`, with `isResolving: false` and `error: null`. | **Still MISMATCH.** The hook never recovers, and the share is never resolved. |

### Weak form: the hook's own `clearSharedPayloads()`

| 1. Share an image from Chrome | 2. Tap `hook.clearSharedPayloads()` | 3. Background → foreground |
| :-: | :-: | :-: |
| <a href="repro/weak-1-shared.png"><img src="repro/weak-1-shared.png" width="220"></a> | <a href="repro/weak-2-after-hook-clear.png"><img src="repro/weak-2-after-hook-clear.png" width="220"></a> | <a href="repro/weak-3-after-bg-fg.png"><img src="repro/weak-3-after-bg-fg.png" width="220"></a> |
| In sync. | **MISMATCH**: the hook's clear empties native, but hook state is unchanged. | In sync again, but only because AppState fired `active`. |

The logcat output for both runs is in [`repro/log.txt`](repro/log.txt).

## Cause

In `expo-sharing@58.0.17`, `src/useIncomingShare.ts` (the same code is in 57.0.5 and on `main`):

- `:39` seeds state with `useState(getSharedPayloads())`, but `currentSharedDataRef` (`:43`)
  starts as `[]`.
- `refreshSharePayloads()` returns early when native equals the ref (`:50`). If native is cleared
  before the first refresh, both are `[]`, so the early return fires and the seeded `sharedPayloads`
  is never replaced or resolved. Later AppState refreshes also compare `[]` with `[]`, so the hook
  stays stuck.
- The `clearSharedPayloads` the hook returns (`:94`) is the plain native clear, so it doesn't touch
  hook state. The hook updates only on the next AppState `active` event (`:78-82`).

**Expected:** the hook's state follows native: it is empty after any clear, including its own.
At minimum, a payload the hook reports should get resolved.

## Steps

1. Build and install (see below), then open the app.
2. **Strong form:** on the Home tab turn on **clearEarly (bug 1)**. In Chrome, long-press any
   image, tap **Share image**, and pick **expo-sharing-reproducer**. Then background the app and
   bring it back.
3. **Weak form:** with **clearEarly** off, share an image the same way. Tap
   **hook.clearSharedPayloads()**, then background the app and bring it back.

The `clearEarly` toggle lives in module scope, so it lasts only while the app process is alive.
For a cold-start check, change the default in `src/repro/flags.ts` and rebuild.

## What's in the app

It is the `default@sdk-58` template plus:

- the `expo-sharing` config plugin in `app.json` (images, files and text)
- `src/app/+native-intent.ts`: the redirect from the docs (`expo-sharing` host → `/handle-share`)
- `src/app/handle-share.tsx`: shows native `getSharedPayloads()` (polled every 1s) next to the
  full `useIncomingShare()` result, with a red **MISMATCH** banner. It also mirrors state to
  logcat (`[repro]` lines).
- `src/repro/flags.ts` and the `clearEarly` switch on the Home tab

`handle-share` is a third tab ("Share"). It renders only while focused, so each share that
navigates to it mounts `useIncomingShare()` fresh, the way a pushed share screen would. Tabs
otherwise keep screens mounted.

## Versions

| package      | version     |
| ------------ | ----------- |
| expo         | 58.0.9      |
| expo-sharing | 58.0.17     |
| expo-router  | 58.0.18     |
| react-native | 0.88.0-rc.4 |
| react        | 19.3.0      |

> `.npmrc` sets `legacy-peer-deps=true`. Without it, `npm install` on the SDK 58 template fails:
> `react-native-reanimated@4.7.0` declares the peer range `0.86 - 0.88`, which does not match the
> prerelease `0.88.0-rc.4`.

## Build and run

Config plugins don't work in Expo Go, so this needs a native build.

```sh
npm install
npx expo prebuild --clean --platform android
npx expo run:android --variant release
```

For cold-start checks, use the release build. The dev client's launcher receives the share intent
first and drops the URI read grant.

The bug is in the shared JS hook, so it should reproduce on iOS too. I only tested Android.
