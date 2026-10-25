import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { learnRuleFromAssignment } from '../../../../lib/categorizer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      transactionId,
      categoryId,
      createRule = false,
      deleteRuleId,
      customPayee,
      customDescription,
      customRule,
    } = body;

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

    const updateData: any = {
      categoryId: isReset ? null : categoryId,
      status: isReset ? 'UNCATEGORIZED' : 'CATEGORIZED',
      matchedRuleId: null, // Clear matched rule on manual override to prevent accidental resets later
    };

    if (typeof customPayee === 'string' && customPayee.trim() !== '') {
      updateData.payee = customPayee.trim();
    }
    if (typeof customDescription === 'string' && customDescription.trim() !== '') {
      updateData.description = customDescription.trim();
    }

    let learnResult = { ruleCreated: false, pattern: '', retroactivelyAppliedCount: 0 };
    let createdOrUpdatedRuleId: string | null = null;

    if (!isReset && createRule) {
      if (customRule && typeof customRule.pattern === 'string' && customRule.pattern.trim().length >= 2) {
        const cleanPattern = customRule.pattern.trim();
        const rMatchType = customRule.matchType || 'KEYWORD';

        const existingRule = await prisma.rule.findFirst({
          where: { matchType: rMatchType, pattern: cleanPattern },
        });

        let savedRule;
        if (existingRule) {
          savedRule = await prisma.rule.update({
            where: { id: existingRule.id },
            data: { categoryId, isApproved: true },
          });
        } else {
          savedRule = await prisma.rule.create({
            data: {
              categoryId,
              matchType: rMatchType,
              pattern: cleanPattern,
              isAuto: false,
              isApproved: true,
            },
          });
        }

        createdOrUpdatedRuleId = savedRule.id;
        updateData.matchedRuleId = savedRule.id;

        if (Array.isArray(customRule.applyToTransactionIds) && customRule.applyToTransactionIds.length > 0) {
          const otherIds = customRule.applyToTransactionIds.filter((id: string) => id !== transactionId);
          if (otherIds.length > 0) {
            const bulkRes = await prisma.transaction.updateMany({
              where: { id: { in: otherIds } },
              data: {
                categoryId,
                status: 'CATEGORIZED',
                matchedRuleId: savedRule.id,
              },
            });
            learnResult = {
              ruleCreated: true,
              pattern: cleanPattern,
              retroactivelyAppliedCount: bulkRes.count,
            };
          } else {
            learnResult = {
              ruleCreated: true,
              pattern: cleanPattern,
              retroactivelyAppliedCount: 0,
            };
          }
        } else {
          learnResult = {
            ruleCreated: true,
            pattern: cleanPattern,
            retroactivelyAppliedCount: 0,
          };
        }
      } else {
        learnResult = await learnRuleFromAssignment(
          categoryId,
          updateData.payee || tx.payee,
          tx.iban,
          updateData.description || tx.description
        );
      }
    }

    const updatedTx = await prisma.transaction.update({
      where: { id: transactionId },
      data: updateData,
      include: {
        category: true,
        matchedRule: true,
      },
    });

    // Falls ein Rechnungsbeleg mit diesem Umsatz verknüpft ist, Kategorie dort synchron halten
    await prisma.invoice.updateMany({
      where: { matchedTransactionId: transactionId },
      data: { suggestedCategoryId: isReset ? null : categoryId },
    });

    return NextResponse.json({
      success: true,
      transaction: updatedTx,
      isReset,
      ruleDeleted,
      learnResult,
      createdOrUpdatedRuleId,
    });
  } catch (error: any) {
    console.error('Error categorizing transaction:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
