import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import {
  analyzeInvoiceDocument,
  matchInvoiceToTransaction,
  matchAllPendingInvoices,
} from '../../../lib/invoiceMatcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { not: 'SKIPPED' },
      },
      include: {
        suggestedCategory: true,
        matchedTransaction: {
          include: { category: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ invoices });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // 1. JSON-Aktionen (z. B. offene Rechnungen erneut mit Bankumsätzen abgleichen)
    if (contentType.includes('application/json')) {
      const body = await req.json();

      if (body.action === 'rematch') {
        const result = await matchAllPendingInvoices();
        return NextResponse.json({ success: true, ...result });
      }

      if (body.action === 'updateCategory' && body.invoiceId) {
        const nextCatId = body.categoryId ? body.categoryId : null;
        const inv = await prisma.invoice.update({
          where: { id: body.invoiceId },
          data: { suggestedCategoryId: nextCatId },
        });
        // Falls bereits mit einer Transaktion verknüpft, diese ebenfalls aktualisieren
        if (inv.matchedTransactionId) {
          await prisma.transaction.update({
            where: { id: inv.matchedTransactionId },
            data: {
              categoryId: nextCatId,
              status: nextCatId ? 'CATEGORIZED' : 'UNCATEGORIZED',
            },
          });
        } else if (nextCatId) {
          await matchInvoiceToTransaction(inv.id);
        }
        return NextResponse.json({ success: true });
      }

      if (body.action === 'updateInvoice' && body.invoiceId) {
        const nextCatId = body.suggestedCategoryId ? body.suggestedCategoryId : null;
        const parsedAmount =
          body.grossAmount !== undefined && body.grossAmount !== null && body.grossAmount !== ''
            ? parseFloat(String(body.grossAmount).replace(',', '.'))
            : null;
        const validAmount = parsedAmount !== null && !isNaN(parsedAmount) ? Math.abs(parsedAmount) : null;

        const inv = await prisma.invoice.update({
          where: { id: body.invoiceId },
          data: {
            vendorName: body.vendorName?.trim() || null,
            invoiceNumber: body.invoiceNumber?.trim() || null,
            invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
            grossAmount: validAmount,
            itemsSummary: body.itemsSummary?.trim() || null,
            paymentMethod: body.paymentMethod?.trim() || null,
            suggestedCategoryId: nextCatId,
          },
        });

        if (inv.matchedTransactionId) {
          await prisma.transaction.update({
            where: { id: inv.matchedTransactionId },
            data: {
              categoryId: nextCatId,
              status: nextCatId ? 'CATEGORIZED' : 'UNCATEGORIZED',
            },
          });
        } else {
          await matchInvoiceToTransaction(inv.id);
        }

        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: 'Unbekannte Aktion' }, { status: 400 });
    }

    // 2. PDF-Datei-Upload (einzelne oder mehrere Rechnungs-PDFs)
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const singleFile = formData.get('file') as File | null;
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : [];

    if (allFiles.length === 0) {
      return NextResponse.json({ error: 'Keine PDF-Datei ausgewählt' }, { status: 400 });
    }

    let importedCount = 0;
    let matchedCount = 0;
    let autoCategorizedCount = 0;

    for (const file of allFiles) {
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      const analysis = await analyzeInvoiceDocument({
        pdfBuffer: buffer,
        fileName: file.name || 'Rechnung.pdf',
      });

      const created = await prisma.invoice.create({
        data: {
          source: 'UPLOAD',
          fileName: file.name || 'Rechnung.pdf',
          vendorName: analysis.vendorName,
          invoiceNumber: analysis.invoiceNumber,
          invoiceDate: analysis.invoiceDate ? new Date(analysis.invoiceDate) : null,
          grossAmount: analysis.grossAmount,
          itemsSummary: analysis.itemsSummary,
          paymentMethod: analysis.paymentMethod,
          suggestedCategoryId: analysis.suggestedCategoryId,
          confidence: analysis.confidence,
          status: 'PENDING',
        },
      });
      importedCount++;

      const matchRes = await matchInvoiceToTransaction(created.id);
      if (matchRes.matched) {
        matchedCount++;
        if (matchRes.autoCategorized) autoCategorizedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      importedCount,
      matchedCount,
      autoCategorizedCount,
    });
  } catch (error: any) {
    console.error('Error in /api/invoices POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID fehlt' }, { status: 400 });
    }
    const existing = await prisma.invoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ success: true });
    }
    if (existing.messageUid) {
      // Gmail-Rechnungen als SKIPPED markieren, damit ihre UID bekannt bleibt und sie beim nächsten Sync nicht erneut geladen werden
      await prisma.invoice.update({
        where: { id },
        data: { status: 'SKIPPED', matchedTransactionId: null },
      });
    } else {
      await prisma.invoice.delete({ where: { id } });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
