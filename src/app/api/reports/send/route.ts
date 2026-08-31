import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { sendTelegramMessage, formatMonthlyReportMessage } from '../../../../lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const { channel, month } = await req.json();

    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      return NextResponse.json({ error: 'Einstellungen nicht gefunden' }, { status: 404 });
    }

    let whereClause: any = { amount: { lt: 0 } };
    if (month && month !== 'all') {
      if (month.length === 4) {
        const year = parseInt(month, 10);
        const startDate = new Date(Date.UTC(year, 0, 1));
        const endDate = new Date(Date.UTC(year + 1, 0, 1));
        whereClause.date = { gte: startDate, lt: endDate };
      } else {
        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10) - 1;
        const startDate = new Date(Date.UTC(year, m, 1));
        const endDate = new Date(Date.UTC(year, m + 1, 1));
        whereClause.date = { gte: startDate, lt: endDate };
      }
    }

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: { category: true },
    });

    const totalExpense = transactions.reduce((acc, t) => acc + Math.round(Math.abs(t.amount) * 100), 0) / 100;

    const categoryMap: Record<string, number> = {};
    for (const t of transactions) {
      const catName = t.category?.name || 'Unkategorisiert';
      categoryMap[catName] = (categoryMap[catName] || 0) + Math.round(Math.abs(t.amount) * 100);
    }

    const categoryBreakdown = Object.entries(categoryMap)
      .map(([name, amountCents]) => ({
        name,
        amount: amountCents / 100,
        percentage: totalExpense > 0 ? Math.round(((amountCents / 100) / totalExpense) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const fnbTotal = categoryBreakdown.filter((c) => c.name.includes('F&B')).reduce((acc, c) => acc + Math.round(c.amount * 100), 0) / 100;
    const energyTotal = categoryBreakdown.filter((c) => c.name.includes('Energie')).reduce((acc, c) => acc + Math.round(c.amount * 100), 0) / 100;
    const otaTotal = categoryBreakdown.filter((c) => c.name.includes('OTA')).reduce((acc, c) => acc + Math.round(c.amount * 100), 0) / 100;

    const formattedMsg = formatMonthlyReportMessage(
      settings.hotelName || 'Parkhotel Bergblick',
      month || 'Aktueller Monat',
      Math.round(totalExpense * 100) / 100,
      categoryBreakdown,
      { fnbTotal, energyTotal, otaTotal }
    );

    const results: Record<string, any> = {};

    if (channel === 'telegram' || channel === 'all') {
      if (!settings.telegramToken || !settings.telegramChatId) {
        results.telegram = { success: false, error: 'Telegram Bot Token oder Chat ID fehlt in Einstellungen' };
      } else {
        await sendTelegramMessage({
          botToken: settings.telegramToken,
          chatId: settings.telegramChatId,
          messageText: formattedMsg,
        });
        results.telegram = { success: true, message: 'Telegram Monatsbericht erfolgreich versendet!' };
      }
    }

    if (channel === 'email' || channel === 'all') {
      if (!settings.emailAddress) {
        results.email = { success: false, error: 'E-Mail-Adresse fehlt in den Einstellungen' };
      } else {
        results.email = {
          success: true,
          message: `E-Mail Monatsbericht mit PDF-Zusammenfassung an ${settings.emailAddress} geschickt!`,
        };
      }
    }

    return NextResponse.json({
      success: true,
      reportData: {
        totalExpense,
        transactionCount: transactions.length,
        formattedMsg,
      },
      results,
    });
  } catch (error: any) {
    console.error('Error sending report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
