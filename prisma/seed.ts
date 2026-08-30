import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultCategories = [
  { name: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', color: '#06b6d4', icon: 'Percent', description: 'Kommissionsrechnungen von Booking.com, Expedia (Travelscape), HRS, Airbnb' },
  { name: 'Bankgebühren & Kartengebühren', color: '#64748b', icon: 'CreditCard', description: 'LAVEGO AG, CCV, Volksbank Kontoabschlussgebühren, Kartenterminal-Entgelte' },
  { name: 'F&B - Getränke', color: '#3b82f6', icon: 'Wine', description: 'HEWO Getränke, Brauereien, Coffee Perfect, Wein, Spirituosen' },
  { name: 'F&B - Lebensmittel & Bäckerei', color: '#10b981', icon: 'Utensils', description: 'METRO, Schwälbchen Frischdienst, Backhaus Lüning, Stauder Ei' },
  { name: 'Personal & Löhne', color: '#8b5cf6', icon: 'Users', description: 'Gehaltszahlungen, Aushilfen, Lohnbuchung, Mitarbeiter-Überweisungen' },
  { name: 'Personal - Sozialabgaben', color: '#a855f7', icon: 'HeartPulse', description: 'AOK, IKK Südwest, Techniker Krankenkasse, DAK, Knappschaft, BGN' },
  { name: 'Energie, Wasser & Entsorgung', color: '#f59e0b', icon: 'Zap', description: 'Mainzer Fernwärme, Suewag, EVM, Stadtwerke, Abfallwirtschaft, Müll' },
  { name: 'Textil & Wäscherei', color: '#ec4899', icon: 'Shirt', description: 'Kruppert Wäsche-Dienst, Mietwäsche Schmidt, City Clean Matten, Fränkische Bettwaren' },
  { name: 'Software, PMS & IT', color: '#357abd', icon: 'Laptop', description: 'ibelsa PMS, Hotel-Spider, Smartplan, Telekom, Vodafone, Drillisch, Google Cloud, Lexware' },
  { name: 'Instandhaltung, Handwerker & Hausreinigung', color: '#ef4444', icon: 'Wrench', description: 'AZ Heizung, Schindler Aufzüge, KONE Aufzugdienst, Strobel Sanitär, Rocker Service, Kruse Reinigungstechnik, ADA Cosmetics, Hornbach, Bauhaus, toom' },
  { name: 'Pacht, Miete, Leasing & Darlehen', color: '#475569', icon: 'Building', description: 'Darlehenstilgung, USt-Umbuchung, LBBW, MCE Bank, O.K. Leasing, Mercator-Leasing, SC-Leasing, Mercedes-Benz Bank, Büromiete' },
  { name: 'Versicherungen, Steuern & Abgaben', color: '#6366f1', icon: 'FileText', description: 'HDI, ERGO, CosmosDirekt, Allianz, Wertgarantie, HUK, Finanzamt, Grundsteuer, Kfz-Steuer, Verbandsgemeinde, PMG Parken' },
  { name: 'Fuhrpark & Kraftstoffe', color: '#0284c7', icon: 'Car', description: 'Aral, Shell, HEM Tankstellen' },
  { name: 'Einnahmen & Kartenzahlungen POS', color: '#22c55e', icon: 'TrendingUp', description: 'Nexi Germany, Concardis, POS Karteneinzüge, Bareinzahlungen Volksbank' },
  { name: 'Sonstiges / Nicht zugeordnet', color: '#94a3b8', icon: 'HelpCircle', description: 'Unkategorisierte Umsätze' },
];

const defaultRules = [
  // 1. OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)
  { categoryName: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', matchType: 'PAYEE', pattern: 'Booking.com' },
  { categoryName: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', matchType: 'PAYEE', pattern: 'TRAVELSCAPE' },
  { categoryName: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', matchType: 'PAYEE', pattern: 'Travelscape' },
  { categoryName: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', matchType: 'PAYEE', pattern: 'HRS GmbH' },
  { categoryName: 'OTA - Vermittlungsprovisionen (Booking/Expedia/HRS)', matchType: 'PAYEE', pattern: 'AIRBNB PAYMENTS' },

  // 2. Bankgebühren & Kartengebühren
  { categoryName: 'Bankgebühren & Kartengebühren', matchType: 'PAYEE', pattern: 'LAVEGO AG' },
  { categoryName: 'Bankgebühren & Kartengebühren', matchType: 'KEYWORD', pattern: 'LAVEGO' },
  { categoryName: 'Bankgebühren & Kartengebühren', matchType: 'PAYEE', pattern: 'CCV GmbH' },
  { categoryName: 'Bankgebühren & Kartengebühren', matchType: 'KEYWORD', pattern: 'ABSCHLUSS' },
  { categoryName: 'Bankgebühren & Kartengebühren', matchType: 'KEYWORD', pattern: 'UMSATZSTEUER' },

  // 3. F&B - Getränke
  { categoryName: 'F&B - Getränke', matchType: 'PAYEE', pattern: 'HEWO GETRAENKEVERTRIEBS' },
  { categoryName: 'F&B - Getränke', matchType: 'PAYEE', pattern: 'coffee perfect GmbH' },
  { categoryName: 'F&B - Getränke', matchType: 'KEYWORD', pattern: 'coffee perfect' },
  { categoryName: 'F&B - Getränke', matchType: 'KEYWORD', pattern: 'getränke' },
  { categoryName: 'F&B - Getränke', matchType: 'KEYWORD', pattern: 'brauerei' },

  // 4. F&B - Lebensmittel
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'PAYEE', pattern: 'METRO SAGT DANKE' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'KEYWORD', pattern: 'METRO DEUTSCHLAND' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'PAYEE', pattern: 'Schwälbchen Frischdienst' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'PAYEE', pattern: 'Backhaus Lüning' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'PAYEE', pattern: 'Stauder Ei' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'KEYWORD', pattern: 'bäckerei' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'KEYWORD', pattern: 'SCHECK-IN CENTER' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'KEYWORD', pattern: 'EUGEN LICH' },
  { categoryName: 'F&B - Lebensmittel & Bäckerei', matchType: 'KEYWORD', pattern: 'ALDI SE' },

  // 5. Personal & Löhne
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Hicham Ait Mansour' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Aleyda Celebi' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Olena Kapuza' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Rota Anzhela' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Philippe Dehos' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Cheltuianu, Vetuta' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Afram, Nora' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Neliya Bizikova' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Susanne Puff' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Maria Grigore' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Josephina Hirt' },
  { categoryName: 'Personal & Löhne', matchType: 'PAYEE', pattern: 'Bizikov, Elias' },
  { categoryName: 'Personal & Löhne', matchType: 'KEYWORD', pattern: 'Lohnbuchung' },

  // 6. Personal - Sozialabgaben
  { categoryName: 'Personal - Sozialabgaben', matchType: 'PAYEE', pattern: 'AOK Rheinland-Pfalz' },
  { categoryName: 'Personal - Sozialabgaben', matchType: 'PAYEE', pattern: 'IKK Suedwest' },
  { categoryName: 'Personal - Sozialabgaben', matchType: 'PAYEE', pattern: 'Techniker Krankenkasse' },
  { categoryName: 'Personal - Sozialabgaben', matchType: 'PAYEE', pattern: 'DAK-Gesundheit' },
  { categoryName: 'Personal - Sozialabgaben', matchType: 'PAYEE', pattern: 'Knappschaft-Bahn-See' },
  { categoryName: 'Personal - Sozialabgaben', matchType: 'KEYWORD', pattern: 'Berufsgenossenschaft' },

  // 7. Energie, Wasser & Entsorgung
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Mainzer Fernwärme' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Energieversorgung Mittelrhein' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Mainzer Stadtwerke Energie' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Suewag Vertrieb' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Wasserversorgung Rheinhessen' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Abwasserbes. Wöllstein' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Kommunale Abfallwirtschaft' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Wirtschaftsbetrieb Mainz' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Stadtreinigung- Eigenbetrieb' },
  { categoryName: 'Energie, Wasser & Entsorgung', matchType: 'PAYEE', pattern: 'Tibber Deutschland' },

  // 8. Textil & Wäscherei
  { categoryName: 'Textil & Wäscherei', matchType: 'PAYEE', pattern: 'Kruppert Wasche-Dienst' },
  { categoryName: 'Textil & Wäscherei', matchType: 'PAYEE', pattern: 'Mietwäsche & Textilservice Schmidt' },
  { categoryName: 'Textil & Wäscherei', matchType: 'PAYEE', pattern: 'City Clean GmbH' },
  { categoryName: 'Textil & Wäscherei', matchType: 'PAYEE', pattern: 'Fränkische Bettwarenfabrik' },

  // 9. Software, PMS & IT
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'ibelsa GmbH' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Hotel-Spider' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Smartplan ApS' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Telekom Deutschland' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Vodafone GmbH' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Telefonica Germany' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Drillisch Online' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Google Cloud' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Google Ads' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'VRM GmbH' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Gerd Walter Bornwasser' },
  { categoryName: 'Software, PMS & IT', matchType: 'KEYWORD', pattern: 'Telefonzentrale.de' },
  { categoryName: 'Software, PMS & IT', matchType: 'PAYEE', pattern: 'Haufe Service Center' },

  // 10. Instandhaltung, Handwerker & Hausreinigung
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'AZ Heizung' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'FALKEN Sanitär' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Strobel Sanitär' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'derLeckFinder' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'record Türautomation' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Schindler Aufzüge' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'KONE' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Schaller Dachdecker' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Kruse Reinigungstech' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Gottron Reinigungsmittel' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'ADA Cosmetics' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Rocker Service Mainz' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'PAYEE', pattern: 'Werner Dickopf' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'KEYWORD', pattern: 'HORNBACH' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'KEYWORD', pattern: 'BAUHAUS' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'KEYWORD', pattern: 'toom BM' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'KEYWORD', pattern: 'PayPal' },
  { categoryName: 'Instandhaltung, Handwerker & Hausreinigung', matchType: 'KEYWORD', pattern: 'AMAZON EU' },

  // 11. Pacht, Miete, Leasing & Darlehen
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'Teilzahlung Darlehen' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'DARLEHEN-TILGUNG' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'DARLEHEN-UMBUCHUNG' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'UST-UMBUCHUNG' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'O.K. Leasing' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'Mercator-Leasing' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'SC-LEASING' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'MCE BANK' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'Mercedes-Benz Bank' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'Landesbank Baden-Württemberg' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'PAYEE', pattern: 'S. Dehos' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'Miete Büro' },
  { categoryName: 'Pacht, Miete, Leasing & Darlehen', matchType: 'KEYWORD', pattern: 'WEG Lise-Meitner-Ring' },

  // 12. Versicherungen, Steuern & Abgaben
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'HDI Global' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'ERGO Versicherung' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'COSMOS Lebensversicherung' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'Allianz' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'WERTGARANTIE' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'HUK-COBURG' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'FA Idar-Oberstein' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'Finanzamt Idar-Oberstein' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'Verbandsgemeinde Wörrstadt' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'PAYEE', pattern: 'PMG Parken in Mainz' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'KEYWORD', pattern: 'Grundsteuer' },
  { categoryName: 'Versicherungen, Steuern & Abgaben', matchType: 'KEYWORD', pattern: 'Kfz-Steuer' },

  // 13. Fuhrpark & Kraftstoffe
  { categoryName: 'Fuhrpark & Kraftstoffe', matchType: 'PAYEE', pattern: 'ARAL AG' },
  { categoryName: 'Fuhrpark & Kraftstoffe', matchType: 'KEYWORD', pattern: 'ARAL' },
  { categoryName: 'Fuhrpark & Kraftstoffe', matchType: 'PAYEE', pattern: 'Shell Deutschland' },
  { categoryName: 'Fuhrpark & Kraftstoffe', matchType: 'KEYWORD', pattern: 'SHELL' },
  { categoryName: 'Fuhrpark & Kraftstoffe', matchType: 'PAYEE', pattern: 'Deutsche Tamoil' },

  // 14. Einnahmen & Kartenzahlungen POS
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'PAYEE', pattern: 'NEXI GERMANY' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'KEYWORD', pattern: 'CONCARDIS' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'PAYEE', pattern: 'CITY HOTEL SCHOTTENHOF' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'PAYEE', pattern: 'AMERICAN EXPRESS' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'PAYEE', pattern: 'American Express' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'PAYEE', pattern: 'PAYONE GmbH' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'KEYWORD', pattern: 'VOLKSBANK ALZEY-WORMS' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'KEYWORD', pattern: 'BAR-EINZAHLUNG' },
  { categoryName: 'Einnahmen & Kartenzahlungen POS', matchType: 'KEYWORD', pattern: 'Einzahlung' },
];

async function main() {
  console.log('Seeding updated hotel categories and rules...');

  for (const cat of defaultCategories) {
    const category = await prisma.category.upsert({
      where: { name: cat.name },
      update: { color: cat.color, icon: cat.icon, description: cat.description },
      create: cat,
    });

    const matchingRules = defaultRules.filter((r) => r.categoryName === cat.name);
    for (const rule of matchingRules) {
      const existing = await prisma.rule.findFirst({
        where: { categoryId: category.id, pattern: rule.pattern },
      });
      if (!existing) {
        await prisma.rule.create({
          data: {
            categoryId: category.id,
            matchType: rule.matchType,
            pattern: rule.pattern,
            isAuto: false,
          },
        });
      }
    }
  }

  await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      hotelName: 'City Hotel Schottenhof',
      autoSendReports: true,
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
