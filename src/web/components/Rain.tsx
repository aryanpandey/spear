import { useEffect, useRef } from "react";

const GLYPHS = "アイウエオカキクケコサシスセソタ0123456789ABCDEFｱｲｳｴｵ$+*=<>|/".split("");
const FONT = 14;

/** Lightweight Matrix "digital rain" backdrop on a canvas. */
export function Rain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let cols: number[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const n = Math.max(1, Math.floor(canvas.width / FONT));
      cols = Array.from({ length: n }, () => Math.floor((Math.random() * canvas.height) / FONT));
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.fillStyle = "rgba(6,10,6,0.10)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00ff41";
      ctx.font = `${FONT}px monospace`;
      for (let i = 0; i < cols.length; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        ctx.fillText(ch, i * FONT, cols[i] * FONT);
        if (cols[i] * FONT > canvas.height && Math.random() > 0.975) cols[i] = 0;
        cols[i]++;
      }
    };
    const timer = window.setInterval(draw, 70);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="rain" ref={ref} />;
}
