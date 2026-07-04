import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry with exponential backoff for 429 quota errors
async function generateWithRetry(
  model: ReturnType<InstanceType<typeof GoogleGenerativeAI>["getGenerativeModel"]>,
  prompt: string,
  maxRetries = 5
) {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      });
      return result;
    } catch (err: any) {
      lastError = err;
      const is429 =
        err?.message?.includes("429") ||
        err?.message?.includes("quota") ||
        err?.message?.includes("Too Many Requests");
      if (is429 && attempt < maxRetries - 1) {
        const waitMs = 15000 * Math.pow(2, attempt);
        console.log(`[Retry ${attempt + 1}] Rate limit hit. Waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      chapterText,
      previousSummary,
      customPrompt,
      apiKey: clientApiKey,
      modelName = "gemini-2.0-flash",
    } = body;

    const apiKey = clientApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API Key is missing. Please set it in settings or environment." },
        { status: 400 }
      );
    }

    if (!chapterText || typeof chapterText !== "string") {
      return NextResponse.json(
        { error: "chapterText is required and must be a string." },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `You are a professional literary editor and book publisher.
Your task is to refine and polish the English text of the following book chapter.
Maintain the original plot, character names, and writing style, but improve flow, syntax, grammar, vocabulary, and general readability.

Here is the context of what happened in previous chapters (if any):
---
${previousSummary || "None (This is the first chapter)"}
---

Here is the raw text of the current chapter:
---
${chapterText}
---

${customPrompt ? `Additional editorial instructions:\n${customPrompt}\n` : ""}

Respond STRICTLY in JSON format with these two keys:
1. "refinedText": The fully refined, polished English text for this chapter. Do not add markdown headers or titles at the beginning.
2. "summary": A brief 1-2 sentence summary of this chapter to maintain continuity in subsequent chapters.
`;

    const result = await generateWithRetry(model, prompt);
    const responseText = result.response.text();

    try {
      const parsedData = JSON.parse(responseText);
      return NextResponse.json(parsedData);
    } catch (parseErr) {
      console.error("Failed to parse JSON from Gemini:", responseText, parseErr);
      return NextResponse.json(
        { error: "Failed to parse Gemini response as JSON.", rawResponse: responseText },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error("Gemini API Error:", err);
    const is429 =
      err?.message?.includes("429") ||
      err?.message?.includes("quota") ||
      err?.message?.includes("Too Many Requests");
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred.", isQuotaError: is429 },
      { status: is429 ? 429 : 500 }
    );
  }
}
