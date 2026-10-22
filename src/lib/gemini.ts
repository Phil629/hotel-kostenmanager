import { getActiveGeminiApiKey } from './invoiceMatcher';

export interface GeminiSuggestionResult {
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  confidenceScore: number; // 0.0 to 1.0
  reasoning: string;
}

export interface TransactionInfo {
  payee: string | null;
  description: string;
  amount: number;
}

export interface CategoryInfo {
  id: string;
  name: string;
  description: string | null;
}

export async function suggestCategoryWithGemini(
  tx: TransactionInfo,
  categories: CategoryInfo[]
): Promise<GeminiSuggestionResult> {
  const apiKey = await getActiveGeminiApiKey();

  const categoriesPrompt = categories
    .map((c) => `- ID: "${c.id}", Name: "${c.name}"${c.description ? ` (${c.description})` : ''}`)
    .join('\n');

  const promptText = `Du bist der KI-Kosten-Assistent für ein Hotel. Ordne folgenden Bankumsatz der am besten passenden Hotel-Kategorie zu.

**Verfügbare Kategorien:**
${categoriesPrompt}

**Transaktion:**
- Empfänger: ${tx.payee || 'Unbekannt'}
- Verwendungszweck: ${tx.description}
- Betrag: ${tx.amount} EUR

Antworte AUSSCHLIESSLICH in folgendem JSON-Format (kein Markdown block):
{
  "suggestedCategoryId": "Kategorie-ID aus der Liste",
  "suggestedCategoryName": "Exakter Name der Kategorie",
  "confidenceScore": 0.95,
  "reasoning": "Kurze Begründung auf Deutsch"
}`;

  if (!apiKey) {
    const descLower = tx.description.toLowerCase();
    const payeeLower = (tx.payee || '').toLowerCase();

    for (const cat of categories) {
      const catLower = cat.name.toLowerCase();
      if (catLower.includes('getränke') && (descLower.includes('wein') || descLower.includes('bier') || payeeLower.includes('getränk'))) {
        return {
          suggestedCategoryId: cat.id,
          suggestedCategoryName: cat.name,
          confidenceScore: 0.9,
          reasoning: 'Simulation ohne API-Key: Stichwörter für Getränke im Verwendungszweck erkannt.',
        };
      }
      if (catLower.includes('lebensmittel') && (descLower.includes('fleisch') || descLower.includes('gemüse') || payeeLower.includes('metro'))) {
        return {
          suggestedCategoryId: cat.id,
          suggestedCategoryName: cat.name,
          confidenceScore: 0.92,
          reasoning: 'Simulation ohne API-Key: Lebensmittel/Großmarkt erkannt.',
        };
      }
    }

    const fallbackCat = categories[0];
    return {
      suggestedCategoryId: fallbackCat?.id || null,
      suggestedCategoryName: fallbackCat?.name || null,
      confidenceScore: 0.7,
      reasoning: 'Simulierter Vorschlag (Hinterlegen Sie unter "Rechnungs-KI" Ihren kostenlosen Gemini API-Key für echte KI-Analysen).',
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
        }),
      }
    );

    const data = await response.json();
    const textResp = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textResp) {
      throw new Error('Keine Antwort von Gemini API erhalten');
    }

    const cleanJsonText = textResp.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJsonText);

    return {
      suggestedCategoryId: parsed.suggestedCategoryId || null,
      suggestedCategoryName: parsed.suggestedCategoryName || null,
      confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.85,
      reasoning: parsed.reasoning || 'Gemini KI Zuordnungsvorschlag',
    };
  } catch (err: any) {
    console.error('Gemini API Error:', err);
    return {
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidenceScore: 0,
      reasoning: `Gemini API Fehler: ${err.message}`,
    };
  }
}
