export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!discordWebhookUrl) {
      console.error('DISCORD_WEBHOOK_URL is not set in Vercel.');
      return new Response('Server configuration error', { status: 500 });
    }

    // Pass the raw formData directly to Discord
    const formData = await req.formData();
    
    const response = await fetch(discordWebhookUrl, {
      method: 'POST',
      body: formData,
    });

    if (response.ok || response.status === 204) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      console.error('Discord API Error:', response.status, await response.text());
      return new Response(JSON.stringify({ success: false, error: 'Discord API error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Webhook forwarding error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
