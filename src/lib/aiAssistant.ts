import { prisma } from './prisma';
import { getActiveGeminiApiKey } from './invoiceMatcher';

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];

// Tool declarations for Gemini Function Calling
const TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: 'search_transactions',
        description: 'Sucht in den Bankumsätzen nach Suchbegriffen (Lieferant, Verwendungszweck, Empfänger), Zeitraum oder Betragsgrenzen.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Suchbegriff für Empfänger oder Buchungstext (z.B. "Grundsteuer", "Fernwärme", "Philippe", "Metro")' },
            startDate: { type: 'STRING', description: 'Startdatum im Format YYYY-MM-DD (z.B. "2025-01-01")' },
            endDate: { type: 'STRING', description: 'Enddatum im Format YYYY-MM-DD (z.B. "2025-12-31")' },
            minAmount: { type: 'NUMBER', description: 'Minimaler Betrag (z.B. -500 für Ausgaben ab 500 €)' },
            maxAmount: { type: 'NUMBER', description: 'Maximaler Betrag' },
            categoryName: { type: 'STRING', description: 'Optionaler Kategoriename zur Einschränkung' },
          },
        },
      },
      {
        name: 'get_financial_overview',
        description: 'Ermittelt Gesamteinnahmen, Gesamtausgaben, Saldo und Kategorien-Aufteilung für einen Monat oder ein ganzes Jahr.',
        parameters: {
          type: 'OBJECT',
          properties: {
            year: { type: 'INTEGER', description: 'Jahr (z.B. 2024 oder 2025)' },
            month: { type: 'INTEGER', description: 'Optionaler Monat (1 bis 12)' },
          },
          required: ['year'],
        },
      },
      {
        name: 'get_employee_payroll',
        description: 'Ruft alle Gehalts- und Lohnüberweisungen für einen bestimmten Mitarbeiter in einem Jahr ab.',
        parameters: {
          type: 'OBJECT',
          properties: {
            employeeName: { type: 'STRING', description: 'Name des Mitarbeiters (z.B. "Philippe Dehos", "Susanne Puff", "Khurana")' },
            year: { type: 'INTEGER', description: 'Jahr (z.B. 2025)' },
          },
          required: ['employeeName', 'year'],
        },
      },
      {
        name: 'get_tax_summary',
        description: 'Ruft alle Steuerzahlungen (Gewerbesteuer, Grundsteuer, Umsatzsteuer, Lohnsteuer, Finanzamt, Stadtkasse Mainz) für ein bestimmtes Jahr ab.',
        parameters: {
          type: 'OBJECT',
          properties: {
            year: { type: 'INTEGER', description: 'Jahr (z.B. 2024 oder 2025)' },
            taxType: { type: 'STRING', description: 'Optional: "Gewerbesteuer", "Grundsteuer", "Umsatzsteuer", "Lohnsteuer"' },
          },
          required: ['year'],
        },
      },
    ],
  },
];

