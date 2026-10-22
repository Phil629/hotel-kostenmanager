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

    // Aktion 2: Alle noch nicht geprüften E-Mails aus dem gewählten Gmail-Ordner in Batches synchronisieren
    const lock = await client.getMailboxLock(folder);
    let newInvoicesCount = 0;
    let matchedCount = 0;
    let autoCategorizedCount = 0;
    let scannedEmails = 0;
    let remainingUnseenCount = 0;
    let totalFolderEmails = 0;

    try {
      const status = client.mailbox;
      const totalMessages = status && typeof status === 'object' && 'exists' in status ? Number(status.exists) : 0;
      totalFolderEmails = totalMessages;

      if (totalMessages > 0) {
        // 1. Alle bereits in der Datenbank verarbeiteten (oder übersprungenen) Gmail-UIDs dieses Ordners laden
        const existingUids = await prisma.invoice.findMany({
          where: { messageUid: { startsWith: `${folder}:` } },
          select: { messageUid: true },
        });
        const existingUidSet = new Set(existingUids.map((i) => i.messageUid));
        const processedMsgUidNumbers = new Set<number>();
        const prefix = `${folder}:`;
        for (const row of existingUids) {
          if (!row.messageUid || !row.messageUid.startsWith(prefix)) continue;
          const rest = row.messageUid.slice(prefix.length);
          const uidNum = parseInt(rest.split(':')[0], 10);
          if (!isNaN(uidNum)) {
            processedMsgUidNumbers.add(uidNum);
          }
        }

        // 2. Blitzschneller Abruf aller vorhandenen E-Mail-UIDs im Ordner (ohne Body/Anhänge < 0.2 Sek.)
        const allMailboxUids: number[] = [];
        for await (const meta of client.fetch('1:*', { uid: true })) {
          if (meta.uid) allMailboxUids.push(meta.uid);
        }

        // 3. Nur die noch NIE geprüften UIDs herausfiltern (neueste zuerst)
        const unseenUids = allMailboxUids
          .filter((uid) => !processedMsgUidNumbers.has(uid))
          .sort((a, b) => b - a);

        const batchSize = Math.min(Number(body.batchSize) || 8, 15);
        const batchUids = unseenUids.slice(0, batchSize);
        remainingUnseenCount = Math.max(0, unseenUids.length - batchUids.length);

        if (batchUids.length > 0) {
          const uidRange = batchUids.join(',');
          for await (const msg of client.fetch(uidRange, { uid: true, envelope: true, source: true }, { uid: true })) {
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

            // Selbst weitergeleitete Kopien ("Fwd:" / "WG:" vom eigenen Konto ohne eigenes PDF) als SKIPPED markieren,
            // damit sie beim nächsten Sync nicht erneut heruntergeladen werden müssen.
            const isSelfForward =
              pdfAttachments.length === 0 &&
              fromText.toLowerCase().includes(user.toLowerCase()) &&
              /^(fwd|wg):/i.test(subject.trim());

            if (isSelfForward) {
              const skipUid = `${baseUid}:skipped`;
              if (!existingUidSet.has(skipUid)) {
                await prisma.invoice.create({
                  data: {
                    source: 'GMAIL',
                    messageUid: skipUid,
                    fileName: 'Weiterleitungs-Kopie (übersprungen)',
                    emailSubject: subject,
                    emailFrom: fromText,
                    emailDate,
                    status: 'SKIPPED',
                  },
                });
                existingUidSet.add(skipUid);
              }
              continue;
            }

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
              if (bodyText.length < 30) {
                const skipUid = `${baseUid}:skipped`;
                if (!existingUidSet.has(skipUid)) {
                  await prisma.invoice.create({
                    data: {
                      source: 'GMAIL',
                      messageUid: skipUid,
                      fileName: 'Leere E-Mail (übersprungen)',
                      emailSubject: subject,
                      emailFrom: fromText,
                      emailDate,
                      status: 'SKIPPED',
                    },
                  });
                  existingUidSet.add(skipUid);
                }
                continue;
              }

              const analysis = await analyzeInvoiceDocument({
                fileName: `${subject}.eml`,
                emailSubject: subject,
                emailFrom: fromText,
                emailText: bodyText,
              });

              // Nur als Rechnung speichern, wenn ein Rechnungsbetrag erkannt wurde; sonst als SKIPPED markieren
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
              } else {
                const skipUid = `${baseUid}:skipped`;
                if (!existingUidSet.has(skipUid)) {
                  await prisma.invoice.create({
                    data: {
                      source: 'GMAIL',
                      messageUid: skipUid,
                      fileName: 'Kein Rechnungsbetrag erkannt (übersprungen)',
                      emailSubject: subject,
                      emailFrom: fromText,
                      emailDate,
                      status: 'SKIPPED',
                    },
                  });
                  existingUidSet.add(skipUid);
                }
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
      remainingUnseenCount,
      totalFolderEmails,
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
