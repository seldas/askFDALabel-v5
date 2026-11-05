'use client';

import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';

type Point = { x: number; y: number };

type Params = {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  src?: string; // Optional for backwards compatibility
  points: Point[];
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

function yearFromMs(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getFullYear());
}

export function useCumulativeChart({ enabled, canvasRef, points }: Params) {
  const chartRef = useRef<Chart | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!enabled) {
      if (chartRef.current) {
        try {
          chartRef.current.destroy();
        } catch {}
        chartRef.current = null;
      }
      setStatus('idle');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      setStatus('error');
      return;
    }

    // Destroy existing chart if any
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    if (chartRef.current) {
      try {
        chartRef.current.destroy();
      } catch {}
      chartRef.current = null;
    }

    try {
      const data = points.map((p) => ({ x: p.x, y: p.y }));
      const yMax = Math.max(1, ...data.map((d) => d.y));

      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Cumulative labels',
              data,
              parsing: false,
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 4,
              tension: 0.15,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: any[]) => {
                  const x = items?.[0]?.parsed?.x;
                  if (!x) return '';
                  const d = new Date(x);
                  return d.toISOString().slice(0, 10); // YYYY-MM-DD
                },
              },
            },
          },
          scales: {
            x: {
              type: 'linear', // numeric timestamp axis => evenly spaced across years
              title: { display: true, text: 'Effective time' },
              grid: { display: true },
              ticks: {
                maxTicksLimit: 6,
                callback: function (value: any) {
                  const ms = Number(value);
                  return Number.isFinite(ms) ? yearFromMs(ms) : '';
                },
              },
            },
            y: {
              beginAtZero: true,
              suggestedMax: yMax,
              title: { display: true, text: 'Cumulative count' },
              ticks: { precision: 0 },
              grid: { display: true },
            },
          },
        },
      });

      chartRef.current = chart;
      setStatus('ready');
    } catch (e) {
      console.error('Failed to initialize cumulative chart:', e);
      setStatus('error');
    }
  }, [enabled, canvasRef, points]);

  // Update data without recreating (nice when stats refresh)
  useEffect(() => {
    if (!enabled) return;
    const chart = chartRef.current;
    if (!chart) return;

    const data = points.map((p) => ({ x: p.x, y: p.y }));
    chart.data.datasets[0].data = data;

    const yMax = Math.max(1, ...data.map((d: any) => Number(d.y) || 0));
    if (chart.options.scales?.y) {
      chart.options.scales.y.suggestedMax = yMax;
    }

    chart.update('none');
  }, [enabled, points]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        try {
          chartRef.current.destroy();
        } catch {}
        chartRef.current = null;
      }
    };
  }, []);

  return { status };
}
