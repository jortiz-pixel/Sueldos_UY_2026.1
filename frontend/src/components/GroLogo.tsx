// Logo institucional de GRO Consultores & Asociados.
// Se reproduce como SVG (sin depender de un archivo binario) para que escale
// nítido y se adapte a fondos claros (login) y oscuros (barra lateral).
interface GroLogoProps {
  /** 'dark' = texto azul sobre fondo claro · 'light' = texto blanco sobre fondo oscuro */
  variant?: 'dark' | 'light';
  /** Alto del wordmark en px (el ancho se ajusta proporcional). */
  height?: number;
  className?: string;
}

export default function GroLogo({ variant = 'dark', height = 40, className = '' }: GroLogoProps) {
  const principal = variant === 'light' ? '#FFFFFF' : '#003DA5';
  const secundario = variant === 'light' ? '#BFD4F2' : '#5B7FB8';

  return (
    <svg
      viewBox="0 0 260 72"
      height={height}
      className={className}
      role="img"
      aria-label="GRO Consultores & Asociados"
    >
      {/* Wordmark GRO */}
      <text
        x="0"
        y="44"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="52"
        fontWeight="700"
        letterSpacing="1"
        fill={principal}
      >
        GRO
      </text>
      {/* Tagline */}
      <text
        x="2"
        y="64"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="12.5"
        letterSpacing="2.5"
        fill={secundario}
      >
        Consultores &amp; Asociados
      </text>
    </svg>
  );
}
