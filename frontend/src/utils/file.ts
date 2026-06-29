/**
 * Abre un PDF (u otro blob) en una pestaña nueva con el token ya aplicado.
 * Abre la pestaña en blanco de forma síncrona (dentro del gesto del usuario)
 * para evitar el bloqueo de pop-ups, y luego carga el contenido descargado.
 * Si la pestaña fue bloqueada, cae a una descarga.
 */
export async function abrirBlobEnPestania(fetchBlob: () => Promise<Blob>, filename = 'archivo.pdf') {
  const win = window.open('', '_blank');
  try {
    const blob = await fetchBlob();
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (win) win.close();
    alert('No se pudo abrir el archivo.');
  }
}
