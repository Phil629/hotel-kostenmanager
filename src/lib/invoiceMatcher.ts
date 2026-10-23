import { prisma } from './prisma';

export interface ExtractedInvoiceData {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  grossAmount: number | null; // Positive EUR value, e.g. 750.00
  itemsSummary: string | null;
  paymentMethod: string | null;
  suggestedCategoryId: string | null;
  confidence: number;
  usedAi: boolean;
}

/**
 * Liest den Text aus einem PDF-Buffer mit pdf2json aus (als Fallback und Unterstützung für die KI).
 */
export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  try {
    const PDFParserMod: any = await import('pdf2json');
    const PDFParser = PDFParserMod.default || PDFParserMod;
    return await new Promise<string>((resolve) => {
      const parser = new PDFParser(null, 1);
      const timeout = setTimeout(() => resolve(''), 8000);
      parser.on('pdfParser_dataError', () => {
        clearTimeout(timeout);
        resolve('');
      });
      parser.on('pdfParser_dataReady', () => {
        clearTimeout(timeout);
        try {
          const raw = parser.getRawTextContent() || '';
          resolve(raw.replace(/\r\n/g, '\n').trim());
        } catch {
          resolve('');
        }
      });
      parser.parseBuffer(buffer);
    });
  } catch {
    return '';
  }
}

/**
 * Holt den hinterlegten Gemini API-Key (entweder aus den DB-Settings oder aus der .env).
 */
