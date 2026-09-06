# Movie Recap AI 🇲🇲

A deployable starter app for turning a user-supplied short video clip into a 60/90/120-second vertical recap draft:
- extracts representative frames with FFmpeg
- uses OpenAI vision/text to write a Burmese narration
- uses OpenAI TTS for narration
- renders 720x1280 MP4 with narration
- provides the script, MP4 and MP3

## Requirements
- Node.js 20+
- FFmpeg + FFprobe installed and available on PATH
- An OpenAI API key

## Run
1. Copy `.env.example` to `.env`
2. Put your API key in `OPENAI_API_KEY`
3. `npm install`
4. `npm start`
5. Open `http://localhost:3000`

The server keeps API keys off the browser. Never paste an API key into `public/index.html`.

## Important
This app does not bypass copyright. Use only footage you have permission to use and follow TikTok/YouTube rules.

For a production deployment, add authentication, object storage, a job queue, cleanup/retention rules, rate limits and HTTPS.