// Tool Executors
async function executeTool(name: string, args: any) {
  try {
    if (name === 'search_transactions') {
      const where: any = {};

      if (args.startDate || args.endDate) {
        where.date = {};
        if (args.startDate) where.date.gte = new Date(`${args.startDate}T00:00:00.000Z`);
        if (args.endDate) where.date.lte = new Date(`${args.endDate}T23:59:59.999Z`);
      }

      if (args.query) {
        where.OR = [
          { payee: { contains: args.query, mode: 'insensitive' } },
          { description: { contains: args.query, mode: 'insensitive' } },
        ];
      }

      if (args.minAmount !== undefined || args.maxAmount !== undefined) {
        where.amount = {};
        if (args.minAmount !== undefined) where.amount.gte = args.minAmount;
        if (args.maxAmount !== undefined) where.amount.lte = args.maxAmount;
      }

      if (args.categoryName) {
        where.category = { name: { contains: args.categoryName, mode: 'insensitive' } };
      }

      const txs = await prisma.transaction.findMany({
        where,
        take: 40,
        orderBy: { date: 'asc' },
        select: {
          date: true,
          amount: true,
          payee: true,
          description: true,
          category: { select: { name: true } },
        },
      });

      return {
        foundCount: txs.length,
        transactions: txs.map((t) => ({
          date: t.date.toISOString().split('T')[0],
          amount: t.amount,
          payee: t.payee,
          category: t.category?.name || 'Unkategorisiert',
          desc: t.description.length > 120 ? t.description.substring(0, 120) + '...' : t.description,
        })),
      };
    }

    if (name === 'get_financial_overview') {
      let start: Date;
      let end: Date;

      if (args.month) {
        const mStr = String(args.month).padStart(2, '0');
        start = new Date(`${args.year}-${mStr}-01T00:00:00.000Z`);
        const lastDay = new Date(args.year, args.month, 0).getDate();
        end = new Date(`${args.year}-${mStr}-${lastDay}T23:59:59.999Z`);
      } else {
        start = new Date(`${args.year}-01-01T00:00:00.000Z`);
        end = new Date(`${args.year}-12-31T23:59:59.999Z`);
      }

      const incomeAgg = await prisma.transaction.aggregate({
        where: { date: { gte: start, lte: end }, amount: { gt: 0 } },
        _sum: { amount: true },
        _count: true,
      });

      const expenseAgg = await prisma.transaction.aggregate({
        where: { date: { gte: start, lte: end }, amount: { lt: 0 } },
        _sum: { amount: true },
        _count: true,
      });

      const categoryTotals = await prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { date: { gte: start, lte: end }, amount: { lt: 0 } },
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'asc' } },
        take: 8,
      });

      const categories = await prisma.category.findMany();
      const catMap = new Map(categories.map((c) => [c.id, c.name]));

      return {
        year: args.year,
        month: args.month || 'Gesamtjahr',
        income: incomeAgg._sum.amount || 0,
        expense: expenseAgg._sum.amount || 0,
        balance: (incomeAgg._sum.amount || 0) + (expenseAgg._sum.amount || 0),
        topExpenseCategories: categoryTotals.map((c) => ({
          category: c.categoryId ? catMap.get(c.categoryId) || 'Unbekannt' : 'Unkategorisiert',
          amount: Math.abs(c._sum.amount || 0),
          count: c._count,
        })),
      };
    }

    if (name === 'get_employee_payroll') {
      const start = new Date(`${args.year}-01-01T00:00:00.000Z`);
      const end = new Date(`${args.year}-12-31T23:59:59.999Z`);

      const txs = await prisma.transaction.findMany({
        where: {
          date: { gte: start, lte: end },
          amount: { lt: 0 },
          OR: [
            { payee: { contains: args.employeeName, mode: 'insensitive' } },
            { description: { contains: args.employeeName, mode: 'insensitive' } },
          ],
        },
        orderBy: { date: 'asc' },
        select: { date: true, amount: true, payee: true, description: true },
      });

      return {
        employee: args.employeeName,
        year: args.year,
        paymentCount: txs.length,
        totalPaid: txs.reduce((sum, t) => sum + Math.abs(t.amount), 0),
        payments: txs.map((t) => ({
          date: t.date.toISOString().split('T')[0],
          amount: t.amount,
          desc: t.description.length > 90 ? t.description.substring(0, 90) + '...' : t.description,
        })),
      };
    }

    if (name === 'get_tax_summary') {
      const start = new Date(`${args.year}-01-01T00:00:00.000Z`);
      const end = new Date(`${args.year}-12-31T23:59:59.999Z`);

      const txs = await prisma.transaction.findMany({
        where: {
          date: { gte: start, lte: end },
          OR: [
            { description: { contains: 'gewst', mode: 'insensitive' } },
            { description: { contains: 'grundsteuer', mode: 'insensitive' } },
            { description: { contains: 'ums.st', mode: 'insensitive' } },
            { description: { contains: 'lohnst', mode: 'insensitive' } },
            { description: { contains: 'eink.st', mode: 'insensitive' } },
            { payee: { contains: 'finanzamt', mode: 'insensitive' } },
            { payee: { contains: 'stadt mainz', mode: 'insensitive' } },
            { payee: { contains: 'stadtkasse', mode: 'insensitive' } },
            { payee: { contains: 'landeshauptstadt mainz', mode: 'insensitive' } },
            { payee: { contains: 'landesfinanzkasse', mode: 'insensitive' } },
          ],
        },
        orderBy: { date: 'asc' },
        select: { date: true, amount: true, payee: true, description: true },
      });

      return {
        year: args.year,
        count: txs.length,
        taxTransactions: txs.map((t) => ({
          date: t.date.toISOString().split('T')[0],
          amount: t.amount,
          payee: t.payee,
          desc: t.description.length > 100 ? t.description.substring(0, 100) + '...' : t.description,
        })),
      };
    }

    return { error: `Unbekanntes Werkzeug: ${name}` };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * Antwortet auf eine freie Finanzfrage des Hotelinhabers mittels Gemini und Live-Datenbankabfragen.
 */
