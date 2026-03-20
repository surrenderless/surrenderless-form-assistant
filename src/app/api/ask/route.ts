// src/app/api/ask/route.ts
import { NextResponse } from "next/server";

const FORM_KEYWORDS = [
  "form",
  "complaint",
  "apply",
  "application",
  "sign up",
  "signup",
  "report",
  "inquiry",
  "consumer justice",
];

export async function POST(req: Request) {
  const { prompt } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
  }

  const lower = prompt.toLowerCase();
  const looksLikeFormRequest = FORM_KEYWORDS.some((k) => lower.includes(k));

  // 🔹 form-style request → delegate to /api/forms/suggest
  if (looksLikeFormRequest) {
    const base = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") ?? "";

    const suggestRes = await fetch(`${base}/api/forms/suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
      },
      body: JSON.stringify({ query: prompt }),
    });

    if (!suggestRes.ok) {
      const txt = await suggestRes.text().catch(() => "");
      console.warn("forms/suggest failed:", txt);
      return NextResponse.json(
        { error: "forms_suggest_failed", details: txt },
        { status: 500 },
      );
    }

    const data = await suggestRes.json();
    return NextResponse.json({
      mode: "forms_suggest",
      ...data,
    });
  }

  // 🔹 normal chat behavior (same as before)
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4-1106-preview",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    console.error("OpenAI API error:", data);
    return NextResponse.json({ result: "Error: No response from OpenAI" });
  }

  return NextResponse.json({
    mode: "chat",
    result: data.choices[0].message.content,
  });
}
