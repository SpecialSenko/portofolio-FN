import { useEffect, useRef } from "react";

const SPARK_COLORS = ["#ffffff", "#ffd27d", "#ffae42", "#ff8c00", "#ff4500", "#4cc9f0"];

export function CustomCursor() {
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) return;

    const sparkle = (x, y) => {
      const el = document.createElement("div");
      
      // Randomize properties for a "natural" feel
      const size = Math.random() * 3 + 2; 
      const angle = Math.random() * Math.PI * 2;
      const velocity = Math.random() * 40 + 10;
      
      // Calculate travel distance
      const driftX = Math.cos(angle) * velocity;
      const driftY = Math.sin(angle) * velocity;

      const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];

      Object.assign(el.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: "9999",
        mixBlendMode: "screen",
        background: `radial-gradient(circle, #ffffff, ${color})`,
        boxShadow: `0 0 8px ${color}`,
        transform: "translate(-50%, -50%) scale(1)",
        opacity: "1",
      });

      document.body.appendChild(el);

      // Animation using a smoother ease-out
      const animation = el.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${driftX}px), calc(-50% + ${driftY}px)) scale(0)`, opacity: 0 }
        ],
        {
          duration: 600 + Math.random() * 400, // Varied durations feel smoother
          easing: "cubic-bezier(0.16, 1, 0.3, 1)", // Expo-out curve
          fill: "forwards",
        }
      );

      animation.onfinish = () => el.remove();
    };

    const onMove = (e) => {
      // Calculate distance moved since last sparkle
      const dist = Math.hypot(e.clientX - lastPos.current.x, e.clientY - lastPos.current.y);
      
      // Only spawn a sparkle if the mouse moved more than 4 pixels 
      // This prevents "clumping" and saves CPU
      if (dist > 4) {
        sparkle(e.clientX, e.clientY);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return null;
}

export default CustomCursor;