
# Biblical AI – super simple

## Quick start (2 steps)
1. Install dependencies and set key
```
npm install
copy .env.example .env   # then paste your keys
```
2. Start server (serves the frontend too)
```
npm start
```
Open http://localhost:3000 in your browser.

## Providers
- **OpenAI** (default): set `OPENAI_API_KEY`.
- **Gemini**: set `GOOGLE_API_KEY`, choose provider `gemini` in the UI.
- **Copilot / Azure OpenAI**: set `AZURE_OPENAI_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, choose `copilot` in the UI.

## Windows desktop
Double-click `start-server.bat` to run the server, then open `http://localhost:3000`.

