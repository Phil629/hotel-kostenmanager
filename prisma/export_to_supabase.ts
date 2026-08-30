import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';

/**
 * High-Speed Bulk Migration of 100% of SQLite data (dev.db) into Supabase PostgreSQL Cloud.
 */
async function migrateToSupabase() {
  console.log('🚀 Starte High-Speed Migration zu Supabase Cloud PostgreSQL...');

  const dbPath = './prisma/dev.db';
  const sqlite = new Database(dbPath);

  // Fetch all existing local data
  const categories: any[] = sqlite.prepare('SELECT * FROM "Category"').all();
  const rules: any[] = sqlite.prepare('SELECT * FROM "Rule"').all();
  const transactions: any[] = sqlite.prepare('SELECT * FROM "Transaction"').all();
  const budgets: any[] = sqlite.prepare('SELECT * FROM "Budget"').all();
  const settings: any[] = sqlite.prepare('SELECT * FROM "Settings"').all();

  console.log(`📊 Gefunden in lokaler SQLite (dev.db):`);
  console.log(`   - ${categories.length} Kategorien`);
  console.log(`   - ${rules.length} Regeln`);
  console.log(`   - ${transactions.length} Umsätze`);

  const postgres = new PrismaClient();

  // 1. Bulk Insert Categories
  console.log('\n📦 Übertrage Kategorien...');
  await postgres.category.createMany({
    data: categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      isHotelCore: Boolean(c.isHotelCore),
      description: c.description,
      createdAt: new Date(c.createdAt),
    })),
    skipDuplicates: true,
  });
  console.log('✅ Kategorien übertragen!');

  // 2. Bulk Insert Rules
  console.log('📦 Übertrage Regelsystem...');
  await postgres.rule.createMany({
    data: rules.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      matchType: r.matchType,
      pattern: r.pattern,
      isAuto: Boolean(r.isAuto),
      isApproved: Boolean(r.isApproved),
      createdAt: new Date(r.createdAt),
    })),
    skipDuplicates: true,
  });
  console.log('✅ Regelsystem übertragen!');

  // 3. Bulk Insert Transactions in Chunks of 500
  console.log(`📦 Übertrage ${transactions.length} Umsätze...`);
  const formattedTxs = transactions.map((t) => ({
    id: t.id,
    date: new Date(t.date),
    amount: Number(t.amount),
    payee: t.payee,
    iban: t.iban,
    description: t.description,
    status: t.status,
    categoryId: t.categoryId,
    matchedRuleId: t.matchedRuleId,
    rawHash: t.rawHash,
    createdAt: new Date(t.createdAt),
  }));

  const chunkSize = 500;
  for (let i = 0; i < formattedTxs.length; i += chunkSize) {
    const chunk = formattedTxs.slice(i, i + chunkSize);
    await postgres.transaction.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    console.log(`   └─ ${Math.min(i + chunkSize, formattedTxs.length)} von ${formattedTxs.length} Umsätzen übertragen...`);
  }

  // 4. Bulk Insert Budgets
  if (budgets.length > 0) {
    await postgres.budget.createMany({
      data: budgets.map((b) => ({
        id: b.id,
        categoryId: b.categoryId,
        monthlyLimit: Number(b.monthlyLimit),
        monthYear: b.monthYear,
        createdAt: new Date(b.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  // 5. Insert Settings
  for (const s of settings) {
    await postgres.settings.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        telegramToken: s.telegramToken,
        telegramChatId: s.telegramChatId,
        emailAddress: s.emailAddress,
        hotelName: s.hotelName,
        autoSendReports: Boolean(s.autoSendReports),
        updatedAt: new Date(s.updatedAt),
      },
      update: {
        telegramToken: s.telegramToken,
        telegramChatId: s.telegramChatId,
        emailAddress: s.emailAddress,
        hotelName: s.hotelName,
        autoSendReports: Boolean(s.autoSendReports),
      },
    });
  }

  console.log('\n🎉 VOLLSTÄNDIGE BLITZ-MIGRATION ERFOLGREICH!');
  console.log(`Alle ${transactions.length} Umsätze, Kategorien & Regeln sind jetzt LIVE in Supabase PostgreSQL Cloud!`);
}

migrateToSupabase().catch(console.error);
