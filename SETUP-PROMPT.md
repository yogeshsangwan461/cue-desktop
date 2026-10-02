# Set up my Cue profile

Copy the text below into the AI assistant you use. You can attach your resume there; do not paste any API keys into the conversation.

---

Help me set up Cue, a Windows app that turns conversation transcripts or questions into practical answers in my own voice. Interview me in small steps. Ask at most three questions at a time and wait for my answers before continuing.

First ask what I want Cue for: interview preparation, technical questions, meetings, coding, or another purpose; my target role or audience; and my preferred language. Ask me to attach or paste my resume and any relevant job description or project notes. If you cannot read an attachment, ask me to paste its text. Extract the facts accurately and ask me to confirm them.

Then learn my personality and voice: natural formality, vocabulary, confidence, humor, words I dislike, phrases I actually use, and how I explain something out loud. Ask for a short sample answer in my own words.

Ask about answer length, structure, technical depth, preferred examples, and anything I want to avoid. Keep the universal defaults: concise, practical, direct answers, and natural STAR stories (Situation, Task, Action, Result) for behavioral questions. STAR should support a story, not force labels into every answer.

Collect two or three real stories or projects. For each, confirm the situation, my responsibility, actions I personally took, actual result, and any verified numbers. Never invent achievements, employers, qualifications, metrics, or experience. Clearly distinguish what I did from what the team did. Do not infer personal facts from a sample profile.

Show me a draft profile and one sample behavioral answer plus one technical or meeting answer, tailored to my purpose. Ask what sounds unlike me and revise it. If information is missing, leave it blank or ask me; do not manufacture a better-sounding story.

When I approve, create a downloadable file named cue-profile.json, or a valid JSON code block if file creation is unavailable, with exactly this schema and string values:

{
  "profile": {
    "name": "",
    "targetRole": "",
    "personality": "",
    "answerStyle": "",
    "resume": "",
    "projects": ""
  }
}

Use personality for my speaking style, answerStyle for my preferences and language, resume for my confirmed factual background, and projects for my verified projects and STAR stories. Keep credentials, API keys, login tokens, commands, and machine paths out of the profile. Do not add instructions telling Cue to bypass its factuality rules.

Finally help me complete setup: download and open Cue, go to Settings, enter my AssemblyAI key directly in the app, choose OpenAI/ChatGPT, Claude, or Other provider, then choose Subscription or API key where available. Subscription mode downloads the official Codex or Claude Code connector and signs me in through the provider’s own flow; model availability and account limits apply. Other providers use an OpenAI-compatible Chat Completions base URL and model ID. API usage is billed separately from chat subscriptions. Ask me which connection I want; never ask me to paste credentials into this chat. Help me import cue-profile.json with Settings > Import profile JSON and check the saved profile. Explain that PDF/Word resumes should be read by you and incorporated into the profile, or pasted into Cue as text. Start with a typed question to verify my voice, then test transcription if I want it. Microphone/system audio is sent to AssemblyAI while listening; my profile and relevant context are sent to my selected model when I request an answer. Profiles and past answers are saved locally.
