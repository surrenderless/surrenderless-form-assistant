import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
  model: 'gpt-4-1106-preview', // 👈 this is the one to use
  messages: [{ role: 'user', content: prompt }],
}),
  });

  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    console.error('OpenAI API error:', data);
    return NextResponse.json({ result: 'Error: No response from OpenAI' });
  }

  return NextResponse.json({ result: data.choices[0].message.content });
}
