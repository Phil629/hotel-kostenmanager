import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { suggestCategoryWithGemini } from '../../../../lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const { transactionId } = await req.json();

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId erforderlich' }, { status: 400 });
    }

    const tx = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!tx) {
      return NextResponse.json({ error: 'Transaktion nicht gefunden' }, { status: 404 });
    }

    const categories = await prisma.category.findMany();

    const suggestion = await suggestCategoryWithGemini(
      { payee: tx.payee, description: tx.description, amount: tx.amount },
      categories.map((c) => ({ id: c.id, name: c.name, description: c.description }))
    );

    return NextResponse.json({
      success: true,
      transaction: tx,
      suggestion,
    });
  } catch (error: any) {
    console.error('Error in ai-categorize route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
