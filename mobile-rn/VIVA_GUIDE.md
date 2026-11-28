# TouchGrass React Native Viva Study Guide

This guide explains the JavaScript and TypeScript side of the TouchGrass Android app in beginner-friendly terms. It follows the current code in `App.tsx`, `src/supabase.ts`, `src/native.ts`, and the Expo config. Android Kotlin services are treated as external native functionality; the focus here is what the JS calls and what data passes across that boundary.

## 1. Big picture

TouchGrass is an Expo + React Native app. Expo starts the JavaScript app, React renders the screen, and React Native maps components such as `View`, `Text`, and `Pressable` to native Android views.

```text
Expo entry point
      ↓
    App.tsx ──────────────→ Supabase Auth / database / storage / Edge Function
      │
      └── src/native.ts ──→ Android native module (VPN, app blocking, focus timer)
```

Most screen layout, screen state, and button handling live in `App.tsx`. `src/supabase.ts` creates the backend client. `src/native.ts` gives TypeScript a typed wrapper around an Android module. `app.json` defines Expo settings and the config plugin that adds Android services during prebuild.

The Flutter app is a separate implementation in the same repository. This guide covers `mobile-rn`, not the Flutter source.

## 2. How the app starts and chooses a screen

The `main` entry in `package.json` points Expo at `node_modules/expo/AppEntry.js`. Expo loads the default export from `App.tsx`.

`App()` is a React function component. It reads state and builds JSX. When state changes, React calls the component again and renders the updated result.

At the top of `App()`, the code has three major screen states:

1. While `authReady` is false, show a loading spinner.
2. If there is no `session`, show the sign-in or create-account form.
3. Once signed in, show the app header, selected tab or subpage, and bottom navigation.

This is called **conditional rendering**: JSX is selected based on values such as `authReady`, `session`, `tab`, and `subpage`.

The four main tabs are `Today`, `The Lawn`, `Squad`, and `You`. `subpage` can switch the user from the main tabs into Gatekeeper pairing/inbox or the voice-proof request screen. The tab buttons set `subpage` back to `home` so returning to a tab does not leave an old subpage open.

## 3. React and TypeScript concepts used here

### Components and JSX

JSX is the HTML-like syntax inside the TypeScript file. It is not HTML: `<View>` and `<Text>` are React Native components. A component can contain other components, for example a `Card` containing a title and a button.

Small reusable components near the bottom of `App.tsx` are:

- `Button`: a `Pressable` with consistent label, disabled, primary, outline, and destructive styles.
- `Card`: a white card that accepts child elements and optional style overrides.
- `Avatar`: derives initials from a name and puts them in a circular badge.
- `Metric`: displays a small icon, value, and label in the You tab.

### State: `useState`

State is data that affects what the user sees or what the app does. Calling a state setter schedules a re-render. For example, typing in the duration input calls `setFocusMinutes`; React then redraws the timer with the new goal.

The state is grouped by purpose:

| Purpose | Examples |
| --- | --- |
| Authentication | `session`, `authReady`, `email`, `password`, `createAccount` |
| Navigation and feedback | `tab`, `subpage`, `notice`, `toast`, `busy` |
| Focus and blocking | `running`, `seconds`, `focusMinutes`, `progress`, `grounded`, `appBlocking`, `accessibility` |
| Social and Gatekeeper data | `friends`, `posts`, `requests`, `connections`, `grants` |
| Composer and audio | `postDraft`, `postImage`, `recording`, `proofUri`, playback and upload flags |

Some values use TypeScript unions to constrain possible states. For example, `subpage` is `'home' | 'gatekeeper' | 'request'`, so TypeScript can catch misspelled values.

### Refs: `useRef`

A ref keeps a value between renders without itself causing a render when changed. `proofSound.current` holds the active audio object; `completingFocus.current` prevents the timer-completion effect from submitting twice; `requestStatuses.current` remembers old request statuses to detect a new inbox item or decision; `toastTimer.current` stores the timeout handle so it can be cancelled.

### Effects: `useEffect`

An effect runs after React renders. The dependency list tells React when it should run again. Effects in this app:

- Load the saved Supabase auth session and listen for later auth changes. Cleanup unsubscribes the listener.
- Clear the toast timeout when the component unmounts.
- When the user session changes, load requests, social data, and native state; subscribe to relevant Supabase realtime changes; refresh when the app returns to foreground. Cleanup removes the channel and AppState listener.
- Start a one-second UI interval while a focus session is running. Cleanup clears the interval.
- Detect when the session target time has passed and finish the session once.

An important distinction: the interval updates the displayed elapsed time. The native module stores the session timestamps and calculates its authoritative progress; the JS interval is not the durable timer.

### Async JavaScript and errors

Backend, media, and native calls are asynchronous. `async` marks a function as returning a Promise; `await` pauses that function until the Promise settles. `try/catch/finally` is used to show errors and reset loading flags. `Promise.all` runs independent requests concurrently and waits for all of them.

### TypeScript types

