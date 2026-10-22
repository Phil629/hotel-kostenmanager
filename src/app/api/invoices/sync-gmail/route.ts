import { NextRequest, NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma } from '../../../../lib/prisma';
import {
  analyzeInvoiceDocument,
  matchInvoiceToTransaction,
  matchAllPendingInvoices,
} from '../../../../lib/invoiceMatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function getGmailCredentials(override?: { user?: string; appPassword?: string; folder?: string }) {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const user = (override?.user ?? settings?.gmailUser ?? process.env.GMAIL_USER ?? '').trim();
  // Google App-Passwörter werden oft mit Leerzeichen kopiert ("abcd efgh ijkl mnop") -> Leerzeichen entfernen
  const rawPass = override?.appPassword ?? settings?.gmailAppPassword ?? process.env.GMAIL_APP_PASSWORD ?? '';
  const pass = rawPass.replace(/\s+/g, '');
  const folder = (override?.folder ?? settings?.gmailFolder ?? 'INBOX').trim() || 'INBOX';

  return { user, pass, folder };
}

export async function POST(req: NextRequest) {
  let client: ImapFlow | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const { action, gmailUser, gmailAppPassword, gmailFolder, maxMessages = 25 } = body;

    const { user, pass, folder } = await getGmailCredentials({
      user: gmailUser,
      appPassword: gmailAppPassword,
      folder: gmailFolder,
    });

    if (!user || !pass) {
      return NextResponse.json(
        { error: 'Bitte hinterlegen Sie zuerst Ihre Gmail-Adresse und Ihr 16-stelliges Google App-Passwort.' },
        { status: 400 }
      );
    }

    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user, pass },
      logger: false,
    });
    client.on('error', (err) => {
      console.error('IMAP socket error:', err.message);
    });

    await client.connect();

    // Aktion 1: Alle vorhandenen Gmail-Ordner / Labels abrufen
    if (action === 'listFolders') {
      const list = await client.list();
      const folders = list.map((f) => ({
        path: f.path,
        name: f.name,
      }));
      await client.logout();
      return NextResponse.json({ success: true, folders });
    }

    // Aktion 2: Rechnungen aus dem gewählten Gmail-Ordner synchronisieren
    const lock = await client.getMailboxLock(folder);
    let newInvoicesCount = 0;
    let matchedCount = 0;
    let autoCategorizedCount = 0;
    let scannedEmails = 0;

    try {
      const status = client.mailbox;
      const totalMessages = status && typeof status === 'object' && 'exists' in status ? Number(status.exists) : 0;

      if (totalMessages > 0) {
        const startSeq = Math.max(1, totalMessages - maxMessages + 1);
        const range = `${startSeq}:*`;

        const existingUids = await prisma.invoice.findMany({
          where: { messageUid: { not: null } },
          select: { messageUid: true },
        });
        const existingUidSet = new Set(existingUids.map((i) => i.messageUid));

        for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true })) {
          scannedEmails++;
          const baseUid = `${folder}:${msg.uid}`;

          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || msg.envelope?.subject || 'Ohne Betreff';
          const fromText = parsed.from?.text || '';
          const emailDate = parsed.date || msg.envelope?.date || new Date();
          const htmlAsText = parsed.html
            ? String(parsed.html)
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim()
            : '';
          const fullBodyText = (parsed.text || '').trim() || htmlAsText;

          // Alle PDF-Anhänge dieser E-Mail finden
          const pdfAttachments = (parsed.attachments || []).filter(
            (att) =>
              att.contentType === 'application/pdf' ||
              (att.filename && att.filename.toLowerCase().endsWith('.pdf'))
          );

          // Selbst weitergeleitete Kopien ("Fwd:" / "WG:" vom eigenen Konto ohne eigenes PDF) überspringen,
          // da die Original-Mail bereits im selben Ordner liegt.
          const isSelfForward =
            pdfAttachments.length === 0 &&
            fromText.toLowerCase().includes(user.toLowerCase()) &&
            /^(fwd|wg):/i.test(subject.trim());
          if (isSelfForward) continue;

          if (pdfAttachments.length > 0) {
            for (let idx = 0; idx < pdfAttachments.length; idx++) {
              const att = pdfAttachments[idx];
              const msgUid = `${baseUid}:att${idx}`;
              if (existingUidSet.has(msgUid)) continue;

              const fileName = att.filename || `Rechnung_${msg.uid}_${idx + 1}.pdf`;
              const analysis = await analyzeInvoiceDocument({
                pdfBuffer: att.content,
                fileName,
                emailSubject: subject,
                emailFrom: fromText,
                emailText: fullBodyText,
              });

              const created = await prisma.invoice.create({
                data: {
                  source: 'GMAIL',
                  messageUid: msgUid,
                  fileName,
                  emailSubject: subject,
                  emailFrom: fromText,
                  emailDate,
                  vendorName: analysis.vendorName,
                  invoiceNumber: analysis.invoiceNumber,
                  invoiceDate: analysis.invoiceDate ? new Date(analysis.invoiceDate) : emailDate,
                  grossAmount: analysis.grossAmount,
                  itemsSummary: analysis.itemsSummary,
                  paymentMethod: analysis.paymentMethod,
                  suggestedCategoryId: analysis.suggestedCategoryId,
                  confidence: analysis.confidence,
                  status: 'PENDING',
                },
              });
              existingUidSet.add(msgUid);
              newInvoicesCount++;

              const matchRes = await matchInvoiceToTransaction(created.id);
              if (matchRes.matched) {
                matchedCount++;
                if (matchRes.autoCategorized) autoCategorizedCount++;
              }
            }
          } else {
            // Reine E-Mail-Rechnung ohne PDF-Anhang (z. B. PayPal-Beleg oder Online-Rechnung im Mailtext)
            const msgUid = `${baseUid}:body`;
            if (existingUidSet.has(msgUid)) continue;

            const bodyText = fullBodyText;
            if (bodyText.length < 30) continue;

            const analysis = await analyzeInvoiceDocument({
              fileName: `${subject}.eml`,
              emailSubject: subject,
              emailFrom: fromText,
              emailText: bodyText,
            });

            // Nur speichern, wenn ein Rechnungsbetrag erkannt wurde
            if (analysis.grossAmount && analysis.grossAmount > 0) {
              const created = await prisma.invoice.create({
                data: {
                  source: 'GMAIL',
                  messageUid: msgUid,
                  fileName: `${subject.slice(0, 60)} (E-Mail)`,
                  emailSubject: subject,
                  emailFrom: fromText,
                  emailDate,
                  vendorName: analysis.vendorName,
                  invoiceNumber: analysis.invoiceNumber,
                  invoiceDate: analysis.invoiceDate ? new Date(analysis.invoiceDate) : emailDate,
                  grossAmount: analysis.grossAmount,
                  itemsSummary: analysis.itemsSummary,
                  paymentMethod: analysis.paymentMethod,
                  suggestedCategoryId: analysis.suggestedCategoryId,
                  confidence: analysis.confidence,
                  status: 'PENDING',
                },
              });
              existingUidSet.add(msgUid);
              newInvoicesCount++;

              const matchRes = await matchInvoiceToTransaction(created.id);
              if (matchRes.matched) {
                matchedCount++;
                if (matchRes.autoCategorized) autoCategorizedCount++;
              }
            }
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    // Zusätzlich alle noch wartenden Rechnungen gegen die Datenbank prüfen
    const pendingRes = await matchAllPendingInvoices();
    matchedCount += pendingRes.matchedCount;
    autoCategorizedCount += pendingRes.autoCategorizedCount;

    await prisma.settings.upsert({
      where: { id: 'default' },
      update: { lastGmailSyncAt: new Date() },
      create: { id: 'default', hotelName: 'City Hotel Schottenhof', lastGmailSyncAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      scannedEmails,
      newInvoicesCount,
      matchedCount,
      autoCategorizedCount,
    });
  } catch (error: any) {
    if (client) {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
    console.error('Gmail Sync Error:', error);
    const rawMsg = error.responseText || error.message || 'Unbekannter IMAP-Fehler';
    const friendlyMsg = rawMsg.includes('Invalid credentials') || rawMsg.includes('AUTHENTICATIONFAILED')
      ? 'Anmeldung bei Gmail fehlgeschlagen. Bitte prüfen Sie die Gmail-Adresse und stellen Sie sicher, dass Sie ein 16-stelliges Google App-Passwort (nicht Ihr normales Passwort) verwenden.'
      : rawMsg;
    return NextResponse.json({ error: friendlyMsg }, { status: 500 });
  }
}
