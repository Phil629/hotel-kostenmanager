import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { parseCSVContent } from '../src/lib/parsers.js';
import { matchTransaction } from '../src/lib/categorizer.js';

const prisma = new PrismaClient();

const REAL_CSV_PATH = '/Users/philippe/.gemini/antigravity/brain/84ff43f7-4732-4ab8-84a4-ede432c650c9/.user_uploaded/media_1787906561179.csv';

async function importRealFile() {
  console.log(`Reading 100% of real statement CSV from: ${REAL_CSV_PATH}...`);
  const csvContent = fs.readFileSync(REAL_CSV_PATH, 'utf-8');

  const parsedTx = await parseCSVContent(csvContent);
  console.log(`Parsed ${parsedTx.length} total raw transactions from statement file.`);

  // Clear previous dataset
  await prisma.transaction.deleteMany();
  console.log('Cleared previous database table.');

  let insertedCount = 0;
  let autoCategorizedCount = 0;
  let uncategorizedCount = 0;
  let negativeExpensesCount = 0;
  let positiveIncomeCount = 0;

  for (const raw of parsedTx) {
    const match = await matchTransaction(raw.iban, raw.payee, raw.description);

    if (match.status === 'CATEGORIZED') {
      autoCategorizedCount++;
    } else {
      uncategorizedCount++;
    }

    if (raw.amount < 0) {
      negativeExpensesCount++;
    } else {
      positiveIncomeCount++;
    }

    await prisma.transaction.create({
      data: {
        date: raw.date,
        amount: raw.amount,
        payee: raw.payee,
        iban: raw.iban,
        description: raw.description,
        status: match.status,
        categoryId: match.categoryId,
        matchedRuleId: match.ruleId,
        rawHash: raw.rawHash,
      },
    });

    insertedCount++;
  }

  console.log(`
==================================================
✅ REAL BANK STATEMENT IMPORT COMPLETED:
==================================================
  • Total Rows Processed: ${parsedTx.length}
  • Total Inserted Transactions: ${insertedCount}
  • Negative Expense Rows (Abbuchungen): ${negativeExpensesCount}
  • Positive Income Rows (Gutschriften/Einzahlungen): ${positiveIncomeCount}
  • Auto-Categorized Rows: ${autoCategorizedCount} (${Math.round((autoCategorizedCount / insertedCount) * 100)}%)
  • Uncategorized Rows (Offen): ${uncategorizedCount}
==================================================
  `);
}

importRealFile()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
