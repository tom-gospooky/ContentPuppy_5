import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Call the backend scraping service
    const response = await fetch('http://localhost:3001/api/start-scraping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to start scraping service');
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error starting scraping:', error);
    return NextResponse.json(
      { error: 'Failed to start scraping' },
      { status: 500 }
    );
  }
}