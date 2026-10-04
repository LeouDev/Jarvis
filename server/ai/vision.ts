// Screen understanding: one Gemini vision call turns a screenshot into a short text answer,
// so the chat model only ever sees text (and the image is never stored).
export async function describeImage(dataUrl: string, question: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return 'Seeing the screen needs GEMINI_API_KEY on the server.';
  if (!/^data:image\/(jpeg|png);base64,/.test(dataUrl)) return 'The screenshot was not a valid image.';
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Screenshot of the user's Mac. ${question}\nAnswer concisely with what's relevant. Never read out passwords, keys or other secrets.` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!res?.ok) return "I couldn't analyse the screenshot right now.";
  return (await res.json()).choices?.[0]?.message?.content?.trim() || 'I could not make out anything useful.';
}
