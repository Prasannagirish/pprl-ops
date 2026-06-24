"use client";

import { useEffect, useRef } from "react";

export default function WaveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, cols = 0, rows = 0;
    let animId: number;

    interface Dot {
      bx: number; by: number;
      col: number; row: number;
      lift: number;
      alpha: number;
      r: number;
    }

    let dots: Dot[] = [];

    const GAP = 24;
    const BASE_R = 1.1;
    const MAX_LIFT = 6;
    const WAVE_SPEED = 0.032;
    const WAVE_SIGMA = 2.4;
    const NUM_WAVES = 3;

    interface Wave {
      col: number;
      speed: number;
      amp: number;
      rowOffset: number;
    }

    let waves: Wave[] = [];

    function spawnWave(): Wave {
      return {
        col: -WAVE_SIGMA * 4,
        speed: WAVE_SPEED + Math.random() * 0.016,
        amp: 0.5 + Math.random() * 0.5,
        rowOffset: (Math.random() - 0.5) * 1.4,
      };
    }

    function init() {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
      cols = Math.ceil(W / GAP) + 1;
      rows = Math.ceil(H / GAP) + 1;

      dots = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          dots.push({
            bx: c * GAP, by: r * GAP,
            col: c, row: r,
            lift: 0,
            alpha: 0.06 + Math.random() * 0.06,
            r: BASE_R + Math.random() * 0.5,
          });
        }
      }

      waves = Array.from({ length: NUM_WAVES }, (_, i) => {
        const w = spawnWave();
        w.col = -WAVE_SIGMA * 4 + (cols / NUM_WAVES) * i;
        return w;
      });
    }

    function gaussian(x: number, sigma: number) {
      return Math.exp(-(x * x) / (2 * sigma * sigma));
    }

    let t = 0;

    function frame() {
      ctx.clearRect(0, 0, W, H);
      t++;

      // advance waves
      for (const w of waves) {
        w.col += w.speed;
        if (w.col > cols + WAVE_SIGMA * 4) {
          w.col = -WAVE_SIGMA * 4;
          w.speed = WAVE_SPEED + Math.random() * 0.016;
          w.amp = 0.5 + Math.random() * 0.5;
          w.rowOffset = (Math.random() - 0.5) * 1.4;
        }
      }

      for (const d of dots) {
        let totalLift = 0;
        for (const w of waves) {
          const effectiveCol = d.col - w.rowOffset * d.row;
          totalLift += w.amp * gaussian(effectiveCol - w.col, WAVE_SIGMA);
        }
        d.lift = totalLift * MAX_LIFT;

        const lift01 = d.lift / MAX_LIFT;
        const y = d.by - d.lift;
        const r = d.r + lift01 * 0.9;
        const a = d.alpha + lift01 * 0.32;

        ctx.beginPath();
        ctx.arc(d.bx, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(80,150,230,${Math.min(a, 0.48)})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(frame);
    }

    init();
    frame();

    const ro = new ResizeObserver(init);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
