"use client";

import { useEffect, useRef } from "react";

type WaveBackgroundProps = {
  /** "absolute" tracks a positioned ancestor (the login card); "fixed" pins to the viewport (the app shell). */
  position?: "absolute" | "fixed";
  /** Pixel spacing between dots -- lower is denser. */
  gap?: number;
  baseRadius?: number;
  maxLift?: number;
  waveSpeed?: number;
  waveSigma?: number;
  numWaves?: number;
  baseAlpha?: number;
  alphaJitter?: number;
  maxAlpha?: number;
  opacity?: number;
};

export default function WaveBackground({
  position = "absolute",
  gap = 24,
  baseRadius = 1.1,
  maxLift = 6,
  waveSpeed = 0.032,
  waveSigma = 2.4,
  numWaves = 3,
  baseAlpha = 0.06,
  alphaJitter = 0.06,
  maxAlpha = 0.48,
  opacity = 1
}: WaveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let waveRgb = "80,150,230";
    let waveAlphaScale = 1;
    function readWaveColor() {
      const style = getComputedStyle(document.documentElement);
      waveRgb = style.getPropertyValue("--wave-rgb").trim() || waveRgb;
      const scale = parseFloat(style.getPropertyValue("--wave-alpha-scale"));
      waveAlphaScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    }
    readWaveColor();

    let W = 0, H = 0, cols = 0, rows = 0;
    let animId: number;

    interface Dot {
      bx: number; by: number;
      col: number; row: number;
      lift: number;
      alpha: number;
      r: number;
    }

    interface Wave {
      col: number;
      speed: number;
      amp: number;
      rowOffset: number;
    }

    let dots: Dot[] = [];
    let waves: Wave[] = [];

    function spawnWave(): Wave {
      return {
        col: -waveSigma * 4,
        speed: waveSpeed + Math.random() * (waveSpeed / 2),
        amp: 0.5 + Math.random() * 0.5,
        rowOffset: (Math.random() - 0.5) * 1.4
      };
    }

    function init() {
      if (!canvas) return;
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
      cols = Math.ceil(W / gap) + 1;
      rows = Math.ceil(H / gap) + 1;

      dots = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          dots.push({
            bx: c * gap, by: r * gap,
            col: c, row: r,
            lift: 0,
            alpha: baseAlpha + Math.random() * alphaJitter,
            r: baseRadius + Math.random() * 0.5
          });
        }
      }

      waves = Array.from({ length: numWaves }, (_, i) => {
        const w = spawnWave();
        w.col = -waveSigma * 4 + (cols / numWaves) * i;
        return w;
      });
    }

    function gaussian(x: number, sigma: number) {
      return Math.exp(-(x * x) / (2 * sigma * sigma));
    }

    function paint() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      for (const d of dots) {
        let totalLift = 0;
        for (const w of waves) {
          const effectiveCol = d.col - w.rowOffset * d.row;
          totalLift += w.amp * gaussian(effectiveCol - w.col, waveSigma);
        }
        d.lift = totalLift * maxLift;

        const lift01 = d.lift / maxLift;
        const y = d.by - d.lift;
        const r = d.r + lift01 * 0.9;
        const a = (d.alpha + lift01 * 0.32) * waveAlphaScale;

        ctx.beginPath();
        ctx.arc(d.bx, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${waveRgb},${Math.min(a, maxAlpha * waveAlphaScale)})`;
        ctx.fill();
      }
    }

    function frame() {
      for (const w of waves) {
        w.col += w.speed;
        if (w.col > cols + waveSigma * 4) {
          w.col = -waveSigma * 4;
          w.speed = waveSpeed + Math.random() * (waveSpeed / 2);
          w.amp = 0.5 + Math.random() * 0.5;
          w.rowOffset = (Math.random() - 0.5) * 1.4;
        }
      }
      paint();
      animId = requestAnimationFrame(frame);
    }

    init();
    // Always paint one frame so the canvas isn't blank, then only keep
    // animating if the visitor hasn't asked for reduced motion.
    paint();
    if (!reduceMotion) frame();

    const ro = new ResizeObserver(() => { init(); paint(); });
    ro.observe(canvas);

    // Repaint with the new accent color the instant the theme toggle flips
    // data-theme, instead of waiting for the next resize or frame.
    const mo = new MutationObserver(() => { readWaveColor(); paint(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      if (animId) cancelAnimationFrame(animId);
      ro.disconnect();
      mo.disconnect();
    };
  }, [position, gap, baseRadius, maxLift, waveSpeed, waveSigma, numWaves, baseAlpha, alphaJitter, maxAlpha]);

  return (
    <canvas
      ref={canvasRef}
      className={`wave-canvas${position === "fixed" ? " wave-canvas-fixed" : ""}`}
      style={{ opacity }}
    />
  );
}
