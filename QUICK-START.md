# Cue for Windows

Choose the installer for a normal installation, or open the portable executable without installing. Windows x64 is supported. No Node.js or Python installation is required.

1. Open Settings and enter your own AssemblyAI API key for transcription.
2. Select your AI provider and connection. OpenAI and Claude have subscription and API key modes. Other providers require an OpenAI-compatible API base URL and model ID; local compatible providers may work without a key.
3. For subscription mode, click Connect account. The official connector downloads on first use; internet access is required. Finish sign-in through the provider. For ChatGPT device login, open the displayed official URL and enter the code, then click Check connection. Your subscription’s model access and limits apply. This app does not include a subscription.
4. Copy SETUP-PROMPT.md into your AI assistant, answer its questions, and import its cue-profile.json in Settings. Or enter your background directly.
5. Ask a typed question first using the floating bar. In Settings choose microphone/system audio, then click Start. The translucent overlay stays above your interview window. Expand or collapse it with the brand icon. Stop when finished: AssemblyAI bills by connected stream duration, including silence. Two streams consume two stream-hours per hour of use.

Your credentials are encrypted for your Windows account. Your profile, reference documents, provider sign-ins, and past answers are stored in %APPDATA%\Cue-Standalone. No developer credentials or personal profile are supplied. Profile exports contain your profile only, never keys. Use .txt/.md reference documents or paste extracted resume text. Claude screenshots require API key mode. Screenshot support for other providers depends on the selected model.

Audio is sent to AssemblyAI while listening. Questions, your profile, and relevant documents are sent to the selected model when requesting an answer. Only record audio you are allowed to share. No website login or uploading your resume to the download website is required.

Ctrl+Enter: answer. Ctrl+Shift+Space: capture a screen; click Solve to answer captured screens, or Assist for an immediate screen answer. Ctrl+\: hide/show. Ctrl+Shift+\: stop listening. Ctrl+,: settings. Ctrl+Shift+H: answer history. Use the tray icon to show or quit Cue. Hiding leaves listening active; Stop or Quit ends it.

Capture protection is enabled by default using Windows content protection. The Private switch toggles it; opacity is adjustable in Settings. Capture behavior varies by recorder and platform. This does not guarantee invisibility or prevent detection by other software.

This build is unsigned. Windows may show a publisher warning. Compare its SHA-256 checksum with the download page before running it.
