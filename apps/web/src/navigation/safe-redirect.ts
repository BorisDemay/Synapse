/** Écrans d'authentification : y revenir depuis une redirection boucherait la
 * navigation entre connexion et déverrouillage. */
const AUTH_PATHS = ["/login", "/unlock", "/activate"];

/**
 * Chemin interne contenu dans `?redirect=` (destination d'origine d'un lien
 * profond), ou null quand la valeur n'est pas une destination sûre. Un seul
 * `/` initial est exigé : `//evil.example` et `https://evil.example` sont
 * refusés, tout comme les écrans d'authentification.
 */
export function safeInternalRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Les navigateurs normalisent l'antislash en barre oblique : une adresse
  // commençant par /\ serait lue comme protocol-relative (//evil.example).
  if (value.includes("\\")) return null;
  const path = value.split(/[?#]/u)[0] ?? "";
  if (AUTH_PATHS.includes(path.replace(/\/+$/u, ""))) return null;
  return value;
}
