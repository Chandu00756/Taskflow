declare module 'react-confetti' {
  import * as React from 'react';

  export interface ConfettiSourceRect {
    x: number;
    y: number;
    w: number;
    h: number;
  }

  export interface ConfettiProps {
    width?: number;
    height?: number;
    numberOfPieces?: number;
    recycle?: boolean;
    gravity?: number;
    wind?: number;
    run?: boolean;
    tweenDuration?: number;
    colors?: string[];
    opacity?: number;
    drawShape?: (ctx: CanvasRenderingContext2D) => void;
    confettiSource?: ConfettiSourceRect;
    onConfettiComplete?: () => void;
    style?: React.CSSProperties;
    className?: string;
  }

  const Confetti: React.FC<ConfettiProps>;
  export default Confetti;
}
