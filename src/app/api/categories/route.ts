import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [categories, sums] = await Promise.all([
      prisma.category.findMany({
        include: {
          _count: {
            select: { transactions: true, rules: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { amount: { lt: 0 }, categoryId: { not: null } },
        _sum: { amount: true },
      }),
    ]);

    const sumByCatId = new Map<string, number>();
    for (const row of sums) {
      if (row.categoryId) {
        sumByCatId.set(row.categoryId, Math.round(Math.abs(row._sum.amount || 0) * 100) / 100);
      }
    }

    const enriched = categories.map((cat) => ({
      ...cat,
      totalAmount: sumByCatId.get(cat.id) || 0,
    }));

    return NextResponse.json({ categories: enriched });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, color, icon, description } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Kategoriename erforderlich' }, { status: 400 });
    }

    const existing = await prisma.category.findUnique({
      where: { name: name.trim() },
    });

    if (existing) {
      return NextResponse.json({ error: 'Eine Kategorie mit diesem Namen existiert bereits' }, { status: 400 });
    }

    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        color: color || '#3b82f6',
        icon: icon || 'Tag',
        description: description?.trim() || null,
        isHotelCore: false,
      },
    });

    return NextResponse.json({ success: true, category });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, name, color, icon, description } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Kategorie-ID erforderlich' }, { status: 400 });
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Kategoriename erforderlich' }, { status: 400 });
    }

    const existing = await prisma.category.findUnique({
      where: { name: name.trim() },
    });

    if (existing && existing.id !== id) {
      return NextResponse.json({ error: 'Eine Kategorie mit diesem Namen existiert bereits' }, { status: 400 });
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: name.trim(),
        color,
        icon: icon || 'Tag',
        description: description?.trim() || null,
      },
    });

    return NextResponse.json({ success: true, category });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Kategorie-ID erforderlich' }, { status: 400 });
    }

    // Reset transactions before deleting category to ensure status is updated correctly
    await prisma.transaction.updateMany({
      where: { categoryId: id },
      data: {
        categoryId: null,
        status: 'UNCATEGORIZED',
        matchedRuleId: null,
      },
    });

    await prisma.category.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
