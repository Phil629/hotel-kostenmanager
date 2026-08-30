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
    for (const t of allTransactions) {
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

    // Apply month filter to statistics & pie chart
    let filteredTransactions = allTransactions;
    if (month && month !== 'all') {
      filteredTransactions = allTransactions.filter((t) => {
        const dateObj = new Date(t.date);
        const ym = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
        return ym === month;
      });
    }

    const totalExpense = filteredTransactions.reduce((acc, t) => acc + Math.abs(t.amount), 0);

    const categoryMap: Record<
      string,
      {
        id: string;
        name: string;
        amount: number;
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
          amount: 0,
          color: catColor,
          count: 0,
          transactions: [],
        };
      }

      categoryMap[catName].amount += Math.abs(t.amount);
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
        amount: Math.round(item.amount * 100) / 100,
        percentage: totalExpense > 0 ? Math.round((item.amount / totalExpense) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Build Bar Chart data across ALL months always
    const monthlyTotalsMap: Record<string, number> = {};
    for (const t of allTransactions) {
      const dateObj = new Date(t.date);
      const ym = `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyTotalsMap[ym] = (monthlyTotalsMap[ym] || 0) + Math.abs(t.amount);
    }

    const barChartData = Array.from(monthsSet)
      .sort()
      .map((mStr) => {
        const [y, m] = mStr.split('-');
        return {
          monthKey: mStr,
          month: `${monthNamesGerman[m] || m} ${y}`,
          total: Math.round((monthlyTotalsMap[mStr] || 0) * 100) / 100,
        };
      });

    const fnbTotal = pieChartData
      .filter((p) => p.name.includes('F&B'))
      .reduce((acc, p) => acc + p.amount, 0);

    const energyTotal = pieChartData
      .filter((p) => p.name.includes('Energie'))
      .reduce((acc, p) => acc + p.amount, 0);

    const otaTotal = pieChartData
      .filter((p) => p.name.includes('OTA'))
      .reduce((acc, p) => acc + p.amount, 0);

    const uncategorizedAmount = pieChartData
      .filter((p) => p.name === 'Unkategorisiert')
      .reduce((acc, p) => acc + p.amount, 0);

    return NextResponse.json(
      {
        summary: {
          totalExpense: Math.round(totalExpense * 100) / 100,
          transactionCount: filteredTransactions.length,
          fnbTotal: Math.round(fnbTotal * 100) / 100,
          energyTotal: Math.round(energyTotal * 100) / 100,
          otaTotal: Math.round(otaTotal * 100) / 100,
          uncategorizedAmount: Math.round(uncategorizedAmount * 100) / 100,
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
