'use client';

import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

type Params = {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  src: string; // e.g. "/dashboard/js/Chart.js"
  points: Point[];
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

declare global {
  interface Window {
    Chart?: any;
  }
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded?
    if (window.Chart) return resolve();

    // Already injected?
    const existing = document.querySelector(`script[data-chartjs="1"][src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load chart.js')));
      return;
    }

    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.setAttribute('data-chartjs', '1');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load chart.js from ${src}`));
    document.head.appendChild(s);
  });
}

function yearFromMs(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getFullYear());
}

export function useCumulativeChart({ enabled, canvasRef, src, points }: Params) {
  const chartRef = useRef<any>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!enabled) {
      // destroy if closing
      if (chartRef.current) {
        try {
          chartRef.current.destroy();
        } catch {}
        chartRef.current = null;
      }
      setStatus('idle');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setStatus('loading');
        await loadScriptOnce(src);
        if (cancelled) return;

        const Chart = window.Chart;
        if (!Chart) throw new Error('chart.js is not available on window.Chart');

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Chart canvas not mounted');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context');

        // Destroy old chart
        if (chartRef.current) {
          try {
            chartRef.current.destroy();
          } catch {}
          chartRef.current = null;
        }

        const data = points.map((p) => ({ x: p.x, y: p.y }));
        const yMax = Math.max(1, ...data.map((d) => d.y));

        const chart = new Chart(ctx, {
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
                    // `value` is numeric axis tick; show year
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
        console.error(e);
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, src, canvasRef, points]);

  // Update data without recreating (nice when stats refresh)
  useEffect(() => {
    if (!enabled) return;
    const chart = chartRef.current;
    if (!chart) return;

    const data = points.map((p) => ({ x: p.x, y: p.y }));
    chart.data.datasets[0].data = data;

    const yMax = Math.max(1, ...data.map((d: any) => Number(d.y) || 0));
    chart.options.scales.y.suggestedMax = yMax;

    chart.update('none');
  }, [enabled, points]);

  // destroy on unmount
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
