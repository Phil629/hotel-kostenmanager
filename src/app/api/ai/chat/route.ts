import { NextResponse } from 'next/server';
import { answerFinancialQuestion } from '@/lib/aiAssistant';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ success: false, error: 'Keine Nachricht übergeben.' }, { status: 400 });
    }

    const answer = await answerFinancialQuestion(message);

    return NextResponse.json({
      success: true,
      answer,
    });
  } catch (error: any) {
    console.error('AI Chat Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
