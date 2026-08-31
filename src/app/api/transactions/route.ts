import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { matchTransaction } from '../../../lib/categorizer';
import { parseCSVContent, parseCAMT053Content } from '../../../lib/parsers';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

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

    // Fetch ALL negative transactions to build dynamic availableMonths list
    const allExpenses = await prisma.transaction.findMany({
      where: { amount: { lt: 0 } },
      select: { date: true },
      orderBy: { date: 'desc' },
    });

    const monthsSet = new Set<string>();
    for (const t of allExpenses) {
      const dateObj = new Date(t.date);
      const ym = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
      monthsSet.add(ym);
    }

    const availableMonths = Array.from(monthsSet)
      .sort()
      .reverse()
      .map((ym) => {
        const [y, m] = ym.split('-');
        return {
          value: ym,
          label: `${monthNamesGerman[m] || m} ${y}`,
        };
      });

    // Build filter clause
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

    if (search) {
      whereClause.AND = [
        {
          OR: [
            { payee: { contains: search } },
            { description: { contains: search } },
            { iban: { contains: search } },
          ],
        },
      ];
    }

    if (month && month !== 'all') {
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1;
      const startDate = new Date(Date.UTC(year, m, 1));
      const endDate = new Date(Date.UTC(year, m + 1, 1));
      whereClause.date = { gte: startDate, lt: endDate };
    }

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        category: true,
        matchedRule: {
          include: { category: true },
        },
      },
      orderBy: { date: 'desc' },
    });

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

    if (fileType === 'xml' || file.name.endsWith('.xml')) {
      rawTransactions = parseCAMT053Content(fileText);
    } else {
      rawTransactions = await parseCSVContent(fileText);
    }

    if (rawTransactions.length === 0) {
      return NextResponse.json({ error: 'Keine gültigen Umsätze in der Datei gefunden' }, { status: 400 });
    }

    let importedCount = 0;
    let skippedCount = 0;
    let autoCategorizedCount = 0;

    const preloadedRules = await prisma.rule.findMany({
      where: { isApproved: true },
      include: { category: true },
    });

    for (const raw of rawTransactions) {
      const existing = await prisma.transaction.findUnique({
        where: { rawHash: raw.rawHash },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      const match = await matchTransaction(raw.iban, raw.payee, raw.description, preloadedRules);

      if (match.status === 'CATEGORIZED') {
        autoCategorizedCount++;
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

      importedCount++;
    }

    return NextResponse.json({
      success: true,
      importedCount,
      skippedCount,
      autoCategorizedCount,
    });
  } catch (error: any) {
    console.error('Error importing transactions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
