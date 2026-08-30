import { PrismaClient } from '@prisma/client';
import { matchTransaction } from '../src/lib/categorizer.js';
import { generateRawHash } from '../src/lib/parsers.js';

const prisma = new PrismaClient();

// Template transactions per month
const monthConfigs = [
  { year: 2026, month: 1, monthStr: '2026-01', daysInMonth: 31, otaFactor: 0.8 },
  { year: 2026, month: 2, monthStr: '2026-02', daysInMonth: 28, otaFactor: 0.85 },
  { year: 2026, month: 3, monthStr: '2026-03', daysInMonth: 31, otaFactor: 1.0 },
  { year: 2026, month: 4, monthStr: '2026-04', daysInMonth: 30, otaFactor: 1.1 },
  { year: 2026, month: 5, monthStr: '2026-05', daysInMonth: 31, otaFactor: 1.25 },
];

async function generateMonthlyDataset() {
  console.log('Generating complete 5-month realistic dataset (Jan – May 2026)...');

  // Clear existing transactions
  await prisma.transaction.deleteMany();

  let totalInserted = 0;

  for (const cfg of monthConfigs) {
    const { year, month, monthStr, daysInMonth, otaFactor } = cfg;

    const templates = [
      // 1. Personal & Löhne (28th of month)
      { day: 28, payee: 'Philippe Dehos', amount: -3032.84, iban: 'DE24500105175430709469', desc: `Gehalt ${monthStr} Philippe Dehos` },
      { day: 28, payee: 'Afram, Nora', amount: -2489.09, iban: 'DE56550501201200707204', desc: `Gehalt ${monthStr} Afram, Nora` },
      { day: 28, payee: 'Cheltuianu, Vetuta', amount: -2335.78, iban: 'DE74550700240071915300', desc: `Gehalt ${monthStr} Cheltuianu, Vetuta` },
      { day: 28, payee: 'Rota Anzhela', amount: -2087.99, iban: 'DE10100100100935867139', desc: `Gehalt ${monthStr} Rota Anzhela` },
      { day: 28, payee: 'Susanne Puff', amount: -1949.12, iban: 'DE53540700240014218200', desc: `Gehalt ${monthStr} Susanne Puff` },
      { day: 28, payee: 'Neliya Bizikova', amount: -1763.00, iban: 'DE85550905000008660670', desc: `Gehalt ${monthStr} Neliya Bizikova` },
      { day: 28, payee: 'Olena Kapuza', amount: -1653.17, iban: 'DE78553500100022405824', desc: `Gehalt ${monthStr} Olena Kapuza` },
      { day: 28, payee: 'Hicham Ait Mansour', amount: -1534.81, iban: 'DE45553500100022976875', desc: `Gehalt ${monthStr} Hicham Ait Mansour` },
      { day: 28, payee: 'Aleyda Celebi', amount: -433.80, iban: 'DE23553500101201257902', desc: `Gehalt ${monthStr} Aleyda Celebi` },
      { day: 28, payee: 'n. bizikova', amount: -400.00, iban: 'DE85550905000008660670', desc: `Miete Büro ${monthStr}` },

      // 2. Sozialabgaben (27th of month)
      { day: 27, payee: 'IKK Suedwest', amount: -2941.21, iban: 'DE32590500000031513583', desc: `Beitraege ${monthStr}` },
      { day: 27, payee: 'Techniker Krankenkasse', amount: -2240.70, iban: 'DE59200505501280376854', desc: `Beitraege ${monthStr}` },
      { day: 27, payee: 'AOK Rheinland-Pfalz/Saarland', amount: -2204.82, iban: 'DE18370205000008190100', desc: `Beitraege ${monthStr}` },
      { day: 27, payee: 'DAK-Gesundheit', amount: -2170.93, iban: 'DE38200600000010600700', desc: `Beitraege ${monthStr}` },
      { day: 27, payee: 'Knappschaft-Bahn-See', amount: -146.03, iban: 'DE24300500000001050541', desc: `Beitraege ${monthStr}` },

      // 3. OTA Provisionen (Booking, Travelscape, HRS)
      { day: 18, payee: 'Booking.com B.V.', amount: Math.round(-3202.21 * otaFactor * 100) / 100, iban: 'NL61CHAS0198576315', desc: `Monatsprovision ${monthStr}` },
      { day: 29, payee: 'Booking.com B.V.', amount: Math.round(5730.35 * otaFactor * 100) / 100, iban: 'NL15CITI2032301393', desc: `Auszahlung Gäste ${monthStr}` },
      { day: 4, payee: 'Booking.com B.V.', amount: Math.round(6849.80 * otaFactor * 100) / 100, iban: 'NL15CITI2032301393', desc: `Auszahlung Gäste ${monthStr}` },
      { day: 27, payee: 'HRS GmbH', amount: Math.round(-284.65 * otaFactor * 100) / 100, iban: 'DE79370400440123619900', desc: `Payment Invoice ${monthStr}` },

      // 4. F&B Lieferanten
      { day: 7, payee: 'METRO SAGT DANKE', amount: -241.39, iban: 'DE70300500000006003115', desc: `METRO DEUTSCHLAND Mainz` },
      { day: 19, payee: 'METRO SAGT DANKE', amount: -129.41, iban: 'DE70300500000006003115', desc: `METRO DEUTSCHLAND Mainz` },
      { day: 27, payee: 'METRO SAGT DANKE', amount: -143.58, iban: 'DE70300500000006003115', desc: `METRO DEUTSCHLAND Mainz` },
      { day: 8, payee: 'Schwälbchen Frischdienst GmbH', amount: -386.60, iban: 'DE21551900000516189016', desc: `RG Frischdienst ${monthStr}` },
      { day: 19, payee: 'Schwälbchen Frischdienst GmbH', amount: -569.95, iban: 'DE21551900000516189016', desc: `RG Frischdienst ${monthStr}` },
      { day: 28, payee: 'Schwälbchen Frischdienst GmbH', amount: -821.19, iban: 'DE21551900000516189016', desc: `RG Frischdienst ${monthStr}` },
      { day: 7, payee: 'Backhaus Lüning GmbH', amount: -276.27, iban: 'DE40551900000019699024', desc: `Bäckerei Lieferung ${monthStr}` },
      { day: 22, payee: 'Backhaus Lüning GmbH', amount: -333.10, iban: 'DE40551900000019699024', desc: `Bäckerei Lieferung ${monthStr}` },
      { day: 6, payee: 'HEWO GETRAENKEVERTRIEBS GMBH', amount: -295.70, iban: 'DE08553500100100049667', desc: `Getränke Lieferschein ${monthStr}` },
      { day: 11, payee: 'HEWO GETRAENKEVERTRIEBS GMBH', amount: -246.85, iban: 'DE08553500100100049667', desc: `Getränke Lieferschein ${monthStr}` },
      { day: 18, payee: 'Stauder Ei', amount: -144.45, iban: 'DE21551900000407782010', desc: `Eier Lieferung ${monthStr}` },
      { day: 15, payee: 'coffee perfect GmbH', amount: -424.28, iban: 'DE12280200505228333000', desc: `Kaffee Bohnen & Miete` },

      // 5. Wäscherei & Textil
      { day: 7, payee: 'Kruppert Wasche-Dienst GmbH', amount: -436.61, iban: 'DE57518500790370104000', desc: `Bettwäsche Reinigung` },
      { day: 12, payee: 'Kruppert Wasche-Dienst GmbH', amount: -489.61, iban: 'DE57518500790370104000', desc: `Bettwäsche Reinigung` },
      { day: 15, payee: 'Kruppert Wasche-Dienst GmbH', amount: -433.93, iban: 'DE57518500790370104000', desc: `Bettwäsche Reinigung` },
      { day: 21, payee: 'Kruppert Wasche-Dienst GmbH', amount: -795.53, iban: 'DE57518500790370104000', desc: `Bettwäsche Reinigung` },
      { day: 27, payee: 'Kruppert Wasche-Dienst GmbH', amount: -454.76, iban: 'DE57518500790370104000', desc: `Bettwäsche Reinigung` },

      // 6. Energie & Nebenkosten
      { day: 15, payee: 'Mainzer Fernwärme GmbH', amount: -2176.00, iban: 'DE08551900000941141012', desc: `Abschlag Fernwärme ${monthStr}` },
      { day: 21, payee: 'Mainzer Stadtwerke Energie', amount: -384.00, iban: 'DE25550400220218630200', desc: `Wasserabschlag ${monthStr}` },
      { day: 26, payee: 'Suewag Vertrieb AG', amount: -145.00, iban: 'DE69500400000257744300', desc: `Stromabschlag ${monthStr}` },
      { day: 19, payee: 'Tibber Deutschland GmbH', amount: -87.96, iban: 'DE73512106004222458012', desc: `Strom Abrechnung ${monthStr}` },

      // 7. Pacht, Leasing & Darlehen
      { day: 29, payee: 'Teilzahlung Darlehen', amount: -3550.00, iban: 'DE72550912003435866300', desc: `Darlehen Tilgung & Zins ${monthStr}` },
      { day: 15, payee: 'S. Dehos', amount: -1100.00, iban: 'DE88551900000599753019', desc: `Ratenzahlung per Monat ${monthStr}` },
      { day: 15, payee: 'MCE BANK GMBH', amount: -766.26, iban: 'DE10500500005097000037', desc: `Miete Fahrzeug ${monthStr}` },
      { day: 3, payee: 'Landesbank Baden-Württemberg', amount: -625.00, iban: 'DE76600501010002811785', desc: `Dauerauftrag ${monthStr}` },
      { day: 18, payee: 'SC-LEASING GMBH', amount: -287.02, iban: 'DE14370206006940001115', desc: `Leasing Rate Mazda` },
      { day: 20, payee: 'O.K. Leasing AG', amount: -215.39, iban: 'DE49472601217904453100', desc: `Vertragsrate ${monthStr}` },

      // 8. Bankgebühren & Kartenterminals
      { day: 6, payee: 'LAVEGO AG', amount: -16.52, iban: 'DE02300500000001252212', desc: `Terminalgebühren ${monthStr}` },
      { day: 12, payee: 'CCV GmbH', amount: -54.03, iban: 'DE47428600030235724900', desc: `Kartenleser Service` },
      { day: 29, payee: 'VOLKSBANK ALZEY-WORMS', amount: -76.53, iban: '', desc: `Abschluss per End of Month ${monthStr}` },

      // 9. Software & IT
      { day: 5, payee: 'ibelsa GmbH', amount: -3169.77, iban: 'DE63591900000120797000', desc: `PMS Software Lizenz ${monthStr}` },
      { day: 19, payee: 'Hotel-Spider', amount: -188.00, iban: 'DE52100190001000027873', desc: `Channel Manager ${monthStr}` },
      { day: 5, payee: 'Telekom Deutschland GmbH', amount: -98.71, iban: 'DE83500100600123220600', desc: `Festnetz & DSL ${monthStr}` },
      { day: 27, payee: 'Telekom Deutschland GmbH', amount: -55.12, iban: 'DE68700202700667302269', desc: `Mobilfunk ${monthStr}` },
      { day: 6, payee: 'Smartplan ApS', amount: -44.00, iban: 'IE30CITI99005132956548', desc: `Dienstplan Software` },

      // 10. Einnahmen POS & Bareinzahlung
      { day: 4, payee: 'NEXI GERMANY GMBH', amount: Math.round(3995.92 * otaFactor * 100) / 100, iban: 'DE68512106004222308043', desc: `Kartenzahlungen Einzug` },
      { day: 29, payee: 'NEXI GERMANY GMBH', amount: Math.round(1843.05 * otaFactor * 100) / 100, iban: 'DE68512106004222308043', desc: `Kartenzahlungen Einzug` },
      { day: 29, payee: 'CITY HOTEL SCHOTTENHOF', amount: Math.round(852.00 * otaFactor * 100) / 100, iban: '', desc: `Concardis Einzug` },
      { day: 5, payee: 'VOLKSBANK ALZEY-WORMS', amount: 5340.00, iban: '', desc: `GA Bareinzahlung` },
      { day: 6, payee: 'VOLKSBANK ALZEY-WORMS', amount: 5000.00, iban: '', desc: `GA Bareinzahlung` },
    ];

    for (const t of templates) {
      const d = Math.min(t.day, daysInMonth);
      const date = new Date(Date.UTC(year, month - 1, d));
      const rawHash = generateRawHash(date, t.amount, t.payee, t.desc);

      const match = await matchTransaction(t.iban, t.payee, t.desc);

      await prisma.transaction.create({
        data: {
          date,
          amount: t.amount,
          payee: t.payee,
          iban: t.iban,
          description: t.desc,
          status: match.status,
          categoryId: match.categoryId,
          matchedRuleId: match.ruleId,
          rawHash,
        },
      });

      totalInserted++;
    }
  }

  console.log(`Successfully generated ${totalInserted} transactions across 5 months!`);
}

generateMonthlyDataset()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