export async function answerFinancialQuestion(question: string): Promise<string> {
  const apiKey = await getActiveGeminiApiKey();
  if (!apiKey) {
    return '⚠️ Es ist kein Gemini API-Key in den Einstellungen hinterlegt. Bitte tragen Sie diesen unter Einstellungen ein.';
  }

  const systemInstruction = `Du bist der persönliche KI-Finanzassistent des City Hotel Schottenhof (Mainz).
Du sprichst direkt mit dem Hotelinhaber.
Deine Aufgabe ist es, Fragen zu Kontobewegungen, Ausgaben, Gehältern, Steuern und Kennzahlen präzise und faktenbasiert zu beantworten.
WICHTIG:
1. Erfinde KEINE Zahlen oder Daten! Nutze immer die bereitgestellten Werkzeuge (Tools), um die echten Zahlen aus der Datenbank abzurufen.
2. Wenn nach Steuern oder Gehältern gefragt wird, rufe die entsprechenden Werkzeuge auf, prüfe Beträge und Buchungstexte genau.
3. Formatiere Beträge immer mit Euro-Zeichen (z.B. 3.028,73 €).
4. Antworte klar, freundlich, sachlich und auf Deutsch. Halte Antworten prägnant und übersichtlich (mit Aufzählungspunkten oder kleinen Tabellen).`;

  const conversationHistory: any[] = [
    {
      role: 'user',
      parts: [{ text: question }],
    },
  ];

  // Try calling Gemini with tool calling loop (up to 3 iterations)
  for (const model of GEMINI_MODELS) {
    try {
      let turnCount = 0;
      while (turnCount < 4) {
        turnCount++;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: conversationHistory,
              systemInstruction: { parts: [{ text: systemInstruction }] },
              tools: TOOLS_DECLARATION,
              generationConfig: { temperature: 0.1 },
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`Gemini (${model}) error: ${response.status} - ${errText.slice(0, 100)}`);
          break; // Try next model
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const content = candidate?.content;
        const parts = content?.parts || [];

        // Check if Gemini wants to call a function
        const functionCallPart = parts.find((p: any) => p.functionCall);
        if (functionCallPart && functionCallPart.functionCall) {
          const { name, args } = functionCallPart.functionCall;

          // Execute tool
          const toolResult = await executeTool(name, args);

          // Add model response and tool response to history
          conversationHistory.push({
            role: 'model',
            parts: [{ functionCall: { name, args } }],
          });

          conversationHistory.push({
            role: 'function',
            parts: [
              {
                functionResponse: {
                  name,
                  response: { result: toolResult },
                },
              },
            ],
          });
          continue; // Loop again to let Gemini see the tool result
        }

        // Otherwise Gemini produced the final text response
        const textPart = parts.find((p: any) => typeof p.text === 'string' && !p.thought) || parts.find((p: any) => typeof p.text === 'string');
        if (textPart?.text) {
          return textPart.text.trim();
        }

        break;
      }
    } catch (e: any) {
      console.warn(`Error with ${model}:`, e.message);
    }
  }

  return 'Entschuldigung, bei der Verarbeitung der Anfrage ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut oder prüfen Sie Ihren Gemini API-Key.';
}