The `Request`, `Grant`, `Connection`, `FriendConnection`, `Profile`, `FocusStats`, and `LawnPost` types document the shapes expected from Supabase. `string | null` means a value can be a string or no value. `?:` marks an optional property. Types are checked during development; they do not validate data at runtime. The session is currently typed as `any`, so it has weaker type checking than the other data.

## 4. Backend setup and data loading

### Supabase client

`src/supabase.ts` reads the Supabase URL and publishable key from Expo environment variables first, then falls back to `extra` in `app.json`. It throws early if either is missing. `createClient` configures Supabase Auth to persist credentials in `AsyncStorage`, automatically refresh tokens, and avoid handling browser callback URLs. When the app becomes active, auth token refresh starts; while backgrounded, it stops.

### Loading requests and social data

`refreshRequests()` fetches unlock requests, the signed-in user's active grants, and Gatekeeper relationships. It compares request statuses with a `Map` held in a ref to detect newly arrived requests or decisions. It also passes valid grants to the Android bridge so the local blocker can honor approved time windows. Finally, it invokes the `gatekeeper-ops` Edge Function's cleanup action.

`loadSocial(userId)` fetches friend links, then loads profiles, focus stats, and Lawn posts for the user and friends. It converts numeric database values to JavaScript numbers, maps IDs to display names, and asks Supabase Storage for temporary signed image URLs. The resulting arrays/maps are placed in React state for rendering.

Supabase realtime subscriptions request a refresh when relevant tables change. This lets the UI update when another person creates a request, makes a decision, posts, or records a focus session. AppState also triggers a refresh when the app becomes active again.

## 5. Feature flows to be ready to explain

### Sign in / create account

1. The user enters email and password; `TextInput` writes into state.
2. `signIn()` trims and validates the email and checks the minimum password length for registration.
3. `act()` sets `busy`, clears old feedback, runs the Supabase operation, shows success/error text, then resets `busy` in `finally`.
4. Supabase emits an auth state change; the auth listener updates `session` and the signed-in screen appears.

### Today: focus timer

1. The idle display derives `MM:SS` from the selected `focusMinutes`; preset chips set that same state.
2. `startFocus()` checks for the Android bridge, validates a whole-number goal between 1 and 1,440 minutes, and requires at least one blocking mode.
3. It calls `nativeFocus.startFocus(userId, minutes)`. The Android side returns start and target timestamps; JS sets `running` and updates the display.
4. A JS interval recomputes elapsed seconds from `Date.now() - sessionStartMillis`, which avoids the timer drifting by adding one each tick.
5. When the target time is reached, `finishFocus(true)` asks native code to stop and reports the completed duration to Supabase with `record_focus_session`. Early ending sends `complete: false` and awards no points.

The one-minute points/stat rules are ultimately represented by the backend response and stored stats, not by the visual timer itself.

### Today: blocking controls

`toggleAppBlocking()` and `toggleGrounded()` call methods on `nativeFocus`. The app-blocking path may first open Android Accessibility settings if the permission is not enabled. Grounded Mode asks the native VPN service to start or stop. If either protection mode is turned off during an active focus session, JS ends the session without points.

JavaScript displays the service status; actual DNS filtering and foreground-app blocking are performed by native Android services outside the scope of this JS walkthrough.

### Squad: friend codes and leaderboard

`createFriendInvite()` creates a random ten-character code, hashes it with SHA-256, and sends the hash to the `create_friend_invite` database function. The plain code is shown to the user; the database stores/checks the hash. `redeemFriendInvite()` normalizes the entered code, hashes it, and calls `redeem_friend_invite`. The leaderboard is a sorted view of the signed-in user's stats and friends' stats.

### The Lawn: posting a moment

1. Text input and chosen photo are held locally in `postDraft` and `postImage`.
2. `choosePostImage()` requests photo permission, opens the picker, and rejects missing or over-5-MB files.
3. `publishPost()` uploads image bytes to Storage if present, then inserts the post row with the image path.
4. If inserting fails after upload, it tries to remove the uploaded image so there is not an orphaned file.
5. On success it clears the composer, displays a short toast, and reloads social data.

Feed items get a display name and temporary image URL during `loadSocial()`. The “Send a cheer” button is currently local UI state (`cheeredPosts`); it is not saved to Supabase.

### Gatekeeper: invite, request, and voice proof

The Gatekeeper pairing code is created/redeemed through the `gatekeeper-ops` Edge Function. Requests and grants are loaded into state and shown in the inbox or the user's recent requests.

For voice proof, `recordVoiceProof()` checks that a focus session is active, requests microphone permission, records five seconds, checks that a usable file exists, and saves its URI in state so the user can preview it. `sendVoiceProof()` reads the file as base64, converts it to bytes, uploads it to the private `unlock-proofs` bucket, then calls the Edge Function to create the unlock request. If the request fails after upload, JS tries to delete that uploaded file. Gatekeepers play a proof using a short-lived signed Storage URL; review and cancellation actions call the same Edge Function with different action names.