export async function getActiveGeminiApiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY?.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    if (settings?.geminiApiKey?.trim()) {
      return settings.geminiApiKey.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Prüft, ob es sich bei einer Kategorie um eine Sammel-/Sonstiges-Kategorie handelt,
 * die von der KI niemals automatisch zugewiesen werden darf.
 */
export function isIgnoredFallbackCategory(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'sonstiges' || n === 'sonstige' || n.startsWith('sonstig');
}

/**
 * Analysiert eine PDF-Rechnung (oder E-Mail) mit Gemini KI (oder lokalem Text-Fallback)
 * und extrahiert Betrag, Lieferant, Datum, Rechnungsnummer, gekaufte Artikel & passende Hotel-Kategorie.
 */
export async function analyzeInvoiceDocument(params: {
  pdfBuffer?: Buffer;
  fileName: string;
  emailSubject?: string | null;
  emailFrom?: string | null;
  emailText?: string | null;
}): Promise<ExtractedInvoiceData> {
  const allCategories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
  // "Sonstiges" komplett ausschließen, damit die KI bei Unsicherheit niemals auf "Sonstiges" ausweicht
  const categories = allCategories.filter((c) => !isIgnoredFallbackCategory(c.name));
  const apiKey = await getActiveGeminiApiKey();

  const pdfText = params.pdfBuffer ? await extractTextFromPdfBuffer(params.pdfBuffer) : '';
  const combinedText = [
    params.emailSubject ? `Betreff: ${params.emailSubject}` : '',
    params.emailFrom ? `Absender: ${params.emailFrom}` : '',
    params.emailText ? `E-Mail-Text:\n${params.emailText.slice(0, 3000)}` : '',
    pdfText ? `PDF-Text:\n${pdfText.slice(0, 8000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (apiKey) {
    const categoriesPrompt = categories
      .map((c) => `- ID: "${c.id}", Name: "${c.name}"${c.description ? ` (${c.description})` : ''}`)
      .join('\n');

    const prompt = `Du bist der KI-Buchhaltungs-Assistent für das City Hotel Schottenhof.
Lies die beigefügte Eingangsrechnung (PDF / E-Mail) aus und extrahiere die Rechnungsdaten sowie die passende Hotel-Ausgabenkategorie.

Verfügbare Hotel-Kategorien (Hinweis: "Sonstiges" darf NIEMALS verwendet werden):
${categoriesPrompt}

Zusätzliche Metadaten / erkannter Text:
Dateiname: ${params.fileName}
${combinedText}

WICHTIG:
- "grossAmount" muss der gesamte zu zahlende BRUTTO-Rechnungsbetrag (inkl. MwSt.) in Euro als positive Dezimalzahl sein (z.B. 750.00).
- "invoiceDate" im Format "YYYY-MM-DD" (oder null).
- "itemsSummary": kurze, prägnante deutsche Beschreibung, was konkret gekauft/berechnet wurde (z.B. "20 Kartons Toilettenpapier & Hygienebedarf").
- "paymentMethod": falls erkennbar z.B. "PayPal", "Lastschrift", "Überweisung", "Kreditkarte" oder null.
- "suggestedCategoryId": die exakt passende Kategorie-ID aus der obigen Liste. Wenn du dir nicht sicher bist oder keine spezifische Kategorie passt, gib zwingend null zurück (NIEMALS raten oder "Sonstiges" wählen!).

Antworte AUSSCHLIESSLICH mit gültigem JSON (ohne Markdown-Codeblock):
{
  "vendorName": "Name des Lieferanten / Händlers",
  "invoiceNumber": "Rechnungsnummer oder null",
  "invoiceDate": "YYYY-MM-DD oder null",
  "grossAmount": 750.00,
  "itemsSummary": "Kurze Beschreibung der Artikel/Leistung",
  "paymentMethod": "PayPal",
  "suggestedCategoryId": "UUID der passenden Kategorie oder null",
  "confidence": 0.95
}`;

    const parts: any[] = [{ text: prompt }];
    if (params.pdfBuffer && params.pdfBuffer.length < 15 * 1024 * 1024) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: params.pdfBuffer.toString('base64'),
        },
      });
    }

    const models = ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemma-4-31b-it'];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { temperature: 0.1 },
            }),
          }
        );

        if (!res.ok) continue;
        const data = await res.json();
        const resParts: any[] = data.candidates?.[0]?.content?.parts || [];
        const textPart =
          resParts.filter((p) => typeof p.text === 'string' && !p.thought).pop() ||
          resParts.filter((p) => typeof p.text === 'string').pop();
        const textResp = textPart?.text;
        if (!textResp) continue;

        const cleanJson = textResp.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;
        const parsed = JSON.parse(jsonMatch[0]);

        const validCat = categories.find((c) => c.id === parsed.suggestedCategoryId);
        const amountNum =
          typeof parsed.grossAmount === 'number'
            ? Math.round(Math.abs(parsed.grossAmount) * 100) / 100
            : typeof parsed.grossAmount === 'string'
            ? parseFloat(parsed.grossAmount.replace(',', '.')) || null
            : null;

        return {
          vendorName: parsed.vendorName || null,
          invoiceNumber: parsed.invoiceNumber || null,
          invoiceDate: parsed.invoiceDate || null,
          grossAmount: amountNum,
          itemsSummary: parsed.itemsSummary || null,
          paymentMethod: parsed.paymentMethod || null,
          suggestedCategoryId: validCat ? validCat.id : null,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
          usedAi: true,
        };
      } catch (e) {
        console.error(`Gemini (${model}) invoice parse error:`, e);
      }
    }
  }

  // Lokaler Fallback-Parser (falls noch kein Gemini-Key hinterlegt ist)
  return heuristicParseInvoice(combinedText, params.fileName, params.emailFrom || null, categories);
}

function heuristicParseInvoice(
  text: string,
  fileName: string,
  emailFrom: string | null,
  categories: Array<{ id: string; name: string; description: string | null }>
): ExtractedInvoiceData {
  // 1. Bruttobetrag suchen (z.B. "Gesamtbetrag 750,00 €" oder "Brutto: 1.234,56 EUR")
  let grossAmount: number | null = null;
  const totalRegex =
    /(?:gesamtbetrag|rechnungsbetrag|zahlbetrag|endbetrag|brutto|summe|total|zu zahlen)[^\d]{0,25}(\d{1,3}(?:\.\d{3})*,\d{2}|\d+\.\d{2})/gi;
  const totalMatches = [...text.matchAll(totalRegex)];
  if (totalMatches.length > 0) {
    const raw = totalMatches[totalMatches.length - 1][1];
    grossAmount = parseGermanNumber(raw);
  } else {
    const euroRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)/gi;
    const allAmounts = [...text.matchAll(euroRegex)]
      .map((m) => parseGermanNumber(m[1]))
      .filter((n): n is number => n !== null && n > 0);
    if (allAmounts.length > 0) {
      grossAmount = Math.max(...allAmounts);
    }
  }

  // 2. Datum suchen (DD.MM.YYYY)
  let invoiceDate: string | null = null;
  const dateMatch = text.match(/\b(\d{2})\.(\d{2})\.(202\d)\b/);
  if (dateMatch) {
    invoiceDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  // 3. Rechnungsnummer suchen
  let invoiceNumber: string | null = null;
  const invMatch = text.match(/(?:rechnungs(?:-?nr\.?|nummer)|beleg(?:-?nr\.?|nummer)|invoice)\s*[:#]?\s*([A-Z0-9\-\/]{4,25})/i);
  if (invMatch) {
    invoiceNumber = invMatch[1];
  }

  // 4. Zahlungsart
  const lower = text.toLowerCase();
  const paymentMethod = lower.includes('paypal')
    ? 'PayPal'
    : lower.includes('lastschrift') || lower.includes('sepa-mandat')
    ? 'Lastschrift'
    : lower.includes('kreditkarte') || lower.includes('visa') || lower.includes('mastercard')
    ? 'Kreditkarte'
    : null;

  // 5. Kategorie & Zusammenfassung über Stichwörter (ohne "Sonstiges"-Fallback!)
  const keywordRules: Array<{ keywords: string[]; catMatch: string[]; label: string }> = [
    {
      keywords: ['toilettenpapier', 'klopapier', 'seife', 'reinigung', 'putzmittel', 'hygiene', 'handtuch', 'wäsche', 'waschmittel', 'desinfektion'],
      catMatch: ['reinigung', 'hygiene', 'wäsche', 'zimmer', 'betriebsbedarf'],
      label: 'Hygiene- & Reinigungsbedarf',
    },
    {
      keywords: ['lebensmittel', 'frühstück', 'bäckerei', 'metzgerei', 'kaffee', 'milch', 'käse', 'wurst', 'obst', 'gemüse', 'metro', 'transgourmet'],
      catMatch: ['f&b', 'lebensmittel', 'wareneinkauf', 'getränke', 'gastronomie'],
      label: 'Lebensmittel & Frühstücksbedarf',
    },
    {
      keywords: ['wein', 'bier', 'wasser', 'saft', 'getränke', 'spirituosen', 'cola'],
      catMatch: ['getränke', 'f&b', 'wareneinkauf'],
      label: 'Getränkelieferung',
    },
    {
      keywords: ['reparatur', 'wartung', 'handwerker', 'sanitär', 'elektro', 'heizung', 'instandhaltung', 'ersatzteil', 'maler', 'schlüsseldienst', 'leuchtstoff', 'lampe', 'leuchtmittel'],
      catMatch: ['instandhaltung', 'reparatur', 'wartung'],
      label: 'Reparatur & Instandhaltung',
    },
    {
      keywords: ['strom', 'gas', 'fernwärme', 'wasser', 'stadtwerke', 'energie'],
      catMatch: ['energie', 'wasser', 'strom', 'raumkosten'],
      label: 'Energie & Versorgung',
    },
    {
      keywords: ['booking.com', 'expedia', 'hrs', 'provision', 'kommission'],
      catMatch: ['ota', 'provision', 'marketing'],
      label: 'OTA-Provisionen',
    },
    {
      keywords: ['software', 'lizenz', 'hosting', 'domain', 'telefon', 'internet', 'telekom', 'vodafone', 'drucker', 'papier', 'büro'],
      catMatch: ['it', 'büro', 'verwaltung', 'telefon'],
      label: 'IT & Bürobedarf',
    },
  ];

  let suggestedCategoryId: string | null = null;
  let itemsSummary: string | null = null;

  for (const rule of keywordRules) {
    const matchedKw = rule.keywords.filter((k) => lower.includes(k));
    if (matchedKw.length > 0) {
      itemsSummary = `${rule.label} (${matchedKw.slice(0, 3).join(', ')})`;
      for (const m of rule.catMatch) {
        const found = categories.find(
          (c) => !isIgnoredFallbackCategory(c.name) && c.name.toLowerCase().includes(m)
        );
        if (found) {
          suggestedCategoryId = found.id;
          break;
        }
      }
      if (suggestedCategoryId) break;
    }
  }

  // Bewusst KEIN Fallback auf "Sonstiges" oder categories[0]:
  // Wenn keine spezifische Kategorie sicher erkannt wurde, bleibt suggestedCategoryId = null.

  const vendorName = emailFrom
    ? emailFrom.replace(/<.*>/, '').replace(/"/g, '').trim()
    : fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();

  return {
    vendorName: vendorName || null,
    invoiceNumber,
    invoiceDate,
    grossAmount,
    itemsSummary: itemsSummary || `Rechnung ${fileName}`,
    paymentMethod,
    suggestedCategoryId,
    confidence: suggestedCategoryId ? 0.75 : 0.4,
    usedAi: false,
  };
}

function parseGermanNumber(raw: string): number | null {
  const cleaned = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : Math.round(val * 100) / 100;
}

// Sammel-Zahlungsdienstleister beim Einkauf (wo jeder Umsatz ein anderer Händler/Artikel sein kann).
// Hinweis: Hotel-Terminal-Anbieter wie Nexi/Concardis gehören NICHT hierhin, da deren Gebühren fest in "Darlehen & Bankkosten" gehören.
const GENERIC_PAYEES = ['paypal', 'amazon', 'klarna', 'kartenzahlung', 'ec-karte', 'visa', 'mastercard'];

export function isGenericPaymentProvider(payee: string | null, description: string): boolean {
  const combined = `${payee || ''} ${description}`.toLowerCase();
  return GENERIC_PAYEES.some((g) => combined.includes(g));
}

/**
 * Sucht für eine Rechnung den passenden OFFENEN (unkategorisierten) Bankumsatz
 * und ordnet die Kategorie automatisch zu, ohne bereits zugeordnete Umsätze zu verändern.
 */
export async function matchInvoiceToTransaction(invoiceId: string): Promise<{
  matched: boolean;
  transactionId: string | null;
  autoCategorized: boolean;
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { suggestedCategory: true },
  });
  if (!invoice || !invoice.grossAmount || invoice.grossAmount <= 0) {
    return { matched: false, transactionId: null, autoCategorized: false };
  }

  const targetAmount = invoice.grossAmount;

  // WICHTIG: Bereits zugeordnete Umsätze (manuell oder per Regel kategorisiert) werden komplett ignoriert!
  // Es werden ausschließlich offene/unkategorisierte Umsätze (status = 'UNCATEGORIZED' & categoryId = null) berücksichtigt.
  const candidates = await prisma.transaction.findMany({
    where: {
      amount: {
        gte: -(targetAmount + 0.02),
        lte: -(targetAmount - 0.02),
      },
      status: 'UNCATEGORIZED',
      categoryId: null,
      invoice: { is: null },
    },
    orderBy: { date: 'desc' },
  });

  if (candidates.length === 0) {
    return { matched: false, transactionId: null, autoCategorized: false };
  }

  const refDate = invoice.invoiceDate || invoice.emailDate || invoice.createdAt;
  const refTime = new Date(refDate).getTime();

  // Bewertungs-Score für jeden Kandidaten berechnen
  const scored = candidates
    .map((tx) => {
      let score = 0;
      const txTime = new Date(tx.date).getTime();
      const diffDays = (txTime - refTime) / (1000 * 60 * 60 * 24); // positiv = Bankabbuchung nach Rechnungsdatum

      // Datums-Fenster prüfen: Abbuchung meist 0 bis 45 Tage nach Rechnungsdatum (oder wenige Tage davor)
      if (diffDays >= -7 && diffDays <= 45) {
        score += 50 - Math.min(40, Math.abs(diffDays));
      } else if (Math.abs(diffDays) <= 90) {
        score += 10;
      } else {
        score -= 50; // Zu weit entfernt
      }

      // Unkategorisierte Umsätze
      score += 40;

      // PayPal / Kreditkarte / Sammel-Zahlungsdienstleister bevorzugen
      if (isGenericPaymentProvider(tx.payee, tx.description)) {
        score += 25;
      }

      const descLower = `${tx.payee || ''} ${tx.description}`.toLowerCase();

      // Rechnungsnummer im Verwendungszweck?
      if (invoice.invoiceNumber && invoice.invoiceNumber.length >= 4) {
        if (descLower.includes(invoice.invoiceNumber.toLowerCase())) {
          score += 100;
        }
      }

      // Lieferantenname im Verwendungszweck / Empfänger?
      if (invoice.vendorName) {
        const vendorWords = invoice.vendorName
          .toLowerCase()
          .split(/[\s,&.-]+/)
          .filter((w) => w.length >= 4 && !['gmbh', 'shop', 'online', 'deutschland'].includes(w));
        if (vendorWords.some((w) => descLower.includes(w))) {
          score += 60;
        }
      }

      // Zahlungsart PayPal erwähnt?
      if (invoice.paymentMethod?.toLowerCase() === 'paypal' && descLower.includes('paypal')) {
        score += 35;
      }

      return { tx, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { matched: false, transactionId: null, autoCategorized: false };
  }

  const best = scored[0].tx;
  const validCategoryId =
    invoice.suggestedCategoryId &&
    invoice.suggestedCategory &&
    !isIgnoredFallbackCategory(invoice.suggestedCategory.name)
      ? invoice.suggestedCategoryId
      : null;

  const shouldUpdateCategory = !!validCategoryId;

  // Hinweis mit Rechnungsinhalt an den Verwendungszweck anhängen (falls noch nicht vorhanden)
  const invoiceNote = [
    invoice.vendorName ? `📄 ${invoice.vendorName}` : '📄 Beleg',
    invoice.itemsSummary ? `: ${invoice.itemsSummary}` : '',
    invoice.invoiceNumber ? ` (Nr. ${invoice.invoiceNumber})` : '',
  ].join('');

  const updatedDescription = best.description.includes('📄')
    ? best.description
    : `${best.description} | ${invoiceNote}`;

  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        matchedTransactionId: best.id,
        status: 'MATCHED',
      },
    }),
    prisma.transaction.update({
      where: { id: best.id },
      data: {
        description: updatedDescription,
        ...(shouldUpdateCategory
          ? {
              categoryId: validCategoryId,
              status: 'CATEGORIZED',
            }
          : {}),
      },
    }),
  ]);

  return {
    matched: true,
    transactionId: best.id,
    autoCategorized: shouldUpdateCategory,
  };
}

/**
 * Prüft alle noch offenen Rechnungen ("PENDING") gegen die Bankumsätze.
 * Wird automatisch nach jedem Kontoauszug-Upload sowie nach dem Gmail-Abruf ausgeführt.
 */
export async function matchAllPendingInvoices(): Promise<{
  checkedCount: number;
  matchedCount: number;
  autoCategorizedCount: number;
}> {
  const pending = await prisma.invoice.findMany({
    where: { status: 'PENDING', matchedTransactionId: null },
    orderBy: { createdAt: 'desc' },
  });

  let matchedCount = 0;
  let autoCategorizedCount = 0;

  for (const inv of pending) {
    const res = await matchInvoiceToTransaction(inv.id);
    if (res.matched) {
      matchedCount++;
      if (res.autoCategorized) autoCategorizedCount++;
    }
  }

  return {
    checkedCount: pending.length,
    matchedCount,
    autoCategorizedCount,
  };
}
