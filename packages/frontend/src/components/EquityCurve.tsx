// ============================================================
// CORTEX-PM: Equity Curve Chart
// Renders cumulative P&L over time using Chart.js.
// Matches the upward-sloping white line from reference images.
// ============================================================

import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface Props {
  data: Array<{ time: string; equity: number }>;
  height?: number;
}

export function EquityCurve({ data, height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // --- Destroy previous chart instance ---
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const labels = data.map(d => {
      const date = new Date(d.time);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    const values = data.map(d => d.equity);

    // --- If no data, show placeholder ---
    if (values.length === 0) {
      // Generate demo curve for visual placeholder
      for (let i = 0; i < 50; i++) {
        labels.push(`${i}`);
        values.push(Math.sin(i * 0.1) * 20 + i * 8 + Math.random() * 10);
      }
    }

    const lastValue = values[values.length - 1] || 0;

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: '#e0e0e0',
          borderWidth: 1.5,
          fill: {
            target: 'origin',
            above: 'rgba(255, 255, 255, 0.03)',
          },
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0a0a0a',
            borderColor: '#2a2a2a',
            borderWidth: 1,
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            titleColor: '#888',
            bodyColor: '#e0e0e0',
            padding: 8,
            displayColors: false,
            callbacks: {
              label: (ctx) => `$${ctx.parsed.y.toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            display: true,
            grid: {
              color: 'rgba(255,255,255,0.03)',
              drawTicks: false,
            },
            ticks: {
              color: '#333',
              font: { family: 'JetBrains Mono', size: 9 },
              maxTicksLimit: 6,
            },
            border: { color: '#1a1a1a' },
          },
          y: {
            display: true,
            position: 'right',
            grid: {
              color: 'rgba(255,255,255,0.03)',
              drawTicks: false,
            },
            ticks: {
              color: '#555',
              font: { family: 'JetBrains Mono', size: 9 },
              callback: (val) => `$${val}`,
              maxTicksLimit: 5,
            },
            border: { color: '#1a1a1a' },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) chartRef.current.destroy();
    };
  }, [data]);

  return (
    <div className="chart-container" style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
