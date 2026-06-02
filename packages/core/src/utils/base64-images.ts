export interface Base64ImageCleanupResult {
  text: string;
  removedBase64Images: number;
}

const imageTagPattern = /<img\b[^>]*\bsrc\s*=\s*(["'])data:image\/[^"']+;base64,[^"']+\1[^>]*>/gi;
const base64ImagePlaceholder = "[Image \u2014 contenu non extrait]";

export function removeBase64Images(value: string): Base64ImageCleanupResult {
  let removedBase64Images = 0;
  const text = value.replace(imageTagPattern, () => {
    removedBase64Images += 1;
    return base64ImagePlaceholder;
  });

  return { text, removedBase64Images };
}
