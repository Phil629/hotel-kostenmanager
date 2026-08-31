// @ts-ignore
import Papa from 'papaparse';
import { XMLParser } from 'fast-xml-parser';
// @ts-ignore
import crypto from 'crypto';

export interface RawParsedTransaction {
  date: Date;
  amount: number;
  payee: string;
  iban: string;
  description: string;
  rawHash: string;
}

export function generateRawHash(date: Date, amount: number, payee: string, description: string): string {
  const dateStr = date instanceof Date && !isNaN(date.getTime()) ? date.toISOString().split('T')[0] : '1970-01-01';
  const payload = `${dateStr}_${amount.toFixed(2)}_${(payee || '').trim().toLowerCase()}_${(description || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function parseAmount(val: string | number): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;

  let cleanStr = val.toString().trim();
  
  let isDebit = false;
  if (cleanStr.endsWith('S') || cleanStr.endsWith('s')) {
    isDebit = true;
    cleanStr = cleanStr.slice(0, -1).trim();
  } else if (cleanStr.endsWith('H') || cleanStr.endsWith('h')) {
    cleanStr = cleanStr.slice(0, -1).trim();
  }

  cleanStr = cleanStr.replace(/[€$£\s]/g, '');

  if (cleanStr.includes(',') && cleanStr.includes('.')) {
    cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
  } else if (cleanStr.includes(',')) {
    cleanStr = cleanStr.replace(',', '.');
  }

  let num = parseFloat(cleanStr);
  if (isNaN(num)) return 0;
  if (isDebit && num > 0) num = -num;

  return num;
}

export function parseDate(val: string): Date {
  if (!val) return new Date();
  const trimmed = val.toString().trim();

  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, month, day));
    }
  }

  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, month, day));
    }
  }

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function parseCSVContent(csvText: string): Promise<RawParsedTransaction[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: 'greedy',
      delimiter: ';', // Auto-detect or default semicolon for German Volksbank CSVs
      dynamicTyping: false,
      complete: (results) => {
        const parsed: RawParsedTransaction[] = [];

        for (const row of results.data as Record<string, string>[]) {
          const normalizedRow: Record<string, string> = {};
          for (const key of Object.keys(row)) {
            if (key && typeof key === 'string') {
              normalizedRow[key.trim().toLowerCase()] = row[key];
            }
          }

          if (
            normalizedRow['buchungstag'] === 'Buchungstag' ||
            normalizedRow['datum'] === 'Datum' ||
            normalizedRow['betrag'] === 'Betrag'
          ) {
            continue;
          }

          const dateVal =
            normalizedRow['buchungstag'] ||
            normalizedRow['datum'] ||
            normalizedRow['valutadatum'] ||
            normalizedRow['wertstellung'] ||
            normalizedRow['date'] ||
            Object.values(normalizedRow)[0];

          const payeeVal =
            normalizedRow['name zahlungsbeteiligter'] ||
            normalizedRow['beguenstigter/zahlungspflichtiger'] ||
            normalizedRow['empfänger'] ||
            normalizedRow['empfaenger'] ||
            normalizedRow['auftraggeber'] ||
            normalizedRow['auftraggeber/empfänger'] ||
            normalizedRow['name'] ||
            normalizedRow['payee'] ||
            '';

          const descVal =
            normalizedRow['verwendungszweck'] ||
            normalizedRow['buchungstext'] ||
            normalizedRow['beschreibung'] ||
            normalizedRow['description'] ||
            '';

          const ibanVal =
            normalizedRow['iban zahlungsbeteiligter'] ||
            normalizedRow['iban'] ||
            normalizedRow['kontonummer'] ||
            normalizedRow['iban/kontonummer'] ||
            '';

          const amountVal =
            normalizedRow['betrag'] ||
            normalizedRow['betrag (eur)'] ||
            normalizedRow['umsatz'] ||
            normalizedRow['umsatz (eur)'] ||
            normalizedRow['amount'] ||
            '0';

          const date = parseDate(dateVal);
          const amount = parseAmount(amountVal);
          const payee = (payeeVal || '').trim();
          const description = (descVal || '').trim();
          const iban = (ibanVal || '').trim();

          if (amount === 0 && !payee && !description) continue;

          const rawHash = generateRawHash(date, amount, payee, description);

          parsed.push({
            date,
            amount,
            payee,
            iban,
            description,
            rawHash,
          });
        }

        resolve(parsed);
      },
      error: (err: Error) => reject(err),
    });
  });
}

export function parseCAMT053Content(xmlText: string): RawParsedTransaction[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const jsonObj = parser.parse(xmlText);
  const parsed: RawParsedTransaction[] = [];

  try {
    const stmts = Array.isArray(jsonObj.Document?.BkToCstmrStmt?.Stmt)
      ? jsonObj.Document.BkToCstmrStmt.Stmt
      : jsonObj.Document?.BkToCstmrStmt?.Stmt
      ? [jsonObj.Document.BkToCstmrStmt.Stmt]
      : [];

    for (const stmt of stmts) {
      const entries = Array.isArray(stmt?.Ntry) ? stmt.Ntry : stmt?.Ntry ? [stmt.Ntry] : [];

      for (const ntry of entries) {
        const amtVal = ntry.Amt;
        let amount = typeof amtVal === 'object' ? parseAmount(amtVal['#text']) : parseAmount(amtVal);
        const cdtDbtInd = ntry.CdtDbtInd;
        if (cdtDbtInd === 'DBIT' && amount > 0) amount = -amount;

        const dateStr = ntry.BookgDt?.Dt || ntry.ValDt?.Dt || new Date().toISOString();
        const date = new Date(dateStr);

        const txDtls = ntry.NtryDtls?.TxDtls;
        const rltdPties = txDtls?.RltdPties;
        const payee = rltdPties?.Cdtr?.Nm || rltdPties?.Dbtr?.Nm || '';
        const iban = rltdPties?.CdtrAcct?.Id?.IBAN || rltdPties?.DbtrAcct?.Id?.IBAN || '';
        const description = txDtls?.RmtInf?.Ustrd || ntry.AddtlNtryInf || '';

        const rawHash = generateRawHash(date, amount, payee, description);

        parsed.push({
          date,
          amount,
          payee,
          iban,
          description,
          rawHash,
        });
      }
    }
  } catch (err) {
    console.error('Error parsing CAMT.053 XML:', err);
  }

  return parsed;
}
