import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rules = await prisma.rule.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });

    const transactions = await prisma.transaction.findMany({
      where: { amount: { lt: 0 } },
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    const rulesWithMatches = rules.map((rule) => {
      const patternLower = rule.pattern.toLowerCase().trim();
      const cleanRuleIban = rule.pattern.replace(/\s+/g, '').toUpperCase();

      const matchingTransactions = transactions.filter((t) => {
        if (rule.matchType === 'IBAN' && t.iban) {
          return t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
        }
        if (rule.matchType === 'PAYEE' && t.payee) {
          const payeeLower = t.payee.toLowerCase().trim();
          return payeeLower.includes(patternLower) || patternLower.includes(payeeLower);
        }
        if (rule.matchType === 'KEYWORD') {
          const payeeLower = (t.payee || '').toLowerCase();
          const descLower = (t.description || '').toLowerCase();
          return descLower.includes(patternLower) || payeeLower.includes(patternLower);
        }
        return false;
      });

      return {
        ...rule,
        matchingCount: matchingTransactions.length,
        matchingTransactions: matchingTransactions.slice(0, 100),
      };
    });

    return NextResponse.json({ rules: rulesWithMatches });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { categoryId, matchType, pattern, applyToExisting = true, isApproved = true } = await req.json();

    if (!categoryId || !matchType || !pattern) {
      return NextResponse.json({ error: 'categoryId, matchType und pattern erforderlich' }, { status: 400 });
    }

    const rule = await prisma.rule.create({
      data: {
        category: { connect: { id: categoryId } },
        matchType,
        pattern: pattern.trim(),
        isAuto: false,
        isApproved,
      },
      include: { category: true },
    });

    let appliedCount = 0;
    if (applyToExisting && isApproved) {
      const patternLower = pattern.toLowerCase().trim();
      const cleanRuleIban = pattern.replace(/\s+/g, '').toUpperCase();

      const allTxs = await prisma.transaction.findMany({
        where: { amount: { lt: 0 } },
      });

      for (const t of allTxs) {
        let isMatch = false;
        if (matchType === 'IBAN' && t.iban) {
          isMatch = t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
        } else if (matchType === 'PAYEE' && t.payee) {
          const payeeLower = t.payee.toLowerCase().trim();
          isMatch = payeeLower.includes(patternLower) || patternLower.includes(payeeLower);
        } else if (matchType === 'KEYWORD') {
          const payeeLower = (t.payee || '').toLowerCase();
          const descLower = (t.description || '').toLowerCase();
          isMatch = descLower.includes(patternLower) || payeeLower.includes(patternLower);
        }

        if (isMatch) {
          await prisma.transaction.update({
            where: { id: t.id },
            data: {
              categoryId,
              status: 'CATEGORIZED',
              matchedRuleId: rule.id,
            },
          });
          appliedCount++;
        }
      }
    }

    return NextResponse.json({ success: true, rule, appliedCount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, categoryId, matchType, pattern, isApproved, updateTransactionIds } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Regel-ID erforderlich' }, { status: 400 });
    }

    const updateData: any = {};
    if (categoryId) updateData.category = { connect: { id: categoryId } };
    if (matchType) updateData.matchType = matchType;
    if (pattern) updateData.pattern = pattern.trim();
    if (isApproved !== undefined) updateData.isApproved = isApproved;

    const rule = await prisma.rule.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });

    let updatedTxCount = 0;

    if (Array.isArray(updateTransactionIds) && updateTransactionIds.length > 0) {
      const targetCatId = categoryId || rule.categoryId;
      const result = await prisma.transaction.updateMany({
        where: {
          id: { in: updateTransactionIds },
        },
        data: {
          categoryId: targetCatId,
          status: 'CATEGORIZED',
          matchedRuleId: rule.id,
        },
      });
      updatedTxCount = result.count;
    }

    return NextResponse.json({
      success: true,
      rule,
      updatedTxCount,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const resetTransactions = searchParams.get('reset') === 'true';

    if (!id) {
      return NextResponse.json({ error: 'ID erforderlich' }, { status: 400 });
    }

    if (resetTransactions) {
      // Reset all linked transactions to UNCATEGORIZED
      await prisma.transaction.updateMany({
        where: { matchedRuleId: id },
        data: {
          categoryId: null,
          status: 'UNCATEGORIZED',
          matchedRuleId: null,
        },
      });
    }

    await prisma.rule.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, resetTransactions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
