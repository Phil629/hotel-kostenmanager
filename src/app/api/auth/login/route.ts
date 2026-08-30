import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    // Default master password or env password
    const validPassword = process.env.APP_PASSWORD || 'Schottenhof2026!';

    if (password !== validPassword) {
      return NextResponse.json({ error: 'Falsches Passwort' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    
    // Set secure HTTP-only cookie valid for 30 days
    response.cookies.set('auth_token', 'authenticated_session_token_schottenhof', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
