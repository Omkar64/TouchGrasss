# TouchGrass React Native Android app

This is the React Native migration alongside the existing Flutter app. The Flutter project and its install remain unchanged. The React Native build uses a separate application ID and display name during migration so it can be installed alongside Flutter without uninstalling it or losing its local data. React Native shares the existing Supabase project, migration schema, Edge Function contract, and Android VPN/accessibility service implementations.

## Run

From this folder, install dependencies and start the Android development build:

```powershell
npm install
npx expo prebuild --platform android
npx expo run:android
```

`plugins/withTouchGrassAndroid.js` copies the existing Kotlin VPN and Accessibility services into the generated Android project and registers the React Native bridge. Keep the bridge and services in this repository; generated `android/` files are recreated by Expo prebuild.

The app uses the public Supabase publishable key with the existing database RLS policies. Email/password account creation follows the project's current Auth confirmation setting. If Supabase still requires email confirmation, an account will need confirmation before it can sign in.

The initial React Native screens include Today, The Lawn, Squad, You, password sign-in, Gatekeeper pairing/inbox, request cancellation, and a five-second voice proof request. The first-run Android permission flow requires enabling TouchGrass in Accessibility settings before app blocking can be switched on. Approved grants sync into the native Android blocker when the app opens or foregrounds.
