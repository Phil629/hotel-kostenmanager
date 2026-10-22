import { getActiveGeminiApiKey, isIgnoredFallbackCategory } from './invoiceMatcher';

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

  // "Sonstiges" strikt ausschließen, damit die KI niemals blind auf "Sonstiges" ausweicht
  const allowedCategories = categories.filter((c) => !isIgnoredFallbackCategory(c.name));

  const categoriesPrompt = allowedCategories
    .map((c) => `- ID: "${c.id}", Name: "${c.name}"${c.description ? ` (${c.description})` : ''}`)
    .join('\n');

  const promptText = `Du bist der KI-Kosten-Assistent für ein Hotel. Ordne folgenden Bankumsatz der am besten passenden Hotel-Kategorie zu.

**Verfügbare Kategorien (WICHTIG: "Sonstiges" darf NIEMALS verwendet werden):**
${categoriesPrompt}

**Transaktion:**
- Empfänger: ${tx.payee || 'Unbekannt'}
- Verwendungszweck: ${tx.description}
- Betrag: ${tx.amount} EUR

WICHTIG: Wenn der Umsatz nicht eindeutig zu einer der genannten spezifischen Kategorien passt oder du dir unsicher bist (z. B. reine PayPal-Abbuchung ohne Artikelhinweis), setze "suggestedCategoryId" und "suggestedCategoryName" zwingend auf null!

Antworte AUSSCHLIESSLICH in folgendem JSON-Format (kein Markdown block):
{
  "suggestedCategoryId": "Kategorie-ID aus der Liste oder null",
  "suggestedCategoryName": "Exakter Name der Kategorie oder null",
  "confidenceScore": 0.95,
  "reasoning": "Kurze Begründung auf Deutsch"
}`;

  if (!apiKey) {
    const descLower = tx.description.toLowerCase();
    const payeeLower = (tx.payee || '').toLowerCase();

    for (const cat of allowedCategories) {
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

    return {
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidenceScore: 0,
      reasoning: 'Keine eindeutige Kategorie erkannt (Kategorie "Sonstiges" wird bewusst ignoriert).',
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    const data = await response.json();
    const resParts: any[] = data.candidates?.[0]?.content?.parts || [];
    const textPart =
      resParts.filter((p) => typeof p.text === 'string' && !p.thought).pop() ||
      resParts.filter((p) => typeof p.text === 'string').pop();
    const textResp = textPart?.text;

    if (!textResp) {
      throw new Error('Keine Antwort von Gemini API erhalten');
    }

    const cleanJsonText = textResp.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Ungültige JSON-Antwort von Gemini API');
    }
    const parsed = JSON.parse(jsonMatch[0]);

    const validCat = allowedCategories.find((c) => c.id === parsed.suggestedCategoryId);

    return {
      suggestedCategoryId: validCat ? validCat.id : null,
      suggestedCategoryName: validCat ? validCat.name : null,
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
