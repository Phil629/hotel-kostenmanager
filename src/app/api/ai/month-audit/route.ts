import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { auditMonthTransactionsWithGemini } from '../../../../lib/gemini';
import { getActiveGeminiApiKey } from '../../../../lib/invoiceMatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action = 'audit', month: rawMonth, updates } = body;

    const apiKey = await getActiveGeminiApiKey();
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Kein Google Gemini API-Schlüssel hinterlegt. Bitte tragen Sie diesen unter Einstellungen ein.',
        },
        { status: 400 }
      );
    }

    // ==========================================
    // AKTION 1: BEREITS BESTÄTIGTE KORREKTUREN SPEICHERN
    // ==========================================
    if (action === 'apply') {
      if (!Array.isArray(updates) || updates.length === 0) {
        return NextResponse.json({ error: 'Keine Aktualisierungen übermittelt.' }, { status: 400 });
      }

      let appliedCount = 0;
      let rulesCreated = 0;

      for (const item of updates) {
        if (!item.transactionId) continue;

        const updateData: any = {};
        if (item.categoryId !== undefined) {
          updateData.categoryId = item.categoryId || null;
          updateData.status = item.categoryId ? 'CATEGORIZED' : 'UNCATEGORIZED';
        }
        if (item.cleanPayee && typeof item.cleanPayee === 'string' && item.cleanPayee.trim()) {
          updateData.payee = item.cleanPayee.trim();
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.transaction.update({
            where: { id: item.transactionId },
            data: updateData,
          });
          appliedCount++;
        }

        // Regel erstellen, falls vom Nutzer angewählt
        if (item.createRule && item.categoryId && item.rulePattern) {
          try {
            const pattern = item.rulePattern.trim();
            const matchType = item.matchType || 'KEYWORD';

            const existingRule = await prisma.rule.findFirst({
              where: { pattern: { equals: pattern, mode: 'insensitive' } },
            });

            if (!existingRule) {
              await prisma.rule.create({
                data: {
                  pattern,
                  matchType,
                  categoryId: item.categoryId,
                  isAuto: true,
                  isApproved: true,
                },
              });
              rulesCreated++;
            }
          } catch (e) {
            console.warn('Could not auto-create rule for item:', e);
          }
        }
      }

      return NextResponse.json({
        success: true,
        appliedCount,
        rulesCreated,
      });
    }

    // ==========================================
    // AKTION 2: MONATS-AUDIT & PRÜFLAUF DURCHFÜHREN
    // ==========================================
    let targetMonth = rawMonth;

    // Falls 'latest' oder nicht angegeben, neuesten Monat mit Buchungen ermitteln
    if (!targetMonth || targetMonth === 'latest') {
      const newestTx = await prisma.transaction.findFirst({
        where: { amount: { lt: 0 } },
        select: { date: true },
        orderBy: { date: 'desc' },
      });
      if (newestTx) {
        const d = new Date(newestTx.date);
        targetMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      } else {
        targetMonth = 'all';
      }
    }

    // Datumsbereich bestimmen
    const periodWhere: any = { amount: { lt: 0 } };
    if (targetMonth && targetMonth !== 'all') {
      if (targetMonth.length === 4) {
        const year = parseInt(targetMonth, 10);
        periodWhere.date = {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        };
      } else {
        const [yearStr, monthStr] = targetMonth.split('-');
        const year = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10) - 1;
        periodWhere.date = {
          gte: new Date(Date.UTC(year, m, 1)),
          lt: new Date(Date.UTC(year, m + 1, 1)),
        };
      }
    }

    const [allMonthTxs, categories] = await Promise.all([
      prisma.transaction.findMany({
        where: periodWhere,
        include: {
          category: true,
        },
        orderBy: { date: 'desc' },
      }),
      prisma.category.findMany({
        orderBy: { name: 'asc' },
      }),
    ]);

    if (allMonthTxs.length === 0) {
      return NextResponse.json({
        success: true,
        targetMonth,
        totalCount: 0,
        uncategorizedCount: 0,
        suggestions: [],
        message: 'Keine Ausgaben in diesem Zeitraum gefunden.',
      });
    }

    const formattedTxs = allMonthTxs.map((t) => ({
      id: t.id,
      date: new Date(t.date).toISOString().slice(0, 10),
      payee: t.payee,
      description: t.description,
      amount: t.amount,
      currentCategoryId: t.categoryId,
      currentCategoryName: t.category?.name || null,
    }));

    // Audit per Gemini durchführen
    const rawAuditResults = await auditMonthTransactionsWithGemini(
      formattedTxs,
      categories.map((c) => ({ id: c.id, name: c.name, description: c.description }))
    );

    // Ergebnisse mit Transaktionsdaten anreichern
    const txMap = new Map(allMonthTxs.map((t) => [t.id, t]));
    const catMap = new Map(categories.map((c) => [c.id, c]));

    const enrichedSuggestions = rawAuditResults
      .map((item) => {
        const tx = txMap.get(item.id);
        if (!tx) return null;

        const suggestedCat = item.suggestedCategoryId ? catMap.get(item.suggestedCategoryId) : null;
        const currentCat = tx.category;

        // Wenn kein echter Unterschied besteht, überspringen
        const isSameCategory = tx.categoryId === item.suggestedCategoryId;
        const isSamePayee = (tx.payee || '').trim() === (item.cleanPayee || '').trim();

        if (isSameCategory && (isSamePayee || !item.cleanPayee)) {
          return null;
        }

        return {
          id: tx.id,
          date: tx.date,
          amount: tx.amount,
          originalPayee: tx.payee || 'Unbekannt',
          cleanPayee: item.cleanPayee || tx.payee || 'Unbekannt',
          description: tx.description,
          currentCategory: currentCat ? { id: currentCat.id, name: currentCat.name, color: currentCat.color } : null,
          suggestedCategory: suggestedCat
            ? { id: suggestedCat.id, name: suggestedCat.name, color: suggestedCat.color }
            : null,
          confidence: Math.round(item.confidence * 100),
          type: item.type, // 'NEW_ASSIGNMENT' | 'CORRECTION' | 'CLEANUP'
          reason: item.reason,
          selected: true, // initial ausgewählt
        };
      })
      .filter(Boolean);

    const uncategorizedCount = allMonthTxs.filter((t) => !t.categoryId || t.status === 'UNCATEGORIZED').length;
    const newAssignmentsCount = enrichedSuggestions.filter((s: any) => s.type === 'NEW_ASSIGNMENT').length;
    const correctionsCount = enrichedSuggestions.filter((s: any) => s.type === 'CORRECTION').length;
    const cleanupsCount = enrichedSuggestions.filter((s: any) => s.type === 'CLEANUP').length;

    return NextResponse.json({
      success: true,
      targetMonth,
      totalCount: allMonthTxs.length,
      uncategorizedCount,
      summary: {
        newAssignmentsCount,
        correctionsCount,
        cleanupsCount,
        totalProposed: enrichedSuggestions.length,
      },
      suggestions: enrichedSuggestions,
      categories,
    });
  } catch (error: any) {
    console.error('Error in month-audit route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
