import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Call the backend scraping service
    const response = await fetch('http://localhost:3001/api/stop-scraping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to stop scraping service');
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error stopping scraping:', error);
    return NextResponse.json(
      { error: 'Failed to stop scraping' },
      { status: 500 }
    );
  }
}