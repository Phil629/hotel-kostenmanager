import { getActiveGeminiApiKey, isIgnoredFallbackCategory } from './invoiceMatcher';

export interface GeminiSuggestionResult {
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  cleanPayee?: string | null;
  confidenceScore: number; // 0.0 to 1.0
  reasoning: string;
}

export interface TransactionInfo {
  id?: string;
  payee: string | null;
  description: string;
  amount: number;
  currentCategoryId?: string | null;
  currentCategoryName?: string | null;
}

export interface CategoryInfo {
  id: string;
  name: string;
  description: string | null;
}

export interface MonthAuditItem {
  id: string;
  cleanPayee: string | null;
  originalPayee: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  currentCategoryId: string | null;
  currentCategoryName: string | null;
  confidence: number;
  type: 'NEW_ASSIGNMENT' | 'CORRECTION' | 'CLEANUP';
  reason: string;
}

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];

/**
 * Führt einen Aufruf gegen die Gemini API mit automatischem Modell-Fallback durch.
 */
async function callGeminiApi(apiKey: string, promptText: string): Promise<any> {
  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Gemini (${model}) error: ${response.status} - ${errorText.slice(0, 120)}`);
        continue;
      }

      const data = await response.json();
      const resParts: any[] = data.candidates?.[0]?.content?.parts || [];
      const textPart =
        resParts.filter((p) => typeof p.text === 'string' && !p.thought).pop() ||
        resParts.filter((p) => typeof p.text === 'string').pop();
      const textResp = textPart?.text;

      if (!textResp) {
        continue;
      }

      const cleanJsonText = textResp.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleanJsonText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!jsonMatch) {
        continue;
      }

      return JSON.parse(jsonMatch[0]);
    } catch (err: any) {
      lastError = err;
      console.warn(`Gemini (${model}) exception:`, err.message);
    }
  }

  throw lastError || new Error('Keine Antwort von Gemini API Modellen erhalten.');
}

/**
 * Einzelner Zuordnungsvorschlag für eine Transaktion.
 */
export async function suggestCategoryWithGemini(
  tx: TransactionInfo,
  categories: CategoryInfo[]
): Promise<GeminiSuggestionResult> {
  const apiKey = await getActiveGeminiApiKey();

  // "Sonstiges" strikt ausschließen
  const allowedCategories = categories.filter((c) => !isIgnoredFallbackCategory(c.name));

  const categoriesPrompt = allowedCategories
    .map((c) => `- ID: "${c.id}", Name: "${c.name}"${c.description ? ` (${c.description})` : ''}`)
    .join('\n');

  const promptText = `Du bist der KI-Kosten-Assistent für das City Hotel Schottenhof. Ordne folgenden Bankumsatz der am besten passenden Hotel-Kategorie zu und bereinige den Händlernamen.

**Verfügbare Hotel-Kategorien (WICHTIG: "Sonstiges" darf NIEMALS verwendet werden):**
${categoriesPrompt}

**Transaktion:**
- Empfänger: ${tx.payee || 'Unbekannt'}
- Verwendungszweck: ${tx.description}
- Betrag: ${tx.amount} EUR

WICHTIG:
1. "cleanPayee": Bereinigter, echter Händlername (z. B. aus "1053275545044/. Bike24 GmbH..." -> "Bike24 GmbH" oder aus PayPal-Texten den tatsächlichen Verkäufer extrahieren).
2. "suggestedCategoryId": ID aus der Liste. Wenn nicht eindeutig zuordenbar, null setzen.
3. "reasoning": Kurze, präzise Begründung auf Deutsch.

Antworte AUSSCHLIESSLICH im folgenden JSON-Format:
{
  "cleanPayee": "Echter Händlername",
  "suggestedCategoryId": "Kategorie-ID aus der Liste oder null",
  "suggestedCategoryName": "Exakter Name der Kategorie oder null",
  "confidenceScore": 0.95,
  "reasoning": "Kurze Begründung auf Deutsch"
}`;

  if (!apiKey) {
    return {
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidenceScore: 0,
      reasoning: 'Kein Google Gemini API-Schlüssel hinterlegt. Bitte unter Einstellungen hinterlegen.',
    };
  }

  try {
    const parsed = await callGeminiApi(apiKey, promptText);
    const validCat = allowedCategories.find((c) => c.id === parsed.suggestedCategoryId);

    return {
      cleanPayee: parsed.cleanPayee || null,
      suggestedCategoryId: validCat ? validCat.id : null,
      suggestedCategoryName: validCat ? validCat.name : null,
      confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.85,
      reasoning: parsed.reasoning || 'Gemini KI Zuordnungsvorschlag',
    };
  } catch (err: any) {
    console.error('Gemini API Error in suggestCategoryWithGemini:', err);
    return {
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      confidenceScore: 0,
      reasoning: `Gemini API Fehler: ${err.message}`,
    };
  }
}

/**
 * Stapel-Prüfung & Bereinigung eines Monats per Gemini KI.
 * - Ordnet unkategorisierte Buchungen zu.
 * - Prüft bereits kategorisierte Buchungen auf Plausibilität & Fehlzuordnungen.
 * - Bereinigt kryptische Empfängernamen / PayPal-Codes.
 */
export async function auditMonthTransactionsWithGemini(
  txs: Array<{
    id: string;
    date: string;
    payee: string | null;
    description: string;
    amount: number;
    currentCategoryId: string | null;
    currentCategoryName: string | null;
  }>,
  categories: CategoryInfo[]
): Promise<MonthAuditItem[]> {
  const apiKey = await getActiveGeminiApiKey();
  if (!apiKey) {
    throw new Error('Kein Google Gemini API-Schlüssel in den Einstellungen hinterlegt.');
  }

  const allowedCategories = categories.filter((c) => !isIgnoredFallbackCategory(c.name));
  const categoryMap = new Map(allowedCategories.map((c) => [c.id, c.name]));

  const categoriesPrompt = allowedCategories
    .map((c) => `- ID: "${c.id}", Name: "${c.name}"${c.description ? ` (${c.description})` : ''}`)
    .join('\n');

  // In Paketen von max. 40 Buchungen aufrufen, um Tokens und Qualität optimal zu halten
  const CHUNK_SIZE = 40;
  const allSuggestions: MonthAuditItem[] = [];

  for (let i = 0; i < txs.length; i += CHUNK_SIZE) {
    const chunk = txs.slice(i, i + CHUNK_SIZE);

    const txPromptList = chunk
      .map(
        (t) =>
          `[ID: "${t.id}"] | Datum: ${t.date} | Betrag: ${t.amount} EUR | Empfänger: "${t.payee || 'Unbekannt'}" | Aktuelle Kategorie: "${t.currentCategoryName || 'Unkategorisiert'}" | Zweck: "${t.description.slice(0, 250)}"`
      )
      .join('\n');

    const promptText = `Du bist der Chefbuchhalter und KI-Finanzexperte für das City Hotel Schottenhof.
Prüfe und bereinige die folgenden ${chunk.length} Bankumsätze eines Monats.

Verfügbare Hotel-Kategorien (WICHTIG: "Sonstiges" existiert NICHT und darf niemals vergeben werden):
${categoriesPrompt}

Zu prüfende Bankbuchungen:
${txPromptList}

AUFGABE FÜR JEDE BUCHUNG:
1. **Unkategorisierte Buchungen (Aktuelle Kategorie = "Unkategorisiert"):**
   - Finde die exakt passende Kategorie-ID aus der Liste.
   - Bereinige den Empfängernamen (z.B. PayPal-Verkäufer, Händlername ohne SEPA-Codes).
   - Setze type="NEW_ASSIGNMENT".
2. **Plausibilitäts-Prüfung (Buchung hat bereits eine Kategorie):**
   - Prüfe, ob die Kategorie plausibel ist.
   - Falls die Kategorie offensichtlich falsch ist (z. B. Telefon/Internet unter Lebensmittel, OTA-Provision unter Bürobedarf, etc.):
     Setze type="CORRECTION", schlage die korrekte Kategorie-ID vor und begründe den Fehler kurz.
   - Falls die Kategorie bereits vollkommen korrekt ist, aber der Händlername kryptisch ist:
     Setze type="CLEANUP" mit dem sauberen Händlernamen.
   - Falls alles bereits perfekt ist: Buchung einfach aus der Antwort weglassen.

Antworte AUSSCHLIESSLICH im folgenden JSON-Format:
{
  "audit": [
    {
      "id": "Buchungs-ID",
      "cleanPayee": "Sauberer Händlername oder null",
      "suggestedCategoryId": "Kategorie-ID aus obiger Liste oder null",
      "type": "NEW_ASSIGNMENT", // oder "CORRECTION" oder "CLEANUP"
      "confidence": 0.95,
      "reason": "Prägnante deutsche Begründung (max. 1 Satz)"
    }
  ]
}`;

    try {
      const parsed = await callGeminiApi(apiKey, promptText);
      const items: any[] = Array.isArray(parsed?.audit) ? parsed.audit : Array.isArray(parsed) ? parsed : [];

      for (const item of items) {
        const originalTx = chunk.find((c) => c.id === item.id);
        if (!originalTx) continue;

        const catName = item.suggestedCategoryId ? categoryMap.get(item.suggestedCategoryId) || null : null;

        allSuggestions.push({
          id: originalTx.id,
          cleanPayee: item.cleanPayee?.trim() || originalTx.payee,
          originalPayee: originalTx.payee,
          suggestedCategoryId: catName ? item.suggestedCategoryId : null,
          suggestedCategoryName: catName,
          currentCategoryId: originalTx.currentCategoryId,
          currentCategoryName: originalTx.currentCategoryName,
          confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0.1, item.confidence)) : 0.9,
          type: item.type === 'CORRECTION' ? 'CORRECTION' : item.type === 'CLEANUP' ? 'CLEANUP' : 'NEW_ASSIGNMENT',
          reason: item.reason || 'Automatische Zuordnung per Gemini KI',
        });
      }
    } catch (e: any) {
      console.error(`Error in auditMonthTransactionsWithGemini batch ${i}:`, e.message);
    }
  }

  return allSuggestions;
}
