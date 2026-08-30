import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function GET() {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: 'default',
          hotelName: 'Parkhotel & Restaurant Bergblick',
        },
      });
    }

    return NextResponse.json({ settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { telegramToken, telegramChatId, emailAddress, hotelName, autoSendReports } = body;

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: {
        telegramToken,
        telegramChatId,
        emailAddress,
        hotelName,
        autoSendReports: autoSendReports ?? true,
      },
      create: {
        id: 'default',
        telegramToken,
        telegramChatId,
        emailAddress,
        hotelName: hotelName || 'Parkhotel & Restaurant Bergblick',
        autoSendReports: autoSendReports ?? true,
      },
    });

    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
