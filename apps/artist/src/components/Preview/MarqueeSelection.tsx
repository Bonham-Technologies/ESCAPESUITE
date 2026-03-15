import styles from './MarqueeSelection.module.css';

interface MarqueeProps {
  startX: number;  // CSS pixels
  startY: number;
  currentX: number;
  currentY: number;
}

export function MarqueeSelection({ startX, startY, currentX, currentY }: MarqueeProps) {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  return (
    <div
      className={styles.marquee}
      style={{ left, top, width, height }}
    />
  );
}
