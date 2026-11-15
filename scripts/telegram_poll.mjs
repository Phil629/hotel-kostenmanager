import { prisma } from '../src/lib/prisma';
import { sendTelegramMessage, escapeHtml, formatMonthlyReportMessage } from '../src/lib/telegram';
import { answerFinancialQuestion } from '../src/lib/aiAssistant';

let lastUpdateId = 0;

console.log('🤖 Telegram Long-Polling Dienst gestartet...');

async function pollUpdates() {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const botToken = settings?.telegramToken;
  const configuredChatId = settings?.telegramChatId?.trim();

  if (!botToken) {
    console.warn('Kein Telegram Bot Token konfiguriert.');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.ok || !Array.isArray(data.result)) {
      return;
    }

    for (const update of data.result) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      const message = update.message;
      if (!message || !message.text) continue;

      const chatId = String(message.chat.id);
      const userText = message.text.trim();

      // Security Check: Only allow configured Chat ID
      if (configuredChatId && chatId !== configuredChatId) {
        await sendTelegramMessage({
          botToken,
          chatId,
          messageText: '⛔ <b>Zugriff verweigert.</b>\nDieser Finanz-Bot ist ausschließlich für den autorisierten Hotelinhaber freigeschaltet.',
        });
        continue;
      }

      console.log(`[Telegram] Nachricht von Chat ${chatId}: "${userText}"`);

      // 1. Slash commands
      if (userText.startsWith('/')) {
        const cmd = userText.split(' ')[0].toLowerCase();
        if (cmd === '/start' || cmd === '/hilfe' || cmd === '/help') {
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

          await sendTelegramMessage({ botToken, chatId, messageText: welcomeText });
          continue;
        }

        if (cmd === '/status') {
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

          await sendTelegramMessage({ botToken, chatId, messageText: statusMsg });
          continue;
        }

        if (cmd === '/offen') {
          const openTxs = await prisma.transaction.findMany({
            where: { status: 'UNCATEGORIZED' },
            orderBy: { date: 'desc' },
            take: 5,
          });

          if (openTxs.length === 0) {
            await sendTelegramMessage({ botToken, chatId, messageText: '🎉 <b>Alles erledigt!</b> Keine offenen Buchungen.' });
          } else {
            const list = openTxs
              .map((t) => `• <b>${t.date.toLocaleDateString('de-DE')}</b>: ${Math.abs(t.amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} (${escapeHtml(t.payee || t.description.substring(0, 30))})`)
              .join('\n');
            await sendTelegramMessage({ botToken, chatId, messageText: `📋 <b>Letzte offene Posten:</b>\n\n${list}` });
          }
          continue;
        }

        if (cmd === '/bericht') {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

          const expenses = await prisma.transaction.findMany({
            where: { date: { gte: start, lte: end }, amount: { lt: 0 } },
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

          await sendTelegramMessage({ botToken, chatId, messageText: reportMsg });
          continue;
        }
      }

      // 2. Natural language question to AI
      await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      });

      const aiAnswer = await answerFinancialQuestion(userText);
      const formatted = aiAnswer
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.*?)\*/g, '<i>$1</i>');

      await sendTelegramMessage({ botToken, chatId, messageText: formatted });
    }
  } catch (err: any) {
    console.error('Polling error:', err.message);
  }
}

async function loop() {
  while (true) {
    await pollUpdates();
    await new Promise((r) => setTimeout(r, 1000));
  }
}

loop();
