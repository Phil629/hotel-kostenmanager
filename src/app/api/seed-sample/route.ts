import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { matchTransaction } from '../../../lib/categorizer';
import { generateRawHash } from '../../../lib/parsers';

const multiMonthSampleData = [
  // Mai 2026
  { date: '2026-05-29', amount: -5730.35, payee: 'Booking.com B.V.', iban: 'NL15CITI2032301393', description: 'Monatsprovision Mai 2026' },
  { date: '2026-05-28', amount: -1534.81, payee: 'Hicham Ait Mansour', iban: 'DE45553500100022976875', description: 'Gehalt Mai 2026' },
  { date: '2026-05-27', amount: -2204.82, payee: 'AOK Rheinland-Pfalz/Saarland', iban: 'DE18370205000008190100', description: 'Beitrag Mai 2026' },
  { date: '2026-05-21', amount: -2176.00, payee: 'Mainzer Fernwärme GmbH', iban: 'DE08551900000941141012', description: 'Abschlag Fernwärme Mai' },
  { date: '2026-05-19', amount: -569.95, payee: 'Schwälbchen Frischdienst GmbH', iban: 'DE21551900000516189016', description: 'Rechnung Frischdienst Mai' },

  // April 2026
  { date: '2026-04-28', amount: -4321.80, payee: 'Booking.com B.V.', iban: 'NL15CITI2032301393', description: 'Monatsprovision April 2026' },
  { date: '2026-04-28', amount: -1486.94, payee: 'Olena Kapuza', iban: 'DE78553500100022405824', description: 'Gehalt April 2026' },
  { date: '2026-04-27', amount: -2917.37, payee: 'AOK Rheinland-Pfalz/Saarland', iban: 'DE18370205000008190100', description: 'Beitrag April 2026' },
  { date: '2026-04-15', amount: -2176.00, payee: 'Mainzer Fernwärme GmbH', iban: 'DE08551900000941141012', description: 'Abschlag Fernwärme April' },
  { date: '2026-04-08', amount: -285.23, payee: 'Schwälbchen Frischdienst GmbH', iban: 'DE21551900000516189016', description: 'Rechnung Frischdienst April' },

  // März 2026
  { date: '2026-03-27', amount: -5719.75, payee: 'Booking.com B.V.', iban: 'NL15CITI2032301393', description: 'Monatsprovision März 2026' },
  { date: '2026-03-30', amount: -1886.89, payee: 'Rota Anzhela', iban: 'DE10100100100935867139', description: 'Gehalt März 2026' },
  { date: '2026-03-27', amount: -2486.15, payee: 'AOK Rheinland-Pfalz/Saarland', iban: 'DE18370205000008190100', description: 'Beitrag März 2026' },
  { date: '2026-03-16', amount: -2176.00, payee: 'Mainzer Fernwärme GmbH', iban: 'DE08551900000941141012', description: 'Abschlag Fernwärme März' },
  { date: '2026-03-11', amount: -314.83, payee: 'Kruppert Wasche-Dienst GmbH', iban: 'DE57518500790370104000', description: 'Wäschereireinigung März' },

  // Februar 2026
  { date: '2026-02-27', amount: -4029.56, payee: 'Booking.com B.V.', iban: 'NL15CITI2032301393', description: 'Monatsprovision Februar 2026' },
  { date: '2026-02-26', amount: -1734.43, payee: 'Rota Anzhela', iban: 'DE10100100100935867139', description: 'Gehalt Februar 2026' },
  { date: '2026-02-25', amount: -3194.24, payee: 'AOK Rheinland-Pfalz/Saarland', iban: 'DE18370205000008190100', description: 'Beitrag Februar 2026' },
  { date: '2026-02-05', amount: -2176.00, payee: 'Mainzer Fernwärme GmbH', iban: 'DE08551900000941141012', description: 'Abschlag Fernwärme Februar' },

  // Januar 2026
  { date: '2026-01-23', amount: -4844.60, payee: 'Booking.com B.V.', iban: 'NL15CITI2032301393', description: 'Monatsprovision Januar 2026' },
  { date: '2026-01-29', amount: -2032.94, payee: 'Cheltuianu, Vetuta', iban: 'DE74550700240071915300', description: 'Gehalt Januar 2026' },
  { date: '2026-01-28', amount: -3345.38, payee: 'AOK Rheinland-Pfalz/Saarland', iban: 'DE18370205000008190100', description: 'Beitrag Januar 2026' },
  { date: '2026-01-02', amount: -7622.68, payee: 'ERGO Versicherung Aktiengesellschaft', iban: 'DE81300700100397921800', description: 'Jahresbeitrag Betriebsgebäude 2026' },
];

export async function POST() {
  try {
    let addedCount = 0;

    for (const item of multiMonthSampleData) {
      const date = new Date(item.date);
      const rawHash = generateRawHash(date, item.amount, item.payee, item.description);

      const existing = await prisma.transaction.findUnique({ where: { rawHash } });
      if (existing) continue;

      const match = await matchTransaction(item.iban, item.payee, item.description);

      await prisma.transaction.create({
        data: {
          date,
          amount: item.amount,
          payee: item.payee,
          iban: item.iban,
          description: item.description,
          status: match.status,
          categoryId: match.categoryId,
          matchedRuleId: match.ruleId,
          rawHash,
        },
      });

      addedCount++;
    }

    return NextResponse.json({ success: true, addedCount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
