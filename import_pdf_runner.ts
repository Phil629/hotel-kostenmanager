import { prisma } from './src/lib/prisma';
import { matchTransaction } from './src/lib/categorizer';
import { generateRawHash, parseAmount, parseDate } from './src/lib/parsers';

// Data parsed from the 5 PDF statements provided by user (08/2024, 09/2024, 10/2024, 11/2024, 12/2024)
// Let's create an import routine.

interface StatementItem {
  date: string; // YYYY-MM-DD
  amount: number;
  payee: string;
  iban?: string;
  description: string;
}

// We will load and insert these items
export async function importItems(items: StatementItem[]) {
  const preloadedRules = await prisma.rule.findMany({
    where: { isApproved: true },
    include: { category: true }
  });

  const rawHashes: string[] = [];
  const processedItems = items.map(item => {
    const d = new Date(item.date + 'T00:00:00.000Z');
    const hash = generateRawHash(d, item.amount, item.payee, item.description);
    rawHashes.push(hash);
    return { ...item, dateObj: d, rawHash: hash };
  });

  const existingTxs = await prisma.transaction.findMany({
    where: { rawHash: { in: rawHashes } },
    select: { rawHash: true }
  });
  const existingSet = new Set(existingTxs.map(t => t.rawHash));

  const toInsert = [];
  let skipped = 0;
  let autoCategorized = 0;

  for (const item of processedItems) {
    if (existingSet.has(item.rawHash)) {
      skipped++;
      continue;
    }
    existingSet.add(item.rawHash);

    const match = await matchTransaction(item.iban || null, item.payee, item.description, preloadedRules);
    if (match.status === 'CATEGORIZED') {
      autoCategorized++;
    }

    toInsert.push({
      date: item.dateObj,
      amount: item.amount,
      payee: item.payee || null,
      iban: item.iban || null,
      description: item.description,
      status: match.status,
      categoryId: match.categoryId,
      matchedRuleId: match.ruleId,
      rawHash: item.rawHash,
    });
  }

  const CHUNK_SIZE = 250;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    await prisma.transaction.createMany({
      data: chunk,
      skipDuplicates: true
    });
  }

  console.log(`Importiert: ${toInsert.length}, Übersprungen: ${skipped}, Auto-Kategorisiert: ${autoCategorized}`);
  return { imported: toInsert.length, skipped, autoCategorized };
}
