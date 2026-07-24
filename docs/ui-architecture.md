# Mobile UI architecture

SmartClip uses a portrait-first, dark Android application shell shared by the local and URL workflows. The compact top bar identifies the current workflow; Home, Projects, Downloads, and Settings remain available from the safe-area-aware bottom navigation on primary screens. Editing and processing can use the same shell in immersive mode without the bottom navigation.

## Design system

The token layer in `src/index.css` defines near-black surfaces, a single restrained indigo accent, semantic success/warning/error colors, 44 px minimum controls, 18 px card radii, subtle borders and a short 180 ms motion duration. Layouts start at 320 px, stack source actions on phones, and expand at 700 px. Status, selection, and errors always include text or iconography rather than relying on color. `prefers-reduced-motion` removes transitions, animated progress pulses, and smooth scrolling.

Reusable patterns include `AppShell`, bottom navigation, `SegmentedControl`, `StatusBadge`, `EmptyState`, page headers, library cards, and settings rows. Workflow-specific editors remain separate so polling does not rerender unrelated navigation or library screens.

## State and privacy

Local source state, URL job state, navigation, preferences, known downloads, and project history remain separate. `localStorage` contains only preferences and lightweight records (title, source type, state, date, candidate count, and known output metadata). Active URL job recovery continues to use `sessionStorage`. Video bytes, authorization headers, backend responses, and the API token are never persisted. Clearing history does not delete gallery media.

Downloads intentionally lists only files created during known app sessions. Enumerating every MediaStore video would require expanding the native architecture and potentially permissions, so SmartClip does not do it. No broad storage permission is requested.

## Accessibility and limitations

Controls have visible keyboard focus, accessible navigation/current-page semantics, named icon buttons, readable text sizes, high-contrast copy, and large touch targets. Android status, display-cutout, gesture, and navigation insets are applied to the fixed bars. Candidate confidence is explicitly described as a heuristic rather than an audience prediction.

The browser remains a UI-development fallback and cannot export or run native analysis. Facecam composition is preview-only where the native renderer does not yet support it. The next step is a full APK testing and bug-fix pass across narrow, typical, tall, and tablet Android devices.
