// src/app/api/forms/suggest/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabaseClient";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const { data: templates, error } = await supabaseAdmin
    .from("form_templates")
    .select("id, slug, name, category, description, target_url, is_active")
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!templates || templates.length === 0) {
    return NextResponse.json({ templates: [], matched: [] });
  }

  const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content:
            'You map user requests to form templates. Return ONLY JSON: {"slugs": ["slug1", "slug2", ...]}',
        },
        {
          role: "user",
          content: `User request: ${query}\n\nAvailable templates:\n${JSON.stringify(
            templates.map((t) => ({
              slug: t.slug,
              name: t.name,
              category: t.category,
              description: t.description,
            })),
          )}`,
        },
      ],
      temperature: 0,
    }),
  });

  if (!gptRes.ok) {
    const txt = await gptRes.text().catch(() => "");
    console.warn("GPT suggest error:", txt);
    return NextResponse.json({ templates, matched: templates });
  }

  let content = (await gptRes.json())?.choices?.[0]?.message?.content ?? "{}";

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) content = fenced[1];

  let slugs: string[] = [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed?.slugs)) {
      slugs = parsed.slugs.filter((x: any) => typeof x === "string");
    }
  } catch (e) {
    console.warn("Could not parse GPT suggest JSON:", content);
  }

  const matched =
    slugs.length === 0
      ? templates
      : templates.filter((t) => slugs.includes(t.slug));

  return NextResponse.json({ templates, matched });
}
