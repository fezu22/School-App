# React Native upgrade — 28 October 2026

Base: greenwood-school (3).zip. Full original source preserved.
React Native and matching RN tooling: 0.88.1. React and test renderer: 19.3.1.
Android build settings aligned with official 0.88.1 template: build tools/compile SDK 37, Kotlin 2.2.0, Gradle 9.4.1.
Node: ^22.13.0 || ^24.3.0 || >=26.0.0.

Use npm ci at project root. package-lock.json regenerated. Old Yarn lock retained as yarn.lock.pre-upgrade for reference; do not rename it back.
Then npm --prefix backend ci. Backend dependencies and implementation are unchanged; this is a mobile framework upgrade, not an upgrade of every package or completion of pending features.

Verified: mobile imports/assets, 64 tests in 10 suites, Android production JavaScript bundle. TypeScript checked after compatibility fixes.
Not verified: native Android/iOS compilation, device launch, live MongoDB, card/ZEGO providers. Existing audit reports are historical claims, not verification for this upgrade.
No APK produced. No live records changed.
