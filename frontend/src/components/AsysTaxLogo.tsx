// Logo de la marca AsysTax. Sueldos (sub-marca de AsysTax).
//
// Construido con tipografía viva (Space Grotesk) en lugar de imagen, para que
// escale nítido en cualquier tamaño y respete los tokens de marca.
//  - Wordmark "AsysTax" — "Asys" navy, "Tax" azul primario.
//  - El punto azul cierra siempre la marca (sello de la familia). No se elimina.
//  - Descriptor "SUELDOS" en Plus Jakarta Sans, mayúsculas, tracking amplio.

interface AsysTaxLogoProps {
  /** 'dark' = sobre fondo claro (login) · 'light' = sobre fondo oscuro (sidebar) */
  variant?: 'dark' | 'light';
  /** Alto aproximado del wordmark en px. */
  height?: number;
  /** Mostrar el descriptor "SUELDOS" debajo del wordmark. */
  descriptor?: boolean;
  className?: string;
}

export default function AsysTaxLogo({
  variant = 'dark',
  height = 28,
  descriptor = true,
  className = '',
}: AsysTaxLogoProps) {
  const asys = variant === 'light' ? '#FFFFFF' : '#0B1B3A';
  const tax = variant === 'light' ? '#5B8DEF' : '#1E5BFF';
  const dot = variant === 'light' ? '#5B8DEF' : '#1E5BFF';
  const desc = variant === 'light' ? 'rgba(255,255,255,0.62)' : '#6B7A95';

  return (
    <span className={`inline-flex flex-col leading-none ${className}`} aria-label="AsysTax. Sueldos">
      <span
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: height,
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        <span style={{ color: asys }}>Asys</span>
        <span style={{ color: tax }}>Tax</span>
        <span style={{ color: dot }}>.</span>
      </span>
      {descriptor && (
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 500,
            fontSize: Math.max(8, Math.round(height * 0.32)),
            letterSpacing: '0.3em',
            color: desc,
            marginTop: Math.round(height * 0.18),
          }}
        >
          SUELDOS
        </span>
      )}
    </span>
  );
}

// Isotipo (ícono de app): cuadrado redondeado navy con "A." blanco.
export function AsysTaxIcon({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        background: '#0B1B3A',
        borderRadius: Math.round(size * 0.28),
        fontFamily: "'Space Grotesk', sans-serif",
        fontWeight: 700,
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        color: '#FFFFFF',
      }}
      aria-label="AsysTax"
    >
      <span>A</span>
      <span style={{ color: '#5B8DEF' }}>.</span>
    </span>
  );
}
