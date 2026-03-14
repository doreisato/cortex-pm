// ============================================================
// CORTEX-PM: Neural Topology Visualization
// Animated particle network matching the reference dashboard.
// Renders wallet connections as a neural graph.
// Pure canvas — no Three.js dependency for simplicity.
// ============================================================

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  brightness: number;
  connections: number;
}

export function NeuralTopology({ walletCount = 20 }: { walletCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Resize canvas to container ---
    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width * 2; // 2x for retina
      canvas.height = rect.height * 2;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    // --- Initialize nodes ---
    const nodeCount = Math.max(30, Math.min(walletCount * 3, 120));
    const nodes: Node[] = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.8,
        radius: Math.random() * 2 + 1,
        brightness: Math.random() * 0.6 + 0.2,
        connections: 0,
      });
    }
    nodesRef.current = nodes;

    // --- Animation loop ---
    const CONNECTION_DIST = 120;
    let frame = 0;

    function animate() {
      if (!ctx || !canvas) return;
      frame++;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- Update positions ---
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        // Bounce off edges
        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;

        // Slight drift
        node.vx += (Math.random() - 0.5) * 0.02;
        node.vy += (Math.random() - 0.5) * 0.02;

        // Dampen
        node.vx *= 0.999;
        node.vy *= 0.999;

        node.connections = 0;
      }

      // --- Draw connections ---
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.3;
            nodes[i].connections++;
            nodes[j].connections++;

            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // --- Draw nodes ---
      for (const node of nodes) {
        const pulse = Math.sin(frame * 0.02 + node.x * 0.01) * 0.2 + 0.8;
        const alpha = node.brightness * pulse;
        const r = node.radius * (node.connections > 3 ? 1.5 : 1);

        // Outer glow for high-connection nodes
        if (node.connections > 4) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(122, 162, 255, ${alpha * 0.10})`;
          ctx.fill();
        }

        // Node dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = node.connections > 4
          ? `rgba(122, 162, 255, ${alpha})`
          : `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [walletCount]);

  return (
    <div className="topology-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
