import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    await req.json().catch(() => ({}));

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

    // Sicherstellen, dass kein externer Webhook das 24/7-Polling auf dem Hetzner-Server blockiert
    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);

    const meResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meResp.json();

    if (!meData.ok) {
      return NextResponse.json({
        success: false,
        error: meData.description || 'Telegram Bot Token ungültig.',
      });
    }

    const botUsername = meData.result?.username ? `@${meData.result.username}` : 'Telegram-Bot';

    return NextResponse.json({
      success: true,
      message: `${botUsername} ist aktiv verbunden (24/7 Live-Dienst für Bankumsätze, Umsatzberichte & Cockpitliste).`,
      bot: meData.result,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
