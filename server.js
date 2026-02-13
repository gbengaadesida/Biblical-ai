import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// static front-end
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// --- Minimal login: checks which providers are configured ---
app.post('/api/login', (req, res) => {
  const providers = {
    gemini: !!process.env.GOOGLE_API_KEY,
    chatgpt: !!process.env.OPENAI_API_KEY,
    copilot: !!process.env.AZURE_OPENAI_KEY && !!process.env.AZURE_OPENAI_ENDPOINT && !!process.env.AZURE_OPENAI_DEPLOYMENT,
  };
  const available = Object.entries(providers).filter(([,v])=>v).map(([k])=>k);
  if (available.length === 0) {
    return res.status(400).json({ ok:false, message: 'No provider configured. Add keys to .env' });
  }
  res.json({ ok:true, available });
});

// --- Generate route with 'mode' support for Sermon Crafter ---
app.post('/api/generate', async (req, res) => {
  try {
    const { provider = 'chatgpt', task, input, mode = 'default' } = req.body || {};
    if (!task || !input) return res.status(400).json({ ok:false, error:'task and input required' });

    const system = systemFor(task, mode);

    if (provider === 'chatgpt') {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [ 
            { role:'system', content: system }, 
            { role:'user', content: input } 
          ],
          temperature: 0.85,
          presence_penalty: 0.2,
          frequency_penalty: 0.2
        })
      });
      if (!r.ok) return res.status(500).json({ ok:false, error: await r.text() });
      const data = await r.json();
      return res.json({ ok:true, output: data.choices?.[0]?.message?.content ?? '' });
    }

    if (provider === 'gemini') {
      if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY missing');
      // Use a current Gemini model
      const model = 'gemini-2.5-flash'; // or 'gemini-flash-latest'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const r = await fetch(url, {
        method:'POST',
        headers:{ 'x-goog-api-key': process.env.GOOGLE_API_KEY, 'Content-Type':'application/json' },
        body: JSON.stringify({
          contents: [{ role:'user', parts:[{ text: `${system}\n\nUser:\n${input}` }] }],
          generationConfig: { temperature: 0.7 }
        })
      });
      if (!r.ok) return res.status(500).json({ ok:false, error: await r.text() });
      const data = await r.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') ?? '';
      return res.json({ ok:true, output: text });
    }

    if (provider === 'copilot') {
      const key = process.env.AZURE_OPENAI_KEY;
      const ep = process.env.AZURE_OPENAI_ENDPOINT;
      const dep = process.env.AZURE_OPENAI_DEPLOYMENT;
      if (!key || !ep || !dep) throw new Error('Azure OpenAI env missing');
      const url = `${ep}/openai/deployments/${dep}/chat/completions?api-version=2024-06-01`;
      const r = await fetch(url, {
        method:'POST',
        headers:{ 'api-key': key, 'Content-Type':'application/json' },
        body: JSON.stringify({
          messages: [ { role:'system', content: system }, { role:'user', content: input } ],
          temperature: 0.85,
          presence_penalty: 0.2,
          frequency_penalty: 0.2
        })
      });
      if (!r.ok) return res.status(500).json({ ok:false, error: await r.text() });
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      return res.json({ ok:true, output: text });
    }

    return res.status(400).json({ ok:false, error: 'Unknown provider' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

// ----- Prompt builder with Roles, Assignments, and General Guidelines -----

function systemFor(task, mode = 'default'){
  const GENERAL_GUIDELINES = [
    "Default Scripture is NKJV — quote verbatim or reference.",
    "All content should be biblically accurate and align with sound Evangelical Christian doctrine, with an emphasis on Pentecostal beliefs.",
    "Illustrations must be current and relevant to a modern audience.",
    "Tone: warm, authoritative, and compassionate; 'Human‑First' — avoid mechanical, robotic, or formulaic language.",
    "All content must be Christ‑centered and bring glory to God."
  ].join(' ');

  const HUMAN_VOICE = [
    "Write with a natural, pastoral human voice.",
    "Vary sentence length: mix short, punchy lines with longer, more reflective sentences.",
    "Use contractions (you’ll, we’re, don’t) and occasional rhetorical questions.",
    "Prefer paragraphs over bullet lists unless the structure explicitly requires lists.",
    "Avoid boilerplate phrases like 'in conclusion', 'in today’s fast-paced world', or 'this article will'.",
    "Avoid meta-language (do not say 'as an AI', 'this essay will').",
    "Include concrete, real-life details (e.g., a Tuesday commute, a grocery line, a late-night hospital visit) when illustrating.",
    "Allow mild, tasteful disfluencies for cadence (e.g., a fragment for emphasis).",
    "Keep tone warm, authentic, unpretentious; prioritize clarity over flourish."
  ].join(' ');

  if (task === 'sermonCrafter') {
    const ROLE = "You are Pentecostal and biblically sound; your communication style is 'Human‑First'—warm, intellectually stimulating, and deeply authentic.";
    if (mode === 'outline') {
      const ASSIGNMENT = [
        "You follow a strict two‑step workflow for sermon creation.",
        "Step 1 (current): Generate a structured sermon outline that includes:",
        "• A compelling, concise introduction summary.",
        "• 3–5 distinct sermon points for the body; each point briefly states a biblical truth that will be explored.",
        "• A concise conclusion that reinforces the main message.",
        "Then STOP and wait for explicit user approval. Do NOT write the full sermon."
      ].join(' ');
      return `${ROLE}\n${ASSIGNMENT}\n${GENERAL_GUIDELINES}\n${HUMAN_VOICE}`;
    }
    const ASSIGNMENT_FULL = [
      "Step 2: The user has approved the outline.",
      "Generate a COMPLETE sermon that strictly follows the approved outline and this exact structure:",
      "• Introduction (~200 words): An engaging passage that introduces the topic and hooks the listener.",
      "• Body (~1700 words): For each of the 3–5 sermon points, produce a complete teaching unit:",
      "  - A thorough explanation of the designated Scripture, including its original context.",
      "  - A clear breakdown of the theological principles (sound doctrine) found in the text.",
      "  - A modern, relatable story, analogy, or anecdote that makes the point tangible and memorable.",
      "  - Clear, actionable steps for listeners to apply the biblical truth to their daily lives.",
      "• Conclusion (~200 words): A strong wrap‑up that reinforces the main message and encourages application."
    ].join(' ');
    return `${ROLE}\n${ASSIGNMENT_FULL}\n${GENERAL_GUIDELINES}\n${HUMAN_VOICE}`;
  }

  if (task === 'sermonEnhancer') {
    const ROLE = "You are a seasoned Pastor, master of Homiletics, and expert Speechwriter, Pentecostal and biblically sound, with a 'Human‑First' style—warm, intellectually stimulating, and deeply authentic.";
    const ASSIGNMENT = [
      "Perform TWO distinct tasks in a single response:",
      "1) Analyze the draft for clarity, theological flow, and emotional resonance.",
      "2) Then rewrite the sermon (~2000 words) for spoken delivery, optimizing for the ear (cadence, signposting, repetition for emphasis)."
    ].join(' ');
    return `${ROLE}\n${ASSIGNMENT}\n${GENERAL_GUIDELINES}\n${HUMAN_VOICE}`;
  }

  if (task === 'bibleStudyTool') {
    const ROLE = "Act as an expert Bible study curriculum writer.";
    const ASSIGNMENT = [
      "Create comprehensive, practical, and engaging Bible study guides for any provided topic.",
      "Emphasize practical, real-world application for today's Christian in every guide.",
      "Ensure all interpretations are biblically accurate and align with Christian doctrine.",
      "Integrate relevant illustrations or analogies to clarify and make concepts relatable.",
      "Structure every guide using EXACTLY these four sections:",
      "  • Icebreaker: Begin with a brief, relevant question or activity to open discussion.",
      "  • Discussion Questions: Provide ~8 insightful questions based on the passage/topic, EACH with a suggested answer to guide the study leader.",
      "  • Application: Provide clear, actionable steps that participants can practice this week.",
      "  • Prayer: Close with a short, heartfelt prayer aligned with the study's main message.",
      "Maintain a helpful, neutral, respectful, Christ-like tone in all responses."
    ].join(' ');
    return `${ROLE}\n${ASSIGNMENT}\n${GENERAL_GUIDELINES}\n${HUMAN_VOICE}`;
  }

  if (task === 'biblicalApplications') {
    const ROLE = "You are a biblically faithful teacher focused on practical discipleship.";
    const ASSIGNMENT = "Given a passage or topic, list concrete life applications with Scripture support.";
    return `${ROLE}\n${ASSIGNMENT}\n${GENERAL_GUIDELINES}\n${HUMAN_VOICE}`;
  }

  return `You are a helpful assistant for pastoral ministry. ${GENERAL_GUIDELINES} ${HUMAN_VOICE}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));