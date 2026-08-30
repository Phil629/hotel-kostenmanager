export interface SendTelegramParams {
  botToken: string;
  chatId: string;
  messageText: string;
}

export async function sendTelegramMessage({ botToken, chatId, messageText }: SendTelegramParams) {
  if (!botToken || !chatId) {
    throw new Error('Telegram Bot Token und Chat-ID erforderlich');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
    }),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API Error: ${data.description || 'Unbekannter Fehler'}`);
  }

  return data;
}

export function formatMonthlyReportMessage(
  hotelName: string,
  monthYear: string,
  totalExpense: number,
  categoryBreakdown: { name: string; amount: number; percentage: number }[],
  kpis: { fnbTotal: number; energyTotal: number; otaTotal: number }
): string {
  const categoriesList = categoryBreakdown
    .slice(0, 7)
    .map((c) => `• <b>${c.name}</b>: ${c.amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} (${c.percentage}%)`)
    .join('\n');

  return `<b>🏨 Monatsbericht: ${hotelName}</b>
📅 <b>Zeitraum:</b> ${monthYear}

💸 <b>Gesamtausgaben:</b> ${totalExpense.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}

<b>📊 Top-Kostenpunkte:</b>
${categoriesList}

<b>⚡ Hotel Key Performance Metrics:</b>
• 🥖 <b>F&B (Gastronomie):</b> ${kpis.fnbTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
• ⚡ <b>Energie & Strom:</b> ${kpis.energyTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}
• 🛎️ <b>OTA (Booking/HRS):</b> ${kpis.otaTotal.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}

<i>Erstellt automatisch vom Antigravity Hotel-Kostenmanager.</i>`;
}
