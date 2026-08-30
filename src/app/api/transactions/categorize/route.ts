import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { learnRuleFromAssignment } from '../../../../lib/categorizer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionId, categoryId, createRule = false, deleteRuleId } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId ist erforderlich' }, { status: 400 });
    }

    const tx = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!tx) {
      return NextResponse.json({ error: 'Transaktion nicht gefunden' }, { status: 404 });
    }

    // Optional: Delete an active rule if requested directly from transaction banner
    let ruleDeleted = false;
    if (deleteRuleId) {
      await prisma.rule.deleteMany({
        where: { id: deleteRuleId },
      });
      ruleDeleted = true;
    }

    const isReset = !categoryId || categoryId === 'uncategorized' || categoryId === 'none';

    const updatedTx = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        categoryId: isReset ? null : categoryId,
        status: isReset ? 'UNCATEGORIZED' : 'CATEGORIZED',
        matchedRuleId: isReset || deleteRuleId ? null : undefined,
      },
      include: {
        category: true,
        matchedRule: true,
      },
    });

    let learnResult = { ruleCreated: false, pattern: '', retroactivelyAppliedCount: 0 };

    if (!isReset && createRule) {
      learnResult = await learnRuleFromAssignment(categoryId, tx.payee, tx.iban, tx.description);
    }

    return NextResponse.json({
      success: true,
      transaction: updatedTx,
      isReset,
      ruleDeleted,
      learnResult,
    });
  } catch (error: any) {
    console.error('Error categorizing transaction:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
