import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function findDuplicates(allTxs: Array<{
  id: string;
  date: Date;
  amount: number;
  payee: string | null;
  description: string;
  categoryId: string | null;
  matchedRuleId: string | null;
  invoice: any | null;
}>) {
  const groups = new Map<string, typeof allTxs>();
  for (const tx of allTxs) {
    const dStr = tx.date.toISOString().split('T')[0];
    const key = `${dStr}_${tx.amount.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const duplicatePairs: Array<{
    keep: typeof allTxs[0];
    remove: typeof allTxs[0];
    reason: string;
  }> = [];

  for (const [, group] of groups.entries()) {
    if (group.length <= 1) continue;

    const visitedIndices = new Set<number>();

    for (let i = 0; i < group.length; i++) {
      if (visitedIndices.has(i)) continue;

      for (let j = i + 1; j < group.length; j++) {
        if (visitedIndices.has(j)) continue;

        const a = group[i];
        const b = group[j];

        const pA = (a.payee || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const pB = (b.payee || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

        const dA = (a.description || '').trim().toLowerCase();
        const dB = (b.description || '').trim().toLowerCase();

        const erefA = dA.match(/eref:\s*([a-z0-9\-_]+)/)?.[1];
        const erefB = dB.match(/eref:\s*([a-z0-9\-_]+)/)?.[1];

        let isDup = false;
        let reason = '';

        if (erefA && erefB && erefA === erefB) {
          isDup = true;
          reason = `Identische SEPA-Referenz (EREF ${erefA})`;
        } else if (pA && pB && pA === pB) {
          const cleanDA = dA.replace(/[^a-z0-9]/g, '');
          const cleanDB = dB.replace(/[^a-z0-9]/g, '');
          if (cleanDA === cleanDB || cleanDA.startsWith(cleanDB) || cleanDB.startsWith(cleanDA)) {
            isDup = true;
            reason = 'Identischer Empfänger & deckungsgleicher Buchungstext';
          }
        }

        if (isDup) {
          visitedIndices.add(j);

          let keep = a;
          let remove = b;

          if (!keep.invoice && remove.invoice) {
            keep = b;
            remove = a;
          } else if (!keep.categoryId && remove.categoryId) {
            keep = b;
            remove = a;
          } else if (remove.description.length > keep.description.length && !keep.invoice) {
            keep = b;
            remove = a;
          }

          duplicatePairs.push({ keep, remove, reason });
        }
      }
    }
  }

  return duplicatePairs;
}

// GET: Scan database and report duplicates
export async function GET() {
  try {
    const allTxs = await prisma.transaction.findMany({
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        category: true,
        matchedRule: true,
        invoice: true,
      },
    });

    const duplicates = findDuplicates(allTxs);

    let totalExpense = 0;
    let totalIncome = 0;
    for (const d of duplicates) {
      if (d.remove.amount < 0) totalExpense += Math.abs(d.remove.amount);
      else totalIncome += d.remove.amount;
    }

    return NextResponse.json({
      success: true,
      totalScanned: allTxs.length,
      duplicateCount: duplicates.length,
      isClean: duplicates.length === 0,
      duplicatedExpense: totalExpense,
      duplicatedIncome: totalIncome,
      duplicates: duplicates.map((d) => ({
        date: d.remove.date.toISOString().split('T')[0],
        amount: d.remove.amount,
        payee: d.remove.payee,
        reason: d.reason,
        keepId: d.keep.id,
        removeId: d.remove.id,
      })),
    });
  } catch (error: any) {
    console.error('Error scanning duplicates:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST: Execute cleanup of duplicates
export async function POST() {
  try {
    const allTxs = await prisma.transaction.findMany({
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        category: true,
        matchedRule: true,
        invoice: true,
      },
    });

    const duplicates = findDuplicates(allTxs);

    if (duplicates.length === 0) {
      return NextResponse.json({
        success: true,
        removedCount: 0,
        message: 'Keine Duplikate gefunden. Die Datenbank ist bereits vollständig sauber.',
        remainingTotal: allTxs.length,
      });
    }

    let totalExpense = 0;
    let totalIncome = 0;
    const idsToDelete: string[] = [];

    for (const d of duplicates) {
      idsToDelete.push(d.remove.id);
      if (d.remove.amount < 0) totalExpense += Math.abs(d.remove.amount);
      else totalIncome += d.remove.amount;

      // Transfer category if keep doesn't have one
      if (!d.keep.categoryId && d.remove.categoryId) {
        await prisma.transaction.update({
          where: { id: d.keep.id },
          data: {
            categoryId: d.remove.categoryId,
            status: 'CATEGORIZED',
            matchedRuleId: d.remove.matchedRuleId,
          },
        });
      }

      // Re-link invoice if remove had one
      if (d.remove.invoice && !d.keep.invoice) {
        await prisma.invoice.update({
          where: { id: d.remove.invoice.id },
          data: { matchedTransactionId: d.keep.id },
        });
      }
    }

    // Delete in chunks of 100
    const CHUNK_SIZE = 100;
    let deletedCount = 0;
    for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
      const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
      const res = await prisma.transaction.deleteMany({
        where: { id: { in: chunk } },
      });
      deletedCount += res.count;
    }

    const currentTotal = await prisma.transaction.count();

    return NextResponse.json({
      success: true,
      removedCount: deletedCount,
      removedExpense: totalExpense,
      removedIncome: totalIncome,
      remainingTotal: currentTotal,
      message: `${deletedCount} Duplikate erfolgreich bereinigt.`,
    });
  } catch (error: any) {
    console.error('Error cleaning duplicates:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
