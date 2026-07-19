import confetti from "canvas-confetti";

export function celebrate(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#1982c4", "#98f5e1", "#b9fbc0", "#fde4cf", "#a3c4f3"];
  confetti({
    particleCount: 140,
    spread: 80,
    startVelocity: 45,
    gravity: 0.9,
    ticks: 220,
    origin: { y: 0.35 },
    colors,
    scalar: 1,
    zIndex: 200,
  });
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.5 },
      colors,
      zIndex: 200,
    });
    confetti({
      particleCount: 60,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.5 },
      colors,
      zIndex: 200,
    });
  }, 180);
}
