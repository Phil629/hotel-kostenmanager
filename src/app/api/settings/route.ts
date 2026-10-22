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
          hotelName: 'City Hotel Schottenhof',
        },
      });
    }

    return NextResponse.json({
      settings: {
        ...settings,
        hasEnvGeminiKey: !!process.env.GEMINI_API_KEY,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      telegramToken,
      telegramChatId,
      emailAddress,
      hotelName,
      autoSendReports,
      geminiApiKey,
      gmailUser,
      gmailAppPassword,
      gmailFolder,
    } = body;

    const updateData: any = {};
    if (telegramToken !== undefined) updateData.telegramToken = telegramToken;
    if (telegramChatId !== undefined) updateData.telegramChatId = telegramChatId;
    if (emailAddress !== undefined) updateData.emailAddress = emailAddress;
    if (hotelName !== undefined) updateData.hotelName = hotelName;
    if (autoSendReports !== undefined) updateData.autoSendReports = autoSendReports;
    if (geminiApiKey !== undefined) updateData.geminiApiKey = geminiApiKey;
    if (gmailUser !== undefined) updateData.gmailUser = gmailUser;
    if (gmailAppPassword !== undefined) updateData.gmailAppPassword = gmailAppPassword;
    if (gmailFolder !== undefined) updateData.gmailFolder = gmailFolder;

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: updateData,
      create: {
        id: 'default',
        hotelName: hotelName || 'City Hotel Schottenhof',
        ...updateData,
      },
    });

    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
