import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { 
      chapterText, 
      chapterIndex, 
      totalChapters, 
      previousSummary, 
      customPrompt, 
      apiKey: clientApiKey,
      modelName = "gemini-1.5-flash"
    } = body;

    // Use client-provided API key, or server-side environment key
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

${customPrompt ? `Additional formatting or editorial instructions:\n${customPrompt}\n` : ""}

Respond STRICTLY in JSON format with the following keys:
1. "refinedText": The fully refined, polished English text for this chapter. Do not include markdown headers or title lines at the beginning of the text unless they are part of the story.
2. "summary": A brief 1-2 sentence summary of this chapter. Focus on key plot points, character actions, tone, and naming choices to maintain continuity in subsequent chapters.
3. "illustrationPrompt": A detailed, high-quality prompt for generating a chapter illustration using an AI image generator. Describe the scene's composition, mood, characters, and style (e.g. "A classic dark-themed book illustration showing...").
`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const responseText = result.response.text();
    
    try {
      const parsedData = JSON.parse(responseText);
      return NextResponse.json(parsedData);
    } catch (parseErr) {
      console.error("Failed to parse JSON response from Gemini:", responseText, parseErr);
      return NextResponse.json(
        { 
          error: "Failed to parse Gemini response as JSON.",
          rawResponse: responseText 
        },
        { status: 500 }
      );
    }

  } catch (err: any) {
    console.error("Gemini Refinement API Error:", err);
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred during refinement." },
      { status: 500 }
    );
  }
}
