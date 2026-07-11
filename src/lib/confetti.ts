import confetti from "canvas-confetti";

/** Fire a short celebratory burst from the top-center.
 *  Currently unused by design: reserved for the first-ever-project moment in
 *  a future onboarding tour, not for every project creation. */
export function celebrate(): void {
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
  });
  // a second smaller burst from the sides for a fuller effect
  setTimeout(() => {
    confetti({ particleCount: 60, angle: 60, spread: 70, origin: { x: 0, y: 0.5 }, colors });
    confetti({ particleCount: 60, angle: 120, spread: 70, origin: { x: 1, y: 0.5 }, colors });
  }, 180);
}
