import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const { pageData, userProfile } = await req.json()

  const messages = [
    {
      role: 'system',
      content:
        'You are a step-by-step form submission agent. You must decide how to interact with the page, based on buttons and fields.'
    },
    {
      role: 'user',
      content: `Page data: ${JSON.stringify(pageData, null, 2)}\n\nUser data: ${JSON.stringify(userProfile, null, 2)}\n\nWhat should we fill? What button should we click next? Respond like this:\n{\n  fieldsToFill: [ { selector, value } ],\n  nextButton: { selectorType: "text" | "id" | "name", value: "Continue" },\n  waitForNavigation: true\n}`
    }
  ]

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
    temperature: 0,
  })

  const responseText = completion.choices[0].message.content

  try {
    const parsed = JSON.parse(responseText!)
    return NextResponse.json({ decision: parsed })
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON response from GPT', raw: responseText }, { status: 500 })
  }
}