## 6. Navigation and visual rendering

The bottom tabs are built from an array of `{ name, icon }` objects and `.map()`. Each `Pressable` sets the selected tab. The active tab changes the icon color, label weight, and background. The screen body is a conditional JSX expression: `subpage` is checked first, then `tab` chooses Today, The Lawn, Squad, or You.

`SafeAreaView` and the root padding keep content clear of device UI. `StatusBar` controls status-bar appearance. Styles are centralized in `StyleSheet.create`, where shared color constants such as forest green and warm cream are reused. Arrays of styles are combined to express states, e.g. `[styles.button, primary && styles.buttonPrimary]`.

The You screen formats focused time, streak, sessions, and points into reusable `Metric` components. The sign-out action calls `supabase.auth.signOut()`; the auth listener then returns the app to the sign-in screen.

## 7. Other JavaScript/TypeScript project files

- `src/native.ts` defines the TypeScript interface for the `TouchGrassAndroid` native module and exports `nativeFocus`. If the platform is not Android or the module is absent, `available` is false and calls reject with a clear error. It does not implement blocking itself.
- `app.json` sets the Expo app name, Android package ID, permissions, plugin list, and Supabase public configuration.
- `plugins/withTouchGrassAndroid.js` is an Expo config plugin. During `expo prebuild`, it copies the Kotlin source templates, adds Android manifest service declarations and permissions, and registers the custom React Native package. This is build-time setup, not code that runs on each screen render.
- `TouchGrassPackage.kt` and `TouchGrassAndroidModule.kt` are Kotlin, so they are intentionally not explained line by line here. For viva purposes, describe them as the native implementation behind the methods typed in `src/native.ts`.

## 8. Likely viva questions and model answers

1. **What is React Native?** It lets us build mobile screens with React components and JavaScript/TypeScript while rendering native platform views.
2. **What is a function component?** A JavaScript function that returns the JSX describing a part of the UI; `App()` is the root component here.
3. **What is JSX?** Syntax that lets us describe component trees inside JavaScript/TypeScript. React turns it into UI elements.
4. **What is state?** Data owned by a component that can change; when state changes, React renders the UI again.
5. **Why are text inputs controlled?** Their `value` comes from state and `onChangeText` updates that state, so the component owns the current text.
6. **What is `useEffect` used for here?** Side effects such as subscriptions, data loading, intervals, and cleanup that should happen after rendering.
7. **What is the dependency array?** It controls when an effect reruns. For example, the data-loading effect depends on `session`, so it reacts to sign-in/sign-out changes.
8. **Why use `useRef` instead of state for `proofSound`?** The audio object must survive renders, but changing the object does not need to redraw the UI.
9. **What does `async/await` do?** It provides readable syntax for waiting for asynchronous operations that return Promises.
10. **Why use `Promise.all`?** Requests that do not depend on each other can run at the same time, reducing total wait time.
11. **What is a TypeScript type?** A compile-time description of expected values; for example, `LawnPost` documents fields needed to render a post.
12. **What is the difference between `null` and an optional field?** `null` is an explicit empty value; `field?: T` means that the field may be absent.
13. **How is the auth session persisted?** Supabase Auth uses AsyncStorage through the client configuration, then `getSession()` restores it when the app starts.
14. **How does the leaderboard get data?** `loadSocial()` requests friend links, profiles, and stats, maps them into UI-friendly objects, and the screen sorts them by points.
15. **Is the focus timer just a JavaScript interval?** No. The interval updates the display from timestamps. Native code stores and reports the focus session state.
16. **What happens when a focus session completes?** JS asks native code to stop it, then sends the completed duration to the Supabase `record_focus_session` RPC.
17. **Does `nativeFocus` block apps?** No. It is a JS wrapper/interface. Android native services perform the blocking work.
18. **Why hash friend invite codes?** The server can validate a code without needing to store the original shareable secret in plain text.
19. **Why use a signed URL for post images or voice proof?** It grants temporary access to a private file rather than making the whole bucket public.
20. **What is the realtime channel for?** It listens for database changes and refreshes relevant app data so the UI can reflect updates from another user.
21. **What does `finally` accomplish in an async handler?** It runs whether the operation succeeds or fails, so flags like `busy` can always be reset.
22. **What data is not persisted?** The current cheer/reaction state is only in React state; it disappears when the app reloads.

## 9. Practice tracing these flows aloud

- “I tap Start focus”: name the handler, validation, native bridge call, returned timestamps, state updates, UI interval, and completion RPC.
- “I post a photo”: explain picker permission, file-size validation, upload, database insert, cleanup-on-error, toast, and data refresh.
- “My Gatekeeper approves a pass”: explain realtime refresh, grants state, grant sync to the native bridge, then what the screen displays.
- “I sign out”: explain the Supabase sign-out call, auth-state listener, session becoming null, and the sign-in form rendering.

A strong viva answer follows this pattern: **user action → handler → state/backend/native operation → result or error → UI update**. If an operation is asynchronous, say which part is awaited and where failures are caught.
