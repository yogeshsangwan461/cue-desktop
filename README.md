# Cue

A translucent, always-on-top Windows overlay that uses your own background, AI account, and AssemblyAI key. Keep the compact bar above your interview or meeting and expand it for transcripts and answers. Answers stay concise and practical, with natural STAR stories for behavioral questions.

Download the installer or portable app from [Releases](https://github.com/yogeshsangwan461/cue-desktop/releases). Read [QUICK-START.md](QUICK-START.md) to connect your accounts, or give [SETUP-PROMPT.md](SETUP-PROMPT.md) to your AI assistant to create a personalized profile.

## Connections

- AssemblyAI Universal-Streaming: microphone and system audio transcription using your own key.
- ChatGPT subscription: official Codex connector with isolated local sign-in.
- Claude subscription: official, unmodified Claude Code connector with isolated local sign-in.
- OpenAI and Claude APIs: your own provider key and model.
- Other providers: OpenAI-compatible Chat Completions base URL and model ID. Local providers may work without a key.

The official subscription connectors download on first connection. Provider account eligibility, model access, and usage limits apply. API usage is billed separately from subscriptions. Claude screenshots require API mode. Live service access requires the user's own credentials.

## Local development

Use Node.js with npm on Windows. Run `npm ci`, `npm test`, then `npm start`. Run `npm run build` to produce x64 installer and portable executables under `release/`.

The build uses an explicit file allowlist. It never bundles developer configuration, profiles, documents, sessions, screenshots, environment files, or sign-in tokens. The app starts with blank credentials and no personal profile. Settings live under `%APPDATA%\Cue-Standalone`; keys are encrypted using Windows account protection. Profile export omits credentials.

Audio goes to AssemblyAI while listening. On an answer request, the user's profile, question, relevant documents, and conversation context go to the selected model. The download website does not collect resumes or credentials. Only record audio you are allowed to share.
