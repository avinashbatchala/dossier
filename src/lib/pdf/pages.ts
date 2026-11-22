/**
 * How many pages a PDF has, from its page objects. Chromium writes each as
 * a plain "/Type /Page" dictionary, so no PDF library is needed.
 */
export function countPdfPages(pdf: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(pdf);
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/**
 * A profile's Base resume print path (E24-2), squeezed `fit` steps for "Fit
 * to one page" (public issue 69); the token is signed for exactly this.
 */
export const printBasePath = (fit = 0, profileId?: string) => {
  const params = new URLSearchParams({ ...(profileId ? { profile: profileId } : {}), ...(fit > 0 ? { fit: String(fit) } : {}) }).toString();
  return params ? `/print/base?${params}` : "/print/base";
};
