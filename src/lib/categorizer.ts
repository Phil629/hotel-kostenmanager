import { prisma } from './prisma';

export interface MatchResult {
  categoryId: string | null;
  ruleId: string | null;
  status: 'CATEGORIZED' | 'UNCATEGORIZED';
}

export async function matchTransaction(
  iban: string | null,
  payee: string | null,
  description: string
): Promise<MatchResult> {
  // Only query APPROVED rules to automatically categorize transactions
  const rules = await prisma.rule.findMany({
    where: { isApproved: true },
    include: { category: true },
  });

  const cleanIban = (iban || '').replace(/\s+/g, '').toUpperCase();
  const cleanPayee = (payee || '').toLowerCase().trim();
  const cleanDesc = (description || '').toLowerCase().trim();

  // Priority 1: Match by IBAN
  if (cleanIban && cleanIban.length > 5) {
    for (const rule of rules) {
      if (rule.matchType === 'IBAN') {
        const ruleIban = rule.pattern.replace(/\s+/g, '').toUpperCase();
        if (cleanIban === ruleIban) {
          return { categoryId: rule.categoryId, ruleId: rule.id, status: 'CATEGORIZED' };
        }
      }
    }
  }

  // Priority 2: Match by PAYEE exact or substring
  if (cleanPayee) {
    for (const rule of rules) {
      if (rule.matchType === 'PAYEE') {
        const pattern = rule.pattern.toLowerCase().trim();
        if (pattern && cleanPayee.includes(pattern)) {
          return { categoryId: rule.categoryId, ruleId: rule.id, status: 'CATEGORIZED' };
        }
      }
    }
  }

  // Priority 3: Match by KEYWORD in Payee or Description
  for (const rule of rules) {
    if (rule.matchType === 'KEYWORD') {
      const pattern = rule.pattern.toLowerCase().trim();
      if (pattern && (cleanDesc.includes(pattern) || cleanPayee.includes(pattern))) {
        return { categoryId: rule.categoryId, ruleId: rule.id, status: 'CATEGORIZED' };
      }
    }
  }

  return { categoryId: null, ruleId: null, status: 'UNCATEGORIZED' };
}

/**
 * Clean vendor name to form a reliable rule pattern.
 */
function extractCleanPattern(payee: string | null, description: string): { matchType: string; pattern: string } {
  if (payee && payee.trim().length > 2) {
    let clean = payee.trim();
    if (clean.toLowerCase().includes('reiter')) return { matchType: 'PAYEE', pattern: 'Reiter' };
    if (clean.toLowerCase().includes('metro')) return { matchType: 'PAYEE', pattern: 'METRO' };
    if (clean.toLowerCase().includes('schwälbchen')) return { matchType: 'PAYEE', pattern: 'Schwälbchen' };
    if (clean.toLowerCase().includes('kruppert')) return { matchType: 'PAYEE', pattern: 'Kruppert' };
    if (clean.toLowerCase().includes('booking')) return { matchType: 'PAYEE', pattern: 'Booking.com' };

    const parts = clean.split(/\s+/);
    const shortPattern = parts.slice(0, 2).join(' ');
    return { matchType: 'PAYEE', pattern: shortPattern.length > 2 ? shortPattern : clean };
  }

  if (description && description.trim().length > 3) {
    const parts = description.trim().split(/\s+/);
    return { matchType: 'KEYWORD', pattern: parts[0] };
  }

  return { matchType: 'KEYWORD', pattern: '' };
}

/**
 * Learns rules from manual user categorization and retroactively categorizes ALL matching transactions.
 */
export async function learnRuleFromAssignment(
  categoryId: string,
  payee: string | null,
  iban: string | null,
  description: string,
  isApproved = true
): Promise<{ ruleCreated: boolean; pattern: string; retroactivelyAppliedCount: number }> {
  const cleanIban = (iban || '').replace(/\s+/g, '').toUpperCase();

  let createdRulesCount = 0;
  let primaryPattern = '';

  // 1. Create or update IBAN rule if IBAN exists
  if (cleanIban && cleanIban.length > 5) {
    primaryPattern = cleanIban;
    const existingIbanRule = await prisma.rule.findFirst({
      where: { matchType: 'IBAN', pattern: cleanIban },
    });
    if (!existingIbanRule) {
      await prisma.rule.create({
        data: { categoryId, matchType: 'IBAN', pattern: cleanIban, isAuto: true, isApproved },
      });
      createdRulesCount++;
    } else {
      await prisma.rule.update({
        where: { id: existingIbanRule.id },
        data: { categoryId, isApproved: isApproved || existingIbanRule.isApproved },
      });
    }
  }

  // 2. Create or update PAYEE or KEYWORD rule
  const { matchType, pattern } = extractCleanPattern(payee, description);
  if (pattern) {
    if (!primaryPattern) primaryPattern = pattern;
    const existingPayeeRule = await prisma.rule.findFirst({
      where: { matchType, pattern },
    });
    if (!existingPayeeRule) {
      await prisma.rule.create({
        data: { categoryId, matchType, pattern, isAuto: true, isApproved },
      });
      createdRulesCount++;
    } else {
      await prisma.rule.update({
        where: { id: existingPayeeRule.id },
        data: { categoryId, isApproved: isApproved || existingPayeeRule.isApproved },
      });
    }
  }

  // 3. Retroactively categorize ALL uncategorized transactions matching the new approved rule(s)!
  let retroactivelyAppliedCount = 0;
  if (isApproved) {
    const uncategorized = await prisma.transaction.findMany({
      where: { status: 'UNCATEGORIZED' },
    });

    for (const tx of uncategorized) {
      const match = await matchTransaction(tx.iban, tx.payee, tx.description);
      if (match.status === 'CATEGORIZED' && match.categoryId) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            categoryId: match.categoryId,
            status: 'CATEGORIZED',
            matchedRuleId: match.ruleId,
          },
        });
        retroactivelyAppliedCount++;
      }
    }
  }

  return {
    ruleCreated: createdRulesCount > 0,
    pattern: primaryPattern,
    retroactivelyAppliedCount,
  };
}
