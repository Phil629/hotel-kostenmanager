import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // YYYY-MM or 'all'

    // Fetch ALL transactions for the bar chart and available months list
    const allTransactions = await prisma.transaction.findMany({
      where: { amount: { lt: 0 } },
      include: { category: true },
      orderBy: { date: 'desc' },
    });

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

    const monthsSet = new Set<string>();
    const yearsSet = new Set<string>();
    for (const t of allTransactions) {
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
      const monthsInYear = Array.from(monthsSet).filter(ym => ym.startsWith(y)).sort().reverse();
      for (const ym of monthsInYear) {
        const m = ym.split('-')[1];
        availableMonths.push({ value: ym, label: `   ↳ ${monthNamesGerman[m] || m} ${y}` });
      }
    }

    // Apply month/year filter to statistics & pie chart
    let filteredTransactions = allTransactions;
    if (month && month !== 'all') {
      filteredTransactions = allTransactions.filter((t) => {
        const dateObj = new Date(t.date);
        const y = String(dateObj.getUTCFullYear());
        const ym = `${y}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
        return month.length === 4 ? y === month : ym === month;
      });
    }

    const totalExpenseCents = filteredTransactions.reduce((acc, t) => acc + Math.round(Math.abs(t.amount) * 100), 0);
    const totalExpense = totalExpenseCents / 100;

    const categoryMap: Record<
      string,
      {
        id: string;
        name: string;
        amountCents: number;
        color: string;
        count: number;
        transactions: Array<{
          id: string;
          date: string;
          payee: string | null;
          iban: string | null;
          description: string;
          amount: number;
          categoryId: string | null;
        }>;
      }
    > = {};

    for (const t of filteredTransactions) {
      const catName = t.category?.name || 'Unkategorisiert';
      const catId = t.category?.id || 'uncategorized';
      const catColor = t.category?.color || '#94a3b8';

      if (!categoryMap[catName]) {
        categoryMap[catName] = {
          id: catId,
          name: catName,
          amountCents: 0,
          color: catColor,
          count: 0,
          transactions: [],
        };
      }

      categoryMap[catName].amountCents += Math.round(Math.abs(t.amount) * 100);
      categoryMap[catName].count += 1;
      categoryMap[catName].transactions.push({
        id: t.id,
        date: typeof t.date === 'string' ? t.date : t.date.toISOString(),
        payee: t.payee,
        iban: t.iban,
        description: t.description,
        amount: t.amount,
        categoryId: t.categoryId,
      });
    }

    const pieChartData = Object.values(categoryMap)
      .map((item) => ({
        ...item,
        amount: item.amountCents / 100,
        percentage: totalExpenseCents > 0 ? Math.round((item.amountCents / totalExpenseCents) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Build Bar Chart data across ALL months always
    const monthlyTotalsCentsMap: Record<string, number> = {};
    for (const t of allTransactions) {
      const dateObj = new Date(t.date);
      const ym = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyTotalsCentsMap[ym] = (monthlyTotalsCentsMap[ym] || 0) + Math.round(Math.abs(t.amount) * 100);
    }

    const barChartData = Array.from(monthsSet)
      .sort()
      .map((mStr) => {
        const [y, m] = mStr.split('-');
        return {
          monthKey: mStr,
          month: `${monthNamesGerman[m] || m} ${y}`,
          total: (monthlyTotalsCentsMap[mStr] || 0) / 100,
        };
      });

    const fnbTotal = pieChartData
      .filter((p) => p.name.includes('F&B'))
      .reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;

    const energyTotal = pieChartData
      .filter((p) => p.name.includes('Energie'))
      .reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;

    const otaTotal = pieChartData
      .filter((p) => p.name.includes('OTA'))
      .reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;

    const uncategorizedAmount = pieChartData
      .filter((p) => p.name === 'Unkategorisiert')
      .reduce((acc, p) => acc + Math.round(p.amount * 100), 0) / 100;

    return NextResponse.json(
      {
        summary: {
          totalExpense,
          transactionCount: filteredTransactions.length,
          fnbTotal,
          energyTotal,
          otaTotal,
          uncategorizedAmount,
        },
        availableMonths,
        pieChartData,
        barChartData,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (error: any) {
    console.error('Error in stats route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
