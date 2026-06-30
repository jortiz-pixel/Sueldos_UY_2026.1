import { useState } from 'react';

// Logo institucional de GRO Consultores & Asociados.
//
// Estrategia de calidad:
//  1) Si existe el archivo real en /gro-logo.svg (o /gro-logo.png), se usa ESE
//     (calidad original — recomendado subir un SVG vectorial).
//  2) Si no existe / falla la carga, cae al wordmark vectorial de respaldo,
//     que igual escala nítido y respeta los colores de marca.
//
// Para usar el logo oficial: dejar el archivo en frontend/public/gro-logo.svg
interface GroLogoProps {
  /** 'dark' = sobre fondo claro (login) · 'light' = sobre fondo oscuro (sidebar) */
  variant?: 'dark' | 'light';
  /** Alto del logo en px (el ancho se ajusta proporcional). */
  height?: number;
  className?: string;
}

// Archivo del logo real (si se subió a frontend/public/). Vite lo sirve desde la raíz.
// El sufijo ?v= fuerza a los navegadores a descargar la versión nueva (evita
// servir un gro-logo.svg cacheado del mismo nombre). Subir el número al cambiar el logo.
const LOGO_SRC = '/gro-logo.svg?v=3';

export default function GroLogo({ variant = 'dark', height = 40, className = '' }: GroLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const principal = variant === 'light' ? '#FFFFFF' : '#003DA5';
  const secundario = variant === 'light' ? '#BFD4F2' : '#5B7FB8';

  // Sobre fondo oscuro, el logo claro suele ser una versión en blanco; si el
  // archivo es a color, este filtro lo deja legible. (Solo afecta a la imagen.)
  const imgStyle = variant === 'light' ? { filter: 'brightness(0) invert(1)' } : undefined;

  if (!imgFailed) {
    return (
      <img
        src={LOGO_SRC}
        alt="GRO Consultores & Asociados"
        height={height}
        style={{ height, width: 'auto', ...imgStyle }}
        className={className}
        onError={() => setImgFailed(true)}
      />
    );
  }

  // Respaldo vectorial (wordmark) si todavía no se subió el archivo real.
  return (
    <svg
      viewBox="0 0 260 72"
      height={height}
      className={className}
      role="img"
      aria-label="GRO Consultores & Asociados"
    >
      <text x="0" y="44" fontFamily="Georgia, 'Times New Roman', serif" fontSize="52" fontWeight="700" letterSpacing="1" fill={principal}>
        GRO
      </text>
      <text x="2" y="64" fontFamily="Arial, Helvetica, sans-serif" fontSize="12.5" letterSpacing="2.5" fill={secundario}>
        Consultores &amp; Asociados
      </text>
    </svg>
  );
}
