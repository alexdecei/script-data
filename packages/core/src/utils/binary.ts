export function toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }

  return new Uint8Array(buffer);
}

export function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot === -1) {
    return "";
  }

  return fileName.slice(lastDot + 1).toLowerCase();
}
