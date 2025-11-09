export {}; // force module scope

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

const tools = {
  DOMParser: async (url: string) => {
    const response = await fetch(`${baseUrl}/api/analyze-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const result = await response.json();
    if (response.ok) return result.fields;
    throw new Error(result.error || 'Failed to analyze form');
  },

  OpenAI: async ({ pageData, userProfile }: { pageData: any; userProfile: any }) => {
    const response = await fetch(`${baseUrl}/api/decide-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageData, userProfile }),
    });

    const result = await response.json();
    if (response.ok) return result.decision;
    throw new Error(result.error || 'Failed to get decision from GPT');
  },

  BrowserControl: async ({
    url,
    email,
    decision,
  }: {
    url: string;
    email: string;
    decision: any;
  }) => {
    const response = await fetch(`${baseUrl}/api/fill-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, email, decision }),
    });

    const result = await response.json();
    if (response.ok) return result;
    throw new Error(result.error || 'Failed to fill form');
  },
};

export default tools;
