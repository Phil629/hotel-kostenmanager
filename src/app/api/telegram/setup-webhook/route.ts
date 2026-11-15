import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { action, customUrl } = await req.json().catch(() => ({ action: 'set', customUrl: null }));

    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    const botToken = settings?.telegramToken;
    if (!botToken) {
      return NextResponse.json(
        { success: false, error: 'Kein Telegram Bot Token in den Einstellungen hinterlegt.' },
        { status: 400 }
      );
    }

    if (action === 'delete') {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
      const data = await resp.json();
      return NextResponse.json({ success: data.ok, result: data });
    }

    if (action === 'info') {
      const resp = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const data = await resp.json();
      return NextResponse.json({ success: data.ok, info: data.result });
    }

    // Determine webhook URL
    let webhookUrl = customUrl;
    if (!webhookUrl) {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
      const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
      webhookUrl = `${proto}://${host}/api/telegram/webhook`;
    }

    // Telegram requires HTTPS for public webhooks
    const resp = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&allowed_updates=["message"]`
    );
    const data = await resp.json();

    if (!data.ok) {
      return NextResponse.json({
        success: false,
        error: data.description || 'Telegram Fehler beim Setzen des Webhooks',
        webhookUrl,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Telegram Webhook erfolgreich aktiviert auf ${webhookUrl}`,
      webhookUrl,
      result: data,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
