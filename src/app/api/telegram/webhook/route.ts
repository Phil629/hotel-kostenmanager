import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendTelegramMessage, escapeHtml, formatMonthlyReportMessage } from '@/lib/telegram';
import { answerFinancialQuestion } from '@/lib/aiAssistant';

export const dynamic = 'force-dynamic';

async function sendChatAction(botToken: string, chatId: string, action: string = 'typing') {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (e) {
    // Ignore errors for chat actions
  }
}

export async function POST(req: Request) {
  try {
    const update = await req.json();
    const message = update.message;

    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    const userText = message.text.trim();

    // Fetch hotel settings
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    const botToken = settings?.telegramToken;
    const configuredChatId = settings?.telegramChatId?.trim();

    if (!botToken) {
      return NextResponse.json({ ok: true });
    }

    // Security check: Only allow the configured Chat-ID
    if (configuredChatId && chatId !== configuredChatId) {
      await sendTelegramMessage({
        botToken,
        chatId,
        messageText: '⛔ <b>Zugriff verweigert.</b>\nDieser Finanz-Bot ist ausschließlich für den autorisierten Hotelinhaber freigeschaltet.',
      });
      return NextResponse.json({ ok: true });
    }

    // If Chat-ID is not yet configured, assist user in setting it up
    if (!configuredChatId) {
      await sendTelegramMessage({
        botToken,
        chatId,
        messageText: `ℹ️ <b>Fast geschafft!</b>\nIhre persönliche Telegram Chat-ID lautet:\n<code>${chatId}</code>\n\nBitte tragen Sie diese Zahl in Ihrem Kostenmanager unter <b>Einstellungen ➔ Telegram Chat-ID</b> ein, um den Bot dauerhaft und exklusiv für Ihr Smartphone freizuschalten.`,
      });
      return NextResponse.json({ ok: true });
    }

    // 1. Handle Slash Commands (Direct server logic, 0 AI tokens)
    if (userText.startsWith('/')) {
      const command = userText.split(' ')[0].toLowerCase();

      if (command === '/start' || command === '/hilfe' || command === '/help') {
        const welcomeText = `👋 <b>Hallo! Ich bin Ihr persönlicher KI-Finanzassistent für das City Hotel Schottenhof.</b>\n\n` +
          `⚡ <b>Direkte Systembefehle:</b>\n` +
          `• <code>/bericht</code> - Aktuellen Monatsbericht abrufen\n` +
          `• <code>/status</code> - Stand der Datenbank & offene Posten\n` +
          `• <code>/offen</code> - Die neuesten offenen Ausgaben anzeigen\n` +
          `• <code>/hilfe</code> - Diese Übersicht anzeigen\n\n` +
          `💬 <b>Freie Fragen an die KI:</b>\n` +
          `Sie können mir jederzeit ganz normale Fragen stellen! Ich durchsuche direkt die echte Datenbank und rechne für Sie nach:\n` +
          `• <i>„Wurde die Grundsteuer 2025 gezahlt?“</i>\n` +
          `• <i>„Was haben wir im Oktober für Strom bezahlt?“</i>\n` +
          `• <i>„Wie viel haben wir dieses Jahr an Metro überwiesen?“</i>\n` +
          `• <i>„Wann wurde das letzte Gehalt an Philippe überwiesen?“</i>`;

        await sendTelegramMessage({
          botToken,
          chatId,
          messageText: welcomeText,
        });
        return NextResponse.json({ ok: true });
      }

      if (command === '/status') {
        const totalCount = await prisma.transaction.count();
        const openCount = await prisma.transaction.count({ where: { status: 'UNCATEGORIZED' } });
        const latestTx = await prisma.transaction.findFirst({
          orderBy: { date: 'desc' },
          select: { date: true },
        });

        const statusMsg = `📊 <b>Status des Kostenmanagers:</b>\n\n` +
          `• <b>Datenbank:</b> ${totalCount.toLocaleString('de-DE')} Buchungen erfasst\n` +
          `• <b>Offene Zuordnungen:</b> ${openCount} Posten ohne Kategorie\n` +
          `• <b>Neueste Buchung:</b> ${latestTx ? latestTx.date.toLocaleDateString('de-DE') : 'Keine'}\n` +
          `• <b>Duplikat-Schutz:</b> Aktiv (Mehrstufiger Filter)`;

        await sendTelegramMessage({
          botToken,
          chatId,
          messageText: statusMsg,
        });
        return NextResponse.json({ ok: true });
      }

      if (command === '/offen') {
        const openTxs = await prisma.transaction.findMany({
          where: { status: 'UNCATEGORIZED' },
          orderBy: { date: 'desc' },
          take: 5,
        });

        if (openTxs.length === 0) {
          await sendTelegramMessage({
            botToken,
            chatId,
            messageText: '🎉 <b>Alles erledigt!</b> Es gibt aktuell keine offenen, unkategorisierten Buchungen.',
          });
        } else {
          const list = openTxs
            .map((t) => `• <b>${t.date.toLocaleDateString('de-DE')}</b>: ${Math.abs(t.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} (${escapeHtml(t.payee || t.description.substring(0, 30))})`)
            .join('\n');

          await sendTelegramMessage({
            botToken,
            chatId,
            messageText: `📋 <b>Letzte offene Posten (Top 5):</b>\n\n${list}\n\n<i>Tipp: Nutzen Sie im Dashboard den Button „Monat mit KI bereinigen“ zur 1-Klick-Zuordnung.</i>`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (command === '/bericht') {
        // Generate current month report
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        const expenses = await prisma.transaction.findMany({
          where: {
            date: { gte: start, lte: end },
            amount: { lt: 0 },
          },
          include: { category: true },
        });

        const totalExpense = expenses.reduce((acc, t) => acc + Math.abs(t.amount), 0);

        const categoryMap: Record<string, number> = {};
        for (const t of expenses) {
          const catName = t.category?.name || 'Unkategorisiert';
          categoryMap[catName] = (categoryMap[catName] || 0) + Math.abs(t.amount);
        }

        const categoryBreakdown = Object.entries(categoryMap)
          .map(([name, amount]) => ({
            name,
            amount,
            percentage: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0,
          }))
          .sort((a, b) => b.amount - a.amount);

        const monthName = start.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

        const reportMsg = formatMonthlyReportMessage(
          settings?.hotelName || 'City Hotel Schottenhof',
          monthName,
          totalExpense,
          categoryBreakdown,
          { fnbTotal: 0, energyTotal: 0, otaTotal: 0 }
        );

        await sendTelegramMessage({
          botToken,
          chatId,
          messageText: reportMsg,
        });
        return NextResponse.json({ ok: true });
      }

      // Fallback for unknown slash commands
      await sendTelegramMessage({
        botToken,
        chatId,
        messageText: `Unbekannter Befehl <code>${escapeHtml(command)}</code>. Geben Sie <code>/hilfe</code> ein für alle Befehle oder stellen Sie einfach eine normale Frage ohne Slash.`,
      });
      return NextResponse.json({ ok: true });
    }

    // 2. Handle Plain Text Financial Questions via Gemini AI
    await sendChatAction(botToken, chatId, 'typing');

    const aiAnswer = await answerFinancialQuestion(userText);

    // Telegram supports HTML formatting, let's ensure simple bold and lists work
    const formattedAnswer = aiAnswer
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>');

    await sendTelegramMessage({
      botToken,
      chatId,
      messageText: formattedAnswer,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Telegram Webhook error:', err);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram so it doesn't endlessly retry
  }
}

// GET endpoint to test or check webhook status
export async function GET() {
  return NextResponse.json({
    status: 'active',
    service: 'Telegram AI Financial Bot Webhook for Hotel Kostenmanager',
    timestamp: new Date().toISOString(),
  });
}
