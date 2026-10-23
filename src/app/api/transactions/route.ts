import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { matchTransaction } from '../../../lib/categorizer';
import { parseCSVContent, parseCAMT053Content } from '../../../lib/parsers';
import { matchAllPendingInvoices } from '../../../lib/invoiceMatcher';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const monthNamesGerman: Record<string, string> = {
  '01': 'Januar',
  '02': 'Februar',
  '03': 'März',
  '04': 'April',
  '05': 'Mai',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'August',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Dezember',
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get('categoryId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const month = searchParams.get('month'); // YYYY-MM

    // Build filter clause first so both DB queries run in parallel
    const whereClause: any = {
      amount: { lt: 0 },
    };

    if (categoryId && categoryId !== 'all') {
      if (categoryId === 'uncategorized') {
        whereClause.status = 'UNCATEGORIZED';
      } else {
        whereClause.categoryId = categoryId;
      }
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (search && search.trim()) {
      const q = search.trim();
      whereClause.AND = [
        {
          OR: [
            { payee: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { iban: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (month && month !== 'all') {
      if (month.length === 4) {
        const year = parseInt(month, 10);
        const startDate = new Date(Date.UTC(year, 0, 1));
        const endDate = new Date(Date.UTC(year + 1, 0, 1));
        whereClause.date = { gte: startDate, lt: endDate };
      } else {
        const [yearStr, monthStr] = month.split('-');
        const year = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10) - 1;
        const startDate = new Date(Date.UTC(year, m, 1));
        const endDate = new Date(Date.UTC(year, m + 1, 1));
        whereClause.date = { gte: startDate, lt: endDate };
      }
    }

    const [allExpenses, transactions] = await Promise.all([
      prisma.transaction.findMany({
        where: { amount: { lt: 0 } },
        select: { date: true },
        orderBy: { date: 'desc' },
      }),
      prisma.transaction.findMany({
        where: whereClause,
        include: {
          category: true,
          matchedRule: {
            include: { category: true },
          },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const monthsSet = new Set<string>();
    const yearsSet = new Set<string>();
    for (const t of allExpenses) {
      const dateObj = new Date(t.date);
      const y = String(dateObj.getUTCFullYear());
      const ym = `${y}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
      monthsSet.add(ym);
      yearsSet.add(y);
    }

    const availableMonths: any[] = [];
    const sortedYears = Array.from(yearsSet).sort().reverse();
    for (const y of sortedYears) {
      availableMonths.push({ value: y, label: `📅 Gesamtes Jahr ${y}` });
      const monthsInYear = Array.from(monthsSet).filter((ym) => ym.startsWith(y)).sort().reverse();
      for (const ym of monthsInYear) {
        const m = ym.split('-')[1];
        availableMonths.push({ value: ym, label: `   ↳ ${monthNamesGerman[m] || m} ${y}` });
      }
    }

    const totalCount = transactions.length;
    const uncategorizedCount = transactions.filter((t) => t.status === 'UNCATEGORIZED').length;
    const totalExpenses = transactions.reduce((acc, t) => acc + Math.round(Math.abs(t.amount) * 100), 0) / 100;

    return NextResponse.json(
      {
        transactions,
        availableMonths,
        stats: {
          totalCount,
          uncategorizedCount,
          totalExpenses,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const fileType = (formData.get('type') as string) || 'csv';

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }

    const fileText = await file.text();
    let rawTransactions = [];

    const isXml = fileType === 'xml' || (typeof file.name === 'string' && file.name.endsWith('.xml'));
    if (isXml) {
      rawTransactions = parseCAMT053Content(fileText);
    } else {
      rawTransactions = await parseCSVContent(fileText);
    }

    if (!rawTransactions || rawTransactions.length === 0) {
      return NextResponse.json({ error: 'Keine gültigen Umsätze in der Datei gefunden' }, { status: 400 });
    }

    let importedCount = 0;
    let skippedCount = 0;
    let autoCategorizedCount = 0;

    const preloadedRules = await prisma.rule.findMany({
      where: { isApproved: true },
      include: { category: true },
    });

    // 1. Bulk fetch existing hashes to prevent N+1 query
    const rawHashes = rawTransactions.map((t) => t.rawHash);
    const existingTxs = await prisma.transaction.findMany({
      where: { rawHash: { in: rawHashes } },
      select: { rawHash: true },
    });
    const existingHashMap = new Set(existingTxs.map((t) => t.rawHash));

    // 2. Prepare new transactions in memory
    const newTransactionsData = [];
    
    for (const raw of rawTransactions) {
      if (existingHashMap.has(raw.rawHash)) {
        skippedCount++;
        continue;
      }
      // Add to set to also avoid duplicates within the SAME file batch
      existingHashMap.add(raw.rawHash);

      const match = await matchTransaction(raw.iban, raw.payee, raw.description, preloadedRules);

      if (match.status === 'CATEGORIZED') {
        autoCategorizedCount++;
      }

      newTransactionsData.push({
        date: raw.date,
        amount: raw.amount,
        payee: raw.payee,
        iban: raw.iban,
        description: raw.description,
        status: match.status,
        categoryId: match.categoryId,
        matchedRuleId: match.ruleId,
        rawHash: raw.rawHash,
      });
    }

    // 3. Bulk insert new transactions in chunks of 500
    const CHUNK_SIZE = 500;
    for (let i = 0; i < newTransactionsData.length; i += CHUNK_SIZE) {
      const chunk = newTransactionsData.slice(i, i + CHUNK_SIZE);
      await prisma.transaction.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }
    importedCount = newTransactionsData.length;

    // 4. Bereits vorliegende Rechnungen aus dem Gmail-Ordner mit den neuen Bankumsätzen abgleichen
    const invoiceMatch = await matchAllPendingInvoices();
    autoCategorizedCount += invoiceMatch.autoCategorizedCount;

    return NextResponse.json({
      success: true,
      importedCount,
      skippedCount,
      autoCategorizedCount,
      invoiceMatchedCount: invoiceMatch.matchedCount,
    });
  } catch (error: any) {
    console.error('Error importing transactions:', error);
    return NextResponse.json({ error: error.message || 'Interner Serverfehler beim Import' }, { status: 500 });
  }
}
