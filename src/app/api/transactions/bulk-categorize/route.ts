import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { learnRuleFromAssignment } from '../../../../lib/categorizer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionIds, categoryId, createRule = false } = body;

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json({ error: 'Keine Umsätze ausgewählt' }, { status: 400 });
    }

    const isReset = !categoryId || categoryId === 'uncategorized' || categoryId === 'none';

    let targetCatName = 'Unkategorisiert';
    if (!isReset) {
      const cat = await prisma.category.findUnique({ where: { id: categoryId } });
      if (cat) targetCatName = cat.name;
    }

    const updated = await prisma.transaction.updateMany({
      where: {
        id: { in: transactionIds },
      },
      data: {
        categoryId: isReset ? null : categoryId,
        status: isReset ? 'UNCATEGORIZED' : 'CATEGORIZED',
        matchedRuleId: null, // Clear matched rule on manual override
      },
    });

    // Optional: Learn rule from the first transaction in batch if createRule is requested
    if (!isReset && createRule) {
      const firstTx = await prisma.transaction.findFirst({
        where: { id: transactionIds[0] },
      });
      if (firstTx) {
        await learnRuleFromAssignment(categoryId, firstTx.payee, firstTx.iban, firstTx.description);
      }
    }

    return NextResponse.json({
      success: true,
      count: updated.count,
      categoryName: targetCatName,
    });
  } catch (error: any) {
    console.error('Error in bulk categorize:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
