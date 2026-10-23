import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [rules, transactions] = await Promise.all([
      prisma.rule.findMany({
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.findMany({
        where: { amount: { lt: 0 } },
        select: {
          id: true,
          date: true,
          amount: true,
          payee: true,
          iban: true,
          description: true,
          status: true,
          category: { select: { id: true, name: true, color: true } },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const rulesWithMatches = rules.map((rule) => {
      const patternLower = (rule.pattern || '').toLowerCase().trim();
      const cleanRuleIban = (rule.pattern || '').replace(/\s+/g, '').toUpperCase();

      const matchingTransactions = transactions.filter((t) => {
        if (!patternLower) return false;
        if (rule.matchType === 'IBAN') {
          if (!t.iban || !cleanRuleIban) return false;
          return t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
        }
        if (rule.matchType === 'PAYEE') {
          if (!t.payee) return false;
          const payeeLower = t.payee.toLowerCase().trim();
          return payeeLower.includes(patternLower);
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

    if (!categoryId || !matchType || !pattern || !pattern.trim()) {
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

      // Nur auf noch offene (unkategorisierte) Umsätze anwenden, damit manuelle Zuordnungen niemals überschrieben werden!
      const openTxs = await prisma.transaction.findMany({
        where: {
          amount: { lt: 0 },
          OR: [{ status: 'UNCATEGORIZED' }, { categoryId: null }],
        },
      });

      const matchedIds: string[] = [];
      for (const t of openTxs) {
        let isMatch = false;
        if (matchType === 'IBAN') {
          if (t.iban && cleanRuleIban) {
            isMatch = t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
          }
        } else if (matchType === 'PAYEE') {
          if (t.payee && patternLower) {
            const payeeLower = t.payee.toLowerCase().trim();
            isMatch = payeeLower.includes(patternLower);
          }
        } else if (matchType === 'KEYWORD' && patternLower) {
          const payeeLower = (t.payee || '').toLowerCase();
          const descLower = (t.description || '').toLowerCase();
          isMatch = descLower.includes(patternLower) || payeeLower.includes(patternLower);
        }

        if (isMatch) {
          matchedIds.push(t.id);
        }
      }

      if (matchedIds.length > 0) {
        const res = await prisma.transaction.updateMany({
          where: { id: { in: matchedIds } },
          data: {
            categoryId,
            status: 'CATEGORIZED',
            matchedRuleId: rule.id,
          },
        });
        appliedCount = res.count;
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

    const existingRule = await prisma.rule.findUnique({ where: { id } });
    if (!existingRule) {
      return NextResponse.json({ error: 'Regel nicht gefunden' }, { status: 404 });
    }

    const patternChanged =
      (pattern !== undefined && pattern.trim() !== existingRule.pattern) ||
      (matchType !== undefined && matchType !== existingRule.matchType);

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
    const targetCatId = categoryId || rule.categoryId;

    if (patternChanged) {
      // Wenn das Suchmuster oder der Typ geändert wurde, wende die neue Regel nur auf passende offene Umsätze an
      const patternLower = (rule.pattern || '').toLowerCase().trim();
      const cleanRuleIban = (rule.pattern || '').replace(/\s+/g, '').toUpperCase();
      if (patternLower) {
        const candidates = await prisma.transaction.findMany({
          where: {
            amount: { lt: 0 },
            OR: [{ status: 'UNCATEGORIZED' }, { categoryId: null }, { matchedRuleId: rule.id }],
          },
        });
        const matchedIds = candidates
          .filter((t) => {
            if (rule.matchType === 'IBAN') {
              return !!t.iban && !!cleanRuleIban && t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
            }
            if (rule.matchType === 'PAYEE') {
              return !!t.payee && t.payee.toLowerCase().trim().includes(patternLower);
            }
            const payeeLower = (t.payee || '').toLowerCase();
            const descLower = (t.description || '').toLowerCase();
            return descLower.includes(patternLower) || payeeLower.includes(patternLower);
          })
          .map((t) => t.id);

        if (matchedIds.length > 0) {
          const res = await prisma.transaction.updateMany({
            where: { id: { in: matchedIds } },
            data: {
              categoryId: targetCatId,
              status: 'CATEGORIZED',
              matchedRuleId: rule.id,
            },
          });
          updatedTxCount = res.count;
        }
      }
    } else if (Array.isArray(updateTransactionIds) && updateTransactionIds.length > 0) {
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
